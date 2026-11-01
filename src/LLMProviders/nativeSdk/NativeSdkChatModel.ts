import { t } from "@/lib/i18n";
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4Prompt,
} from "@ai-sdk/provider";
import {
  BaseChatModel,
  type BaseChatModelCallOptions,
} from "@langchain/core/language_models/chat_models";
import {
  AIMessage,
  AIMessageChunk,
  type BaseMessage,
  type UsageMetadata,
} from "@langchain/core/messages";
import { ChatGenerationChunk, type ChatResult } from "@langchain/core/outputs";
import type { CallbackManagerForLLMRun } from "@langchain/core/callbacks/manager";

export type NativeLanguageModel = LanguageModelV2 | LanguageModelV3 | LanguageModelV4;

export interface NativeSdkCallOptions extends BaseChatModelCallOptions {
  headers?: Record<string, string>;
  options?: { headers?: Record<string, string> };
}

type NativeResult = Awaited<ReturnType<NativeLanguageModel["doGenerate"]>>;
type NativeUsage = NativeResult["usage"];
type NativeStreamResult = Awaited<ReturnType<NativeLanguageModel["doStream"]>>;

function usageMetadata(usage: NativeUsage): UsageMetadata | undefined {
  const input =
    typeof usage.inputTokens === "number" ? usage.inputTokens : usage.inputTokens?.total;
  const output =
    typeof usage.outputTokens === "number" ? usage.outputTokens : usage.outputTokens?.total;
  if (input === undefined && output === undefined) return undefined;
  return {
    input_tokens: input ?? 0,
    output_tokens: output ?? 0,
    total_tokens:
      "totalTokens" in usage && typeof usage.totalTokens === "number"
        ? usage.totalTokens
        : (input ?? 0) + (output ?? 0),
  };
}

function finishReason(reason: NativeResult["finishReason"]): string {
  return typeof reason === "string" ? reason : reason.unified;
}

function imagePart(url: string): {
  mediaType: string;
  data: { type: "data"; data: Uint8Array } | { type: "url"; url: URL };
} {
  const dataUrl = /^data:([^;,]+);base64,([\s\S]*)$/.exec(url);
  if (dataUrl) {
    return {
      mediaType: dataUrl[1],
      data: {
        type: "data",
        data: Uint8Array.from(atob(dataUrl[2]), (character) => character.charCodeAt(0)),
      },
    };
  }
  return { mediaType: "image/*", data: { type: "url", url: new URL(url) } };
}

function toPrompt(messages: BaseMessage[]): LanguageModelV4Prompt {
  return messages.map((message) => {
    const content =
      typeof message.content === "string"
        ? [{ type: "text" as const, text: message.content }]
        : message.content.map((part) => {
            if (part.type === "text" && typeof part.text === "string")
              return { type: "text" as const, text: part.text };
            if (part.type === "image_url") {
              const image = part.image_url;
              const url =
                typeof image === "string"
                  ? image
                  : image && typeof image === "object" && "url" in image
                    ? image.url
                    : undefined;
              if (typeof url === "string") return { type: "file" as const, ...imagePart(url) };
            }
            throw new Error(
              t("Unsupported native model message content: {type}", { type: part.type })
            );
          });
    if (message.type === "system") {
      return {
        role: "system" as const,
        content: content.map((part) => (part.type === "text" ? part.text : "")).join(""),
      };
    }
    if (message.type === "human") return { role: "user" as const, content };
    if (message.type === "ai") return { role: "assistant" as const, content };
    throw new Error(t("Unsupported native model message role: {role}", { role: message.type }));
  });
}

function legacyOptions(options: LanguageModelV4CallOptions): LanguageModelV3CallOptions {
  return {
    ...options,
    prompt: options.prompt.map((message) =>
      message.role === "system"
        ? message
        : {
            ...message,
            content: message.content.map((part) =>
              part.type === "file"
                ? {
                    ...part,
                    data:
                      part.data.type === "data"
                        ? part.data.data
                        : part.data.type === "url"
                          ? part.data.url
                          : part.data,
                  }
                : part
            ),
          }
    ) as LanguageModelV3CallOptions["prompt"],
  };
}

