import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
  ProviderStreams,
  StreamOptions,
  SimpleStreamOptions,
  AssistantMessageEventStream,
} from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { thinkingBudgetForLevel } from "@earendil-works/pi-ai/api/simple-options";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { isRecord } from "@/utils/obsidianInternals";

export interface ChatStreamOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  maxRetries?: number;
}

export interface AgentStreamOptions extends SimpleStreamOptions {
  disableReasoning?: boolean;
}

export interface ProviderChatModel {
  model: Model<Api>;
  stream(context: Context, options?: ChatStreamOptions): AsyncIterable<AssistantMessageEvent>;
  agentStream(context: Context, options?: AgentStreamOptions): AssistantMessageEventStream;
}

export interface PiRequest {
  stream: ProviderStreams["stream"];
  options: StreamOptions;
}

class PiStreamError extends Error {
  constructor(
    readonly assistantMessage: AssistantMessage,
    readonly status: number | undefined,
    source: Error
  ) {
    super(source.message);
    this.name = source.name;
  }
}

// 供应商错误正文可能原样回显请求凭据；进入会话、界面或日志前移除凭据，保留模型、协议与 HTTP 状态用于诊断。
// 占位密钥不是真实凭据，脱敏时跳过。https://github.com/ItsDalk-Lane/Scribe/issues/9
const NON_SECRET_KEYS = new Set(["keyless-endpoint", "provider-managed-auth", "default-key"]);

