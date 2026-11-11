import { DEFAULT_SETTINGS } from "@/constants";
import { type ScribeSettings } from "@/settings/model";

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  const normalized = lower.replace(/[_-]/g, "");
  return (
    normalized === "authorization" ||
    normalized === "proxyauthorization" ||
    normalized.endsWith("privatekey") ||
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

export function cleanupLegacyFields(settings: ScribeSettings): ScribeSettings {
  const out = asRecord({ ...settings });
  const legacyFields = [
    "projectList",
    "memoryFolderName",
    "promptUsageTimestamps",
    "customPromptsFolder",
    "projectsFolder",
    "openAIProxyBaseUrl",
    "huggingfaceApiKey",
    "enableSemanticSearchV3",
    "embeddingModelKey",
    "activeEmbeddingModels",
    "embeddingRequestsPerMin",
    "embeddingBatchSize",
    "numPartitions",
    "enableIndexSync",
    "disableIndexOnMobile",
    "indexVaultToVectorStore",
    "openAIEmbeddingProxyBaseUrl",
    "azureOpenAIApiEmbeddingDeploymentName",
  ];
  for (const field of legacyFields) delete out[field];
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
    delete agentMode.debugFullFrames;
    if (
      agentMode.skills &&
      typeof agentMode.skills === "object" &&
      !Array.isArray(agentMode.skills)
    ) {
      const skills = { ...(agentMode.skills as Record<string, unknown>) };
      delete skills.folder;
      agentMode.skills = skills;
    }
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
