import { DEFAULT_SETTINGS } from "@/constants";
import { stripLegacyIndexSettings } from "@/settings/migrations/legacyIndexSettings";
import { type CopilotSettings } from "@/settings/model";
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

function asRecord(obj: CopilotSettings): Record<string, unknown> {
  return obj as unknown as Record<string, unknown>;
}

export function hasPersistedSecrets(rawData: Record<string, unknown>): boolean {
  for (const key of Object.keys(rawData)) {
    if (!isSensitiveKey(key)) continue;
    const value = rawData[key];
    if (typeof value === "string" && value.length > 0) return true;
  }

  // Scan every top-level model-like list so credentials in a retired list are
  // backed up before the migration strips that list from persisted settings.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/283
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

// 凭据可以藏在通用 name/value 配对里（如旧代理服务的 Authorization 头），
// 键名本身不敏感，只有配对名才是标记；不识别会让明文凭据留在同步设置里。
// https://github.com/ItsDalk-Lane/Scribe/issues/17
function isCredentialPairName(name: string): boolean {
  const normalized = name.toLowerCase().replace(/[_-]/g, "");
  // authorization/proxyauthorization 头携带原始凭据但不以 token/secret 等结尾，
  // 现有键名规则覆盖不到，只在配对语境中按头名识别。
  // https://github.com/ItsDalk-Lane/Scribe/issues/17
  return (
    normalized === "authorization" || normalized === "proxyauthorization" || isSensitiveKey(name)
  );
}

function isCredentialPair(entry: unknown): boolean {
  if (!entry || typeof entry !== "object" || Array.isArray(entry)) return false;
  const record = entry as Record<string, unknown>;
  const name = record.name;
  const value = record.value;
  return (
    typeof name === "string" &&
    isCredentialPairName(name) &&
    typeof value === "string" &&
    value.length > 0
  );
}

function hasNestedSecrets(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value))
    return value.some((nested) => isCredentialPair(nested) || hasNestedSecrets(nested));
  return Object.entries(value).some(
    ([key, nested]) =>
      (isSensitiveKey(key) && typeof nested === "string" && nested.length > 0) ||
      hasNestedSecrets(nested)
  );
}

function stripNestedSecrets(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    const result = value.map((nested) =>
      isCredentialPair(nested)
        ? { ...(nested as Record<string, unknown>), value: "" }
        : stripNestedSecrets(nested)
    );
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

export function stripKeychainFields(settings: CopilotSettings): CopilotSettings {
  const out = asRecord({ ...settings });

  for (const key of Object.keys(out)) {
    if (!isSensitiveKey(key)) continue;
    out[key] = "";
  }

  if ("activeModels" in out) {
    out.activeModels = stripModelSecrets(settings.activeModels ?? []);
  }

  if (settings.agentMode) out.agentMode = stripNestedSecrets(settings.agentMode);

  return out as unknown as CopilotSettings;
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

export function cleanupLegacyFields(settings: CopilotSettings): CopilotSettings {
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
  return out as unknown as CopilotSettings;
}
