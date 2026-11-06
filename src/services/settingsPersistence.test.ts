import { DEFAULT_SETTINGS } from "@/constants";
import { getSettings, settingsAtom, settingsStore, type ScribeSettings } from "@/settings/model";
import {
  flushPersistence,
  loadStoredSettings,
  persistSettings,
  persistSettingsWithinTransaction,
  resetPersistenceState,
  runPersistenceTransaction,
  serializeSettings,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";

function configuredSettings() {
  return {
    ...DEFAULT_SETTINGS,
    storageId: "stable-vault-id",
    providers: {
      service: {
        providerId: "service",
        providerType: "openai-compatible" as const,
        displayName: "Test service",
        baseUrl: "https://service.example/v1",
        origin: { kind: "byok" as const },
        addedAt: 1,
        apiKeyRef: "new-secret-reference",
      },
    },
    homeShelfTabs: { home: "projects" },
  };
}

describe("settingsPersistence", () => {
  beforeEach(() => {
    resetPersistenceState();
    settingsStore.set(settingsAtom, DEFAULT_SETTINGS);
  });

  describe("serializeSettings()", () => {
    it("does not persist raw authorization headers or private keys inside service options", () => {
      const settings = configuredSettings();
      const provider = {
        ...settings.providers.service,
        extras: {
          headers: { Authorization: "Bearer synthetic-header" },
          account: { private_key: "synthetic-private-key", client_email: "fixture@example.test" },
        },
      };
      const disk = serializeSettings({ ...settings, providers: { service: provider } });
      expect(JSON.stringify(disk)).not.toMatch(/synthetic-header|synthetic-private-key/);
      expect(disk.providers.service.extras).toEqual({
        headers: {},
        account: { client_email: "fixture@example.test" },
      });
    });
    it("keeps explicit model settings, lightweight preferences and secret references without secret values", () => {
      const settings = configuredSettings();
      const disk = serializeSettings({
        ...settings,
        openAIApiKey: "plaintext-key",
        ...{ userSystemPrompt: "legacy instructions", defaultSystemPromptTitle: "Selected" },
        scribeFolder: "old-folder",
      });
      expect(disk.providers.service).toEqual(settings.providers.service);
      expect(disk.storageId).toBe("stable-vault-id");
      expect(disk.homeShelfTabs).toEqual({ home: "projects" });
      expect(disk).not.toHaveProperty("openAIApiKey");
      expect(disk).not.toHaveProperty("userSystemPrompt");
      expect(disk).not.toHaveProperty("scribeFolder");
      expect(disk).not.toHaveProperty("scribeRootHistory");
    });

    it("drops old keychain pointers and credentials hidden in service options without importing them", () => {
      const settings = configuredSettings();
      const provider = {
        ...settings.providers.service,
        apiKeyRef: undefined,
        apiKeyKeychainId: "old-keychain-entry",
        extras: {
          apiKey: "nested-plaintext",
          region: "test",
          headers: [{ name: "Authorization", value: "Bearer secret" }],
        },
      };
      const disk = serializeSettings({ ...settings, providers: { service: provider } });
      expect(disk.providers.service).not.toHaveProperty("apiKeyKeychainId");
      expect(disk.providers.service.extras).toEqual({
        region: "test",
        headers: [{ name: "Authorization" }],
      });
      expect(JSON.stringify(disk)).not.toMatch(/nested-plaintext|Bearer secret|old-keychain-entry/);
    });
  });

  describe("loadStoredSettings()", () => {
    it("preserves an explicitly keyless custom service through saving and reopening", async () => {
      const settings = configuredSettings();
      const keyless = {
        ...settings.providers.service,
        requiresApiKey: false,
        apiKeyRef: undefined,
      };
      const loaded = await loadStoredSettings(
        serializeSettings({ ...settings, providers: { service: keyless } }),
        async () => {}
      );
      expect(loaded.providers.service.requiresApiKey).toBe(false);
    });
    it("creates a stable storage identity and preserves it on subsequent loads", async () => {
      const save = jest.fn(async () => {});
      const first = await loadStoredSettings(null, save);
      expect(first.storageId).toMatch(/^[a-f0-9-]{36}$/);
      const second = await loadStoredSettings(serializeSettings(first), save);
      expect(second.storageId).toBe(first.storageId);
      expect(save).toHaveBeenCalledTimes(1);
    });

    it("retains explicit configuration but ignores legacy keys, commands and prompt content", async () => {
      const loaded = await loadStoredSettings(
        {
          ...configuredSettings(),
          openAIApiKey: "old-key",
          userSystemPrompt: "old-prompt",
          defaultSystemPromptTitle: "Selected",
          inlineEditCommands: [{ name: "old-command", prompt: "old-body" }],
          activeModels: [{ apiKey: "old-model-key" }],
        },
        async () => {}
      );
      expect(loaded.providers.service.baseUrl).toBe("https://service.example/v1");
      expect(loaded.openAIApiKey).toBe("");
      expect(loaded).not.toHaveProperty("userSystemPrompt");
      expect(loaded).not.toHaveProperty("defaultSystemPromptTitle");
      expect(loaded.activeModels).toEqual([]);
      expect(loaded.inlineEditCommands).toEqual([]);
    });

    it("reports an initial save failure without publishing partially loaded settings", async () => {
      await expect(
        loadStoredSettings(null, async () => {
          throw new Error("read-only vault");
        })
      ).rejects.toThrow("read-only vault");
      expect(getSettings()).toBe(DEFAULT_SETTINGS);
    });
  });

  describe("persistSettings()", () => {
    it("serializes concurrent saves in order and continues after a failed save", async () => {
      const observed: boolean[] = [];
      const save = jest.fn(async (data: ScribeSettings) => {
        observed.push(data.debug);
        if (data.debug) throw new Error("disk unavailable");
      });
      const first = persistSettings({ ...DEFAULT_SETTINGS, debug: true }, save);
      const second = persistSettings({ ...DEFAULT_SETTINGS, debug: false }, save);
      await expect(first).rejects.toThrow("disk unavailable");
      await second;
      expect(observed).toEqual([true, false]);
    });
  });

  describe("persistSettingsWithinTransaction()", () => {
    it("writes only the permitted configuration fields", async () => {
      const save = jest.fn(async (_data: ScribeSettings) => {});
      await persistSettingsWithinTransaction(
        { ...DEFAULT_SETTINGS, googleApiKey: "must-not-save" },
        save
      );
      expect(save.mock.calls[0][0]).not.toHaveProperty("googleApiKey");
    });
  });

  describe("suppressNextPersistOnce()", () => {
    it("suppresses exactly the next subscriber save", async () => {
      const save = jest.fn(async () => {});
      suppressNextPersistOnce();
      await persistSettings(DEFAULT_SETTINGS, save);
      await persistSettings(DEFAULT_SETTINGS, save);
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  describe("resetPersistenceState()", () => {
    it("clears stale save suppression before a new plugin lifecycle", async () => {
      const save = jest.fn(async () => {});
      suppressNextPersistOnce();
      resetPersistenceState();
      await persistSettings(DEFAULT_SETTINGS, save);
      expect(save).toHaveBeenCalledTimes(1);
    });
  });

  describe("runPersistenceTransaction()", () => {
    it("keeps a transaction ordered with earlier saves", async () => {
      const events: string[] = [];
      const saved = persistSettings(DEFAULT_SETTINGS, async () => {
        events.push("save");
      });
      const transaction = runPersistenceTransaction(async () => {
        events.push("transaction");
      });
      await Promise.all([saved, transaction]);
      expect(events).toEqual(["save", "transaction"]);
    });
  });

  describe("flushPersistence()", () => {
    it("waits for the queued save itself", async () => {
      let release!: () => void;
      const completion = new Promise<void>((resolve) => {
        release = resolve;
      });
      const save = persistSettings(DEFAULT_SETTINGS, () => completion);
      const flushed = flushPersistence();
      release();
      await Promise.all([save, flushed]);
    });
  });
});
