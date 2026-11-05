import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "@/constants";
import { createModelManagement } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { backupLegacyCredentials } from "@/services/legacyCredentialBackup";
import {
  flushPersistence,
  loadSettingsWithKeychain,
  persistSettings,
  refreshLastPersistedSettings,
  resetPersistenceState,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import { CURRENT_SETTINGS_VERSION, runSettingsMigrations } from "@/settings/migrations";
import {
  getSettings,
  setSettings,
  settingsAtom,
  settingsStore,
  subscribeToSettingsChange,
  type ScribeSettings,
} from "@/settings/model";

const VAULT_ID = "1234abcd";
const ACCESS_ID = `scribe-v${VAULT_ID}-github-copilot-access-token`;
const TOKEN_ID = `scribe-v${VAULT_ID}-github-copilot-token`;
const SECRET_VALUES = {
  [ACCESS_ID]: "synthetic-access-token",
  [TOKEN_ID]: "synthetic-provider-token",
};

async function startMigration() {
  const secrets = new Map(Object.entries(SECRET_VALUES));
  const backupFiles = new Map<string, string>();
  const app = {
    vault: { adapter: { getBasePath: () => "/isolated-test-vault" } },
    secretStorage: {
      getSecret: (id: string) => secrets.get(id) ?? null,
      setSecret: (id: string, value: string) => secrets.set(id, value),
      deleteSecret: (id: string) => secrets.delete(id),
      listSecrets: () => Array.from(secrets.keys()),
    },
  } as unknown as App;
  const initial: ScribeSettings = {
    ...structuredClone(DEFAULT_SETTINGS),
    _keychainVaultId: VAULT_ID,
    settingsVersion: 8,
    activeModels: [{ name: "gpt-4o", provider: "github-copilot", enabled: true }],
    defaultModelKey: "gpt-4o|github-copilot",
    providers: {
      local: {
        providerId: "local",
        providerType: "openai-compatible",
        displayName: "Local",
        origin: { kind: "byok" },
        addedAt: 0,
        apiKeyKeychainId: null,
        requiresApiKey: true,
      },
    },
  };
  let disk = structuredClone(initial);
  const diskWrites: ScribeSettings[] = [];
  const saveData = async (data: ScribeSettings) => {
    disk = structuredClone(data);
    diskWrites.push(disk);
  };
  KeychainService.getInstance(app);
  const loaded = await loadSettingsWithKeychain(app, disk, saveData, (raw) =>
    backupLegacyCredentials(raw, "test-plugin", {
      exists: async (path: string) => backupFiles.has(path),
      write: async (path: string, contents: string) => {
        backupFiles.set(path, contents);
      },
      rename: async (from: string, to: string) => {
        const contents = backupFiles.get(from);
        if (contents === undefined) throw new Error("missing test backup");
        backupFiles.set(to, contents);
        backupFiles.delete(from);
      },
    })
  );
  setSettings(loaded);
  const jobs: Promise<void>[] = [];
  const unsubscribe = subscribeToSettingsChange((prev, next) => {
    jobs.push(persistSettings(next, saveData, prev));
  });
  try {
    await runSettingsMigrations(createModelManagement({ app }));
    await Promise.all(jobs);
    await flushPersistence();
  } finally {
    unsubscribe();
  }
  return { app, secrets, backupFiles, disk: () => disk, diskWrites, saveData };
}

describe("retiredCredentialMigration", () => {
  beforeEach(() => {
    resetPersistenceState();
    KeychainService.resetInstance();
    settingsStore.set(settingsAtom, structuredClone(DEFAULT_SETTINGS));
  });

  afterEach(() => {
    resetPersistenceState();
    KeychainService.resetInstance();
  });

  describe("runSettingsMigrations()", () => {
    it.each(Object.entries(SECRET_VALUES))(
      "preserves the original retired credential %s through actual load, startup migration and settings save (https://github.com/ItsDalk-Lane/Scribe/issues/23)",
      async (id, value) => {
        const { secrets, diskWrites, backupFiles } = await startMigration();

        expect(secrets.get(id)).toBe(value);
        expect(JSON.stringify(diskWrites)).not.toContain(value);
        expect(JSON.stringify([...backupFiles.values()])).not.toContain(value);
      }
    );

    it("keeps the retired model unavailable while applying the other version migrations", async () => {
      const { disk } = await startMigration();

      expect(getSettings().activeModels).toEqual([]);
      expect(getSettings().defaultModelKey).toBe("");
      expect(getSettings().providers.local.requiresApiKey).toBe(false);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
      expect(disk().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("still clears this vault's keys after an explicit delete while leaving another entry alone", async () => {
      const { secrets, saveData } = await startMigration();
      secrets.set(ACCESS_ID, SECRET_VALUES[ACCESS_ID]);
      secrets.set(TOKEN_ID, SECRET_VALUES[TOKEN_ID]);
      secrets.set("another-plugin-entry", "foreign-secret");
      const keychain = KeychainService.getInstance();

      await runPersistenceTransaction(() =>
        keychain.forgetAllSecrets(saveData, (nextSettings) => {
          refreshLastPersistedSettings(nextSettings as ScribeSettings);
          suppressNextPersistOnce();
          setSettings(nextSettings);
        })
      );

      expect(secrets.has(ACCESS_ID)).toBe(false);
      expect(secrets.has(TOKEN_ID)).toBe(false);
      expect(secrets.get("another-plugin-entry")).toBe("foreign-secret");
    });
  });
});
