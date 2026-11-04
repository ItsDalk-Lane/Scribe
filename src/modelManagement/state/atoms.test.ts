import { resetSettings, setSettings, settingsStore } from "@/settings/model";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

import {
  chatBackendPickerAtom,
  byokProvidersAtom,
  visibleByokProvidersAtom,
  configuredModelsAtom,
  backendsAtom,
} from "./atoms";

function provider(id: string, origin: Provider["origin"], baseUrl?: string): Provider {
  return {
    providerId: id,
    providerType: "openai-compatible",
    displayName: id,
    baseUrl,
    origin,
    addedAt: 0,
  };
}

function model(configuredModelId: string, providerId: string): ConfiguredModel {
  return {
    configuredModelId,
    providerId,
    info: { id: configuredModelId, displayName: configuredModelId },
    configuredAt: 0,
  };
}

const CLOUD = provider("cloud", { kind: "byok" }, "https://api.anthropic.com");
const LOCAL = provider("local", { kind: "byok" }, "http://localhost:11434/v1");

beforeEach(() => {
  resetSettings();
  setSettings({
    providers: { cloud: CLOUD, local: LOCAL },
    configuredModels: [model("cloud-m", "cloud"), model("local-m", "local")],
    backends: { chat: { enabledModels: ["cloud-m", "local-m", "missing"] } },
  });
});

function pickerIds(): string[] {
  return settingsStore.get(chatBackendPickerAtom).map((e) => e.configuredModelId);
}

describe("atoms", () => {
  describe("chatBackendPickerAtom", () => {
    it("lists enabled models in order and marks missing models as broken", () => {
      expect(pickerIds()).toEqual(["cloud-m", "local-m", "missing"]);
      expect(settingsStore.get(chatBackendPickerAtom).map((entry) => entry.state)).toEqual([
        "ok",
        "ok",
        "broken",
      ]);
    });

    it("omits previously enabled non-chat models while retaining saved rows and genuinely broken entries", () => {
      const saved = [
        model("chat", "cloud"),
        {
          ...model("image", "cloud"),
          info: { id: "image", displayName: "Image", modalities: { output: ["image"] } },
        },
        {
          ...model("speech", "cloud"),
          info: { id: "speech", displayName: "Speech", family: "text-to-speech" },
        },
        model("rerank-v3", "cloud"),
        model("gpt-realtime", "cloud"),
        {
          ...model("embed", "cloud"),
          info: { id: "embed", displayName: "Embed", isEmbedding: true },
        },
        model("manual-unknown", "local"),
        model("orphan-chat", "missing-provider"),
        {
          ...model("orphan-image", "missing-provider"),
          info: { id: "orphan-image", displayName: "Image", modalities: { output: ["image"] } },
        },
      ];
      const enabledModels = [...saved.map((record) => record.configuredModelId), "missing-record"];
      setSettings({ configuredModels: saved, backends: { chat: { enabledModels } } });
      expect(
        settingsStore
          .get(chatBackendPickerAtom)
          .map((entry) => [entry.configuredModelId, entry.state])
      ).toEqual([
        ["chat", "ok"],
        ["manual-unknown", "ok"],
        ["orphan-chat", "broken"],
        ["missing-record", "broken"],
      ]);
      expect(settingsStore.get(configuredModelsAtom)).toEqual(saved);
      expect(settingsStore.get(backendsAtom).chat?.enabledModels).toEqual(enabledModels);
    });

    it("returns the canonical empty list when enabled records are all non-chat models", () => {
      setSettings({
        configuredModels: [model("rerank-v3", "cloud")],
        backends: { chat: { enabledModels: ["rerank-v3"] } },
      });
      const before = settingsStore.get(chatBackendPickerAtom);
      setSettings({ providers: { cloud: { ...CLOUD, displayName: "Renamed" } } });
      const after = settingsStore.get(chatBackendPickerAtom);
      expect(after).toEqual([]);
      expect(after).toBe(before);
    });

    it("returns the same empty list on every read when no models are enabled", () => {
      setSettings({ backends: { chat: { enabledModels: [] } } });
      const a = settingsStore.get(chatBackendPickerAtom);
      const b = settingsStore.get(chatBackendPickerAtom);
      expect(a).toHaveLength(0);
      expect(a).toBe(b);
    });
  });

  describe("visibleByokProvidersAtom", () => {
    it("preserves the configured order of cloud and local BYOK providers", () => {
      expect(settingsStore.get(visibleByokProvidersAtom).map((p) => p.providerId)).toEqual([
        "cloud",
        "local",
      ]);
      expect(settingsStore.get(visibleByokProvidersAtom)).toBe(
        settingsStore.get(byokProvidersAtom)
      );
    });

    it("returns the same empty list on every read when no BYOK providers exist", () => {
      setSettings({ providers: {}, configuredModels: [] });
      const a = settingsStore.get(visibleByokProvidersAtom);
      const b = settingsStore.get(visibleByokProvidersAtom);
      expect(a).toHaveLength(0);
      expect(a).toBe(b);
    });
  });
});
