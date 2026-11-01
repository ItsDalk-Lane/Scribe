import { DEFAULT_SETTINGS } from "@/constants";
import { logError } from "@/logger";
import { getSettings, setSettings, settingsAtom, settingsStore } from "@/settings/model";
import { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import type { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import type { Provider } from "@/modelManagement/types/persisted";
import { BackendConfigRegistry } from "./BackendConfigRegistry";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

describe("BackendConfigRegistry", () => {
  let registry: BackendConfigRegistry;
  let models: ConfiguredModelRegistry;
  const provider: Provider = {
    providerId: "byok",
    providerType: "openai-compatible",
    displayName: "My provider",
    origin: { kind: "byok" },
    addedAt: 0,
  };

  beforeEach(() => {
    settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, backends: {}, configuredModels: [] });
    models = new ConfiguredModelRegistry();
    registry = new BackendConfigRegistry(
      {
        get: (id: string) => (id === provider.providerId ? provider : undefined),
      } as ProviderRegistry,
      models
    );
    jest.clearAllMocks();
  });

  describe("get()", () => {
    it("returns a stable empty configuration for an unconfigured backend", () => {
      expect(registry.get("chat").enabledModels).toEqual([]);
      expect(registry.get("chat")).toBe(registry.get("chat"));
    });
    it("returns the persisted configuration for the selected backend", async () => {
      await registry.setEnabledModels("chat", ["a"]);
      expect(registry.get("chat")).toEqual({ enabledModels: ["a"] });
      expect(registry.get("claude").enabledModels).toEqual([]);
    });
  });

  describe("setEnabledModels()", () => {
    it("replaces one backend's model order while preserving other backends and the input array", async () => {
      await registry.setEnabledModels("claude", ["other"]);
      const ids = ["b", "a"];
      await registry.setEnabledModels("chat", ids);
      ids.push("later");
      expect(registry.get("chat").enabledModels).toEqual(["b", "a"]);
      expect(registry.get("claude").enabledModels).toEqual(["other"]);
    });
    it("does not replace stored configurations when the model list is unchanged", async () => {
      await registry.setEnabledModels("chat", ["a"]);
      const before = getSettings().backends;
      await registry.setEnabledModels("chat", ["a"]);
      expect(getSettings().backends).toBe(before);
    });
  });

  describe("enableModel()", () => {
    it("appends a new model and does not duplicate an already enabled model", async () => {
      await registry.enableModel("chat", "a");
      await registry.enableModel("chat", "b");
      const before = getSettings().backends;
      await registry.enableModel("chat", "a");
      expect(registry.get("chat").enabledModels).toEqual(["a", "b"]);
      expect(getSettings().backends).toBe(before);
    });
  });

  describe("disableModel()", () => {
    it("removes only the requested model and preserves the remaining order", async () => {
      await registry.setEnabledModels("chat", ["a", "b", "c"]);
      await registry.disableModel("chat", "b");
      expect(registry.get("chat").enabledModels).toEqual(["a", "c"]);
    });
    it("leaves settings unchanged when the backend or model is absent", async () => {
      const before = getSettings().backends;
      await registry.disableModel("chat", "missing");
      expect(getSettings().backends).toBe(before);
      await registry.setEnabledModels("chat", ["a"]);
      const configured = getSettings().backends;
      await registry.disableModel("chat", "missing");
      expect(getSettings().backends).toBe(configured);
    });
  });

  describe("removeRefs()", () => {
    it("removes matching models from every backend and preserves unrelated models", async () => {
      await registry.setEnabledModels("chat", ["a", "b"]);
      await registry.setEnabledModels("claude", ["b", "c"]);
      await registry.removeRefs(["b"]);
      expect(registry.get("chat").enabledModels).toEqual(["a"]);
      expect(registry.get("claude").enabledModels).toEqual(["c"]);
    });
    it("does not replace settings for an empty list or references absent from all backends", async () => {
      await registry.setEnabledModels("chat", ["a"]);
      const before = getSettings().backends;
      await registry.removeRefs([]);
      await registry.removeRefs(["missing"]);
      expect(getSettings().backends).toBe(before);
    });
  });

  describe("subscribe()", () => {
    it("notifies subscribers for changes, skips no-ops, and stops after unsubscribe", async () => {
      const listener = jest.fn();
      const unsubscribe = registry.subscribe(listener);
      await registry.enableModel("chat", "a");
      await registry.enableModel("chat", "a");
      await registry.setEnabledModels("chat", ["a"]);
      await registry.disableModel("chat", "missing");
      await registry.removeRefs(["missing"]);
      expect(listener).toHaveBeenCalledTimes(1);
      await registry.disableModel("chat", "a");
      expect(listener).toHaveBeenCalledTimes(2);
      unsubscribe();
      await registry.enableModel("chat", "b");
      expect(listener).toHaveBeenCalledTimes(2);
    });
    it("reports a throwing listener and continues notifying other listeners", async () => {
      registry.subscribe(() => {
        throw new Error("listener failed");
      });
      const listener = jest.fn();
      registry.subscribe(listener);
      await registry.enableModel("chat", "a");
      expect(listener).toHaveBeenCalledTimes(1);
      expect(logError).toHaveBeenCalledTimes(1);
    });
  });

  describe("resolveEnabled()", () => {
    it("keeps enabled order and marks missing models and missing providers as broken", async () => {
      const valid = await models.add({
        providerId: provider.providerId,
        info: { id: "model", displayName: "Model" },
      });
      const orphan = await models.add({
        providerId: "removed",
        info: { id: "orphan", displayName: "Orphan" },
      });
      await registry.setEnabledModels("chat", [valid, "missing", orphan]);
      expect(registry.resolveEnabled("chat")).toEqual([
        { configuredModelId: valid, state: "ok", configuredModel: models.get(valid), provider },
        { configuredModelId: "missing", state: "broken" },
        { configuredModelId: orphan, state: "broken" },
      ]);
    });
    it("returns the same frozen empty list when no models are enabled", () => {
      setSettings({ backends: { chat: { enabledModels: [] } } });
      const empty = registry.resolveEnabled("chat");
      expect(empty).toHaveLength(0);
      expect(empty).toBe(registry.resolveEnabled("chat"));
      expect(Object.isFrozen(empty)).toBe(true);
    });
  });
});
