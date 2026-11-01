import { CustomModel } from "@/aiParams";
import {
  ChatModelProviders,
  DEFAULT_MAX_OUTPUT_TOKENS,
  ModelCapability,
  ProviderInfo,
} from "@/constants";
import { logWarn } from "@/logger";
import { providerNeedsResolvedApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import { resolveProviderConnection } from "@/modelManagement/chatModel/resolveProviderConnection";

export const CATALOG_ID_TO_CHAT_PROVIDER: Record<string, ChatModelProviders> = {
  openai: ChatModelProviders.OPENAI,
  groq: ChatModelProviders.GROQ,
  mistral: ChatModelProviders.MISTRAL,
  openrouter: ChatModelProviders.OPENROUTERAI,
  deepseek: ChatModelProviders.DEEPSEEK,
  xai: ChatModelProviders.XAI,
  cohere: ChatModelProviders.COHEREAI,
  siliconflow: ChatModelProviders.SILICONFLOW,
  anthropic: ChatModelProviders.ANTHROPIC,
  google: ChatModelProviders.GOOGLE,
};

function normalizeBaseUrl(value: string | undefined): string {
  return (value ?? "").trim().replace(/\/+$/, "").toLowerCase();
}

export function mapProviderTypeToChatModelProvider(provider: Provider): ChatModelProviders {
  switch (provider.providerType) {
    case "anthropic":
      return ChatModelProviders.ANTHROPIC;
    case "google":
      return ChatModelProviders.GOOGLE;
    case "openai-compatible": {
      const catalogId =
        provider.origin.kind === "byok" ? provider.origin.catalogProviderId : undefined;
      if (
        catalogId === "xai" &&
        provider.baseUrl &&
        normalizeBaseUrl(provider.baseUrl) !==
          normalizeBaseUrl(ProviderInfo[ChatModelProviders.XAI].host)
      ) {
        return ChatModelProviders.OPENAI_FORMAT;
      }
      const mapped = catalogId ? CATALOG_ID_TO_CHAT_PROVIDER[catalogId] : undefined;
      return mapped ?? ChatModelProviders.OPENAI_FORMAT;
    }
    default: {
      const unknownType: never = provider.providerType;
      logWarn(
        `[chatBridge] unknown providerType "${String(unknownType)}"; defaulting to OpenAI-format`
      );
      return ChatModelProviders.OPENAI_FORMAT;
    }
  }
}

function extraString(extras: Record<string, unknown>, key: string): string | undefined {
  const value = extras[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// `maxTokens` is set only for Anthropic, the one provider that rejects a request without one;
// elsewhere a limit can push prompt plus output past the context window:
// https://github.com/logancyang/obsidian-copilot-preview/issues/312
export function configuredModelToCustomModel(params: {
  provider: Provider;
  configuredModel: ConfiguredModel;
  apiKey: string | null;
}): CustomModel {
  const { provider, configuredModel, apiKey } = params;
  const info = configuredModel.info;
  const extras = provider.extras ?? {};

  const trimmedKey = apiKey?.trim() || undefined;
  const requiresApiKey = providerNeedsResolvedApiKey(provider) || !!trimmedKey;

  const connection = resolveProviderConnection(provider, info);
  const chatProvider =
    connection.npm === "@ai-sdk/anthropic"
      ? ChatModelProviders.ANTHROPIC
      : connection.npm === "@ai-sdk/google"
        ? ChatModelProviders.GOOGLE
        : mapProviderTypeToChatModelProvider(provider);
  const maxTokens =
    chatProvider === ChatModelProviders.ANTHROPIC && info.limits?.output
      ? DEFAULT_MAX_OUTPUT_TOKENS
      : undefined;

  const capabilities: ModelCapability[] = [];
  if (info.reasoning) capabilities.push(ModelCapability.REASONING);
  if (info.modalities?.input?.includes("image")) capabilities.push(ModelCapability.VISION);

  return {
    configuredModelId: configuredModel.configuredModelId,
    providerCatalogId:
      provider.origin.kind === "byok" ? provider.origin.catalogProviderId : undefined,
    providerNpm: connection.npm,
    providerOptions: connection.options,
    apiShape: connection.shape,
    name: info.id,
    provider: chatProvider,
    displayName: info.displayName,
    enabled: true,
    baseUrl: connection.baseUrl,
    apiKey: trimmedKey,
    requiresApiKey,
    // https://github.com/logancyang/obsidian-copilot-preview/issues/313:
    // verification can pass through requestUrl while Quick tools fails through
    // native fetch. Preserve the user's explicit compatibility-versus-streaming
    // choice when bridging the provider into the legacy chat runtime.
    enableCors: provider.enableCors ?? true,
    capabilities,
    maxTokens,
    openAIOrgId: extraString(extras, "openAIOrgId"),
  };
}
