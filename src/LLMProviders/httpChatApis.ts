import type { Api, Message, Model, StreamOptions, TranscriptContext } from "@earendil-works/pi-ai";
import {
  getCurrentSystemPrompt,
  collapseSystemMessages,
} from "@earendil-works/pi-ai/utils/transcript";
import { readJsonStream, streamHttpCompletion } from "@/LLMProviders/piHttpStream";
import { retryProviderRequest } from "@earendil-works/pi-ai/utils/provider-retry";
import { t } from "@/lib/i18n";

interface GoogleChunk {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string; thought?: boolean }> };
    finishReason?: string;
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
  message?: string;
  delta?: {
    message?: { content?: { text?: string; thinking?: string } };
    finish_reason?: string;
    usage?: { tokens?: { input_tokens?: number; output_tokens?: number } };
  };
}

interface OllamaChunk {
  message?: { content?: string; thinking?: string };
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
  // Retry only request setup, never a stream that has already displayed text. https://github.com/ItsDalk-Lane/Scribe/issues/8
  return retryProviderRequest(async () => {
    let response: Response;
    try {
      response = await fetch(`${model.baseUrl.replace(/\/+$/, "")}${path}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...options.headers },
        signal: options.signal,
        body: JSON.stringify(replacement === undefined ? body : replacement),
      });
    } catch (error) {
      if (error instanceof TypeError)
        throw Object.assign(error, { status: undefined, headers: undefined });
      throw error;
    }
    if (!response.ok)
      throw Object.assign(
        new Error((await response.text()) || `${t("Unexpected response")} (${response.status})`),
        { status: response.status, headers: response.headers }
      );
    return response;
  }, options);
}

export function textContent(message: Message): string {
  if (typeof message.content === "string") return message.content;
  return (message.content ?? []).map((part) => (part.type === "text" ? part.text : "")).join("");
}

export function streamGoogle(
  model: Model<Api>,
  context: TranscriptContext,
  options?: StreamOptions
) {
  return streamHttpCompletion(model, options, async function* () {
    const system = getCurrentSystemPrompt(context.messages);
    const contents = collapseSystemMessages(context)
      .messages.filter((message) => message.role !== "system")
      .map((message) => {
        if (message.role === "toolResult")
          throw new Error(
            t("Unsupported native model message role: {role}", { role: message.role })
          );
        const parts =
          typeof message.content === "string"
            ? [{ text: message.content }]
            : (message.content ?? []).map((part) => {
                if (part.type === "text") return { text: part.text };
                if (part.type === "image")
                  return { inlineData: { mimeType: part.mimeType, data: part.data } };
                throw new Error(
                  t("Unsupported native model message content: {type}", { type: part.type })
                );
              });
        return { role: message.role === "assistant" ? "model" : "user", parts };
      });
    const response = await postChatRequest(
      model,
      `/models/${encodeURIComponent(model.id)}:streamGenerateContent?alt=sse`,
      {
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(options?.maxTokens === undefined
          ? {}
          : { generationConfig: { maxOutputTokens: options.maxTokens } }),
      },
      options
    );
    for await (const raw of readJsonStream(response, options?.signal)) {
      const chunk = raw as GoogleChunk;
      if (chunk.error || chunk.promptFeedback?.blockReason)
        throw new Error(
          chunk.error?.message || chunk.promptFeedback?.blockReason || t("Unexpected response")
        );
      const candidate = chunk.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.text) yield part.thought ? { thinking: part.text } : { text: part.text };
      }
      if (chunk.usageMetadata)
        yield {
          usage: {
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
          },
        };
      if (candidate?.finishReason) {
        if (candidate.finishReason !== "STOP" && candidate.finishReason !== "MAX_TOKENS")
          throw new Error(candidate.finishReason);
        yield { finishReason: candidate.finishReason === "MAX_TOKENS" ? "length" : "stop" };
      }
    }
  });
}

export function streamCohere(
  model: Model<Api>,
  context: TranscriptContext,
  options?: StreamOptions
) {
  return streamHttpCompletion(model, options, async function* () {
    const messages = collapseSystemMessages(context).messages.map((message) => ({
      role: message.role,
      content:
        message.role === "user" && Array.isArray(message.content)
          ? message.content.map((part) =>
              part.type === "image"
                ? {
                    type: "image_url",
                    image_url: { url: `data:${part.mimeType};base64,${part.data}` },
                  }
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
        stream: true,
        ...(options?.maxTokens === undefined ? {} : { max_tokens: options.maxTokens }),
      },
      options
    );
    for await (const raw of readJsonStream(response, options?.signal)) {
      const chunk = raw as CohereChunk;
      if (chunk.type === "error") throw new Error(chunk.message || t("Unexpected response"));
      if (chunk.delta?.message?.content?.text) yield { text: chunk.delta.message.content.text };
      if (chunk.delta?.message?.content?.thinking)
        yield { thinking: chunk.delta.message.content.thinking };
      if (chunk.type === "message-end") {
        const reason = chunk.delta?.finish_reason;
        if (reason !== "COMPLETE" && reason !== "STOP_SEQUENCE" && reason !== "MAX_TOKENS")
          throw new Error(reason || t("Unexpected response"));
        const usage = chunk.delta?.usage?.tokens;
        yield {
          finishReason: reason === "MAX_TOKENS" ? "length" : "stop",
          usage: {
            input: usage?.input_tokens ?? 0,
            output: usage?.output_tokens ?? 0,
            totalTokens: (usage?.input_tokens ?? 0) + (usage?.output_tokens ?? 0),
          },
        };
      }
    }
  });
}

export function streamOllama(
  model: Model<Api>,
  context: TranscriptContext,
  options?: StreamOptions
) {
  return streamHttpCompletion(model, options, async function* () {
    const messages = collapseSystemMessages(context).messages.map((message) => ({
      role: message.role,
      content: textContent(message),
      ...(message.role === "user" && Array.isArray(message.content)
        ? {
            images: message.content
              .filter((part) => part.type === "image")
              .map((part) => part.data),
          }
        : {}),
    }));
    const response = await postChatRequest(
      model,
      "/api/chat",
      {
        model: model.id,
        messages,
        stream: true,
        think: model.reasoning,
        options: { num_ctx: model.contextWindow, repeat_penalty: 1.1 },
      },
      options
    );
    for await (const raw of readJsonStream(response, options?.signal, true)) {
      const chunk = raw as OllamaChunk;
      if (chunk.error) throw new Error(chunk.error);
      yield { text: chunk.message?.content, thinking: chunk.message?.thinking };
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
  });
}
