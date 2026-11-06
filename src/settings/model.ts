import { CustomModel } from "@/aiParams";
import { atom, createStore, useAtomValue } from "jotai";

import type { ScribeMode, ModelSelection } from "@/agentMode";
import type { BackendConfig, BackendType, ConfiguredModel, Provider } from "@/modelManagement";
import { TOP_LEVEL_SECRET_FIELDS } from "@/services/settingsSecretTransforms";
import { isNotificationSoundId, type NotificationSoundId } from "@/utils/notificationSoundCatalog";
import { type SortStrategy, isSortStrategy } from "@/utils/recentUsageManager";
import {
  DEFAULT_OPEN_AREA,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  SEND_SHORTCUT,
} from "@/constants";

export { getModelKeyFromModel } from "@/lib/model-key";

export interface LegacyCommandSettings {
  name: string;

  modelKey?: string;

  prompt: string;

  showInContextMenu: boolean;
}

export interface ScribeSettings {
  openAIApiKey: string;
  openAIOrgId: string;
  cohereApiKey: string;
  anthropicApiKey: string;
  googleApiKey: string;
  openRouterAiApiKey: string;
  xaiApiKey: string;
  mistralApiKey: string;
  deepseekApiKey: string;
  siliconflowApiKey: string;
  defaultModelKey: string;
  scribeFolder: string;
  scribeRootHistory: string[];
  autoAttachActiveNote: boolean;
  secretsRememberOnDevice: boolean;
  debug: boolean;
  enableInlineCitations: boolean;
  qaExclusions: string;
  qaInclusions: string;
  groqApiKey: string;
  activeModels: Array<CustomModel>;
  chatHistorySortStrategy: SortStrategy;
  defaultOpenArea: DEFAULT_OPEN_AREA;
  defaultSendShortcut: SEND_SHORTCUT;
  inlineEditCommands: LegacyCommandSettings[] | undefined;
  quickCommandModelKey: string | undefined;
  quickCommandIncludeNoteContext: boolean;
  _keychainVaultId?: string;
  _pendingCredentialRecovery?: { deviceId: string; path: string; encrypted: boolean };
  settingsVersion?: number;
  storageId?: string;
  homeShelfTabs?: Record<string, string>;
  agentMode: {
    activeBackend: string;
    backends: {
      native?: NativeBackendSettings;
    };
    notificationSound: boolean;
    notificationSoundId: NotificationSoundId;
    welcomeDismissed: boolean;
    skills: {
      suppressMigrationConfirm?: boolean;
      catalogBudgetPercent?: number;
      catalogBudgetMaxTokens?: number;
      sortStrategy?: "name" | "recent";
    };
  };
  providers: Record<string, Provider>;
  configuredModels: ConfiguredModel[];
  backends: Partial<Record<BackendType, BackendConfig>>;
}

export interface NativeBackendSettings {
  enabled?: boolean;
  defaultModel?: ModelSelection | null;
  defaultMode?: ScribeMode | null;
  maxSteps?: number;
}

export const settingsStore = createStore();
export const settingsAtom = atom<ScribeSettings>(DEFAULT_SETTINGS);

const EMPTY_PROVIDERS = Object.freeze({}) as unknown as Record<string, Provider>;
const EMPTY_CONFIGURED_MODELS = Object.freeze([]) as unknown as ConfiguredModel[];
const EMPTY_BACKENDS = Object.freeze({}) as unknown as Partial<Record<BackendType, BackendConfig>>;
const EMPTY_SCRIBE_ROOT_HISTORY = Object.freeze([]) as unknown as string[];

export function setSettings(
  settings: Partial<ScribeSettings> | ((current: ScribeSettings) => Partial<ScribeSettings>)
) {
  settingsStore.set(settingsAtom, (prev) => {
    const partial = typeof settings === "function" ? settings(prev) : settings;
    return { ...prev, ...partial };
  });
}

