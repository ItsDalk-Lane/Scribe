import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_COPILOT_FOLDER, DEFAULT_SETTINGS } from "@/constants";
import type { ModelManagementApi, ProviderType } from "@/modelManagement";
import { getSettings, settingsAtom, settingsStore, type CopilotSettings } from "@/settings/model";

import { CURRENT_SETTINGS_VERSION, runSettingsMigrations } from "./index";
import { isLegacyCredentialsUnprotected } from "@/services/settingsPersistence";
import { KeychainService } from "@/services/keychainService";

const holdActive = isLegacyCredentialsUnprotected as unknown as jest.Mock;
const getInstance = KeychainService.getInstance as unknown as jest.Mock;

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: jest.fn(() => ({ isAvailable: () => false })) },
}));

jest.mock("@/services/settingsPersistence", () => ({
  ...(jest.requireActual("@/services/settingsPersistence") as unknown as Record<string, unknown>),
  isLegacyCredentialsUnprotected: jest.fn(() => false),
}));

function seedVault(
  overrides: Partial<CopilotSettings> & Record<string, unknown>,
  models: CustomModel[] = []
): CopilotSettings {
  const seeded: CopilotSettings = { ...DEFAULT_SETTINGS, activeModels: models, ...overrides };
  settingsStore.set(settingsAtom, seeded);
  return seeded;
}

function makeApi() {
  const setupProvider = jest.fn(async () => ({ providerId: "p1", configuredModelIds: ["cm1"] }));
  const removeProvider = jest.fn(async () => undefined);
  const api = {
    providerRegistry: { listByOrigin: jest.fn(() => []) },
    setup: { byok: { setupProvider } },
    coordinator: { removeProvider },
  } as unknown as ModelManagementApi;
  return { api, setupProvider, removeProvider };
}

function keyedAnthropicVault(settingsVersion: number | undefined): CopilotSettings {
  return seedVault({ settingsVersion, anthropicApiKey: "sk-ant" }, [
    {
      name: "claude-sonnet-4-5",
      provider: ChatModelProviders.ANTHROPIC,
      enabled: true,
    },
  ]);
}

function codexVaultAt(settingsVersion: number): CopilotSettings {
  return seedVault({
    settingsVersion,
    providers: {
      "prov-codex": {
        providerId: "prov-codex",
        providerType: "openai-compatible",
        displayName: "Codex",
        origin: { kind: "agent", agentType: "codex" },
        addedAt: 0,
      },
    },
    configuredModels: ["low", "high"].map((effort) => ({
      configuredModelId: `cm-${effort}`,
      providerId: "prov-codex",
      info: { id: `gpt-5.6-sol[${effort}]`, displayName: `GPT-5.6-Sol (${effort})` },
      configuredAt: 0,
    })),
    backends: { codex: { enabledModels: ["cm-high"] } },
  } as unknown as Partial<CopilotSettings>);
}

