import React from "react";
import { act } from "@testing-library/react";
import type { App } from "obsidian";
import type ScribePlugin from "@/main";
import { ScribeSettingTab } from "@/settings/SettingsPage";

const mockFocus = jest.fn();
const mockCleanup = jest.fn();
jest.mock("obsidian", () => ({
  ...jest.requireActual<object>("obsidian"),
  PluginSettingTab: class {
    containerEl = Object.assign(document.createElement("div"), {
      empty(this: HTMLElement) {
        this.replaceChildren();
      },
    });
    constructor(readonly app: App) {}
  },
}));
jest.mock("@/settings/v2/SettingsMainV2", () => ({
  __esModule: true,
  default: function SettingsLifecycleFixture() {
    const ReactRuntime = jest.requireActual<typeof React>("react");
    ReactRuntime.useEffect(() => {
      window.addEventListener("focus", mockFocus);
      return () => {
        window.removeEventListener("focus", mockFocus);
        mockCleanup();
      };
    }, []);
    return <div>Settings view</div>;
  },
}));

describe("SettingsPage", () => {
  describe("ScribeSettingTab", () => {
    describe("settings root lifecycle", () => {
      it("keeps one live focus listener across displays and removes it on hide and plugin unload", async () => {
        const cleanups: (() => void)[] = [];
        const plugin = {
          register: (cleanup: () => void) => cleanups.push(cleanup),
          isStarted: () => true,
        } as unknown as ScribePlugin;
        const tab = new ScribeSettingTab({} as App, plugin);
        document.body.append(tab.containerEl);
        await act(async () => tab.display());
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
        expect(mockFocus).toHaveBeenCalledTimes(1);

        await act(async () => tab.display());
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
        expect(mockFocus).toHaveBeenCalledTimes(2);
        expect(mockCleanup).toHaveBeenCalledTimes(1);

        await act(async () => {
          tab.hide();
        });
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
        expect(mockFocus).toHaveBeenCalledTimes(2);

        await act(async () => tab.display());
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
        expect(mockFocus).toHaveBeenCalledTimes(3);
        await act(async () => {
          cleanups.forEach((cleanup) => cleanup());
        });
        await act(async () => {
          window.dispatchEvent(new Event("focus"));
        });
        expect(mockFocus).toHaveBeenCalledTimes(3);
        expect(mockCleanup).toHaveBeenCalledTimes(3);
        tab.containerEl.remove();
      });
    });
  });
});
