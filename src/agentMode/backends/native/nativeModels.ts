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
  isChatModelSelectionForEntry,
  providerNeedsResolvedApiKey,
  type ConfiguredModel,
  type Provider,
} from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { getSettings, type ScribeSettings } from "@/settings/model";
import { t } from "@/lib/i18n";

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

const EMPTY_MODEL_IDS: readonly string[] = Object.freeze([]);

function configuredModels(
  settings: ScribeSettings,
  enabledIds: readonly string[] = settings.backends.native?.enabledModels ??
    settings.backends.chat?.enabledModels ??
    EMPTY_MODEL_IDS
): ConfiguredModel[] {
  const byId = new Map(settings.configuredModels.map((model) => [model.configuredModelId, model]));
  const models = [...new Set(enabledIds)].flatMap((id) => {
    const model = byId.get(id);
    return model &&
      settings.providers[model.providerId]?.origin.kind === "byok" &&
      isChatModelInfo(model.info)
      ? [model]
      : EMPTY_MODELS;
  });
  return models.length ? models : EMPTY_MODELS;
}

export function getNativeDefaultModelId(settings: ScribeSettings): string | undefined {
  const explicit = settings.agentMode.backends.native?.defaultModel?.baseModelId;
  if (explicit) return explicit;
  const models = configuredModels(
    settings,
    settings.backends.chat?.enabledModels ?? EMPTY_MODEL_IDS
  );
  return (
    models.find((model) =>
      isChatModelSelectionForEntry(
        {
          configuredModelId: model.configuredModelId,
          state: "ok",
          configuredModel: model,
          provider: settings.providers[model.providerId],
        },
        settings.defaultModelKey
      )
    )?.configuredModelId ??
    models[0]?.configuredModelId ??
    configuredModels(settings)[0]?.configuredModelId
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
  if (!provider.apiKeyKeychainId) return "missing_key";
  try {
    const value = KeychainService.getInstance().getSecretById(provider.apiKeyKeychainId);
    return value?.trim() ? "ok" : "missing_key";
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
  const preferred = getNativeDefaultModelId(settings);
  return models
    .map((model): EnabledModelEntry => {
      const provider = settings.providers[model.providerId];
      return {
        baseModelId: model.configuredModelId,
        name: model.info.displayName || model.info.id,
        description: model.info.description,
        credentialState: credentialState(provider),
        capabilities: capabilitiesFromConfiguredInfo(model.info),
      };
    })
    .sort(
      (left, right) =>
        Number(right.baseModelId === preferred) - Number(left.baseModelId === preferred)
    );
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
  const apiKey = provider.apiKeyKeychainId
    ? KeychainService.getInstance(app).getSecretById(provider.apiKeyKeychainId)
    : null;
  return ChatModelManager.getInstance().createModelInstanceFromBridged(
    configuredModelToCustomModel({ provider, configuredModel: model, apiKey })
  );
}