function decodeExclusionPattern(pattern: string): string {
  const trimmed = pattern.trim();
  try {
    return decodeURIComponent(trimmed);
  } catch {
    return trimmed;
  }
}

export function sanitizeQaExclusions(rawValue: unknown): string {
  const rawValueString = typeof rawValue === "string" ? rawValue : DEFAULT_QA_EXCLUSIONS_SETTING;

  const decodedPatterns: string[] = rawValueString
    .split(",")
    .map(decodeExclusionPattern)
    .filter((pattern: string) => pattern.length > 0);

  const canonicalToOriginalPattern = new Map<string, string>();

  decodedPatterns.forEach((pattern) => {
    const canonical = pattern.replace(/\/+$/, "");
    const canonicalKey = canonical.length > 0 ? canonical : pattern;
    if (!canonicalToOriginalPattern.has(canonicalKey)) {
      const normalizedValue =
        canonical.length > 0 && pattern.endsWith("/") ? `${canonical}/` : pattern;
      canonicalToOriginalPattern.set(canonicalKey, normalizedValue);
    }
  });

  return Array.from(canonicalToOriginalPattern.values())
    .map((pattern) => encodeURIComponent(pattern))
    .join(",");
}

export function updateSetting<K extends keyof ScribeSettings>(key: K, value: ScribeSettings[K]) {
  setSettings((cur) => ({ ...cur, [key]: value }));
}

export function updateAgentModeBackendFields<
  K extends keyof ScribeSettings["agentMode"]["backends"],
>(key: K, partial: Partial<NonNullable<ScribeSettings["agentMode"]["backends"][K]>>): void {
  setSettings((cur) => ({
    agentMode: {
      ...cur.agentMode,
      backends: {
        ...cur.agentMode.backends,
        [key]: { ...(cur.agentMode.backends?.[key] ?? {}), ...partial },
      },
    },
  }));
}

export function getSettings(): Readonly<ScribeSettings> {
  return settingsStore.get(settingsAtom);
}

const TOP_LEVEL_CREDENTIAL_COMPANION_FIELDS = [
  "openAIOrgId",
] as const satisfies readonly (keyof ScribeSettings)[];

const TOP_LEVEL_CREDENTIAL_BUNDLE_FIELDS: readonly string[] = [
  ...TOP_LEVEL_SECRET_FIELDS,
  ...TOP_LEVEL_CREDENTIAL_COMPANION_FIELDS,
];

function carriesConfiguration(field: string, value: unknown): boolean {
  if (field === "enableCors") return typeof value === "boolean";
  return typeof value === "string" && value.length > 0;
}

function preserveProvidersWithCredentials(
  providers: Record<string, Provider> | undefined
): Record<string, Provider> {
  const preserved = Object.entries(providers ?? {}).filter(([, provider]) => !!provider?.apiKeyRef);
  return preserved.length > 0 ? Object.fromEntries(preserved) : EMPTY_PROVIDERS;
}

function preserveConfiguredModelsForProviders(
  configuredModels: ConfiguredModel[] | undefined,
  preservedProviderIds: Set<string>
): ConfiguredModel[] {
  if (!Array.isArray(configuredModels) || configuredModels.length === 0) {
    return EMPTY_CONFIGURED_MODELS;
  }
  const preserved = configuredModels.filter((model) => preservedProviderIds.has(model.providerId));
  return preserved.length > 0 ? preserved : EMPTY_CONFIGURED_MODELS;
}

