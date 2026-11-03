import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  ProviderStreams,
  StreamOptions,
} from "@earendil-works/pi-ai";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { isRecord } from "@/utils/obsidianInternals";

export interface ChatStreamOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  maxRetries?: number;
}

export interface ProviderChatModel {
  model: Model<Api>;
  stream(context: Context, options?: ChatStreamOptions): AsyncIterable<AssistantMessageEvent>;
}

export interface PiRequest {
  stream: ProviderStreams["stream"];
  options: StreamOptions;
}

export function createAssistantMessage(model: Model<Api>): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content: [],
    stopReason: "pending",
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  };
}

// 网关的文字数组必须在结构仍完整时提取，避免逗号、对象标记或隐藏思考混入正文。https://github.com/ItsDalk-Lane/Scribe/issues/8
function visibleText(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value
    .map((part) =>
      typeof part === "string"
        ? part
        : isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? part.text
          : ""
    )
    .join("");
}

export function createPiChatModel(
  model: Model<Api>,
  resolveRequest: (options: ChatStreamOptions) => Promise<PiRequest>
): ProviderChatModel {
  return {
    model,
    async *stream(context, options = {}) {
      const controller = new AbortController();
      const abort = () => controller.abort(options.signal?.reason);
      options.signal?.addEventListener("abort", abort, { once: true });
      if (options.signal?.aborted) abort();
      let status: number | undefined;
      let transportError: unknown;
      try {
        // A stopped turn must not start a credential refresh or open another request. https://github.com/ItsDalk-Lane/Scribe/issues/8
        if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
        const request = await raceWithAbortSignal(
          resolveRequest({ ...options, signal: controller.signal }),
          controller.signal
        );
        const transport = request.options.fetch;
        if (!transport) throw new Error("A provider transport is required.");
        const requestFetch: typeof fetch = async (input, init) => {
          try {
            const response = await raceWithAbortSignal(transport(input, init), controller.signal);
            // pi-ai 的错误事件只保留文字，认证失败状态也必须留在本轮请求中。https://github.com/ItsDalk-Lane/Scribe/issues/8
            status = response.ok ? undefined : response.status;
            transportError = undefined;
            return response;
          } catch (error) {
            const data = error as { status?: number; statusCode?: number } | null;
            status = data?.status ?? data?.statusCode;
            transportError = error;
            throw error;
          }
        };
        const initialText: string[] = [];
        // 按内容块记录已发送的正文，完成快照只更新结果，不能再次追加文字。https://github.com/ItsDalk-Lane/Scribe/issues/8
        const textByIndex = new Map<number, string>();
        const textSnapshot = (message: AssistantMessage): AssistantMessage => ({
          ...message,
          content: message.content.map((part, index) =>
            part.type === "text" && textByIndex.has(index)
              ? { ...part, text: textByIndex.get(index)! }
              : part
          ),
        });
        const source = request.stream(model, normalizeContext(context), {
          ...request.options,
          ...options,
          headers: { ...request.options.headers, ...options.headers },
          signal: controller.signal,
          fetch: requestFetch,
          onProviderStreamEvent: (data, descriptor) => {
            // 先保存首块文字；队列中的 partial 仍会被 SDK 后续增量修改。https://github.com/ItsDalk-Lane/Scribe/issues/8
            if (
              isRecord(data) &&
              data.type === "content_block_start" &&
              isRecord(data.content_block) &&
              data.content_block.type === "text"
            ) {
              initialText.push(visibleText(data.content_block.text));
            }
            return request.options.onProviderStreamEvent?.(data, descriptor);
          },
        });
        const iterator = source[Symbol.asyncIterator]();
        let completed = false;
        try {
          while (true) {
            const next = await raceWithAbortSignal(iterator.next(), controller.signal);
            if (next.done) break;
            let event = next.value;
            // Error events must never commit a partially generated answer as a successful turn. https://github.com/ItsDalk-Lane/Scribe/issues/8
            if (event.type === "error") {
              const error =
                transportError instanceof Error
                  ? transportError
                  : new Error(event.error.errorMessage || "The model request failed.");
              if (event.reason === "aborted") error.name = "AbortError";
              throw Object.assign(error, { status });
            }
            if (event.type === "text_start") {
              const text = initialText.shift() ?? "";
              textByIndex.set(event.contentIndex, text);
              yield { ...event, partial: textSnapshot(event.partial) };
              // 首块补发也要尊重两次迭代之间的停止，避免取消后新增可见文字。https://github.com/ItsDalk-Lane/Scribe/issues/8
              if (text && !controller.signal.aborted)
                yield {
                  type: "text_delta",
                  contentIndex: event.contentIndex,
                  delta: text,
                  partial: textSnapshot(event.partial),
                };
              continue;
            }
            if (event.type === "text_delta") {
              const delta = visibleText(event.delta);
              textByIndex.set(
                event.contentIndex,
                (textByIndex.get(event.contentIndex) ?? "") + delta
              );
              event = { ...event, delta };
            }
            if (event.type === "text_end")
              event = { ...event, content: textByIndex.get(event.contentIndex) ?? event.content };
            if (event.type === "done") {
              completed = true;
              event = { ...event, message: textSnapshot(event.message) };
            }
            yield "partial" in event ? { ...event, partial: textSnapshot(event.partial) } : event;
          }
          if (!completed) throw new Error("The model stream ended before completion.");
        } finally {
          // A pending iterator cannot finish until the event queue closes, even after its fetch is aborted. https://github.com/ItsDalk-Lane/Scribe/issues/8
          controller.abort();
          source.end();
          await iterator.return?.();
        }
      } finally {
        options.signal?.removeEventListener("abort", abort);
        controller.abort();
      }
    },
  };
}