describe("settingsMigrations", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    holdActive.mockReturnValue(false);
    settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS });
  });

  describe("runSettingsMigrations()", () => {
    it("clears obsolete builtin opt-outs while preserving the native model and permission configuration", async () => {
      const settings = seedVault({
        settingsVersion: 17,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          backends: {
            native: {
              enabled: false,
              defaultModel: { baseModelId: "custom-model", effort: "high" },
              defaultMode: "plan",
              maxSteps: 75,
            },
          },
          skills: {
            ...DEFAULT_SETTINGS.agentMode.skills,
            builtinPreferences: {
              "obsidian-markdown": { disabled: true },
              "obsidian-bases": { disabledAgents: ["claude"] },
            },
          },
        },
      });
      const { api } = makeApi();
      await runSettingsMigrations(api);
      expect(getSettings().agentMode.backends.native).toEqual({
        enabled: false,
        defaultModel: { baseModelId: "custom-model", effort: "high" },
        defaultMode: "plan",
        maxSteps: 75,
      });
      expect(getSettings().agentMode.skills.builtinPreferences).toEqual({});
      expect(getSettings().configuredModels).toEqual(settings.configuredModels);
      expect(getSettings().backends).toEqual(settings.backends);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("migrates legacy BYOK models and stamps the current version for a pre-versioned install", async () => {
      keyedAnthropicVault(undefined);
      const { api, setupProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(setupProvider).toHaveBeenCalledTimes(1);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("defers every migration while the legacy credential backup failed, so keychain entries survive (https://github.com/ItsDalk-Lane/Scribe/issues/23)", async () => {
      keyedAnthropicVault(undefined);
      const { api, setupProvider } = makeApi();
      holdActive.mockReturnValue(true);

      await runSettingsMigrations(api);

      expect(setupProvider).not.toHaveBeenCalled();
      expect(getSettings().settingsVersion).toBeUndefined();
    });

    it("sweeps retired keychain entries even when the settings version is already current (https://github.com/ItsDalk-Lane/Scribe/issues/25)", async () => {
      seedVault({ settingsVersion: CURRENT_SETTINGS_VERSION });
      const { api } = makeApi();
      const deleteSecret = jest.fn((key: string) => undefined);
      getInstance.mockReturnValueOnce({
        isAvailable: () => true,
        deleteSecret,
      });

      await runSettingsMigrations(api);

      expect(deleteSecret.mock.calls.map((call) => call[0])).toEqual([
        "amazonBedrockApiKey",
        "azureOpenAIApiKey",
        "githubCopilotAccessToken",
        "githubCopilotToken",
      ]);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("migrates legacy BYOK models for a vault stamped with the orphaned prototype version 2", async () => {
      keyedAnthropicVault(2);
      const { api, setupProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(setupProvider).toHaveBeenCalledTimes(1);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("stamps the current version even when there is nothing to migrate", async () => {
      seedVault({ settingsVersion: undefined });
      const { api, setupProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(setupProvider).not.toHaveBeenCalled();
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("backfills requiresApiKey for a v4 vault without re-running the legacy BYOK migration", async () => {
      seedVault({
        settingsVersion: 4,
        providers: {
          p1: {
            providerId: "p1",
            providerType: "openai-compatible",
            displayName: "OpenRouter",
            origin: { kind: "byok", catalogProviderId: "openrouter" },
            addedAt: 0,
            apiKeyKeychainId: null,
          },
        },
      });
      const { api, setupProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(setupProvider).not.toHaveBeenCalled();
      expect(getSettings().providers.p1.requiresApiKey).toBe(true);
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it.each([CURRENT_SETTINGS_VERSION, CURRENT_SETTINGS_VERSION + 1])(
      "leaves a v%s vault untouched even when it still holds retired provider, model, and Codex data",
      async (settingsVersion) => {
        const codexRows = codexVaultAt(settingsVersion);
        const seeded = seedVault(
          {
            ...codexRows,
            defaultModelKey: "gpt-4o|github-copilot",
            providers: {
              ...codexRows.providers,
              bed: {
                providerId: "bed",
                providerType: "bedrock" as ProviderType,
                displayName: "Amazon Bedrock",
                origin: { kind: "byok" },
                addedAt: 0,
              },
            },
          },
          [{ name: "gpt-4o", provider: "github-copilot", enabled: true }]
        );
        const { api, setupProvider, removeProvider } = makeApi();

        await runSettingsMigrations(api);

        expect(getSettings()).toBe(seeded);
        expect(setupProvider).not.toHaveBeenCalled();
        expect(removeProvider).not.toHaveBeenCalled();
      }
    );

    it("upgrades a v16 Codex setup to Claude and removes only its retired agent models", async () => {
      codexVaultAt(16);
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().agentMode.activeBackend).toBe("native");
      expect(getSettings().providers).toEqual({});
      expect(getSettings().configuredModels).toEqual([]);
      expect(getSettings().backends).toEqual({});
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it.each([7, undefined])(
      "v8: seeds the Copilot root, its history, and the upgrade flag for a settingsVersion=%s vault",
      async (settingsVersion) => {
        seedVault({
          settingsVersion,
          copilotFolder: undefined,
          copilotRootHistory: undefined,
          upgradedToV8FromLegacy: undefined,
        });
        const { api } = makeApi();

        await runSettingsMigrations(api);

        expect(getSettings().copilotFolder).toBe(DEFAULT_COPILOT_FOLDER);
        expect(getSettings().copilotRootHistory).toEqual([DEFAULT_COPILOT_FOLDER]);
        expect(getSettings().upgradedToV8FromLegacy).toBe(true);
      }
    );

    it("v9: drops GitHub Copilot models and selections for a v8 vault", async () => {
      seedVault({ settingsVersion: 8, defaultModelKey: "gpt-4o|github-copilot" }, [
        { name: "gpt-4o", provider: "github-copilot", enabled: true },
      ]);
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().activeModels.map((m) => m.provider)).not.toContain("github-copilot");
      expect(getSettings().defaultModelKey).toBe("");
    });

    it("v10: makes auth optional for an existing custom OpenAI-compatible provider (https://github.com/logancyang/obsidian-copilot/issues/2895)", async () => {
      seedVault({
        settingsVersion: 9,
        providers: {
          custom: {
            providerId: "custom",
            providerType: "openai-compatible",
            displayName: "Custom OpenAI-compatible",
            origin: { kind: "byok" },
            requiresApiKey: true,
            apiKeyKeychainId: "keychain-custom",
            addedAt: 0,
          },
        },
      });
      const { api } = makeApi();

      await runSettingsMigrations(api);

      expect(getSettings().providers.custom).toMatchObject({
        requiresApiKey: false,
        apiKeyKeychainId: "keychain-custom",
      });
      expect(getSettings().settingsVersion).toBe(CURRENT_SETTINGS_VERSION);
    });

    it("v11: hands a saved Bedrock provider to the removal cascade for a v10 vault", async () => {
      seedVault({
        settingsVersion: 10,
        providers: {
          bed: {
            providerId: "bed",
            providerType: "bedrock" as ProviderType,
            displayName: "Amazon Bedrock",
            origin: { kind: "byok" },
            addedAt: 0,
          },
        },
      });
      const { api, removeProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(removeProvider).toHaveBeenCalledWith("bed");
    });

    it("v12: hands a saved Azure provider to the removal cascade for a v11 vault", async () => {
      seedVault({
        settingsVersion: 11,
        providers: {
          az: {
            providerId: "az",
            providerType: "azure" as ProviderType,
            displayName: "Azure OpenAI",
            origin: { kind: "byok" },
            addedAt: 0,
          },
        },
      });
      const { api, removeProvider } = makeApi();

      await runSettingsMigrations(api);

      expect(removeProvider).toHaveBeenCalledWith("az");
    });
  });
});