export function resetSettings(): void {
  const current = getSettings();
  const currentRecord = current as unknown as Record<string, unknown>;
  const preservedTopLevelSecrets: Record<string, unknown> = {};
  for (const field of TOP_LEVEL_CREDENTIAL_BUNDLE_FIELDS) {
    const value = currentRecord[field];
    if (carriesConfiguration(field, value)) {
      preservedTopLevelSecrets[field] = value;
    }
  }
  const preservedProviders = preserveProvidersWithCredentials(current.providers);
  const preservedProviderIds = new Set(Object.keys(preservedProviders));
  const resetValues = {
    ...DEFAULT_SETTINGS,
    ...preservedTopLevelSecrets,
    activeModels: current.activeModels ?? [],
    providers: preservedProviders,
    configuredModels: preserveConfiguredModelsForProviders(
      current.configuredModels,
      preservedProviderIds
    ),
    storageId: current.storageId,
    homeShelfTabs: current.homeShelfTabs,
  };
  setSettings(resetValues);
}

export function subscribeToSettingsChange(
  callback: (prev: ScribeSettings, next: ScribeSettings) => void
): () => void {
  let previousValue = getSettings();

  return settingsStore.sub(settingsAtom, () => {
    const currentValue = getSettings();
    callback(previousValue, currentValue);
    previousValue = currentValue;
  });
}

export function useSettingsValue(): Readonly<ScribeSettings> {
  return useAtomValue(settingsAtom, {
    store: settingsStore,
  });
}

