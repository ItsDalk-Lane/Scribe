import { getHomeShelfTab, setHomeShelfTab } from "@/agentMode/ui/homeShelfPrefs";
import { DEFAULT_SETTINGS } from "@/constants";
import { settingsAtom, settingsStore, getSettings } from "@/settings/model";
import type { App } from "obsidian";

const app = { loadLocalStorage: jest.fn(), saveLocalStorage: jest.fn() } as unknown as App;

describe("homeShelfPrefs", () => {
  beforeEach(() => {
    settingsStore.set(settingsAtom, DEFAULT_SETTINGS);
    jest.clearAllMocks();
  });
  describe("getHomeShelfTab()", () => {
    it("reads only the lightweight preference in plugin settings", () => {
      settingsStore.set(settingsAtom, {
        ...DEFAULT_SETTINGS,
        homeShelfTabs: { shelf: "projects" },
      });
      expect(getHomeShelfTab(app, "shelf")).toBe("projects");
      expect(getHomeShelfTab(app, "other")).toBeNull();
      expect(app.loadLocalStorage).not.toHaveBeenCalled();
    });
  });
  describe("setHomeShelfTab()", () => {
    it("updates settings without writing Obsidian local storage", () => {
      setHomeShelfTab(app, "shelf", "chats");
      expect(getSettings().homeShelfTabs).toEqual({ shelf: "chats" });
      expect(app.saveLocalStorage).not.toHaveBeenCalled();
    });
  });
});
