import type { Message } from "@earendil-works/pi-ai";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import { createAssistantMessage, type ChatStreamOptions } from "@/LLMProviders/piChatModel";
import type { CustomModel } from "@/aiParams";

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
  const defaultSystemPrompt =
    "You are a helpful assistant. You'll help the user with their content editing needs.";

  return {
    stream(input: string, options: ChatStreamOptions) {
      return chatModel.stream(
        {
          systemPrompt: systemPrompt || defaultSystemPrompt,
          messages: [
            ...memory.chatHistory.messages,
            { role: "user", content: input, timestamp: Date.now() },
          ],
        },
        options
      );
    },
    saveContext(input: string, output: string) {
      const assistant = createAssistantMessage(chatModel.model);
      assistant.content = [{ type: "text", text: output }];
      assistant.stopReason = "stop";
      memory.chatHistory.messages.push(
        { role: "user", content: input, timestamp: Date.now() },
        assistant
      );
    },
  };
}

export type ChatChain = Awaited<ReturnType<typeof createChatChain>>;
