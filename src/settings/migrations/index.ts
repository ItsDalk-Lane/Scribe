import { DEFAULT_COPILOT_FOLDER } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { isLegacyCredentialsUnprotected } from "@/services/settingsPersistence";
import { getSettings, normalizeRootFolders, setSettings, sanitizeSettings } from "@/settings/model";

import { executeAzureRemoval } from "./azureRemovalMigration";
import { executeBedrockRemoval } from "./bedrockRemovalMigration";
import { executeByokMigration } from "./byokMigration";
import { executeGitHubCopilotRemoval } from "./githubCopilotRemovalMigration";
import { planOptionalCustomProviderAuthMigration } from "./optionalCustomProviderAuthMigration";
import { planRequiresApiKeyBackfill } from "./requiresApiKeyMigration";
import { CURRENT_SETTINGS_VERSION } from "./version";

export { CURRENT_SETTINGS_VERSION } from "./version";

// 各设备钥匙串独立而设置会同步：另一台设备先保存新版本号后，本机就永远跳过
// 版本门槛，退役密钥留下孤儿。按确切名字每次启动清扫，不依赖版本号。
// https://github.com/ItsDalk-Lane/Scribe/issues/25
const RETIRED_SECRET_KEYS = [
  "amazonBedrockApiKey",
  "azureOpenAIApiKey",
  "githubCopilotAccessToken",
  "githubCopilotToken",
] as const;

function sweepRetiredKeychainSecrets(): void {
  try {
    const keychain = KeychainService.getInstance();
    if (!keychain.isAvailable()) return;
    for (const key of RETIRED_SECRET_KEYS) keychain.deleteSecret(key);
  } catch (error) {
    logWarn("[settings-migration] retired keychain sweep failed", error);
  }
}

export async function runSettingsMigrations(api: ModelManagementApi): Promise<void> {
  // 备份失败的那次加载里，退役密钥唯一副本可能仍在钥匙串；整体延迟迁移（含版本
  // 盖章），让下次启动在备份成功后完整重跑。 https://github.com/ItsDalk-Lane/Scribe/issues/23
  if (isLegacyCredentialsUnprotected()) {
    logWarn(
      "[settings-migration] legacy credentials are unprotected; deferring migrations to the next start"
    );
    return;
  }
  sweepRetiredKeychainSecrets();
  const fromVersion = getSettings().settingsVersion ?? 0;
  if (fromVersion >= CURRENT_SETTINGS_VERSION) return;

  logInfo(`[settings-migration] migrating from v${fromVersion} to v${CURRENT_SETTINGS_VERSION}`);

  if (fromVersion < 4) {
    await executeByokMigration(api, getSettings());
  }

  if (fromVersion < 5) {
    const backfilled = planRequiresApiKeyBackfill(getSettings().providers);
    if (backfilled) setSettings({ providers: backfilled });
  }

  if (fromVersion < 8) {
    setSettings({ copilotFolder: DEFAULT_COPILOT_FOLDER });

    const currentRoot = getSettings().copilotFolder;
    setSettings({
      copilotRootHistory: normalizeRootFolders([DEFAULT_COPILOT_FOLDER, currentRoot]),
    });

    setSettings({ upgradedToV8FromLegacy: true });
  }

  if (fromVersion < 9) {
    executeGitHubCopilotRemoval(getSettings());
  }

  if (fromVersion < 10) {
    const migrated = planOptionalCustomProviderAuthMigration(getSettings().providers);
    if (migrated) setSettings({ providers: migrated });
  }

  if (fromVersion < 11) {
    await executeBedrockRemoval(api, getSettings());
  }

  if (fromVersion < 12) {
    await executeAzureRemoval(api, getSettings());
  }

  if (fromVersion < 17) {
    setSettings(sanitizeSettings(getSettings()));
  }

  if (fromVersion < 18) {
    setSettings((current) => {
      return {
        agentMode: {
          ...current.agentMode,
          skills: { ...current.agentMode.skills, builtinPreferences: {} },
        },
      };
    });
  }

  setSettings({ settingsVersion: CURRENT_SETTINGS_VERSION });
}
