import { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_MAX_OUTPUT_TOKENS, ProviderInfo } from "@/constants";
import { logWarn } from "@/logger";
import { capabilitiesFromConfiguredInfo } from "@/modelManagement/chatModel/modelCapabilityFlags";
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

export function configuredModelToCustomModel(params: {
  provider: Provider;
  configuredModel: ConfiguredModel;
  apiKey?: string | null;
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
  // 产品默认只是预算偏好，不能覆盖目录声明的模型能力上限。https://github.com/ItsDalk-Lane/Scribe/issues/56
  const maxTokens =
    chatProvider === ChatModelProviders.ANTHROPIC && info.limits?.output
      ? Math.min(info.limits.output, DEFAULT_MAX_OUTPUT_TOKENS)
      : undefined;

  return {
    configuredModelId: configuredModel.configuredModelId,
    providerDisplayName: provider.displayName,
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
    credentialRef: trimmedKey ? undefined : (provider.apiKeyRef ?? undefined),
    requiresApiKey,
    // 与界面共用能力判断，缺少输入类型时保留未知，不静默移除附图。https://github.com/ItsDalk-Lane/Scribe/issues/56
    capabilities: capabilitiesFromConfiguredInfo(info),
    reasoning: info.reasoning,
    reasoningEfforts: info.reasoningEfforts,
    // 能力契约只透传给运行时读取；具体业务由后续迭代逐项接入。https://github.com/ItsDalk-Lane/Scribe/issues/67
    attachment: info.attachment,
    toolCall: info.toolCall,
    structuredOutput: info.structuredOutput,
    temperatureSupport: info.temperature,
    defaultTemperature: info.temperatureValue,
    cost: info.cost,
    maxTokens,
    openAIOrgId: extraString(extras, "openAIOrgId"),
    numCtx: info.limits?.context,
  };
}