export class NativeSdkChatModel extends BaseChatModel<NativeSdkCallOptions> {
  constructor(
    readonly nativeModel:
      | NativeLanguageModel
      | ((options: NativeSdkCallOptions) => Promise<NativeLanguageModel>),
    readonly maxTokens?: number
  ) {
    super({ maxRetries: 3, maxConcurrency: 3 });
  }

  _llmType(): string {
    return "native-provider-sdk";
  }

  private callOptions(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"]
  ): LanguageModelV4CallOptions {
    return {
      prompt: toPrompt(messages),
      abortSignal: options.signal,
      headers: { ...options.options?.headers, ...options.headers },
      stopSequences: options.stop,
      ...(this.maxTokens === undefined ? {} : { maxOutputTokens: this.maxTokens }),
    };
  }

  async _generate(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"]
  ): Promise<ChatResult> {
    const args = this.callOptions(messages, options);
    const result: NativeResult = await this.caller.callWithOptions(
      { signal: options.signal },
      async () => {
        const sdk =
          typeof this.nativeModel === "function"
            ? await this.nativeModel(options)
            : this.nativeModel;
        if (sdk.specificationVersion === "v4") return await sdk.doGenerate(args);
        if (sdk.specificationVersion === "v3") return await sdk.doGenerate(legacyOptions(args));
        return await sdk.doGenerate(legacyOptions(args) as LanguageModelV2CallOptions);
      }
    );
    const text = result.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("");
    const reasoning = result.content
      .filter((part) => part.type === "reasoning")
      .map((part) => part.text)
      .join("");
    return {
      generations: [
        {
          text,
          message: new AIMessage({
            content: text,
            additional_kwargs: reasoning ? { reasoning_content: reasoning } : {},
            usage_metadata: usageMetadata(result.usage),
            response_metadata: {
              finish_reason: finishReason(result.finishReason),
              providerMetadata: result.providerMetadata,
            },
          }),
        },
      ],
    };
  }

  async *_streamResponseChunks(
    messages: BaseMessage[],
    options: this["ParsedCallOptions"],
    runManager?: CallbackManagerForLLMRun
  ): AsyncGenerator<ChatGenerationChunk> {
    const args = this.callOptions(messages, options);
    const result: NativeStreamResult = await this.caller.callWithOptions(
      { signal: options.signal },
      async () => {
        const sdk =
          typeof this.nativeModel === "function"
            ? await this.nativeModel(options)
            : this.nativeModel;
        if (sdk.specificationVersion === "v4") return await sdk.doStream(args);
        if (sdk.specificationVersion === "v3") return await sdk.doStream(legacyOptions(args));
        return await sdk.doStream(legacyOptions(args) as LanguageModelV2CallOptions);
      }
    );
    const reader = result.stream.getReader();
    const abort = () => {
      void reader.cancel(options.signal?.reason).catch(() => {});
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      while (true) {
        if (options.signal?.aborted)
          throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
        const { done, value } = await reader.read();
        if (options.signal?.aborted)
          throw options.signal.reason ?? new DOMException("Aborted", "AbortError");
        if (done) break;
        if (value.type === "error") throw value.error;
        if (value.type === "text-delta" || value.type === "reasoning-delta") {
          const text = value.type === "text-delta" ? value.delta : "";
          const chunk = new ChatGenerationChunk({
            text,
            message: new AIMessageChunk({
              content: text,
              additional_kwargs:
                value.type === "reasoning-delta" ? { reasoning_content: value.delta } : {},
            }),
          });
          yield chunk;
          if (text) await runManager?.handleLLMNewToken(text);
        } else if (value.type === "finish") {
          yield new ChatGenerationChunk({
            text: "",
            message: new AIMessageChunk({
              content: "",
              usage_metadata: usageMetadata(value.usage),
              response_metadata: {
                finish_reason: finishReason(value.finishReason),
                providerMetadata: value.providerMetadata,
              },
            }),
          });
        }
      }
    } finally {
      options.signal?.removeEventListener("abort", abort);
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
}