export function sanitizeSettings(settings: ScribeSettings): ScribeSettings {
  const settingsToSanitize = settings || DEFAULT_SETTINGS;

  const sanitizedSettings: ScribeSettings = { ...settingsToSanitize };
  const sanitizedSettingsRecord = sanitizedSettings as unknown as Record<string, unknown>;
  delete sanitizedSettingsRecord.amazonBedrockApiKey;
  delete sanitizedSettingsRecord.amazonBedrockRegion;
  delete sanitizedSettingsRecord.azureOpenAIApiKey;
  delete sanitizedSettingsRecord.azureOpenAIApiInstanceName;
  delete sanitizedSettingsRecord.azureOpenAIApiDeploymentName;
  delete sanitizedSettingsRecord.azureOpenAIApiVersion;
  delete sanitizedSettingsRecord.maxTokens;

  if (typeof sanitizedSettings.enableInlineCitations !== "boolean") {
    sanitizedSettings.enableInlineCitations = DEFAULT_SETTINGS.enableInlineCitations;
  }

  if (typeof sanitizedSettings.autoAttachActiveNote !== "boolean") {
    sanitizedSettings.autoAttachActiveNote = DEFAULT_SETTINGS.autoAttachActiveNote;
  }

  if (typeof sanitizedSettings.secretsRememberOnDevice !== "boolean") {
    sanitizedSettings.secretsRememberOnDevice = DEFAULT_SETTINGS.secretsRememberOnDevice;
  }

  if (typeof sanitizedSettings.quickCommandIncludeNoteContext !== "boolean") {
    sanitizedSettings.quickCommandIncludeNoteContext =
      DEFAULT_SETTINGS.quickCommandIncludeNoteContext;
  }

  if (
    settingsToSanitize.quickCommandModelKey !== undefined &&
    typeof settingsToSanitize.quickCommandModelKey !== "string"
  ) {
    sanitizedSettings.quickCommandModelKey = DEFAULT_SETTINGS.quickCommandModelKey;
  }

  if (!Object.values(SEND_SHORTCUT).includes(sanitizedSettings.defaultSendShortcut)) {
    sanitizedSettings.defaultSendShortcut = DEFAULT_SETTINGS.defaultSendShortcut;
  }

  sanitizedSettings.scribeFolder = DEFAULT_SETTINGS.scribeFolder;
  sanitizedSettings.scribeRootHistory = EMPTY_SCRIBE_ROOT_HISTORY;

  if (
    !isSortStrategy(sanitizedSettings.chatHistorySortStrategy) ||
    sanitizedSettings.chatHistorySortStrategy === "manual"
  ) {
    sanitizedSettings.chatHistorySortStrategy = DEFAULT_SETTINGS.chatHistorySortStrategy;
  }

  sanitizedSettings.qaExclusions = sanitizeQaExclusions(settingsToSanitize.qaExclusions);

  sanitizedSettings.agentMode = sanitizeAgentMode(sanitizedSettings.agentMode);

  if (
    !sanitizedSettings.providers ||
    typeof sanitizedSettings.providers !== "object" ||
    Array.isArray(sanitizedSettings.providers)
  ) {
    sanitizedSettings.providers = EMPTY_PROVIDERS;
  }
  if (!Array.isArray(sanitizedSettings.configuredModels)) {
    sanitizedSettings.configuredModels = EMPTY_CONFIGURED_MODELS;
  }
  if (
    !sanitizedSettings.backends ||
    typeof sanitizedSettings.backends !== "object" ||
    Array.isArray(sanitizedSettings.backends)
  ) {
    sanitizedSettings.backends = EMPTY_BACKENDS;
  }

  const providerRows = Object.entries(sanitizedSettings.providers);
  if (providerRows.some(([, row]) => "apiKeyKeychainId" in row)) {
    sanitizedSettings.providers = Object.fromEntries(
      providerRows.map(([id, row]) => {
        const copy = { ...row } as Provider & { apiKeyKeychainId?: unknown };
        delete copy.apiKeyKeychainId;
        return [id, copy];
      })
    );
  }

  const providerEntries = Object.entries(sanitizedSettings.providers);
  const removedProviderIds = new Set(
    providerEntries
      .filter(
        ([, provider]) =>
          provider.origin?.kind === "agent" && provider.origin.agentType !== "native"
      )
      .map(([id]) => id)
  );
  if (removedProviderIds.size > 0) {
    const retainedProviders = providerEntries.filter(([id]) => !removedProviderIds.has(id));
    const removedModelIds = new Set(
      sanitizedSettings.configuredModels
        .filter((model) => removedProviderIds.has(model.providerId))
        .map((model) => model.configuredModelId)
    );
    const retainedModels = sanitizedSettings.configuredModels.filter(
      (model) => !removedModelIds.has(model.configuredModelId)
    );
    sanitizedSettings.providers =
      retainedProviders.length > 0 ? Object.fromEntries(retainedProviders) : EMPTY_PROVIDERS;
    sanitizedSettings.configuredModels =
      retainedModels.length > 0 ? retainedModels : EMPTY_CONFIGURED_MODELS;
    const cleanedBackends = Object.entries(sanitizedSettings.backends).map(([id, config]) => [
      id,
      {
        ...config,
        enabledModels: config.enabledModels.filter((modelId) => !removedModelIds.has(modelId)),
      },
    ]);
    sanitizedSettings.backends =
      cleanedBackends.length > 0 ? Object.fromEntries(cleanedBackends) : EMPTY_BACKENDS;
  }
  const retainedBackends = Object.entries(sanitizedSettings.backends).filter(
    ([id]) => id === "chat" || id === "native"
  );
  if (retainedBackends.length !== Object.keys(sanitizedSettings.backends).length) {
    sanitizedSettings.backends =
      retainedBackends.length > 0 ? Object.fromEntries(retainedBackends) : EMPTY_BACKENDS;
  }

  return sanitizedSettings;
}

