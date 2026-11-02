import { t } from "@/lib/i18n";
import { CustomModel, ProjectConfig } from "@/aiParams";
import { BUILTIN_SKILLS } from "@/builtinSkills/builtinSkills";
import { atom, createStore, useAtomValue } from "jotai";

import type { CopilotMode, ModelSelection } from "@/agentMode";
import type { BackendConfig, BackendType, ConfiguredModel, Provider } from "@/modelManagement";
import { TOP_LEVEL_SECRET_FIELDS } from "@/services/settingsSecretTransforms";
import { isNotificationSoundId, type NotificationSoundId } from "@/utils/notificationSoundCatalog";
import { type SortStrategy, isSortStrategy } from "@/utils/recentUsageManager";
import {
  DEFAULT_OPEN_AREA,
  DEFAULT_QA_EXCLUSIONS_SETTING,
  DEFAULT_SETTINGS,
  DEFAULT_SKILLS_FOLDER,
  SEND_SHORTCUT,
} from "@/constants";

export { getModelKeyFromModel } from "@/lib/model-key";

export interface LegacyCommandSettings {
  name: string;

  modelKey?: string;

  prompt: string;

  showInContextMenu: boolean;
}

export interface CopilotSettings {
  openAIApiKey: string;
  openAIOrgId: string;
  huggingfaceApiKey: string;
  cohereApiKey: string;
  anthropicApiKey: string;
  googleApiKey: string;
  openRouterAiApiKey: string;
  xaiApiKey: string;
  mistralApiKey: string;
  deepseekApiKey: string;
  siliconflowApiKey: string;
  defaultModelKey: string;
  userSystemPrompt: string;
  openAIProxyBaseUrl: string;
  copilotFolder: string;
  copilotRootHistory: string[];
  upgradedToV8FromLegacy: boolean;
  defaultSaveFolder: string;
  defaultConversationTag: string;
  autosaveChat: boolean;
  autoAttachActiveNote: boolean;
  customPromptsFolder: string;
  debug: boolean;
  enableInlineCitations: boolean;
  qaExclusions: string;
  qaInclusions: string;
  groqApiKey: string;
  activeModels: Array<CustomModel>;
  promptUsageTimestamps: Record<string, number>;
  promptSortStrategy: string;
  chatHistorySortStrategy: SortStrategy;
  projectsFolder: string;
  defaultOpenArea: DEFAULT_OPEN_AREA;
  defaultSendShortcut: SEND_SHORTCUT;
  defaultConversationNoteName: string;
  inlineEditCommands: LegacyCommandSettings[] | undefined;
  projectList: Array<ProjectConfig>;
  enableCustomPromptTemplating: boolean;
  memoryFolderName: string;
  quickCommandModelKey: string | undefined;
  quickCommandIncludeNoteContext: boolean;
  userSystemPromptsFolder: string;
  defaultSystemPromptTitle: string;
  _keychainVaultId?: string;
  _pendingCredentialRecovery?: { deviceId: string; path: string; encrypted: boolean };
  settingsVersion?: number;
  agentMode: {
    byok: { anthropic?: string; openai?: string; google?: string };
    activeBackend: string;
    backends: {
      claude?: ClaudeBackendSettings;
    };
    // Keyed by device id because binary paths must not sync across devices:
    // https://github.com/logancyang/obsidian-copilot/issues/2539
    deviceProfiles?: Record<string, DeviceAgentProfile>;
    claudeCli?: { path?: string };
    debugFullFrames: boolean;
    offerFeedbackCards: boolean;
    notificationSound: boolean;
    notificationSoundId: NotificationSoundId;
    welcomeDismissed: boolean;
    skills: {
      folder: string;
      suppressMigrationConfirm?: boolean;
      builtinPreferences?: Record<string, { disabled?: boolean; disabledAgents?: string[] }>;
    };
  };
  providers: Record<string, Provider>;
  configuredModels: ConfiguredModel[];
  backends: Partial<Record<BackendType, BackendConfig>>;
}

export type ClaudeAutoModePermission = "acceptEdits" | "auto" | "bypassPermissions";

export interface ClaudeBackendSettings {
  enabled?: boolean;
  defaultModel?: ModelSelection | null;
  defaultMode?: CopilotMode | null;
  autoModePermission?: ClaudeAutoModePermission;
  enableThinking?: boolean;
  envOverrides?: Record<string, string>;
}

export interface DeviceAgentProfile {
  claudeCliPath?: string;
  claude?: {
    envOverrides?: Record<string, string>;
  };
}

