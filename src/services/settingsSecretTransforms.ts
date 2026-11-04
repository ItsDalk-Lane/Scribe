import { DEFAULT_SETTINGS } from "@/constants";
import { stripLegacyIndexSettings } from "@/settings/migrations/legacyIndexSettings";
import { type ScribeSettings } from "@/settings/model";
import { type CustomModel } from "@/aiParams";

export const MODEL_SECRET_FIELDS = ["apiKey"] as const;

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[_-]/g, "");
  return (
    normalized.includes("apikey") ||
    lower.endsWith("token") ||
    lower.endsWith("accesstoken") ||
    lower.endsWith("secret") ||
    lower.endsWith("password")
  );
}

export const TOP_LEVEL_SECRET_FIELDS: readonly string[] = Object.freeze(
  Object.keys(DEFAULT_SETTINGS as unknown as Record<string, unknown>).filter(isSensitiveKey)
);

function asRecord(obj: ScribeSettings): Record<string, unknown> {
  return obj as unknown as Record<string, unknown>;
}

export function hasPersistedSecrets(rawData: Record<string, unknown>): boolean {
  for (const key of Object.keys(rawData)) {
    if (!isSensitiveKey(key)) continue;
    const value = rawData[key];
    if (typeof value === "string" && value.length > 0) return true;
  }

  for (const models of Object.values(rawData)) {
    if (!Array.isArray(models)) continue;
    for (const model of models) {
      if (!model || typeof model !== "object") continue;
      const rec = model as Record<string, unknown>;
      for (const field of MODEL_SECRET_FIELDS) {
        const value = rec[field];
        if (typeof value === "string" && value.length > 0) return true;
      }
    }
  }

  return hasNestedSecrets(rawData.agentMode);
}

function hasNestedSecrets(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasNestedSecrets);
  return Object.entries(value).some(
    ([key, nested]) =>
      (isSensitiveKey(key) && typeof nested === "string" && nested.length > 0) ||
      hasNestedSecrets(nested)
  );
}

function stripNestedSecrets(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const result = value.map(stripNestedSecrets);
    return result.some((nested, index) => nested !== value[index]) ? result : value;
  }
  const entries = Object.entries(value);
  const result = entries.map(([key, nested]) => [
    key,
    isSensitiveKey(key) ? "" : stripNestedSecrets(nested),
  ]);
  return result.some((entry, index) => entry[1] !== entries[index][1])
    ? Object.fromEntries(result)
    : value;
}

export function stripKeychainFields(settings: ScribeSettings): ScribeSettings {
  const out = asRecord({ ...settings });

  for (const key of Object.keys(out)) {
    if (!isSensitiveKey(key)) continue;
    out[key] = "";
  }

  if ("activeModels" in out) {
    out.activeModels = stripModelSecrets(settings.activeModels ?? []);
  }

  if (settings.agentMode) out.agentMode = stripNestedSecrets(settings.agentMode);

  return out as unknown as ScribeSettings;
}

function stripModelSecrets(models: CustomModel[]): CustomModel[] {
  if (!models?.length) return models;

  return models.map((model) => {
    const copy = { ...model } as unknown as Record<string, unknown>;
    for (const field of MODEL_SECRET_FIELDS) {
      copy[field] = "";
    }
    return copy as unknown as CustomModel;
  });
}

export function cleanupLegacyFields(settings: ScribeSettings): ScribeSettings {
  const out = asRecord(stripLegacyIndexSettings(settings));
  delete out.enableEncryption;
  delete out._keychainMigrated;
  delete out._keychainMigratedAt;
  delete out._migrationModalDismissed;
  delete out._diskSecretsCleared;
  delete out._keychainOnly;
  delete out.githubCopilotAccessToken;
  delete out.githubCopilotToken;
  delete out.githubCopilotTokenExpiresAt;
  if (out.agentMode && typeof out.agentMode === "object" && !Array.isArray(out.agentMode)) {
    const agentMode = { ...(out.agentMode as Record<string, unknown>) };
    delete agentMode.mcpServers;
    delete agentMode.claudeCli;
    delete agentMode.deviceProfiles;
    delete agentMode.byok;
    if (
      agentMode.backends &&
      typeof agentMode.backends === "object" &&
      !Array.isArray(agentMode.backends)
    ) {
      const { native } = agentMode.backends as Record<string, unknown>;
      agentMode.backends = native ? { native } : {};
    }
    out.agentMode = agentMode;
  }
  return out as unknown as ScribeSettings;
}
