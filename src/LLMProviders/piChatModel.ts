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
          const response = await raceWithAbortSignal(transport(input, init), controller.signal);
          // pi-ai's error event retains text, not HTTP status; classification must remain request-local. https://github.com/ItsDalk-Lane/Scribe/issues/8
          status = response.ok ? undefined : response.status;
          return response;
        };
        const source = request.stream(model, normalizeContext(context), {
          ...request.options,
          ...options,
          headers: { ...request.options.headers, ...options.headers },
          signal: controller.signal,
          fetch: requestFetch,
        });
        const iterator = source[Symbol.asyncIterator]();
        let completed = false;
        try {
          while (true) {
            const next = await raceWithAbortSignal(iterator.next(), controller.signal);
            if (next.done) break;
            const event = next.value;
            // Error events must never commit a partially generated answer as a successful turn. https://github.com/ItsDalk-Lane/Scribe/issues/8
            if (event.type === "error") {
              const error = new Error(event.error.errorMessage || "The model request failed.");
              if (event.reason === "aborted") error.name = "AbortError";
              throw Object.assign(error, { status });
            }
            if (event.type === "done") completed = true;
            yield event;
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
