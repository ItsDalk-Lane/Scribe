import { DEFAULT_SETTINGS } from "@/constants";
import { saveBuiltinPreferences } from "@/settings/builtinSkillPreferences";
import {
  getSettings,
  setSettings,
  settingsAtom,
  settingsStore,
  type ScribeSettings,
} from "@/settings/model";

const persist = jest.fn<Promise<void>, [ScribeSettings]>();
let inTransaction = false;
jest.mock("@/services/settingsPersistence", () => ({
  runPersistenceTransaction: async (task: () => Promise<void>) => {
    inTransaction = true;
    try {
      await task();
    } finally {
      inTransaction = false;
    }
  },
  persistSettingsWithinTransaction: (settings: ScribeSettings) => persist(settings),
}));

describe("builtinSkillPreferences", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    settingsStore.set(settingsAtom, {
      ...DEFAULT_SETTINGS,
      agentMode: { ...DEFAULT_SETTINGS.agentMode, skills: { folder: "scribe/skills" } },
    });
    persist.mockResolvedValue(undefined);
  });

  describe("saveBuiltinPreferences", () => {
    it("merges concurrent updater saves instead of losing the first opt-out", async () => {
      await Promise.all([
        saveBuiltinPreferences(
          (current) => ({ ...current, "obsidian-markdown": { disabled: true } }),
          jest.fn()
        ),
        saveBuiltinPreferences(
          (current) => ({ ...current, "json-canvas": { disabledAgents: ["opencode"] } }),
          jest.fn()
        ),
      ]);
      expect(getSettings().agentMode.skills.builtinPreferences).toEqual({
        "obsidian-markdown": { disabled: true },
        "json-canvas": { disabledAgents: ["opencode"] },
      });
      expect(persist.mock.calls[1][0].agentMode.skills.builtinPreferences).toEqual(
        getSettings().agentMode.skills.builtinPreferences
      );
    });
    it("preserves untouched preference objects when saving another skill", async () => {
      await saveBuiltinPreferences(
        () => ({ "obsidian-markdown": { disabledAgents: ["codex"] } }),
        jest.fn()
      );
      const previous = getSettings().agentMode.skills.builtinPreferences!["obsidian-markdown"];
      await saveBuiltinPreferences(
        (current) => ({ ...current, "json-canvas": { disabled: true } }),
        jest.fn()
      );
      expect(getSettings().agentMode.skills.builtinPreferences!["obsidian-markdown"]).toBe(
        previous
      );
      expect(getSettings().agentMode.skills.builtinPreferences!["json-canvas"]).toEqual({
        disabled: true,
      });
    });
    it("activates opt-outs only after the durable transaction exits", async () => {
      const preferences = { "obsidian-markdown": { disabled: true } };
      persist.mockImplementation(async (settings) => {
        expect(inTransaction).toBe(true);
        expect(settings.agentMode.skills.builtinPreferences).toEqual(preferences);
        expect(getSettings().agentMode.skills.builtinPreferences).toBeUndefined();
      });
      const onActivation = jest.fn(() => expect(inTransaction).toBe(false));
      const unsubscribe = settingsStore.sub(settingsAtom, onActivation);
      try {
        await saveBuiltinPreferences(() => preferences, jest.fn());
        expect(getSettings().agentMode.skills.builtinPreferences).toEqual(preferences);
        expect(onActivation).toHaveBeenCalledTimes(1);
      } finally {
        unsubscribe();
      }
    });

    it("preserves settings edits made during the write", async () => {
      persist.mockImplementation(async () => {
        setSettings((current) => ({
          debug: true,
          agentMode: {
            ...current.agentMode,
            skills: { ...current.agentMode.skills, suppressMigrationConfirm: true },
          },
        }));
      });
      await saveBuiltinPreferences(
        () => ({ "obsidian-markdown": { disabledAgents: ["opencode"] } }),
        jest.fn()
      );
      expect(getSettings().debug).toBe(true);
      expect(getSettings().agentMode.skills.suppressMigrationConfirm).toBe(true);
      expect(getSettings().agentMode.skills.builtinPreferences).toEqual({
        "obsidian-markdown": { disabledAgents: ["opencode"] },
      });
    });

    it("persists, activates, and returns empty preferences when restoring defaults", async () => {
      await saveBuiltinPreferences(
        () => ({ "obsidian-markdown": { disabled: true, disabledAgents: ["opencode"] } }),
        jest.fn()
      );
      const preferences = await saveBuiltinPreferences(
        () => ({ "obsidian-markdown": { disabled: false, disabledAgents: [] } }),
        jest.fn()
      );
      expect(preferences).toEqual({});
      expect(getSettings().agentMode.skills.builtinPreferences).toBe(preferences);
      expect(persist.mock.calls[1][0].agentMode.skills.builtinPreferences).toBe(preferences);
    });

    it("continues queued saves after a failed write without committing the failed opt-out", async () => {
      persist.mockRejectedValueOnce(new Error("disk full"));
      const results = await Promise.allSettled([
        saveBuiltinPreferences(
          (current) => ({ ...current, "obsidian-markdown": { disabled: true } }),
          jest.fn()
        ),
        saveBuiltinPreferences(
          (current) => ({ ...current, "json-canvas": { disabledAgents: ["codex"] } }),
          jest.fn()
        ),
      ]);
      expect(results.map((result) => result.status)).toEqual(["rejected", "fulfilled"]);
      expect(getSettings().agentMode.skills.builtinPreferences).toEqual({
        "json-canvas": { disabledAgents: ["codex"] },
      });
      expect(persist.mock.calls[1][0].agentMode.skills.builtinPreferences).toEqual(
        getSettings().agentMode.skills.builtinPreferences
      );
    });

    it("leaves preferences unchanged when persistence fails", async () => {
      persist.mockRejectedValue(new Error("disk full"));
      await expect(
        saveBuiltinPreferences(() => ({ "obsidian-markdown": { disabled: true } }), jest.fn())
      ).rejects.toThrow("disk full");
      expect(getSettings().agentMode.skills.builtinPreferences).toBeUndefined();
    });
  });
});
