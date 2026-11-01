import { DEFAULT_COPILOT_FOLDER } from "@/constants";
import { logInfo } from "@/logger";
import type { ModelManagementApi } from "@/modelManagement";
import { getSettings, normalizeRootFolders, setSettings, sanitizeSettings } from "@/settings/model";

import { executeAzureRemoval } from "./azureRemovalMigration";
import { executeBedrockRemoval } from "./bedrockRemovalMigration";
import { executeByokMigration } from "./byokMigration";
import { executeGitHubCopilotRemoval } from "./githubCopilotRemovalMigration";
import { planOptionalCustomProviderAuthMigration } from "./optionalCustomProviderAuthMigration";
import { planRequiresApiKeyBackfill } from "./requiresApiKeyMigration";
import { CURRENT_SETTINGS_VERSION } from "./version";

export { CURRENT_SETTINGS_VERSION } from "./version";

export async function runSettingsMigrations(api: ModelManagementApi): Promise<void> {
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
      const claude = { ...current.agentMode.backends.claude };
      delete claude.defaultModel;
      return {
        agentMode: {
          ...current.agentMode,
          backends: { ...current.agentMode.backends, claude },
          skills: { ...current.agentMode.skills, builtinPreferences: {} },
        },
      };
    });
  }

  setSettings({ settingsVersion: CURRENT_SETTINGS_VERSION });
}
