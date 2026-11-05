import { logInfo, logWarn } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement";
import { isLegacyCredentialsUnprotected } from "@/services/settingsPersistence";
import { getSettings, setSettings, sanitizeSettings } from "@/settings/model";

import { executeAzureRemoval } from "./azureRemovalMigration";
import { executeBedrockRemoval } from "./bedrockRemovalMigration";
import { executeByokMigration } from "./byokMigration";
import { executeRetiredModelsAndSelectionsRemoval } from "./githubCopilotRemovalMigration";
import { planOptionalCustomProviderAuthMigration } from "./optionalCustomProviderAuthMigration";
import { planRequiresApiKeyBackfill } from "./requiresApiKeyMigration";
import { CURRENT_SETTINGS_VERSION } from "./version";

export { CURRENT_SETTINGS_VERSION } from "./version";

export async function runSettingsMigrations(api: ModelManagementApi): Promise<void> {
  // 备份失败的那次加载里，退役密钥唯一副本可能仍在钥匙串；整体延迟迁移（含版本
  // 盖章），让下次启动在备份成功后完整重跑。 https://github.com/ItsDalk-Lane/Scribe/issues/23
  if (isLegacyCredentialsUnprotected()) {
    logWarn(
      "[settings-migration] legacy credentials are unprotected; deferring migrations to the next start"
    );
    return;
  }
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

  if (fromVersion < 9) {
    executeRetiredModelsAndSelectionsRemoval(getSettings());
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

  setSettings({ settingsVersion: CURRENT_SETTINGS_VERSION });
}
