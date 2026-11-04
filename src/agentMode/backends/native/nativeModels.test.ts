import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "@/constants";
import { getSettings, resetSettings, setSettings, type CopilotSettings } from "@/settings/model";
import {
  createNativeModel,
  getNativeDefaultModelId,
  getNativeEnabledModelEntries,
  getNativeModelEntries,
} from "@/agentMode/backends/native/nativeModels";

const mockCreate = jest.fn().mockResolvedValue({ model: { id: "chosen" } });
const mockSecret = jest.fn().mockReturnValue("synthetic-secret");
jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: { getInstance: () => ({ createModelInstanceFromBridged: mockCreate }) },
}));
jest.mock("@/services/keychainService", () => ({
  KeychainService: { getInstance: () => ({ getSecretById: mockSecret }) },
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function settings(): CopilotSettings {
  return {
    ...DEFAULT_SETTINGS,
    defaultModelKey: "reasoning",
    providers: {
      local: {
        providerId: "local",
        providerType: "openai-compatible",
        displayName: "Local",
        baseUrl: "http://localhost:1234/v1",
        enableCors: false,
        requiresApiKey: false,
        origin: { kind: "byok" },
        addedAt: 1,
      },
      cloud: {
        providerId: "cloud",
        providerType: "openai-compatible",
        displayName: "Cloud",
        baseUrl: "https://example.test/custom/v1",
        enableCors: true,
        requiresApiKey: true,
        apiKeyKeychainId: "saved-key",
        origin: { kind: "byok", catalogProviderId: "openai" },
        addedAt: 1,
      },
      missing: {
        providerId: "missing",
        providerType: "google",
        displayName: "No key",
        requiresApiKey: true,
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "manual",
        providerId: "local",
        info: { id: "manually-entered", displayName: "Manual" },
        configuredAt: 1,
      },
      {
        configuredModelId: "reasoning",
        providerId: "cloud",
        info: {
          id: "reasoning-model",
          displayName: "Reasoning",
          reasoningEfforts: ["none", "low", "high"],
        },
        configuredAt: 1,
      },
      {
        configuredModelId: "untagged",
        providerId: "missing",
        info: { id: "untagged-model", displayName: "Untagged", toolCall: false },
        configuredAt: 1,
      },
    ],
    backends: { chat: { enabledModels: ["manual", "reasoning", "untagged"] } },
    agentMode: { ...DEFAULT_SETTINGS.agentMode, backends: {} },
  };
}

describe("nativeModels", () => {
  beforeEach(() => {
    resetSettings();
    jest.clearAllMocks();
  });
  describe("getNativeDefaultModelId()", () => {
    it("inherits the same first enabled chat model when the enabled list has a different order from registration", () => {
      const value = settings();
      value.defaultModelKey = "";
      value.backends.chat = { enabledModels: ["reasoning", "manual"] };
      expect(getNativeDefaultModelId(value)).toBe("reasoning");
    });
    it("keeps the selected chat identity when native visibility excludes it so execution can report its unavailability", () => {
      const value = settings();
      value.backends.native = { enabledModels: ["manual"] };
      expect(getNativeDefaultModelId(value)).toBe("reasoning");
    });
    it("uses the existing selected chat model when no native default has been saved", () => {
      expect(getNativeDefaultModelId(settings())).toBe("reasoning");
    });
    it("keeps an explicitly selected unavailable model so creation reports the problem instead of changing models", () => {
      const value = settings();
      value.agentMode.backends.native = {
        defaultModel: { baseModelId: "removed-model", effort: null },
      };
      expect(getNativeDefaultModelId(value)).toBe("removed-model");
    });
    it("selects the first enabled chat model only when no saved chat choice resolves", () => {
      expect(getNativeDefaultModelId({ ...settings(), defaultModelKey: "" })).toBe("manual");
    });
  });
  describe("getNativeModelEntries()", () => {
    it("includes manually entered and untagged models and separates the provider default from advertised reasoning levels", () => {
      const models = getNativeModelEntries(settings());
      expect(models.map((entry) => entry.baseModelId)).toEqual(["manual", "reasoning", "untagged"]);
      expect(models[0].effortOptions).toEqual([]);
      expect(models[1].effortOptions).toEqual([
        { value: "default", label: "Default" },
        { value: "off", label: "off" },
        { value: "low", label: "low" },
        { value: "high", label: "high" },
      ]);
    });
    it("honors an explicit native enablement list and returns stable empty slices when every native model is disabled", () => {
      const value = settings();
      value.backends.native = { enabledModels: [] };
      expect(getNativeModelEntries(value)).toEqual([]);
      expect(getNativeModelEntries(value)).toBe(getNativeModelEntries(value));
    });
  });
  describe("getNativeEnabledModelEntries()", () => {
    it("puts the selected default first and marks required credentials missing without hiding the model", () => {
      expect(
        getNativeEnabledModelEntries(settings()).map((model) => [
          model.baseModelId,
          model.credentialState,
        ])
      ).toEqual([
        ["reasoning", "ok"],
        ["manual", "ok"],
        ["untagged", "missing_key"],
      ]);
    });
    it("returns the same empty reference when there are no enabled models", () => {
      const value = settings();
      value.backends = {};
      expect(getNativeEnabledModelEntries(value)).toBe(getNativeEnabledModelEntries(value));
    });
  });
  describe("createNativeModel()", () => {
    it("reuses the exact BYOK endpoint, transport choice and saved key of the selected model", async () => {
      setSettings(settings());
      await createNativeModel({} as App, "reasoning");
      expect(mockSecret).toHaveBeenCalledWith("saved-key");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "reasoning-model",
          configuredModelId: "reasoning",
          baseUrl: "https://example.test/custom/v1",
          enableCors: true,
          apiKey: "synthetic-secret",
        })
      );
      expect(getSettings().providers.cloud.apiKeyKeychainId).toBe("saved-key");
    });
    it("preserves a keyless local endpoint and its compatibility transport", async () => {
      setSettings(settings());
      await createNativeModel({} as App, "manual");
      expect(mockSecret).not.toHaveBeenCalled();
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "manually-entered",
          baseUrl: "http://localhost:1234/v1",
          requiresApiKey: false,
          enableCors: false,
        })
      );
    });
    it("rejects a removed or disabled chosen model before creating any different model", async () => {
      setSettings(settings());
      await expect(createNativeModel({} as App, "removed-model")).rejects.toThrow("removed-model");
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
