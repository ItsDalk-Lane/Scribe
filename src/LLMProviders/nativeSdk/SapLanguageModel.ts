import { t } from "@/lib/i18n";
import type {
  LanguageModelV2,
  LanguageModelV2CallOptions,
  LanguageModelV2FinishReason,
  LanguageModelV2StreamPart,
} from "@ai-sdk/provider";

interface SapMessage {
  content?: string;
  reasoning_content?: Array<{ content?: string }>;
}
interface SapPayload {
  final_result?: {
    choices?: Array<{ message?: SapMessage; delta?: SapMessage; finish_reason?: string }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  error?: { message?: string; code?: number };
}

function finishReason(value?: string): LanguageModelV2FinishReason {
  if (value === "stop" || value === "length") return value;
  if (value === "content_filter") return "content-filter";
  return "unknown";
}

function resultParts(message?: SapMessage): Array<{ type: "text" | "reasoning"; text: string }> {
  const parts: Array<{ type: "text" | "reasoning"; text: string }> = [];
  const reasoning = message?.reasoning_content?.map((block) => block.content || "").join("");
  if (reasoning) parts.push({ type: "reasoning", text: reasoning });
  if (message?.content) parts.push({ type: "text", text: message.content });
  return parts;
}

function checkError(payload: SapPayload): void {
  if (payload.error)
    throw Object.assign(new Error(payload.error.message || t("Unexpected response")), {
      statusCode: payload.error.code,
    });
}

export function createSapHttpModel(
  modelId: string,
  completionUrl: string,
  headers: Record<string, string>,
  transport: typeof fetch
): LanguageModelV2 {
  const request = async (
    options: LanguageModelV2CallOptions,
    stream: boolean
  ): Promise<Response> => {
    const placeholders: Record<string, string> = {};
    const literal = (text: string): string => {
      if (!/\{[{#%]/.test(text)) return text;
      const name = `copilot_message_${Object.keys(placeholders).length}`;
      placeholders[name] = text;
      return `{{?${name}}}`;
    };
    const template = options.prompt.map((message) => {
      if (message.role === "system")
        return { role: message.role, content: literal(message.content) };
      if (message.role === "tool")
        throw new Error(t("Unsupported native model message role: {role}", { role: message.role }));
      const content = message.content.map((part) => {
        if (part.type === "text") return { type: "text", text: literal(part.text) };
        if (part.type === "file") {
          const url =
            part.data instanceof URL
              ? part.data.href
              : `data:${part.mediaType};base64,${typeof part.data === "string" ? part.data : btoa(Array.from(part.data, (byte) => String.fromCharCode(byte)).join(""))}`;
          return { type: "image_url", image_url: { url } };
        }
        throw new Error(t("Unsupported native model message content: {type}", { type: part.type }));
      });
      return {
        role: message.role,
        content: content.every((part) => part.type === "text")
          ? content.map((part) => ("text" in part ? part.text : "")).join("")
          : content,
      };
    });
    const params = {
      ...(options.maxOutputTokens === undefined
        ? {}
        : { max_completion_tokens: options.maxOutputTokens }),
      ...(options.stopSequences ? { stop: options.stopSequences } : {}),
      ...(stream ? { stream_options: { include_usage: true } } : {}),
    };
    const response = await transport(completionUrl, {
      method: "POST",
      signal: options.abortSignal,
      headers: { ...headers, ...options.headers, "Content-Type": "application/json" },
      body: JSON.stringify({
        config: {
          ...(stream ? { stream: { enabled: true } } : {}),
          modules: {
            prompt_templating: { model: { name: modelId, params }, prompt: { template } },
          },
        },
        ...(Object.keys(placeholders).length ? { placeholder_values: placeholders } : {}),
      }),
    });
    if (!response.ok)
      throw Object.assign(new Error(`${t("Unexpected response")} (${response.status})`), {
        statusCode: response.status,
      });
    return response;
  };
  return {
    specificationVersion: "v2",
    provider: "sap-ai",
    modelId,
    supportedUrls: {},
    async doGenerate(options) {
      const payload = (await (await request(options, false)).json()) as SapPayload;
      checkError(payload);
      const result = payload.final_result;
      const choice = result?.choices?.[0];
      if (!choice?.message) throw new Error(t("Unexpected response"));
      return {
        content: resultParts(choice.message),
        finishReason: finishReason(choice.finish_reason),
        usage: {
          inputTokens: result?.usage?.prompt_tokens,
          outputTokens: result?.usage?.completion_tokens,
          totalTokens: result?.usage?.total_tokens,
        },
        warnings: [],
      };
    },
    async doStream(options) {
      const response = await request(options, true);
      if (!response.body) throw new Error(t("Unexpected response"));
      const decoder = new TextDecoder();
      let buffer = "";
      let last: SapPayload["final_result"];
      let reason: string | undefined;
      let finished = false;
      const emit = (
        record: string,
        controller: TransformStreamDefaultController<LanguageModelV2StreamPart>
      ) => {
        const data = record
          .split(/\r?\n/)
          .filter((line) => line.startsWith("data:"))
          .map((line) => line.slice(5).trimStart())
          .join("\n");
        if (!data) return;
        if (data === "[DONE]") {
          finished = true;
          return;
        }
        const payload = JSON.parse(data) as SapPayload;
        checkError(payload);
        if (payload.final_result?.usage) last = payload.final_result;
        const choice = payload.final_result?.choices?.[0];
        if (choice?.finish_reason) reason = choice.finish_reason;
        for (const part of resultParts(choice?.delta))
          controller.enqueue(
            part.type === "text"
              ? { type: "text-delta", id: "text", delta: part.text }
              : { type: "reasoning-delta", id: "reasoning", delta: part.text }
          );
      };
      const stream = response.body.pipeThrough(
        new TransformStream<Uint8Array, LanguageModelV2StreamPart>({
          transform(chunk, controller) {
            buffer += decoder.decode(chunk, { stream: true });
            const records = buffer.split(/\r?\n\r?\n/);
            buffer = records.pop() || "";
            for (const record of records) emit(record, controller);
          },
          flush(controller) {
            buffer += decoder.decode();
            if (buffer.trim()) emit(buffer, controller);
            if (!finished) throw new Error(t("Unexpected response"));
            controller.enqueue({
              type: "finish",
              finishReason: finishReason(reason),
              usage: {
                inputTokens: last?.usage?.prompt_tokens,
                outputTokens: last?.usage?.completion_tokens,
                totalTokens: last?.usage?.total_tokens,
              },
            });
          },
        })
      );
      return { stream };
    },
  };
}
