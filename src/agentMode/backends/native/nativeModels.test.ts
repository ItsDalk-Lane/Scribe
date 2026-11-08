import type { App } from "obsidian";
import { DEFAULT_SETTINGS } from "@/constants";
import { getSettings, resetSettings, setSettings, type ScribeSettings } from "@/settings/model";
import {
  createNativeModel,
  getNativeDefaultModelId,
  getNativeEnabledModelEntries,
  getNativeModelEntries,
} from "@/agentMode/backends/native/nativeModels";

const mockCreate = jest.fn().mockResolvedValue({ model: { id: "chosen" } });
const mockSecret = jest.fn().mockReturnValue("available");
jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: { getInstance: () => ({ createModelInstanceFromBridged: mockCreate }) },
}));
jest.mock("@/services/secretStore", () => ({
  SecretStore: { getInstance: () => ({ getStatus: mockSecret }) },
}));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function settings(): ScribeSettings {
  return {
    ...DEFAULT_SETTINGS,
    defaultModelKey: "reasoning",
    providers: {
      local: {
        providerId: "local",
        providerType: "openai-compatible",
        displayName: "Local",
        baseUrl: "http://localhost:1234/v1",
        requiresApiKey: false,
        origin: { kind: "byok" },
        addedAt: 1,
      },
      cloud: {
        providerId: "cloud",
        providerType: "openai-compatible",
        displayName: "Cloud",
        baseUrl: "https://example.test/custom/v1",
        requiresApiKey: true,
        apiKeyRef: "saved-key",
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
    it("uses the first configured runnable model regardless of old model switches and chat defaults https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      const value = settings();
      value.backends = { native: { enabledModels: [] }, chat: { enabledModels: ["reasoning"] } };
      expect(getNativeDefaultModelId(value)).toBe("manual");
    });
    it("preserves a previous available choice and falls back when it was removed https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      const value = settings();
      value.agentMode.backends.native = {
        defaultModel: { baseModelId: "reasoning", effort: "high" },
      };
      expect(getNativeDefaultModelId(value)).toBe("reasoning");
      value.agentMode.backends.native.defaultModel = { baseModelId: "removed", effort: null };
      expect(getNativeDefaultModelId(value)).toBe("manual");
    });
    it("skips models without usable credentials when choosing the initial model https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      const value = settings();
      value.configuredModels = [value.configuredModels[2], value.configuredModels[0]];
      expect(getNativeDefaultModelId(value)).toBe("manual");
    });
  });
  describe("getNativeModelEntries()", () => {
    it("returns a stable empty list when no chat models are configured", () => {
      const value = settings();
      value.configuredModels = [];
      expect(getNativeModelEntries(value)).toEqual([]);
      expect(getNativeModelEntries(value)).toBe(getNativeModelEntries(value));
    });

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
    it("makes configured models available despite legacy disabled switches https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      const value = settings();
      value.backends.native = { enabledModels: [] };
      expect(getNativeModelEntries(value).map((entry) => entry.baseModelId)).toEqual([
        "manual",
        "reasoning",
        "untagged",
      ]);
    });
    it("offers the actual GLM reasoning levels when the configured model has no effort list", () => {
      const value = settings();
      value.configuredModels[0].info = {
        id: "glm-5.3-flash",
        displayName: "GLM-5.3-Flash",
        reasoning: true,
      };
      value.providers.local.baseUrl = "https://open.bigmodel.cn/api/paas/v4";
      expect(getNativeModelEntries(value)[0].effortOptions.map((option) => option.value)).toEqual([
        "default",
        "low",
        "high",
        "max",
      ]);
    });
  });
  describe("getNativeEnabledModelEntries()", () => {
    it("preserves configured order and marks required credentials missing without hiding the model", () => {
      expect(
        getNativeEnabledModelEntries(settings()).map((model) => [
          model.baseModelId,
          model.credentialState,
        ])
      ).toEqual([
        ["manual", "ok"],
        ["reasoning", "ok"],
        ["untagged", "missing_key"],
      ]);
    });
    it("returns the same empty reference when there are no configured models", () => {
      const value = settings();
      value.configuredModels = [];
      expect(getNativeEnabledModelEntries(value)).toBe(getNativeEnabledModelEntries(value));
    });
  });
  describe("createNativeModel()", () => {
    it("reuses the selected endpoint and encrypted reference without resolving plaintext", async () => {
      setSettings(settings());
      await createNativeModel({} as App, "reasoning");
      expect(mockSecret).toHaveBeenCalledWith("saved-key");
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "reasoning-model",
          configuredModelId: "reasoning",
          baseUrl: "https://example.test/custom/v1",
          credentialRef: "saved-key",
        })
      );
      expect(getSettings().providers.cloud.apiKeyRef).toBe("saved-key");
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
        })
      );
    });
    it("rejects a removed chosen model before creating any different model", async () => {
      setSettings(settings());
      await expect(createNativeModel({} as App, "removed-model")).rejects.toThrow("removed-model");
      expect(mockCreate).not.toHaveBeenCalled();
    });
  });
});