export const settingsStore = createStore();
export const settingsAtom = atom<CopilotSettings>(DEFAULT_SETTINGS);

const EMPTY_PROVIDERS = Object.freeze({}) as unknown as Record<string, Provider>;
const EMPTY_CONFIGURED_MODELS = Object.freeze([]) as unknown as ConfiguredModel[];
const EMPTY_BACKENDS = Object.freeze({}) as unknown as Partial<Record<BackendType, BackendConfig>>;
const EMPTY_COPILOT_ROOT_HISTORY = Object.freeze([]) as unknown as string[];

export function normalizeRootFolders(input: readonly (string | undefined)[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const normalized = raw
      .trim()
      .replace(/\\/g, "/")
      .replace(/\/+/g, "/")
      .split("/")
      .filter((segment) => segment !== ".")
      .join("/")
      .replace(/\/+$/, "");
    if (normalized.length === 0) continue;
    const escapesVault =
      /(^|\/)\.\.(\/|$)/.test(normalized) ||
      /^[a-zA-Z]:/.test(normalized) ||
      normalized.startsWith("/");
    if (escapesVault) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result.length > 0 ? result : EMPTY_COPILOT_ROOT_HISTORY;
}

export function setSettings(
  settings: Partial<CopilotSettings> | ((current: CopilotSettings) => Partial<CopilotSettings>)
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

export function updateSetting<K extends keyof CopilotSettings>(key: K, value: CopilotSettings[K]) {
  setSettings((cur) => ({ ...cur, [key]: value }));
}

export function updateAgentModeBackendFields<
  K extends keyof CopilotSettings["agentMode"]["backends"],
>(key: K, partial: Partial<NonNullable<CopilotSettings["agentMode"]["backends"][K]>>): void {
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

export function getSettings(): Readonly<CopilotSettings> {
  return settingsStore.get(settingsAtom);
}

const TOP_LEVEL_CREDENTIAL_COMPANION_FIELDS = [
  "openAIOrgId",
] as const satisfies readonly (keyof CopilotSettings)[];

const TOP_LEVEL_CREDENTIAL_BUNDLE_FIELDS: readonly string[] = [
  ...TOP_LEVEL_SECRET_FIELDS,
  ...TOP_LEVEL_CREDENTIAL_COMPANION_FIELDS,
];

// Only `enableCors` is legitimately non-string; the string check stops a corrupted value from
// surviving reset and throwing at its consumer:
// https://github.com/logancyang/obsidian-copilot-preview/issues/259
function carriesConfiguration(field: string, value: unknown): boolean {
  if (field === "enableCors") return typeof value === "boolean";
  return typeof value === "string" && value.length > 0;
}

function preserveProvidersWithCredentials(
  providers: Record<string, Provider> | undefined
): Record<string, Provider> {
  const preserved = Object.entries(providers ?? {}).filter(
    ([, provider]) => !!provider?.apiKeyKeychainId
  );
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
  const preservedRootHistory = normalizeRootFolders([
    ...(Array.isArray(current.copilotRootHistory) ? current.copilotRootHistory : []),
    current.copilotFolder,
  ]);
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
    // Legacy rows stay: dropping one would strand its keychain entry with no `name|provider` identity to reattach it to.
    // https://github.com/logancyang/obsidian-copilot-preview/issues/259
    activeModels: current.activeModels ?? [],
    providers: preservedProviders,
    configuredModels: preserveConfiguredModelsForProviders(
      current.configuredModels,
      preservedProviderIds
    ),
    copilotRootHistory: preservedRootHistory,
  };
  setSettings(resetValues);
}

export function subscribeToSettingsChange(
  callback: (prev: CopilotSettings, next: CopilotSettings) => void
): () => void {
  let previousValue = getSettings();

  return settingsStore.sub(settingsAtom, () => {
    const currentValue = getSettings();
    callback(previousValue, currentValue);
    previousValue = currentValue;
  });
}

export function useSettingsValue(): Readonly<CopilotSettings> {
  return useAtomValue(settingsAtom, {
    store: settingsStore,
  });
}

export function sanitizeSettings(settings: CopilotSettings): CopilotSettings {
  const settingsToSanitize = settings || DEFAULT_SETTINGS;

  const sanitizedSettings: CopilotSettings = { ...settingsToSanitize };
  const sanitizedSettingsRecord = sanitizedSettings as unknown as Record<string, unknown>;
  // Amazon Bedrock is no longer a chat provider, so a stored key and region
  // would only be credentials for a service Copilot can no longer reach.
  // https://github.com/logancyang/obsidian-copilot/issues/2928
  delete sanitizedSettingsRecord.amazonBedrockApiKey;
  delete sanitizedSettingsRecord.amazonBedrockRegion;
  // Azure OpenAI is no longer a chat provider, so a stored key and its routing
  // fields would only address a service Copilot cannot reach.
  // https://github.com/logancyang/obsidian-copilot/issues/2932
  delete sanitizedSettingsRecord.azureOpenAIApiKey;
  delete sanitizedSettingsRecord.azureOpenAIApiInstanceName;
  delete sanitizedSettingsRecord.azureOpenAIApiDeploymentName;
  delete sanitizedSettingsRecord.azureOpenAIApiVersion;
  // Copilot no longer limits how long an answer may be, so a stored limit
  // would only cut off answers the model was willing to finish.
  // https://github.com/logancyang/obsidian-copilot-preview/issues/312
  delete sanitizedSettingsRecord.maxTokens;

  if (typeof sanitizedSettings.enableInlineCitations !== "boolean") {
    sanitizedSettings.enableInlineCitations = DEFAULT_SETTINGS.enableInlineCitations;
  }

  if (typeof sanitizedSettings.enableCustomPromptTemplating !== "boolean") {
    sanitizedSettings.enableCustomPromptTemplating = DEFAULT_SETTINGS.enableCustomPromptTemplating;
  }

  if (
    !sanitizedSettings.memoryFolderName ||
    typeof sanitizedSettings.memoryFolderName !== "string"
  ) {
    sanitizedSettings.memoryFolderName = DEFAULT_SETTINGS.memoryFolderName;
  }

  if (typeof sanitizedSettings.autosaveChat !== "boolean") {
    sanitizedSettings.autosaveChat = DEFAULT_SETTINGS.autosaveChat;
  }

  // Settings saved before this switch existed must keep auto-attaching the active note. https://github.com/logancyang/obsidian-copilot/issues/3663
  if (typeof sanitizedSettings.autoAttachActiveNote !== "boolean") {
    sanitizedSettings.autoAttachActiveNote = DEFAULT_SETTINGS.autoAttachActiveNote;
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

  const copilotFolderValidation = validateCopilotFolder(
    typeof settingsToSanitize.copilotFolder === "string"
      ? toVisibleCopilotFolder(settingsToSanitize.copilotFolder)
      : ""
  );
  sanitizedSettings.copilotFolder = copilotFolderValidation.ok
    ? copilotFolderValidation.folder
    : DEFAULT_SETTINGS.copilotFolder;

  const rawRootHistory = Array.isArray(settingsToSanitize.copilotRootHistory)
    ? settingsToSanitize.copilotRootHistory
    : [];
  sanitizedSettings.copilotRootHistory = normalizeRootFolders([
    ...rawRootHistory,
    sanitizedSettings.copilotFolder,
  ]);

  if (typeof sanitizedSettings.upgradedToV8FromLegacy !== "boolean") {
    sanitizedSettings.upgradedToV8FromLegacy = DEFAULT_SETTINGS.upgradedToV8FromLegacy;
  }

  const saveFolder = (settingsToSanitize.defaultSaveFolder || "").trim();
  sanitizedSettings.defaultSaveFolder =
    saveFolder.length > 0 ? saveFolder : DEFAULT_SETTINGS.defaultSaveFolder;

  const promptsFolder = (settingsToSanitize.customPromptsFolder || "").trim();
  sanitizedSettings.customPromptsFolder =
    promptsFolder.length > 0 ? promptsFolder : DEFAULT_SETTINGS.customPromptsFolder;

  const projectsFolder = (settingsToSanitize.projectsFolder || "").trim();
  const hasTraversal =
    /(^|[/\\])\.\.[/\\]?/.test(projectsFolder) ||
    /^[a-zA-Z]:/.test(projectsFolder) ||
    /^[/\\]/.test(projectsFolder);
  sanitizedSettings.projectsFolder =
    projectsFolder.length > 0 && !hasTraversal ? projectsFolder : DEFAULT_SETTINGS.projectsFolder;

  if (
    !isSortStrategy(sanitizedSettings.chatHistorySortStrategy) ||
    sanitizedSettings.chatHistorySortStrategy === "manual"
  ) {
    sanitizedSettings.chatHistorySortStrategy = DEFAULT_SETTINGS.chatHistorySortStrategy;
  }

  const userSystemPromptsFolder = (settingsToSanitize.userSystemPromptsFolder || "").trim();
  sanitizedSettings.userSystemPromptsFolder =
    userSystemPromptsFolder.length > 0
      ? userSystemPromptsFolder
      : DEFAULT_SETTINGS.userSystemPromptsFolder;

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

  const providerEntries = Object.entries(sanitizedSettings.providers);
  const removedProviderIds = new Set(
    providerEntries
      .filter(
        ([, provider]) =>
          provider.origin?.kind === "agent" && provider.origin.agentType !== "claude"
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
    ([id]) => id === "chat" || id === "claude"
  );
  if (retainedBackends.length !== Object.keys(sanitizedSettings.backends).length) {
    sanitizedSettings.backends =
      retainedBackends.length > 0 ? Object.fromEntries(retainedBackends) : EMPTY_BACKENDS;
  }

  return sanitizedSettings;
}

function sanitizeAgentMode(raw: unknown): CopilotSettings["agentMode"] {
  if (!raw || typeof raw !== "object") {
    return { ...DEFAULT_SETTINGS.agentMode };
  }
  const r = raw as Record<string, unknown>;
  const byok =
    r.byok && typeof r.byok === "object"
      ? (r.byok as { anthropic?: string; openai?: string; google?: string })
      : {};
  const activeBackend = DEFAULT_SETTINGS.agentMode.activeBackend;

  const backendsRaw =
    r.backends && typeof r.backends === "object" ? (r.backends as Record<string, unknown>) : {};
  const existingClaude = backendsRaw.claude as Record<string, unknown> | undefined;
  const backends: CopilotSettings["agentMode"]["backends"] = {};
  if (existingClaude) backends.claude = sanitizeClaudeBackendSettings(existingClaude);

  const deviceProfiles = sanitizeDeviceProfiles(r.deviceProfiles);

  const debugFullFrames =
    typeof r.debugFullFrames === "boolean"
      ? r.debugFullFrames
      : DEFAULT_SETTINGS.agentMode.debugFullFrames;

  const offerFeedbackCards =
    typeof r.offerFeedbackCards === "boolean"
      ? r.offerFeedbackCards
      : DEFAULT_SETTINGS.agentMode.offerFeedbackCards;

  const notificationSound =
    typeof r.notificationSound === "boolean"
      ? r.notificationSound
      : DEFAULT_SETTINGS.agentMode.notificationSound;

  // A sound dropped from the catalog would otherwise persist as a name nothing
  // can play, leaving the user silently unnotified.
  // https://github.com/logancyang/obsidian-copilot/issues/2987
  const notificationSoundId = isNotificationSoundId(r.notificationSoundId)
    ? r.notificationSoundId
    : DEFAULT_SETTINGS.agentMode.notificationSoundId;

  const welcomeDismissed =
    typeof r.welcomeDismissed === "boolean"
      ? r.welcomeDismissed
      : DEFAULT_SETTINGS.agentMode.welcomeDismissed;

  const claudeCliRaw =
    r.claudeCli && typeof r.claudeCli === "object"
      ? (r.claudeCli as Record<string, unknown>)
      : null;
  const claudeCliPath =
    claudeCliRaw && typeof claudeCliRaw.path === "string" ? claudeCliRaw.path : undefined;
  const claudeCli = claudeCliPath ? { path: claudeCliPath } : undefined;

  const skillsRaw =
    r.skills && typeof r.skills === "object" ? (r.skills as Record<string, unknown>) : null;
  const skillsFolderRaw = skillsRaw && typeof skillsRaw.folder === "string" ? skillsRaw.folder : "";
  const skillsValidation = validateSkillsFolder(skillsFolderRaw);
  const suppressMigrationConfirm =
    skillsRaw && typeof skillsRaw.suppressMigrationConfirm === "boolean"
      ? skillsRaw.suppressMigrationConfirm
      : undefined;
  const skills: CopilotSettings["agentMode"]["skills"] = {
    folder: skillsValidation.ok
      ? skillsValidation.folder
      : DEFAULT_SETTINGS.agentMode.skills.folder,
    ...(suppressMigrationConfirm !== undefined ? { suppressMigrationConfirm } : {}),
    ...(skillsRaw?.builtinPreferences !== undefined
      ? { builtinPreferences: sanitizeBuiltinPreferences(skillsRaw.builtinPreferences) }
      : {}),
  };

  return {
    byok,
    activeBackend,
    backends,
    debugFullFrames,
    offerFeedbackCards,
    notificationSound,
    notificationSoundId,
    welcomeDismissed,
    skills,
    ...(claudeCli ? { claudeCli } : {}),
    ...(deviceProfiles ? { deviceProfiles } : {}),
  };
}

type BuiltinPreferences = NonNullable<CopilotSettings["agentMode"]["skills"]["builtinPreferences"]>;
const EMPTY_BUILTIN_PREFERENCES: BuiltinPreferences = Object.freeze({});

export function sanitizeBuiltinPreferences(raw: unknown): BuiltinPreferences {
  // Defaults need no records; removed skills must not leave stale settings behind.
  // https://github.com/logancyang/obsidian-copilot/issues/3022
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return EMPTY_BUILTIN_PREFERENCES;
  }
  const preferences: BuiltinPreferences = {};
  for (const { name } of BUILTIN_SKILLS) {
    const value = (raw as Record<string, unknown>)[name];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const pref = value as Record<string, unknown>;
    // Keep opt-outs for agents absent on this device so sync cannot re-enable them.
    // https://github.com/logancyang/obsidian-copilot/issues/3022
    const disabledAgents = Array.isArray(pref.disabledAgents)
      ? pref.disabledAgents.filter((agent): agent is string => typeof agent === "string")
      : [];
    if (pref.disabled === true || disabledAgents.length > 0) {
      preferences[name] = {
        ...(pref.disabled === true ? { disabled: true } : {}),
        ...(disabledAgents.length > 0 ? { disabledAgents } : {}),
      };
    }
  }
  return Object.keys(preferences).length > 0 ? preferences : EMPTY_BUILTIN_PREFERENCES;
}

const WINDOWS_RESERVED_NAME_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

// eslint-disable-next-line no-control-regex -- settings paths must reject embedded control bytes
const CONTROL_CHAR_RE = /[\u0000-\u001f\u007f]/;

function validateSkillsFolder(
  value: string
): { ok: true; folder: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: true, folder: DEFAULT_SKILLS_FOLDER };
  }

  let cleaned = value.trim().replace(/\\/g, "/");

  while (cleaned.startsWith("./")) {
    cleaned = cleaned.slice(2);
  }
  if (cleaned.startsWith("/")) {
    cleaned = cleaned.replace(/^\/+/, "");
  }
  cleaned = cleaned.replace(/\/+$/, "");

  if (cleaned.length === 0) {
    return { ok: true, folder: DEFAULT_SKILLS_FOLDER };
  }

  const segments = cleaned.split("/");
  for (const segment of segments) {
    if (segment.length === 0) {
      return { ok: false, reason: t("Folder path cannot contain empty segments (//).") };
    }
    if (segment === "..") {
      return { ok: false, reason: t('Folder path cannot contain ".." segments.') };
    }
    if (segment === ".") {
      return { ok: false, reason: t('Folder path cannot contain "." segments.') };
    }
    if (CONTROL_CHAR_RE.test(segment)) {
      return { ok: false, reason: t("Folder path contains illegal control characters.") };
    }
    if (/[<>:"|?*]/.test(segment)) {
      return {
        ok: false,
        reason: t('Folder path contains characters not allowed in folder names (< > : " | ? *).'),
      };
    }
  }

  return { ok: true, folder: cleaned };
}

export function toVisibleCopilotFolder(folder: string): string {
  return folder.trim().replace(/(^|[\\/])\.+/g, "$1");
}

export function validateCopilotFolder(
  value: string,
  configDir?: string
): { ok: true; folder: string } | { ok: false; reason: string } {
  if (typeof value !== "string" || value.trim().length === 0) {
    return { ok: false, reason: t("Folder name cannot be empty.") };
  }
  const trimmed = value.trim();
  if (/^[/\\]/.test(trimmed) || /^[a-zA-Z]:/.test(trimmed)) {
    return { ok: false, reason: t("Folder path must be relative to the vault root.") };
  }
  const cleaned = trimmed.replace(/\\/g, "/").replace(/\/+$/, "");
  if (cleaned.length === 0) {
    return { ok: false, reason: t("Folder name cannot be empty.") };
  }
  const normalizedConfigDir = configDir
    ?.trim()
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
  const cleanedLower = cleaned.toLowerCase();
  if (
    normalizedConfigDir &&
    (cleanedLower === normalizedConfigDir ||
      cleanedLower.startsWith(`${normalizedConfigDir}/`) ||
      normalizedConfigDir.startsWith(`${cleanedLower}/`))
  ) {
    return {
      ok: false,
      reason: t("Folder path cannot use the Obsidian config folder."),
    };
  }
  for (const segment of cleaned.split("/")) {
    if (segment.length === 0) {
      return { ok: false, reason: t("Folder path cannot contain empty segments (//).") };
    }
    if (segment === "..") {
      return { ok: false, reason: t('Folder path cannot contain ".." segments.') };
    }
    // Obsidian does not index dot folders, so every Copilot feature must see a visible root.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/712
    if (segment.startsWith(".")) {
      return { ok: false, reason: t("Folder names cannot start with a dot.") };
    }
    if (CONTROL_CHAR_RE.test(segment)) {
      return { ok: false, reason: t("Folder path contains illegal control characters.") };
    }
    if (/[<>:"|?*]/.test(segment)) {
      return {
        ok: false,
        reason: t('Folder path contains characters not allowed in folder names (< > : " | ? *).'),
      };
    }
    if (/[. ]$/.test(segment)) {
      return { ok: false, reason: t("Folder names cannot end with a dot or space.") };
    }
    if (WINDOWS_RESERVED_NAME_RE.test(segment)) {
      return { ok: false, reason: t('"{segment}" is a name reserved by Windows.', { segment }) };
    }
  }
  return { ok: true, folder: cleaned };
}

function nonEmptyString(v: unknown): string | undefined {
  return typeof v === "string" && v ? v : undefined;
}

function sanitizeDefaultModel(raw: unknown): ModelSelection | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const baseModelId = typeof r.baseModelId === "string" && r.baseModelId ? r.baseModelId : null;
  if (!baseModelId) return undefined;
  const effort = typeof r.effort === "string" && r.effort ? r.effort : null;
  return { baseModelId, effort };
}

const COPILOT_MODES: readonly CopilotMode[] = ["default", "plan", "auto"];
function sanitizeDefaultMode(raw: unknown): CopilotMode | undefined {
  return typeof raw === "string" && (COPILOT_MODES as readonly string[]).includes(raw)
    ? (raw as CopilotMode)
    : undefined;
}

export const ENV_VAR_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function sanitizeEnvOverrides(raw: unknown): Record<string, string> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof k !== "string") continue;
    if (!ENV_VAR_NAME_RE.test(k)) continue;
    if (typeof v !== "string") continue;
    if (CONTROL_CHAR_RE.test(v)) continue;
    out[k] = v;
    if (Object.keys(out).length >= 64) break;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

const CLAUDE_AUTO_MODE_PERMISSIONS: readonly ClaudeAutoModePermission[] = [
  "acceptEdits",
  "auto",
  "bypassPermissions",
];
function sanitizeClaudeAutoModePermission(raw: unknown): ClaudeAutoModePermission | undefined {
  return typeof raw === "string" &&
    (CLAUDE_AUTO_MODE_PERMISSIONS as readonly string[]).includes(raw)
    ? (raw as ClaudeAutoModePermission)
    : undefined;
}

function sanitizeClaudeBackendSettings(raw: unknown): ClaudeBackendSettings {
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  return {
    ...(typeof r.enabled === "boolean" ? { enabled: r.enabled } : {}),
    defaultModel: sanitizeDefaultModel(r.defaultModel),
    defaultMode: sanitizeDefaultMode(r.defaultMode),
    autoModePermission: sanitizeClaudeAutoModePermission(r.autoModePermission),
    enableThinking: typeof r.enableThinking === "boolean" ? r.enableThinking : undefined,
    envOverrides: sanitizeEnvOverrides(r.envOverrides),
  };
}

function sanitizeDeviceAgentProfile(raw: unknown): DeviceAgentProfile | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const r = raw as Record<string, unknown>;
  const out: DeviceAgentProfile = {};

  const claudeCliPath = nonEmptyString(r.claudeCliPath);
  if (claudeCliPath) out.claudeCliPath = claudeCliPath;

  const claudeRaw =
    r.claude && typeof r.claude === "object" ? (r.claude as Record<string, unknown>) : null;
  if (claudeRaw) {
    const envOverrides = sanitizeEnvOverrides(claudeRaw.envOverrides);
    if (envOverrides) out.claude = { envOverrides };
  }

  return Object.keys(out).length > 0 ? out : undefined;
}

function sanitizeDeviceProfiles(raw: unknown): Record<string, DeviceAgentProfile> | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, DeviceAgentProfile> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || key.length === 0) continue;
    const profile = sanitizeDeviceAgentProfile(value);
    if (profile) out[key] = profile;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}
