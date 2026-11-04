import {
  consumeRequestedScribeSettingsTab,
  openScribeSettings,
  openCorePluginSettings,
} from "@/settings/openSettings";
import { SCRIBE_SETTINGS_TAB_IDS } from "@/settings/settingsTabs";
import type { App } from "obsidian";

describe("openSettings", () => {
  afterEach(() => {
    consumeRequestedScribeSettingsTab();
    jest.restoreAllMocks();
  });

  describe("openScribeSettings", () => {
    it("uses the first Scribe display without rendering the tab twice", () => {
      const consumedTabs: string[] = [];
      const openTabById = jest.fn(() => consumedTabs.push(consumeRequestedScribeSettingsTab()));
      const open = jest.fn(() => consumedTabs.push(consumeRequestedScribeSettingsTab()));
      let deferredHandoff: FrameRequestCallback | undefined;
      const ownerWindow = {
        requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
          deferredHandoff = callback;
          return 1;
        }),
      } as unknown as Window;
      const app = { setting: { open, openTabById } } as unknown as App;

      openScribeSettings(app, ownerWindow, "agents");

      expect(open).toHaveBeenCalledTimes(1);
      expect(consumedTabs).toEqual(["agents"]);

      deferredHandoff?.(0);

      expect(openTabById).not.toHaveBeenCalled();
    });

    it("hands off after another settings tab opens and schedules from the initiating window", () => {
      const consumedTabs: string[] = [];
      const openTabById = jest.fn(() => consumedTabs.push(consumeRequestedScribeSettingsTab()));
      const open = jest.fn();
      let deferredHandoff: FrameRequestCallback | undefined;
      const ownerWindow = {
        requestAnimationFrame: jest.fn((callback: FrameRequestCallback) => {
          deferredHandoff = callback;
          return 1;
        }),
      } as unknown as Window;
      const app = { setting: { open, openTabById } } as unknown as App;

      openScribeSettings(app, ownerWindow, "quickActions");

      expect(open).toHaveBeenCalledTimes(1);
      expect(openTabById).not.toHaveBeenCalled();

      deferredHandoff?.(0);

      expect(openTabById).toHaveBeenCalledWith("scribe");
      expect(consumedTabs).toEqual(["quickActions"]);
    });
  });

  describe("openCorePluginSettings", () => {
    function settingsWithCorePluginsTab() {
      const search = document.createElement("input");
      search.type = "search";
      const onInput = jest.fn();
      search.addEventListener("input", onInput);
      const containerEl = document.createElement("div");
      containerEl.appendChild(search);
      const setting = { open: jest.fn(), openTabById: jest.fn(), activeTab: { containerEl } };
      return { app: { setting } as unknown as App, setting, search, onInput };
    }

    it("opens Settings at Core plugins and filters the plugin list to the named plugin", () => {
      const { app, setting, search, onInput } = settingsWithCorePluginsTab();

      openCorePluginSettings(app, "Bookmarks");

      expect(setting.open).toHaveBeenCalled();
      expect(setting.openTabById).toHaveBeenCalledWith("plugins");
      expect(search.value).toBe("Bookmarks");
      expect(onInput).toHaveBeenCalledTimes(1);
    });

    it("still opens Core plugins when the tab has no search box to fill", () => {
      const openTabById = jest.fn();
      const app = {
        setting: {
          open: jest.fn(),
          openTabById,
          activeTab: { containerEl: document.createElement("div") },
        },
      } as unknown as App;

      expect(() => openCorePluginSettings(app, "Bookmarks")).not.toThrow();
      expect(openTabById).toHaveBeenCalledWith("plugins");
    });

    it("does nothing instead of throwing when Obsidian's settings API is missing", () => {
      expect(() => openCorePluginSettings({} as App, "Bookmarks")).not.toThrow();
    });
  });

  describe("consumeRequestedScribeSettingsTab", () => {
    it.each(SCRIBE_SETTINGS_TAB_IDS)(
      "consumes a requested %s tab once and defaults later ordinary opens to General",
      (tab) => {
        const ownerWindow = { requestAnimationFrame: jest.fn() } as unknown as Window;
        const app = {
          setting: { open: jest.fn(), openTabById: jest.fn() },
        } as unknown as App;

        openScribeSettings(app, ownerWindow, tab);

        expect(consumeRequestedScribeSettingsTab()).toBe(tab);
        expect(consumeRequestedScribeSettingsTab()).toBe("basic");
      }
    );
  });
});
