import { DEFAULT_SETTINGS } from "@/constants";
import type { ModelManagementApi } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { settingsAtom, settingsStore } from "@/settings/model";
import type { App } from "obsidian";
import { CURRENT_SETTINGS_VERSION, runSettingsMigrations } from "./index";

describe("settingsMigrations", () => {
  describe("runSettingsMigrations()", () => {
    afterEach(() => {
      KeychainService.resetInstance();
      settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS });
    });

    it("retains all existing device credentials when current settings are loaded", async () => {
      const entries = new Map<string, string>();
      const secretStorage = {
        getSecret: (key: string) => entries.get(key) ?? null,
        setSecret: (key: string, value: string) => entries.set(key, value),
        deleteSecret: (key: string) => entries.delete(key),
        listSecrets: () => [...entries.keys()],
      };
      const app = {
        vault: { adapter: { basePath: "/temporary-test-vault" } },
        secretStorage,
      } as unknown as App;
      const service = KeychainService.getInstance(app);
      service.setVaultId("1234abcd");
      const original = new Map([
        ["scribe-v1234abcd-amazon-bedrock-api-key", "one"],
        ["scribe-v1234abcd-azure-open-a-i-api-key", "two"],
        ["scribe-v1234abcd-github-copilot-access-token", "three"],
        ["scribe-v1234abcd-github-copilot-token", "four"],
      ]);
      for (const [key, value] of original) service.setSecretById(key, value);
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        settingsVersion: CURRENT_SETTINGS_VERSION,
      });

      await runSettingsMigrations({} as ModelManagementApi);

      expect(entries).toEqual(original);
    });

    it("retains existing builtin skill choices while settings advance from version 17", async () => {
      const preferences = {
        "obsidian-markdown": { disabled: true },
        "obsidian-bases": { disabled: true },
      };
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        settingsVersion: 17,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          skills: { ...DEFAULT_SETTINGS.agentMode.skills, builtinPreferences: preferences },
        },
      });

      await runSettingsMigrations({} as ModelManagementApi);

      expect(settingsStore.get(settingsAtom).agentMode.skills.builtinPreferences).toEqual(
        preferences
      );
      expect(settingsStore.get(settingsAtom).settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });
  });
});
