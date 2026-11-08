import type {
  Api,
  AssistantMessage,
  ToolCall,
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
import { observeProviderResponse } from "@/LLMProviders/providerResponse";
import {
  classifyProviderFailure,
  ProviderRequestError,
  waitForProviderRetry,
  type ProviderRequestFailure,
} from "@/LLMProviders/providerRequestFailure";
import { RequestRedactor } from "@/LLMProviders/requestRedaction";
import { isRecord } from "@/utils/obsidianInternals";
import { v4 as uuidv4 } from "uuid";

export interface ChatStreamOptions {
  signal?: AbortSignal;
  headers?: Record<string, string>;
  maxRetries?: number;
}

export interface AgentStreamOptions extends SimpleStreamOptions {
  disableReasoning?: boolean;
  onFailure?: (failure: ProviderRequestFailure) => void;
  beforeRequest?: (requestId: string) => void | Promise<void>;
  onRequestUsage?: (requestId: string, usage: AssistantMessage["usage"]) => void | Promise<void>;
}

export interface ProviderChatModel {
  model: Model<Api>;
  stream(context: Context, options?: ChatStreamOptions): AsyncIterable<AssistantMessageEvent>;
  agentStream(context: Context, options?: AgentStreamOptions): AssistantMessageEventStream;
}

export interface PiRequest {
  stream: ProviderStreams["stream"];
  options: StreamOptions;
  redactionValues?: string[];
}

class PiStreamError extends ProviderRequestError {
  constructor(
    readonly assistantMessage: AssistantMessage | undefined,
    source: Error,
    failure: ProviderRequestFailure
  ) {
    super(source.message, failure);
    this.name = source.name;
  }
}

function safeModelErrorDetail(detail: string, secrets: string[], status: number | undefined) {
  let text = new RequestRedactor(secrets).redact(detail);
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
  async function* attempt(
    context: Context,
    options: AgentStreamOptions,
    setRetryBudget: (budget: number) => void
  ): AsyncGenerator<AssistantMessageEvent> {
    let errorSecrets: string[] = [];
    let redactor = new RequestRedactor(errorSecrets);
    let failureStatus: number | undefined;
    let capturedFailure: ProviderRequestFailure | undefined;
    let requestId: string | undefined;
    const controller = new AbortController();
    const abort = () => controller.abort(options.signal?.reason);
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    let transportError: unknown;
    try {
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
      setRetryBudget(options.maxRetries ?? request.options.maxRetries ?? 0);
      errorSecrets = request.redactionValues ?? [];
      errorSecrets.push(
        ...(typeof request.options.apiKey === "string" ? [request.options.apiKey] : []),
        ...Object.values(request.options.headers ?? {}).filter(
          (value): value is string => typeof value === "string"
        )
      );
      redactor = new RequestRedactor(errorSecrets);
      const transport = request.options.fetch;
      if (!transport) throw new Error("A provider transport is required.");
      const requestFetch: typeof fetch = async (input, init) => {
        try {
          controller.signal.throwIfAborted();
          // 重试和协议续请求都必须先取得同一主任务的预算名额。https://github.com/ItsDalk-Lane/Scribe/issues/50
          const nextRequestId = uuidv4();
          await options.beforeRequest?.(nextRequestId);
          controller.signal.throwIfAborted();
          requestId = nextRequestId;
          const response = await raceWithAbortSignal(transport(input, init), controller.signal);
          failureStatus = response.ok ? undefined : response.status;
          transportError = undefined;
          return await observeProviderResponse(
            response,
            (failure) => {
              capturedFailure = failure;
            },
            controller.signal
          );
        } catch (error) {
          const data = error as { status?: number; statusCode?: number } | null;
          failureStatus = data?.status ?? data?.statusCode ?? failureStatus;
          transportError = error;
          throw error;
        }
      };
      const initialText: string[] = [];
      let structuredRefusal = false;
      const textByIndex = new Map<number, string>();
      const thinkingByIndex = new Map<number, string>();
      const toolSnapshot = (part: ToolCall): ToolCall => ({
        ...part,
        arguments: redactor.structured(part.arguments),
        ...(part.argumentsError ? { argumentsError: redactor.redact(part.argumentsError) } : {}),
      });
      const textSnapshot = (message: AssistantMessage): AssistantMessage => ({
        ...message,
        ...(message.errorMessage ? { errorMessage: redactor.redact(message.errorMessage) } : {}),
        ...(structuredRefusal ? { rawStopReason: "refusal" } : {}),
        content: message.content.map((part, index) => {
          if (part.type === "text")
            return {
              ...part,
              text: textByIndex.get(index) ?? redactor.redact(part.text),
            };
          if (part.type === "thinking")
            return {
              ...part,
              thinking: thinkingByIndex.get(index) ?? redactor.redact(part.thinking),
            };
          if (part.type === "toolCall") return toolSnapshot(part);
          return part;
        }),
      });
      const source = request.stream(model, normalizeContext(context), {
        ...request.options,
        ...options,
        apiKey: request.options.apiKey,
        transport: request.options.transport,
        cacheRetention: request.options.cacheRetention,
        maxTokens: options.maxTokens ?? request.options.maxTokens,
        maxRetries: 0,
        onPayload: async (payload, selectedModel) => {
          const replacement: unknown = await request.options.onPayload?.(payload, selectedModel);
          const body = replacement === undefined ? payload : replacement;
          if (!isRecord(body)) throw new Error("Unexpected model request payload.");
          if (
            options.reasoning === undefined &&
            !options.disableReasoning &&
            !("reasoningEffort" in request.options)
          ) {
            if (model.api === "openai-responses") delete body.reasoning;
            if (isRecord(body.thinking) && body.thinking.type === "disabled") delete body.thinking;
          }
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
            const effort = model.thinkingLevelMap?.[options.reasoning] ?? options.reasoning;
            if (isRecord(body.reasoning)) body.reasoning = { effort };
            else body.reasoning_effort = effort;
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
          if (
            isRecord(data) &&
            (data.error !== undefined || data.type === "response.failed" || data.type === "error")
          )
            capturedFailure = classifyProviderFailure({ payload: data });
          if (isRecord(data) && data.type === "response.refusal.delta") structuredRefusal = true;
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
          if ((event.type === "done" || event.type === "error") && requestId) {
            const message = event.type === "done" ? event.message : event.error;
            await options.onRequestUsage?.(requestId, message.usage);
          }
          if (event.type === "error") {
            const error =
              transportError instanceof Error
                ? transportError
                : new Error(event.error.errorMessage || "The model request failed.");
            if (event.reason === "aborted") error.name = "AbortError";
            throw new PiStreamError(
              textSnapshot(event.error),
              error,
              capturedFailure ?? classifyProviderFailure({ status: failureStatus, cause: error })
            );
          }
          if (event.type === "text_start") {
            const text = redactor.push(event.contentIndex, initialText.shift() ?? "");
            textByIndex.set(event.contentIndex, text);
            yield { ...event, partial: textSnapshot(event.partial) };
            if (text && !controller.signal.aborted)
              yield {
                type: "text_delta",
                contentIndex: event.contentIndex,
                delta: text,
                partial: textSnapshot(event.partial),
              };
            continue;
          }
          if (event.type === "thinking_start") thinkingByIndex.set(event.contentIndex, "");
          if (
            event.type === "text_delta" ||
            event.type === "thinking_delta" ||
            event.type === "toolcall_delta"
          ) {
            const delta = redactor.push(event.contentIndex, visibleText(event.delta));
            if (event.type !== "toolcall_delta") {
              const parts = event.type === "text_delta" ? textByIndex : thinkingByIndex;
              parts.set(event.contentIndex, (parts.get(event.contentIndex) ?? "") + delta);
            }
            event = { ...event, delta };
          }
          if (
            event.type === "text_end" ||
            event.type === "thinking_end" ||
            event.type === "toolcall_end"
          ) {
            const delta = redactor.flush(event.contentIndex);
            const parts = event.type === "text_end" ? textByIndex : thinkingByIndex;
            if (event.type !== "toolcall_end")
              parts.set(event.contentIndex, (parts.get(event.contentIndex) ?? "") + delta);
            if (delta)
              yield {
                type:
                  event.type === "text_end"
                    ? "text_delta"
                    : event.type === "thinking_end"
                      ? "thinking_delta"
                      : "toolcall_delta",
                contentIndex: event.contentIndex,
                delta,
                partial: textSnapshot(event.partial),
              };
            if (event.type === "toolcall_end")
              event = {
                ...event,
                toolCall: toolSnapshot(event.toolCall),
              };
            else
              event = {
                ...event,
                content: parts.get(event.contentIndex) ?? redactor.redact(event.content),
              };
          }
          if (event.type === "done") {
            completed = true;
            event = { ...event, message: textSnapshot(event.message) };
          }
          yield "partial" in event ? { ...event, partial: textSnapshot(event.partial) } : event;
        }
        if (!completed) throw new Error("The model stream ended before completion.");
      } finally {
        controller.abort();
        source.end();
        await iterator.return?.();
      }
    } catch (error) {
      const classified =
        controller.signal.aborted && options.signal?.aborted
          ? { kind: "cancelled" as const }
          : (capturedFailure ?? classifyProviderFailure({ status: failureStatus, cause: error }));
      const failure = {
        ...classified,
        ...(classified.code ? { code: redactor.redact(classified.code) } : {}),
      };
      const safe = new Error(
        safeModelErrorDetail(
          error instanceof Error ? error.message : String(error),
          errorSecrets,
          undefined
        )
      );
      safe.name =
        failure.kind === "cancelled" ? "AbortError" : error instanceof Error ? error.name : "Error";
      throw new PiStreamError(
        error instanceof PiStreamError ? error.assistantMessage : undefined,
        safe,
        failure
      );
    } finally {
      options.signal?.removeEventListener("abort", abort);
      controller.abort();
    }
  }
  async function* run(
    context: Context,
    options: AgentStreamOptions = {}
  ): AsyncGenerator<AssistantMessageEvent> {
    let retryBudget = options.maxRetries ?? 3;
    let producedContent = false;
    for (let retries = 0; ; retries++) {
      try {
        for await (const event of attempt(context, options, (budget) => {
          retryBudget = budget;
        })) {
          if (
            event.type === "toolcall_start" ||
            event.type === "toolcall_delta" ||
            (event.type === "text_delta" && event.delta.length > 0) ||
            (event.type === "thinking_delta" && event.delta.length > 0)
          )
            producedContent = true;
          yield event;
        }
        return;
      } catch (error) {
        const failure = classifyProviderFailure({ cause: error });
        const delay = failure.retryAfterMs ?? Math.min(500 * 2 ** retries, 8000);
        const maxDelay = options.maxRetryDelayMs ?? 60000;
        if (
          failure.kind === "transient" &&
          !producedContent &&
          retries < retryBudget &&
          (maxDelay <= 0 || delay <= maxDelay)
        ) {
          await waitForProviderRetry(delay, options.signal);
          continue;
        }
        if (
          !(error instanceof PiStreamError) ||
          (error.assistantMessage?.rawStopReason !== "refusal" &&
            error.assistantMessage?.rawStopReason !== "content_filter")
        )
          options.onFailure?.(failure);
        throw error;
      }
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
            ...(error instanceof PiStreamError && error.assistantMessage
              ? error.assistantMessage
              : partial),
            stopReason: reason,
            errorMessage: `${model.id} (${model.api}), model stream: ${safeModelErrorDetail(error instanceof Error ? error.message : String(error), [], error instanceof ProviderRequestError ? error.failure.status : undefined)}`,
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