function safeModelErrorDetail(detail: string, secrets: string[], status: number | undefined) {
  let text = detail;
  for (const secret of secrets) {
    if (secret.length >= 8 && !NON_SECRET_KEYS.has(secret))
      text = text.split(secret).join("[redacted]");
  }
  if (status !== undefined && !text.includes(String(status))) text = `HTTP ${status}: ${text}`;
  return text.length > 600 ? `${text.slice(0, 600)}[truncated]` : text;
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
  resolveRequest: (options: SimpleStreamOptions) => Promise<PiRequest>
): ProviderChatModel {
  // 本轮请求的凭据候选与 HTTP 状态，仅用于错误脱敏，绝不离开诊断文本。
  // https://github.com/ItsDalk-Lane/Scribe/issues/9
  let errorSecrets: string[] = [];
  let failureStatus: number | undefined;
  async function* run(
    context: Context,
    options: AgentStreamOptions = {}
  ): AsyncGenerator<AssistantMessageEvent> {
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let transportError: unknown;
    try {
      // A stopped turn must not start a credential refresh or open another request. https://github.com/ItsDalk-Lane/Scribe/issues/8
      if (controller.signal.aborted) throw new DOMException("Aborted", "AbortError");
      let request: PiRequest;
      try {
        request = await raceWithAbortSignal(
          resolveRequest({ ...options, signal: controller.signal }),
          controller.signal
        );
      } catch (error) {
        const data = error as { status?: number; statusCode?: number } | null;
        failureStatus = data?.status ?? data?.statusCode;
        throw error;
      }
      errorSecrets = [
        ...(typeof request.options.apiKey === "string" ? [request.options.apiKey] : []),
        ...Object.values(request.options.headers ?? {}).filter(
          (value): value is string => typeof value === "string"
        ),
      ];
      const transport = request.options.fetch;
      if (!transport) throw new Error("A provider transport is required.");
      const requestFetch: typeof fetch = async (input, init) => {
        try {
          const response = await raceWithAbortSignal(transport(input, init), controller.signal);
          // pi-ai 的错误事件只保留文字，认证失败状态也必须留在本轮请求中。https://github.com/ItsDalk-Lane/Scribe/issues/8
          failureStatus = response.ok ? undefined : response.status;
          transportError = undefined;
          return response;
        } catch (error) {
          const data = error as { status?: number; statusCode?: number } | null;
          failureStatus = data?.status ?? data?.statusCode;
          transportError = error;
          throw error;
        }
      };
      const initialText: string[] = [];
      let structuredRefusal = false;
      // 按内容块记录已发送的正文，完成快照只更新结果，不能再次追加文字。https://github.com/ItsDalk-Lane/Scribe/issues/8
      const textByIndex = new Map<number, string>();
      const textSnapshot = (message: AssistantMessage): AssistantMessage => ({
        ...message,
        ...(structuredRefusal ? { rawStopReason: "refusal" } : {}),
        content: message.content.map((part, index) =>
          part.type === "text" && textByIndex.has(index)
            ? { ...part, text: textByIndex.get(index)! }
            : part
        ),
      });
      const source = request.stream(model, normalizeContext(context), {
        ...request.options,
        ...options,
        apiKey: request.options.apiKey,
        transport: request.options.transport,
        cacheRetention: request.options.cacheRetention,
        maxTokens: options.maxTokens ?? request.options.maxTokens,
        maxRetries: options.maxRetries ?? request.options.maxRetries,
        onPayload: async (payload, selectedModel) => {
          const replacement: unknown = await request.options.onPayload?.(payload, selectedModel);
          const body = replacement === undefined ? payload : replacement;
          if (!isRecord(body)) throw new Error("Unexpected model request payload.");
          if (options.disableReasoning) {
            if (model.api === "openai-completions") {
              if (isRecord(body.reasoning)) body.reasoning = { effort: "none" };
              else body.reasoning_effort = "none";
            } else if (model.api === "openai-responses") body.reasoning = { effort: "none" };
            else if (model.api === "anthropic-messages") {
              body.thinking = { type: "disabled" };
              if (isRecord(body.output_config)) delete body.output_config.effort;
            } else if (model.api === "google-generative-ai") {
              body.generationConfig = {
                ...(isRecord(body.generationConfig) ? body.generationConfig : {}),
                thinkingConfig: { includeThoughts: false, thinkingBudget: 0 },
              };
            } else if (model.api === "scribe-cohere") body.thinking = { type: "disabled" };
            else if (model.api === "scribe-ollama") body.think = false;
            else if (model.api === "scribe-sap") {
              const config = body.config;
              const modules = isRecord(config) ? config.modules : undefined;
              const templating = isRecord(modules) ? modules.prompt_templating : undefined;
              const sapModel = isRecord(templating) ? templating.model : undefined;
              if (!isRecord(sapModel) || !isRecord(sapModel.params))
                throw new Error("Unexpected SAP model request payload.");
              sapModel.params.reasoning_effort = "none";
            } else throw new Error(`Reasoning disablement is unsupported for ${model.api}.`);
          } else if (options.reasoning !== undefined && model.api === "openai-completions") {
            if (isRecord(body.reasoning)) body.reasoning = { effort: options.reasoning };
            else body.reasoning_effort = options.reasoning;
          }
          return body;
        },
        ...(options.reasoning !== undefined
          ? {
              reasoningEffort: options.reasoning,
              ...(model.api === "anthropic-messages"
                ? {
                    thinkingEnabled: true,
                    effort: options.reasoning,
                    thinkingBudgetTokens: Math.min(
                      thinkingBudgetForLevel(options.reasoning, options.thinkingBudgets),
                      Math.max(
                        0,
                        (options.maxTokens ?? request.options.maxTokens ?? model.maxTokens) - 1024
                      )
                    ),
                  }
                : {}),
            }
          : {}),
        headers: { ...request.options.headers, ...options.headers },
        signal: controller.signal,
        fetch: requestFetch,
        onProviderStreamEvent: (data, descriptor) => {
          if (isRecord(data) && data.type === "response.refusal.delta") structuredRefusal = true;
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
            throw new PiStreamError(textSnapshot(event.error), failureStatus, error);
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
  }
  return {
    model,
    stream: run,
    agentStream(context, options = {}) {
      const events = createAssistantMessageEventStream();
      let partial = createAssistantMessage(model);
      void (async () => {
        try {
          for await (const event of run(context, options)) {
            partial =
              "partial" in event
                ? event.partial
                : event.type === "done"
                  ? event.message
                  : event.error;
            events.push(event);
          }
        } catch (error) {
          const reason =
            options.signal?.aborted || (error instanceof Error && error.name === "AbortError")
              ? "aborted"
              : "error";
          const message: AssistantMessage = {
            ...(error instanceof PiStreamError ? error.assistantMessage : partial),
            stopReason: reason,
            errorMessage: `${model.id} (${model.api}), model stream: ${safeModelErrorDetail(
              error instanceof Error ? error.message : String(error),
              errorSecrets,
              failureStatus
            )}`,
          };
          events.push({ type: "error", reason, error: message });
        } finally {
          events.end();
        }
      })();
      return events;
    },
  };
}
