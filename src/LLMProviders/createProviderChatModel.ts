import type { CustomModel } from "@/aiParams";
import { createProviderFetch } from "@/LLMProviders/providerTransport";
import { createNativeSdkChatModel } from "@/LLMProviders/nativeSdk/createNativeSdkChatModel";
import { ChatOpenRouter } from "@/LLMProviders/ChatOpenRouter";
import { anthropicHostBaseUrl } from "@/utils/providerBaseUrl";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatAnthropic } from "@langchain/anthropic";
import { ChatOpenAI } from "@langchain/openai";
import { ModelCapability } from "@/constants";
import { t } from "@/lib/i18n";

const NATIVE_SDKS: ReadonlySet<string> = new Set([
  "@ai-sdk/google",
  "@ai-sdk/cohere",
  "@ai-sdk/google-vertex",
  "@ai-sdk/google-vertex/anthropic",
  "@jerome-benoit/sap-ai-provider-v2",
  "gitlab-ai-provider",
]);

export async function createProviderChatModel(model: CustomModel): Promise<BaseChatModel> {
  if (model.providerNpm && NATIVE_SDKS.has(model.providerNpm)) {
    return createNativeSdkChatModel(model);
  }
  if (!model.baseUrl?.trim()) {
    throw new Error(t("A base URL is required for this provider."));
  }
  const fetch = createProviderFetch(model);
  const common = {
    maxRetries: 3,
    maxConcurrency: 3,
    ...(model.maxTokens === undefined ? {} : { maxTokens: model.maxTokens }),
  };
  if (model.providerNpm === "@ai-sdk/anthropic") {
    return new ChatAnthropic({
      ...common,
      model: model.name,
      anthropicApiKey: model.apiKey,
      anthropicApiUrl: anthropicHostBaseUrl(model.baseUrl),
      streaming: model.stream ?? true,
      clientOptions: {
        fetch,
        defaultHeaders: { "anthropic-dangerous-direct-browser-access": "true" },
      },
    });
  }
  const managedCredential =
    model.providerCatalogId === "watsonx" ||
    model.providerCatalogId === "google-vertex" ||
    model.providerCatalogId === "google-vertex-anthropic";
  const configuration = {
    baseURL: model.baseUrl,
    fetch,
    organization: model.openAIOrgId,
    ...(model.providerNpm === "@openrouter/ai-sdk-provider"
      ? {
          defaultHeaders: {
            "HTTP-Referer": "https://obsidiancopilot.com",
            "X-Title": "Obsidian Scribe",
          },
        }
      : {}),
  };
  const config = {
    ...common,
    modelName: model.name,
    apiKey: managedCredential ? "provider-managed-auth" : model.apiKey || "keyless-endpoint",
    streaming: model.stream ?? true,
    streamUsage: model.streamUsage ?? false,
    configuration,
  };
  if (model.providerNpm === "@openrouter/ai-sdk-provider") {
    return new ChatOpenRouter({
      ...config,
      enableReasoning: model.capabilities?.includes(ModelCapability.REASONING) ?? false,
      enablePromptCaching: model.enablePromptCaching ?? true,
    });
  }
  return new ChatOpenAI({
    ...config,
    useResponsesApi:
      model.apiShape === "responses" ||
      (model.apiShape !== "completions" && model.providerNpm === "@ai-sdk/openai"),
  });
}
