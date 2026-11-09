import type {
  Api,
  JsonObject,
  Message,
  Model,
  SimpleStreamOptions,
  StreamOptions,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { thinkingBudgetForLevel } from "@earendil-works/pi-ai/api/simple-options";
import {
  getCurrentSystemPrompt,
  collapseSystemMessages,
  getCurrentTools,
} from "@earendil-works/pi-ai/utils/transcript";
import { readJsonStream, streamHttpCompletion } from "@/LLMProviders/piHttpStream";
import { observeProviderResponse } from "@/LLMProviders/providerResponse";
import {
  classifyProviderFailure,
  ProviderRequestError,
  waitForProviderRetry,
  type ProviderRequestFailure,
} from "@/LLMProviders/providerRequestFailure";
import { t } from "@/lib/i18n";
import { abortSignalWithDeadline } from "@/utils/abortDeadline";
import { DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS } from "@/constants";

// 与底层协议库的图片降级文案保持一致，模型看到的省略说明在所有适配路径上相同。https://github.com/ItsDalk-Lane/Scribe/issues/56
const IMAGE_OMITTED_TEXT = "(image omitted: model does not support images)";
const TOOL_IMAGE_OMITTED_TEXT = "(tool image omitted: model does not support images)";

function acceptsImages(model: Model<Api>): boolean {
  return model.input.includes("image");
}

// 同一调用的全部请求（含协议续跑）共享同一取消与期限信号；响应头与读流全程受统一期限约束。
// https://github.com/ItsDalk-Lane/Scribe/issues/59
function withCallDeadline(options?: SimpleStreamOptions): {
  options: SimpleStreamOptions | undefined;
  dispose(): void;
} {
  const deadline = abortSignalWithDeadline(
    options?.signal,
    options?.timeoutMs ?? DEFAULT_PROVIDER_REQUEST_TIMEOUT_MS
  );
  return {
    options: options && { ...options, signal: deadline.signal },
    dispose: () => deadline.dispose(),
  };
}

interface GooglePart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name?: string; args?: JsonObject };
  functionResponse?: { id: string; name: string; response: { error?: string; output?: string } };
}

interface GoogleChunk {
  candidates?: Array<{
    content?: { parts?: GooglePart[] };
    finishReason?: string;
    continuationToken?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
    totalTokenCount?: number;
    cachedContentTokenCount?: number;
  };
}

interface CohereChunk {
  type?: string;
  index?: number;
  message?: string;
  delta?: {
    message?: {
      content?: { text?: string; thinking?: string };
      tool_calls?: { id?: string; function?: { name?: string; arguments?: string } };
    };
    finish_reason?: string;
    usage?: { tokens?: { input_tokens?: number; output_tokens?: number } };
  };
}

interface OllamaChunk {
  message?: {
    content?: string;
    thinking?: string;
    tool_calls?: Array<{
      id?: string;
      function: { index?: number; name: string; arguments: JsonObject };
    }>;
  };
  error?: string;
  done?: boolean;
  done_reason?: string;
  prompt_eval_count?: number;
  eval_count?: number;
}

