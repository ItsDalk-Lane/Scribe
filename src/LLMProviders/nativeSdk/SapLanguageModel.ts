import type { ProviderStreams, SimpleStreamOptions } from "@earendil-works/pi-ai";
import { collapseSystemMessages, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { postChatRequest, textContent } from "@/LLMProviders/httpChatApis";
import { readJsonStream, streamHttpCompletion } from "@/LLMProviders/piHttpStream";
import { t } from "@/lib/i18n";

interface SapPayload {
  final_result?: {
    choices?: Array<{
      delta?: {
        content?: string;
        reasoning_content?: Array<{ content?: string }>;
        tool_calls?: Array<{
          index: number;
          id?: string;
          function?: { name?: string; arguments?: string };
        }>;
      };
      finish_reason?: string;
    }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  error?: { message?: string; code?: number };
}

export function createSapHttpModel(
  completionUrl: string,
  headers: Record<string, string>
): ProviderStreams["stream"] {
  return (model, context, options?: SimpleStreamOptions) =>
    streamHttpCompletion(model, options, async function* () {
      const placeholders: Record<string, string> = {};
      const literal = (text: string): string => {
        // SAP evaluates prompt templates; interpolation-looking user text must remain literal. https://github.com/ItsDalk-Lane/Scribe/issues/8
        if (!/\{[{#%]/.test(text)) return text;
        const name = `copilot_message_${Object.keys(placeholders).length}`;
        placeholders[name] = text;
        return `{{?${name}}}`;
      };
      const template = collapseSystemMessages(context)
        .messages.filter((message) => message.role !== "system" || textContent(message))
        .map((message) => {
          if (message.role === "toolResult")
            return {
              role: "tool",
              tool_call_id: message.toolCallId,
              content: literal(textContent(message)),
            };
          if (message.role === "assistant")
            return {
              role: "assistant",
              content: literal(textContent(message)),
              ...(message.content.some((part) => part.type === "toolCall")
                ? {
                    tool_calls: message.content
                      .filter((part) => part.type === "toolCall")
                      .map((part) => ({
                        id: part.id,
                        type: "function",
                        function: {
                          name: part.name,
                          arguments: literal(JSON.stringify(part.arguments)),
                        },
                      })),
                  }
                : {}),
            };
          if (typeof message.content === "string")
            return { role: message.role, content: literal(message.content) };
          const content = (message.content ?? []).map((part) => {
            if (part.type === "text") return { type: "text", text: literal(part.text) };
            return {
              type: "image_url",
              image_url: { url: `data:${part.mimeType};base64,${part.data}` },
            };
          });
          return {
            role: message.role,
            content: content.every((part) => part.type === "text")
              ? content.map((part) => part.text).join("")
              : content,
          };
        });
      const response = await postChatRequest(
        { ...model, baseUrl: completionUrl },
        "",
        {
          config: {
            stream: { enabled: true },
            modules: {
              prompt_templating: {
                model: {
                  name: model.id,
                  params: {
                    ...(options?.maxTokens === undefined
                      ? {}
                      : { max_completion_tokens: options.maxTokens }),
                    ...(options?.reasoning !== undefined
                      ? { reasoning_effort: options.reasoning }
                      : {}),
                    stream_options: { include_usage: true },
                  },
                },
                prompt: {
                  template,
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
                },
              },
            },
          },
          ...(Object.keys(placeholders).length ? { placeholder_values: placeholders } : {}),
        },
        { ...options, headers: { ...headers, ...options?.headers } }
      );
      let reason: "stop" | "length" | "toolUse" = "stop";
      for await (const raw of readJsonStream(response, options?.signal)) {
        // A final_result alone does not complete SAP orchestration: only [DONE] does. https://github.com/ItsDalk-Lane/Scribe/issues/8
        if (raw === "[DONE]") {
          yield { finishReason: reason };
          return;
        }
        const payload = raw as SapPayload;
        if (payload.error) throw new Error(payload.error.message || t("Unexpected response"));
        const choice = payload.final_result?.choices?.[0];
        if (choice?.finish_reason === "length") reason = "length";
        if (choice?.finish_reason === "tool_calls") reason = "toolUse";
        for (const call of choice?.delta?.tool_calls ?? [])
          yield {
            toolCall: {
              index: call.index,
              id: call.id,
              name: call.function?.name,
              arguments: call.function?.arguments,
            },
          };
        const usage = payload.final_result?.usage;
        yield {
          text: choice?.delta?.content,
          thinking: choice?.delta?.reasoning_content?.map((part) => part.content || "").join(""),
          ...(usage
            ? {
                usage: {
                  input: usage.prompt_tokens ?? 0,
                  output: usage.completion_tokens ?? 0,
                  totalTokens: usage.total_tokens ?? 0,
                },
              }
            : {}),
        };
      }
    });
}
