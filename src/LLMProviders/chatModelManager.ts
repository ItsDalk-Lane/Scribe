import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import { getSettings } from "@/settings/model";
import { MissingApiKeyError } from "@/error";
import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import type { ProviderChatModel } from "@/LLMProviders/piChatModel";

export default class ChatModelManager {
  private static instance: ChatModelManager;

  private constructor() {}

  static getInstance(): ChatModelManager {
    if (!ChatModelManager.instance) ChatModelManager.instance = new ChatModelManager();
    return ChatModelManager.instance;
  }

  async createModelInstanceFromBridged(model: CustomModel): Promise<ProviderChatModel> {
    const provider = model.provider as ChatModelProviders;
    if (
      !model.apiKey &&
      !model.credentialRef &&
      !(model.requiresApiKey === false && provider === ChatModelProviders.OPENAI_FORMAT)
    ) {
      throw new MissingApiKeyError(`API key is not provided for the model: ${model.name}.`);
    }
    return createProviderChatModel(
      provider === ChatModelProviders.OPENAI
        ? { ...model, openAIOrgId: model.openAIOrgId || getSettings().openAIOrgId }
        : model
    );
  }

  async countTokens(inputStr: string): Promise<number> {
    return Math.ceil(inputStr.length / 4);
  }
}