export async function postChatRequest(
  model: Model<Api>,
  path: string,
  body: object,
  options?: StreamOptions
): Promise<Response> {
  if (!options?.fetch) throw new Error("A provider transport is required.");
  const fetch = options.fetch;
  const replacement: unknown = await options.onPayload?.(body, model);
  for (let retries = 0; ; retries++) {
    try {
      const response = await fetch(`${model.baseUrl.replace(/\/+$/, "")}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        signal: options.signal,
        body: JSON.stringify(replacement === undefined ? body : replacement),
      });
      if (!response.ok) {
        let failure: ProviderRequestFailure | undefined;
        const observed = await observeProviderResponse(
          response,
          (value) => {
            failure = value;
          },
          options.signal
        );
        throw new ProviderRequestError(
          (await observed.text()) || `${t("Unexpected response")} (${response.status})`,
          failure ?? classifyProviderFailure({ status: response.status })
        );
      }
      return response;
    } catch (error) {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      const failure = classifyProviderFailure({ cause: error });
      const delay = failure.retryAfterMs ?? Math.min(500 * 2 ** retries, 8000);
      const maxDelay = options.maxRetryDelayMs ?? 60000;
      if (
        failure.kind !== "transient" ||
        retries >= (options.maxRetries ?? 0) ||
        (maxDelay > 0 && delay > maxDelay)
      )
        throw error;
      await waitForProviderRetry(delay, options.signal);
    }
  }
}

export function textContent(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function streamGoogle(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions
) {
  const deadline = withCallDeadline(options);
  const scopedOptions = deadline.options;
  return streamHttpCompletion(
    model,
    deadline.options,
    async function* () {
      const system = getCurrentSystemPrompt(context.messages);
      const allowImages = acceptsImages(model);
      const contents: Array<{ role: string; parts: GooglePart[] }> = [];
      for (const message of collapseSystemMessages(context).messages) {
        if (message.role === "system") continue;
        if (message.role === "toolResult") {
          const toolImages = message.content.filter((part) => part.type === "image");
          const omittedNote =
            allowImages || toolImages.length === 0 ? "" : `\n${TOOL_IMAGE_OMITTED_TEXT}`;
          const part: GooglePart = {
            functionResponse: {
              id: message.toolCallId,
              name: message.toolName,
              response: message.isError
                ? { error: textContent(message) + omittedNote }
                : { output: textContent(message) + omittedNote },
            },
          };
          const previous = contents.at(-1);
          if (previous?.role === "user" && previous.parts.some((part) => part.functionResponse))
            previous.parts.push(part);
          else contents.push({ role: "user", parts: [part] });
          if (allowImages)
            for (const image of toolImages)
              contents
                .at(-1)!
                .parts.push({ inlineData: { mimeType: image.mimeType, data: image.data } });
          continue;
        }
        const parts: GooglePart[] =
          typeof message.content === "string"
            ? [{ text: message.content }]
            : (message.content ?? []).map((part) => {
                if (part.type === "text") return { text: part.text };
                if (part.type === "image")
                  return allowImages
                    ? { inlineData: { mimeType: part.mimeType, data: part.data } }
                    : { text: IMAGE_OMITTED_TEXT };
                if (part.type === "toolCall")
                  return {
                    functionCall: { id: part.id, name: part.name, args: part.arguments },
                    ...(part.thoughtSignature ? { thoughtSignature: part.thoughtSignature } : {}),
                  };
                return {
                  text: part.thinking,
                  thought: true,
                  ...(part.thinkingSignature ? { thoughtSignature: part.thinkingSignature } : {}),
                };
              });
        contents.push({ role: message.role === "assistant" ? "model" : "user", parts });
      }
      const supportsSystemInstruction = !model.id.split("/").pop()?.startsWith("gemma-");
      if (system && !supportsSystemInstruction && contents[0]?.role === "user")
        contents[0].parts.unshift({ text: `${system}\n\n` });
      const resourcePath = /^(?:models|tunedModels|projects|publishers)\//.test(model.id)
        ? model.id.split("/").map(encodeURIComponent).join("/")
        : `models/${encodeURIComponent(model.id)}`;
      const resourceRoot = /^(projects|publishers)\//.exec(model.id)?.[1];
      let requestModel = model;
      if (resourceRoot) {
        const baseUrl = new URL(model.baseUrl);
        baseUrl.pathname = baseUrl.pathname.split(`/${resourceRoot}/`)[0];
        requestModel = { ...model, baseUrl: baseUrl.toString() };
      }
      const body = {
        contents,
        ...(getCurrentTools(context.messages).length
          ? {
              tools: [
                {
                  functionDeclarations: getCurrentTools(context.messages).map((tool) => ({
                    name: tool.name,
                    description: tool.description,
                    parametersJsonSchema: tool.parameters,
                  })),
                },
              ],
            }
          : {}),
        ...(system && supportsSystemInstruction
          ? { systemInstruction: { parts: [{ text: system }] } }
          : {}),
        ...(scopedOptions?.maxTokens === undefined && scopedOptions?.reasoning === undefined
          ? {}
          : {
              generationConfig: {
                ...(scopedOptions?.maxTokens !== undefined
                  ? { maxOutputTokens: options.maxTokens }
                  : {}),
                ...(scopedOptions?.reasoning !== undefined
                  ? {
                      thinkingConfig: {
                        includeThoughts: true,
                        thinkingBudget: Math.min(
                          thinkingBudgetForLevel(options.reasoning, options.thinkingBudgets),
                          options.maxTokens === undefined
                            ? Infinity
                            : Math.max(0, options.maxTokens - 1024)
                        ),
                      },
                    }
                  : {}),
              },
            }),
      };
      const seenContinuationTokens = new Set<string>();
      const completedUsage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, totalTokens: 0 };
      let continuationToken: string | undefined;
      let toolIndex = 0;
      do {
        if (scopedOptions?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const response = await postChatRequest(
          requestModel,
          `/${resourcePath}:streamGenerateContent?alt=sse`,
          continuationToken ? { ...body, continuationToken } : body,
          options
        );
        continuationToken = undefined;
        let requestUsage = { input: 0, output: 0, reasoning: 0, cacheRead: 0, totalTokens: 0 };
        for await (const raw of readJsonStream(response, scopedOptions?.signal)) {
          const chunk = raw as GoogleChunk;
          if (chunk.error || chunk.promptFeedback?.blockReason)
            throw new Error(
              chunk.error?.message || chunk.promptFeedback?.blockReason || t("Unexpected response")
            );
          const candidate = chunk.candidates?.[0];
          for (const part of candidate?.content?.parts ?? []) {
            if (part.text) yield part.thought ? { thinking: part.text } : { text: part.text };
            if (part.functionCall)
              yield {
                toolCall: {
                  index: toolIndex++,
                  id: part.functionCall.id,
                  name: part.functionCall.name,
                  arguments: part.functionCall.args ?? {},
                  thoughtSignature: part.thoughtSignature,
                },
              };
          }
          if (chunk.usageMetadata) {
            requestUsage = {
              input: Math.max(
                0,
                (chunk.usageMetadata.promptTokenCount ?? 0) -
                  (chunk.usageMetadata.cachedContentTokenCount ?? 0)
              ),
              output:
                (chunk.usageMetadata.candidatesTokenCount ?? 0) +
                (chunk.usageMetadata.thoughtsTokenCount ?? 0),
              reasoning: chunk.usageMetadata.thoughtsTokenCount ?? 0,
              cacheRead: chunk.usageMetadata.cachedContentTokenCount ?? 0,
              totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
            };
            yield {
              usage: {
                input: completedUsage.input + requestUsage.input,
                output: completedUsage.output + requestUsage.output,
                reasoning: completedUsage.reasoning + requestUsage.reasoning,
                cacheRead: completedUsage.cacheRead + requestUsage.cacheRead,
                totalTokens: completedUsage.totalTokens + requestUsage.totalTokens,
              },
            };
          }
          if (candidate?.finishReason === "CONTINUATION") {
            const token = candidate.continuationToken;
            if (!token) throw new Error("Google continuation token is missing.");
            if (seenContinuationTokens.has(token))
              throw new Error("Google continuation token was repeated.");
            if (seenContinuationTokens.size >= 32)
              throw new Error("Google continuation request limit exceeded.");
            seenContinuationTokens.add(token);
            continuationToken = token;
          } else if (candidate?.finishReason) {
            if (candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS")
              throw new Error(candidate.finishReason);
            yield { finishReason: candidate.finishReason === "MAX_TOKENS" ? "length" : "stop" };
          }
        }
        for (const key of Object.keys(completedUsage) as Array<keyof typeof completedUsage>)
          completedUsage[key] += requestUsage[key];
      } while (continuationToken);
    },
    () => deadline.dispose()
  );
}

export function streamCohere(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions
) {
  const deadline = withCallDeadline(options);
  const scopedOptions = deadline.options;
  return streamHttpCompletion(
    model,
    deadline.options,
    async function* () {
      const messages = collapseSystemMessages(context).messages.map((message) => ({
        role: message.role === "toolResult" ? "tool" : message.role,
        ...(message.role === "toolResult" ? { tool_call_id: message.toolCallId } : {}),
        ...(message.role === "assistant" && message.content.some((part) => part.type === "toolCall")
          ? {
              tool_calls: message.content
                .filter((part) => part.type === "toolCall")
                .map((part) => ({
                  id: part.id,
                  type: "function",
                  function: { name: part.name, arguments: JSON.stringify(part.arguments) },
                })),
            }
          : {}),
        content:
          message.role === "user" && Array.isArray(message.content)
            ? message.content.map((part) =>
                part.type === "image"
                  ? acceptsImages(model)
                    ? {
                        type: "image_url",
                        image_url: { url: `data:${part.mimeType};base64,${part.data}` },
                      }
                    : { type: "text", text: IMAGE_OMITTED_TEXT }
                  : { type: "text", text: part.text }
              )
            : textContent(message),
      }));
      const response = await postChatRequest(
        model,
        "/chat",
        {
          model: model.id,
          messages,
          ...(getCurrentTools(context.messages).length
            ? {
                tools: getCurrentTools(context.messages).map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
              }
            : {}),
          stream: true,
          ...(scopedOptions?.reasoning !== undefined
            ? {
                thinking: {
                  type: "enabled",
                  token_budget: Math.min(
                    thinkingBudgetForLevel(options.reasoning, options.thinkingBudgets),
                    options.maxTokens === undefined
                      ? Infinity
                      : Math.max(0, options.maxTokens - 1024)
                  ),
                },
              }
            : {}),
          ...(scopedOptions?.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
        },
        options
      );
      for await (const raw of readJsonStream(response, scopedOptions?.signal)) {
        const chunk = raw as CohereChunk;
        if (chunk.type === "error") throw new Error(chunk.message || t("Unexpected response"));
        if (chunk.delta?.message?.content?.text) yield { text: chunk.delta.message.content.text };
        if (chunk.delta?.message?.content?.thinking)
          yield { thinking: chunk.delta.message.content.thinking };
        if (chunk.delta?.message?.tool_calls) {
          const call = chunk.delta.message.tool_calls;
          yield {
            toolCall: {
              index: chunk.index ?? 0,
              id: call.id,
              name: call.function?.name,
              arguments: call.function?.arguments,
            },
          };
        }
        if (chunk.type === "message-end") {
          const reason = chunk.delta?.finish_reason;
          if (
            reason !== "COMPLETE" &&
            reason !== "STOP_SEQUENCE" &&
            reason !== "MAX_TOKENS" &&
            reason !== "TOOL_CALL"
          )
            throw new Error(reason || t("Unexpected response"));
          const usage = chunk.delta?.usage?.tokens;
          yield {
            finishReason:
              reason === "MAX_TOKENS" ? "length" : reason === "TOOL_CALL" ? "toolUse" : "stop",
            usage: {
              input: usage?.input_tokens ?? 0,
              output: usage?.output_tokens ?? 0,
              totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
            },
          };
        }
      }
    },
    () => deadline.dispose()
  );
}

export function streamOllama(
  model: Model<Api>,
  context: TranscriptContext,
  options?: SimpleStreamOptions
) {
  const deadline = withCallDeadline(options);
  const scopedOptions = deadline.options;
  return streamHttpCompletion(
    model,
    deadline.options,
    async function* () {
      const messages = collapseSystemMessages(context).messages.map((message) => ({
        role: message.role === "toolResult" ? "tool" : message.role,
        content: textContent(message),
        ...(message.role === "toolResult"
          ? { tool_name: message.toolName, tool_call_id: message.toolCallId }
          : {}),
        ...(message.role === "assistant" && message.content.some((part) => part.type === "toolCall")
          ? {
              tool_calls: message.content
                .filter((part) => part.type === "toolCall")
                .map((part) => ({
                  id: part.id,
                  type: "function",
                  function: { name: part.name, arguments: part.arguments },
                })),
            }
          : {}),
        ...(message.role === "user" && Array.isArray(message.content)
          ? {
              images: message.content.flatMap((part) =>
                part.type === "image" && acceptsImages(model) ? [part.data] : []
              ),
            }
          : {}),
      }));
      const response = await postChatRequest(
        model,
        "/api/chat",
        {
          model: model.id,
          messages,
          ...(getCurrentTools(context.messages).length
            ? {
                tools: getCurrentTools(context.messages).map((tool) => ({
                  type: "function",
                  function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters,
                  },
                })),
              }
            : {}),
          stream: true,
          think: scopedOptions?.reasoning ?? model.reasoning,
          options: {
            ...(model.contextWindow > 0 ? { num_ctx: model.contextWindow } : {}),
            repeat_penalty: 1.1,
            ...(scopedOptions?.maxTokens === undefined ? {} : { num_predict: options.maxTokens }),
          },
        },
        options
      );
      let toolIndex = 0;
      for await (const raw of readJsonStream(response, scopedOptions?.signal, true)) {
        const chunk = raw as OllamaChunk;
        if (chunk.error) throw new Error(chunk.error);
        yield { text: chunk.message?.content, thinking: chunk.message?.thinking };
        for (const call of chunk.message?.tool_calls ?? [])
          yield {
            toolCall: {
              index: call.function.index ?? toolIndex++,
              id: call.id,
              name: call.function.name,
              arguments: call.function.arguments,
            },
          };
        if (chunk.done)
          yield {
            finishReason: chunk.done_reason === "length" ? "length" : "stop",
            usage: {
              input: chunk.prompt_eval_count ?? 0,
              output: chunk.eval_count ?? 0,
              totalTokens: (chunk.prompt_eval_count ?? 0) + (chunk.eval_count ?? 0),
            },
          };
      }
    },
    () => deadline.dispose()
  );
}
