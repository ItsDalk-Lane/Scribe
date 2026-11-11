import { DEFAULT_SETTINGS } from "@/constants";
import {
  loadStoredSettings,
  persistSettings,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import {
  getSettings,
  resetSettings,
  settingsAtom,
  settingsStore,
  type ScribeSettings,
} from "@/settings/model";

describe("model", () => {
  describe("resetSettings()", () => {
    beforeEach(() => resetPersistenceState());
    it("preserves encrypted key references and the storage identity through reset and reload", async () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        storageId: "vault-stable-id",
        autoAttachActiveNote: false,
        providers: {
          p: {
            providerId: "p",
            providerType: "openai-compatible",
            displayName: "Service",
            origin: { kind: "byok" },
            addedAt: 1,
            apiKeyRef: "encrypted-reference",
          },
        },
        configuredModels: [
          {
            configuredModelId: "m",
            providerId: "p",
            configuredAt: 1,
            info: { id: "model", displayName: "Model" },
          },
        ],
      });
      resetSettings();
      let disk: ScribeSettings | undefined;
      await persistSettings(getSettings(), async (data) => {
        disk = data;
      });
      const loaded = await loadStoredSettings(disk, async () => {});
      expect(loaded.storageId).toBe("vault-stable-id");
      expect(loaded.providers.p.apiKeyRef).toBe("encrypted-reference");
      expect(loaded.configuredModels[0].configuredModelId).toBe("m");
      expect(loaded.autoAttachActiveNote).toBe(DEFAULT_SETTINGS.autoAttachActiveNote);
    });
  });
});
