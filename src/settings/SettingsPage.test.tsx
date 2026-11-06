import { STARTUP_LOADING_TEXT } from "@/components/StartupLoadingView";
import { ScribeSettingTab } from "@/settings/SettingsPage";
import type ScribePlugin from "@/main";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import type { App } from "obsidian";

jest.mock("obsidian", () => ({
  ...jest.requireActual<object>("obsidian"),
  PluginSettingTab: class PluginSettingTab {
    containerEl = Object.assign(document.createElement("div"), {
      empty(this: HTMLElement) {
        this.replaceChildren();
      },
    });
  },
}));
jest.mock("@/settings/v2/SettingsMainV2", () => ({ __esModule: true, default: () => null }));
jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: jest.fn(() => ({ render: jest.fn(), unmount: jest.fn() })),
}));

function createTab(started: boolean) {
  let isStarted = started;
  let finishStartup: () => void = () => undefined;
  const startup = new Promise<void>((resolve) => (finishStartup = resolve));
  const cleanups: (() => void)[] = [];
  const plugin = {
    register: (cleanup: () => void) => cleanups.push(cleanup),
    isStarted: () => isStarted,
    whenStarted: () => startup,
  } as unknown as ScribePlugin;
  const tab = new ScribeSettingTab({} as App, plugin);
  const start = async () => {
    isStarted = true;
    finishStartup();
    await startup;
  };
  return { tab, start, unload: () => cleanups.forEach((cleanup) => cleanup()) };
}

describe("SettingsPage", () => {
  describe("ScribeSettingTab", () => {
    beforeEach(() => {
      jest.mocked(createPluginRoot).mockClear();
      document.body.replaceChildren();
    });

    describe("getSettingDefinitions", () => {
      it("returns no declarative definitions so Obsidian keeps rendering the tab through display", () => {
        const tab = new ScribeSettingTab(
          {} as App,
          { register: jest.fn() } as unknown as ScribePlugin
        );

        expect(tab.getSettingDefinitions()).toEqual([]);
      });
    });

    describe("display", () => {
      it("renders the settings right away once Scribe has started", () => {
        const { tab } = createTab(true);

        tab.display();

        expect(createPluginRoot).toHaveBeenCalledTimes(1);
      });

      it("unmounts the previous settings tree before displaying a replacement", () => {
        const { tab } = createTab(true);
        tab.display();
        const first = jest.mocked(createPluginRoot).mock.results[0].value as ReturnType<
          typeof createPluginRoot
        >;
        tab.display();
        expect(first.unmount).toHaveBeenCalledTimes(1);
        expect(createPluginRoot).toHaveBeenCalledTimes(2);
      });
      it("shows that Scribe is starting instead of settings that have not loaded yet", () => {
        const { tab } = createTab(false);

        tab.display();

        expect(tab.containerEl.textContent).toBe(STARTUP_LOADING_TEXT);
        expect(createPluginRoot).not.toHaveBeenCalled();
      });

      it("renders the settings once Scribe finishes starting while the tab is still open", async () => {
        const { tab, start } = createTab(false);
        document.body.append(tab.containerEl);

        tab.display();
        await start();

        expect(tab.containerEl.textContent).not.toContain(STARTUP_LOADING_TEXT);
        expect(createPluginRoot).toHaveBeenCalledTimes(1);
      });

      it("does not render settings into a tab closed before Scribe finished starting", async () => {
        const { tab, start } = createTab(false);

        tab.display();
        await start();

        expect(createPluginRoot).not.toHaveBeenCalled();
      });

      it("does not resume a hidden startup view even when Obsidian keeps its container connected", async () => {
        const { tab, start } = createTab(false);
        document.body.append(tab.containerEl);
        tab.display();
        tab.hide();
        await start();
        expect(createPluginRoot).not.toHaveBeenCalled();
      });
      it("does not resume or render an unloaded plugin's settings", async () => {
        const { tab, start, unload } = createTab(false);
        document.body.append(tab.containerEl);
        tab.display();
        unload();
        await start();
        tab.display();
        expect(createPluginRoot).not.toHaveBeenCalled();
      });
    });

    describe("hide()", () => {
      it("unmounts the settings root once when the page is hidden or the plugin unloads", () => {
        const { tab, unload } = createTab(true);
        tab.display();
        const root = jest.mocked(createPluginRoot).mock.results[0].value as ReturnType<
          typeof createPluginRoot
        >;
        tab.hide();
        tab.hide();
        unload();
        expect(root.unmount).toHaveBeenCalledTimes(1);
        expect(tab.containerEl.childElementCount).toBe(0);
      });
      it("unmounts an open settings tree directly during plugin unload", () => {
        const { tab, unload } = createTab(true);
        tab.display();
        const root = jest.mocked(createPluginRoot).mock.results[0].value as ReturnType<
          typeof createPluginRoot
        >;
        unload();
        expect(root.unmount).toHaveBeenCalledTimes(1);
      });
    });
  });
});