function sanitizeAgentMode(raw: unknown): ScribeSettings["agentMode"] {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS.agentMode };
  }
  const r = raw as Record<string, unknown>;
  const activeBackend = DEFAULT_SETTINGS.agentMode.activeBackend;

  const backendsRaw =
    r.backends && typeof r.backends === "object" ? (r.backends as Record<string, unknown>) : {};
  const backends: ScribeSettings["agentMode"]["backends"] = {};
  if (backendsRaw.native) backends.native = sanitizeNativeBackendSettings(backendsRaw.native);

  const notificationSound =
    typeof r.notificationSound === "boolean"
      ? r.notificationSound
      : DEFAULT_SETTINGS.agentMode.notificationSound;

  const notificationSoundId = isNotificationSoundId(r.notificationSoundId)
    ? r.notificationSoundId
    : DEFAULT_SETTINGS.agentMode.notificationSoundId;

  const welcomeDismissed =
    typeof r.welcomeDismissed === "boolean"
      ? r.welcomeDismissed
      : DEFAULT_SETTINGS.agentMode.welcomeDismissed;

  const skillsRaw =
    r.skills && typeof r.skills === "object" ? (r.skills as Record<string, unknown>) : null;
  const suppressMigrationConfirm =
    skillsRaw && typeof skillsRaw.suppressMigrationConfirm === "boolean"
      ? skillsRaw.suppressMigrationConfirm
      : undefined;
  // 目录预算字段是轻量数值偏好；非法值回落默认而非拒收整个设置。
  // https://github.com/ItsDalk-Lane/Scribe/issues/40
  const catalogBudgetPercent =
    skillsRaw &&
    typeof skillsRaw.catalogBudgetPercent === "number" &&
    Number.isFinite(skillsRaw.catalogBudgetPercent) &&
    skillsRaw.catalogBudgetPercent > 0 &&
    skillsRaw.catalogBudgetPercent <= 100
      ? skillsRaw.catalogBudgetPercent
      : DEFAULT_SETTINGS.agentMode.skills.catalogBudgetPercent;
  const catalogBudgetMaxTokens =
    skillsRaw &&
    typeof skillsRaw.catalogBudgetMaxTokens === "number" &&
    Number.isSafeInteger(skillsRaw.catalogBudgetMaxTokens) &&
    skillsRaw.catalogBudgetMaxTokens > 0
      ? skillsRaw.catalogBudgetMaxTokens
      : DEFAULT_SETTINGS.agentMode.skills.catalogBudgetMaxTokens;
  const sortStrategy: ScribeSettings["agentMode"]["skills"]["sortStrategy"] =
    skillsRaw && (skillsRaw.sortStrategy === "recent" || skillsRaw.sortStrategy === "name")
      ? skillsRaw.sortStrategy
      : // 列表排序偏好；非法值回退默认按名称。https://github.com/ItsDalk-Lane/Scribe/issues/48
        "name";
  const skills: ScribeSettings["agentMode"]["skills"] = {
    catalogBudgetPercent,
    catalogBudgetMaxTokens,
    sortStrategy,
    ...(suppressMigrationConfirm !== undefined ? { suppressMigrationConfirm } : {}),
  };

  return {
    activeBackend,
    backends,
    notificationSound,
    notificationSoundId,
    welcomeDismissed,
    skills,
  };
}

function sanitizeDefaultModel(raw: unknown): ModelSelection | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const baseModelId = typeof r.baseModelId === "string" && r.baseModelId ? r.baseModelId : null;
  if (!baseModelId) return undefined;
  const effort = typeof r.effort === "string" && r.effort ? r.effort : null;
  return { baseModelId, effort };
}

const SCRIBE_MODES: readonly ScribeMode[] = ["default", "plan", "auto", "full"];
function sanitizeDefaultMode(raw: unknown): ScribeMode | undefined {
  return typeof raw === "string" && (SCRIBE_MODES as readonly string[]).includes(raw)
    ? (raw as ScribeMode)
    : undefined;
}

function sanitizeNativeBackendSettings(raw: unknown): NativeBackendSettings {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const value = raw as Record<string, unknown>;
  return {
    ...(typeof value.enabled === "boolean" ? { enabled: value.enabled } : {}),
    defaultModel: sanitizeDefaultModel(value.defaultModel),
    defaultMode: sanitizeDefaultMode(value.defaultMode),
    maxSteps:
      typeof value.maxSteps === "number" &&
      Number.isSafeInteger(value.maxSteps) &&
      value.maxSteps >= 1
        ? value.maxSteps
        : undefined,
  };
}
