import type { App } from "obsidian";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import type { ProviderChatModel } from "@/LLMProviders/piChatModel";
import type {
  EnabledModelCredentialState,
  EnabledModelEntry,
  ModelEntry,
} from "@/agentMode/session/types";
import {
  capabilitiesFromConfiguredInfo,
  configuredModelToCustomModel,
  isChatModelInfo,
  providerNeedsResolvedApiKey,
  type ConfiguredModel,
  type Provider,
} from "@/modelManagement";
import { SecretStore } from "@/services/secretStore";
import { getSettings, type ScribeSettings } from "@/settings/model";
import { t } from "@/lib/i18n";
import { MissingApiKeyError } from "@/error";

const EMPTY_MODELS: ConfiguredModel[] = Object.freeze([]) as unknown as ConfiguredModel[];
const EMPTY_MODEL_ENTRIES: ModelEntry[] = Object.freeze([]) as unknown as ModelEntry[];
const EMPTY_ENABLED_ENTRIES: EnabledModelEntry[] = Object.freeze(
  []
) as unknown as EnabledModelEntry[];
const EMPTY_EFFORT_OPTIONS: ModelEntry["effortOptions"] = Object.freeze(
  []
) as unknown as ModelEntry["effortOptions"];
const THINKING_LEVELS: readonly string[] = [
  "off",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

function configuredModels(settings: ScribeSettings): ConfiguredModel[] {
  // 模型一次配置后直接供聊天使用，历史启用清单只保留兼容加载。https://github.com/ItsDalk-Lane/Scribe/issues/31
  const models = settings.configuredModels.filter(
    (model) =>
      settings.providers[model.providerId]?.origin.kind === "byok" && isChatModelInfo(model.info)
  );
  return models.length ? models : EMPTY_MODELS;
}

export function getNativeDefaultModelId(settings: ScribeSettings): string | undefined {
  const models = getNativeEnabledModelEntries(settings).filter(
    (model) => model.credentialState === "ok"
  );
  const previous = settings.agentMode.backends.native?.defaultModel?.baseModelId;
  return (
    models.find((model) => model.baseModelId === previous)?.baseModelId ?? models[0]?.baseModelId
  );
}

export function getNativeModelEntries(settings: ScribeSettings): ModelEntry[] {
  const models = configuredModels(settings);
  if (!models.length) return EMPTY_MODEL_ENTRIES;
  return models.map((model) => {
    const efforts = (model.info.reasoningEfforts ?? [])
      .map((value) => (value === "none" ? "off" : value))
      .filter((value) => THINKING_LEVELS.includes(value));
    return {
      baseModelId: model.configuredModelId,
      name: model.info.displayName || model.info.id,
      description: model.info.description,
      provider: settings.providers[model.providerId].displayName,
      effortOptions: efforts.length
        ? [
            { value: "default", label: t("Default") },
            ...efforts.map((value) => ({ value, label: value })),
          ]
        : EMPTY_EFFORT_OPTIONS,
    };
  });
}

function credentialState(provider: Provider): EnabledModelCredentialState {
  if (!providerNeedsResolvedApiKey(provider)) return "ok";
  if (!provider.apiKeyRef) return "missing_key";
  try {
    const status = SecretStore.getInstance().getStatus(provider.apiKeyRef);
    return status === "missing"
      ? "missing_key"
      : status === "unavailable"
        ? "unavailable_key"
        : "ok";
  } catch {
    return "unavailable_key";
  }
}

export function getNativeModelReadiness(
  settings: ScribeSettings
): "no_models" | "missing_credentials" | "ready" {
  const models = configuredModels(settings);
  if (!models.length) return "no_models";
  return models.some((model) => credentialState(settings.providers[model.providerId]) === "ok")
    ? "ready"
    : "missing_credentials";
}

export function getNativeEnabledModelEntries(settings: ScribeSettings): EnabledModelEntry[] {
  const models = configuredModels(settings);
  if (!models.length) return EMPTY_ENABLED_ENTRIES;
  return models.map((model): EnabledModelEntry => {
    const provider = settings.providers[model.providerId];
    return {
      baseModelId: model.configuredModelId,
      name: model.info.displayName || model.info.id,
      description: model.info.description,
      credentialState: credentialState(provider),
      capabilities: capabilitiesFromConfiguredInfo(model.info),
    };
  });
}

export async function createNativeModel(app: App, modelId: string): Promise<ProviderChatModel> {
  const settings = getSettings();
  const model = configuredModels(settings).find(
    (candidate) => candidate.configuredModelId === modelId
  );
  if (!model)
    throw new Error(
      `The selected native agent model is unavailable: ${modelId}. Choose it in the existing model settings.`
    );
  const provider = settings.providers[model.providerId];
  SecretStore.getInstance(app);
  if (credentialState(provider) !== "ok")
    throw new MissingApiKeyError(t("Provider credentials are missing."));
  return ChatModelManager.getInstance().createModelInstanceFromBridged(
    configuredModelToCustomModel({ provider, configuredModel: model })
  );
}
