import { v4 as uuidv4 } from "uuid";
import { DEFAULT_SETTINGS } from "@/constants";
import { isSensitiveKey } from "@/services/settingsSecretTransforms";
import { clearProviderTokenCaches } from "@/LLMProviders/providerTransport";
import { clearProviderResolverCaches } from "@/LLMProviders/createHttpProviderChatModel";
import { CURRENT_SETTINGS_VERSION } from "@/settings/migrations/version";
import { sanitizeSettings, type ScribeSettings } from "@/settings/model";

let writeQueue: Promise<void> = Promise.resolve();
let suppressNextPersist = false;
let transactionEpoch = 0;

const RETIRED_FIELDS = new Set([
  "scribeFolder",
  "scribeRootHistory",
  "userSystemPrompt",
  "defaultSystemPromptTitle",
  "activeModels",
  "inlineEditCommands",
  "_keychainVaultId",
  "_pendingCredentialRecovery",
  "enableEncryption",
]);
const CONFIGURATION_FIELDS = new Set([
  ...Object.keys(DEFAULT_SETTINGS),
  "storageId",
  "homeShelfTabs",
  "settingsVersion",
]);

function stripSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripSecrets);
  if (!value || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  const sensitivePair =
    typeof record.name === "string" &&
    (isSensitiveKey(record.name) || /^(?:proxy-)?authorization$/i.test(record.name));
  return Object.fromEntries(
    Object.entries(record)
      .filter(
        ([key, nested]) =>
          key === "apiKeyRef" ||
          (key === "requiresApiKey" && typeof nested === "boolean") ||
          (!isSensitiveKey(key) &&
            key !== "apiKeyKeychainId" &&
            !(sensitivePair && key === "value"))
      )
      .map(([key, nested]) => [key, stripSecrets(nested)])
  );
}

export function serializeSettings(settings: ScribeSettings): ScribeSettings {
  const sanitized = sanitizeSettings(settings);
  const selected = Object.fromEntries(
    Object.entries(sanitized).filter(
      ([key]) => CONFIGURATION_FIELDS.has(key) && !RETIRED_FIELDS.has(key) && !isSensitiveKey(key)
    )
  );
  const disk = stripSecrets(selected) as ScribeSettings;
  disk.settingsVersion = CURRENT_SETTINGS_VERSION;
  return disk;
}

export async function loadStoredSettings(
  rawData: unknown,
  saveData: (data: ScribeSettings) => Promise<void>
): Promise<ScribeSettings> {
  const raw =
    rawData && typeof rawData === "object" && !Array.isArray(rawData)
      ? (rawData as Partial<ScribeSettings>)
      : {};
  const disk = serializeSettings({ ...DEFAULT_SETTINGS, ...raw });
  if (typeof disk.storageId !== "string" || !disk.storageId) disk.storageId = uuidv4();
  if (JSON.stringify(rawData) !== JSON.stringify(disk)) await saveData(disk);
  return sanitizeSettings({ ...DEFAULT_SETTINGS, ...disk });
}

export function resetPersistenceState(): void {
  writeQueue = Promise.resolve();
  suppressNextPersist = false;
  transactionEpoch = 0;
}

export function suppressNextPersistOnce(): void {
  suppressNextPersist = true;
}

export async function runPersistenceTransaction(task: () => Promise<void>): Promise<void> {
  const job = writeQueue.then(async () => {
    try {
      await task();
    } finally {
      transactionEpoch++;
    }
  });
  writeQueue = job.catch(() => {});
  return job;
}

export async function flushPersistence(): Promise<void> {
  await writeQueue;
}

export async function persistSettingsWithinTransaction(
  settings: ScribeSettings,
  saveData: (data: ScribeSettings) => Promise<void>
): Promise<void> {
  await saveData(serializeSettings(settings));
}

export async function persistSettings(
  settings: ScribeSettings,
  saveData: (data: ScribeSettings) => Promise<void>,
  _previous?: ScribeSettings
): Promise<void> {
  if (suppressNextPersist) {
    suppressNextPersist = false;
    return;
  }
  // 设置变化可能更换供应商地址或凭据：共享的短期令牌与解析器整体失效，下一轮按新凭据重新换取。https://github.com/ItsDalk-Lane/Scribe/issues/61
  clearProviderTokenCaches();
  clearProviderResolverCaches();
  const epoch = transactionEpoch;
  const job = writeQueue.then(async () => {
    if (epoch !== transactionEpoch) return;
    await persistSettingsWithinTransaction(settings, saveData);
  });
  writeQueue = job.catch(() => {});
  return job;
}
