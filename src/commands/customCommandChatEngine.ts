import type { Context, Message, StreamOptions } from "@earendil-works/pi-ai";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { ProviderRequestError } from "@/LLMProviders/providerRequestFailure";
import { t } from "@/lib/i18n";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { createAssistantMessage, type ChatStreamOptions } from "@/LLMProviders/piChatModel";
import type { CustomModel } from "@/aiParams";

export const DEFAULT_CHAT_SYSTEM_PROMPT =
  "You are a helpful assistant. You'll help the user with their content editing needs.";

export interface ChatMemory {
  chatHistory: { messages: Message[] };
}

export function createChatMemory(): ChatMemory {
  return { chatHistory: { messages: [] } };
}

export async function createChatChain(
  selectedModel: CustomModel,
  systemPrompt: string,
  memory: ChatMemory
) {
  const chatModel =
    await ChatModelManager.getInstance().createModelInstanceFromBridged(selectedModel);

  return {
    stream(
      input: string,
      options: ChatStreamOptions & Pick<StreamOptions, "maxTokens">,
      requestSystemPrompt = systemPrompt
    ) {
      const context: Context = {
        systemPrompt: requestSystemPrompt || DEFAULT_CHAT_SYSTEM_PROMPT,
        messages: [
          ...memory.chatHistory.messages,
          { role: "user", content: input, timestamp: Date.now() },
        ],
      };
      const window = chatModel.model.contextWindow;
      const outputBudget = options.maxTokens ?? chatModel.model.maxTokens;
      // 快捷调用同样要核对完整输入并预留输出，超限时保留原历史与重试输入。https://github.com/ItsDalk-Lane/Scribe/issues/64
      if (
        window > 0 &&
        (!Number.isFinite(window) ||
          !Number.isFinite(outputBudget) ||
          outputBudget < 0 ||
          estimateContextTokens(normalizeContext(context)).tokens >=
            Math.min(window * 0.8, window - outputBudget))
      )
        throw new ProviderRequestError(
          t(
            "This conversation and output budget exceed the selected model's capacity. Reduce the input or output limit, start a new quick conversation, or choose a model with a larger context window."
          ),
          { kind: "context" }
        );
      return chatModel.stream(context, options);
    },
    saveContext(input: string, output: string, stopReason: "stop" | "length" = "stop") {
      const assistant = createAssistantMessage(chatModel.model);
      assistant.content = [{ type: "text", text: output }];
      assistant.stopReason = stopReason;
      memory.chatHistory.messages.push(
        { role: "user", content: input, timestamp: Date.now() },
        assistant
      );
    },
  };
}

export type ChatChain = Awaited<ReturnType<typeof createChatChain>>;
