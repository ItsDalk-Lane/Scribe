jest.mock("obsidian", () => {
  const actual = jest.requireActual<Record<string, unknown>>("obsidian");
  const { StateField } =
    jest.requireActual<typeof import("@codemirror/state")>("@codemirror/state");
  return {
    ...actual,
    getLanguage: jest.fn(() => "en"),
    editorInfoField: StateField.define<unknown>({ create: () => null, update: (value) => value }),
    Plugin: class Plugin {},
    PluginSettingTab: class PluginSettingTab {},
    MarkdownView: class MarkdownView {},
    addIcon: jest.fn(),
  };
});
jest.mock("@/LLMProviders/chatModelManager", () => ({
  __esModule: true,
  default: { getInstance: jest.fn() },
}));

jest.mock("@/logger", () => ({
  logError: jest.fn(),
  logFatalError: jest.fn(),
  logInfo: jest.fn(),
  logWarn: jest.fn(),
}));
jest.mock("@/services/settingsPersistence", () => ({
  flushPersistence: jest.fn().mockResolvedValue(undefined),
  persistSettings: jest.fn(),
  loadSettingsWithKeychain: jest.fn(),
  resetPersistenceState: jest.fn(),
}));
jest.mock("@/logFileManager", () => ({
  logFileManager: { flush: jest.fn().mockResolvedValue(undefined), setApp: jest.fn() },
}));
jest.mock("@/settings/migrations", () => ({ runSettingsMigrations: jest.fn() }));
jest.mock("@/commands/migrator", () => ({
  ...jest.requireActual<typeof import("@/commands/migrator")>("@/commands/migrator"),
  migrateCommands: jest.fn(async () => null),
}));
jest.mock("@/system-prompts/migration", () => ({
  ...jest.requireActual<typeof import("@/system-prompts/migration")>("@/system-prompts/migration"),
  migrateSystemPromptsFromSettings: jest.fn(async () => null),
}));
jest.mock("@/state/vaultDataAtoms", () => ({
  VaultDataManager: { getInstance: jest.fn(() => ({ cleanup: jest.fn(), initialize: jest.fn() })) },
}));
jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: jest.fn(() => ({ stopActiveWebTabTracking: jest.fn() })),
  startActiveWebTabTracking: jest.fn(),
}));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: jest.fn(() => false) }));
jest.mock("@/utils/rendererEventsShim", () => ({ installRendererEventsShim: jest.fn() }));
jest.mock("@/utils/notificationSound", () => ({ disposeNotificationSound: jest.fn() }));
jest.mock("@/utils/chatDeepLink", () => ({
  ...jest.requireActual<typeof import("@/utils/chatDeepLink")>("@/utils/chatDeepLink"),
  findChatFileByDeepLinkId: jest.fn(),
}));
const mockSkillManagerDispose = jest.fn();
const mockSkillManagerHasInstance = jest.fn(() => true);
jest.mock("@/agentMode", () => ({
  SkillManager: {
    hasInstance: () => mockSkillManagerHasInstance(),
    getInstance: () => ({ dispose: mockSkillManagerDispose }),
  },
  setFrameSinkVaultBasePath: jest.fn(),
  closeRestoredTurnDiffs: jest.fn(),
  registerTurnDiffCommands: jest.fn(),
  acpFrameSink: { narrowLegacyLogs: jest.fn(async () => undefined) },
  createAgentSessionManager: jest.fn(() => ({})),
  ScribeAgentView: class {},
  PlanPreviewView: class {},
  closeAgentDetailModals: jest.fn(),
}));

import ScribePlugin from "@/main";
import { QuickAskController } from "@/editor";
import { getSelectedTextContexts } from "@/selection/selectionStore";
import { DEFAULT_SETTINGS } from "@/constants";
import { CHAT_AGENT_VIEWTYPE, COMMAND_IDS, PLAN_PREVIEW_VIEW_TYPE } from "@/constants";
import { StartupLoadingView } from "@/components/StartupLoadingView";
import { settingsAtom, settingsStore } from "@/settings/model";
import type { WebSelectionTrackingOptions } from "@/services/webViewerService/webViewerServiceSelection";

const mockStartSelectionTracker = jest.fn();
const mockSelectionTrackerOptions = jest.fn();
jest.mock("@/services/webViewerService/webViewerServiceSelection", () => ({
  WebSelectionTracker: class {
    constructor(options: WebSelectionTrackingOptions) {
      mockSelectionTrackerOptions(options);
    }
    start = mockStartSelectionTracker;
  },
}));
import { logError, logFatalError, logInfo, logWarn } from "@/logger";
import { migrateCommands } from "@/commands/migrator";
import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { logFileManager } from "@/logFileManager";
import { flushPersistence, resetPersistenceState } from "@/services/settingsPersistence";
import { startActiveWebTabTracking } from "@/services/webViewerService/webViewerServiceSingleton";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { disposeNotificationSound } from "@/utils/notificationSound";
import { findChatFileByDeepLinkId } from "@/utils/chatDeepLink";
import { Notice, TFile, type WorkspaceLeaf } from "obsidian";
import { getLanguage } from "obsidian";
import { setInterfaceLocale, t } from "@/lib/i18n";

function createPluginUnderTest(calls: string[]) {
  const plugin = Object.create(ScribePlugin.prototype) as ScribePlugin;

  Object.assign(plugin, {
    app: { workspace: { getLeavesOfType: jest.fn(() => []) } },
    chatSelectionHighlightController: { cleanup: jest.fn(() => calls.push("highlight")) },
    agentSessionManager: {
      shutdown: jest.fn(async () => {
        calls.push("sessions");
      }),
    },
    customCommandRegister: { cleanup: jest.fn(() => calls.push("customCommands")) },
    projectRegister: { cleanup: jest.fn(() => calls.push("projects")) },
    settingsUnsubscriber: jest.fn(() => calls.push("settings")),
    modelManagement: { dispose: jest.fn(() => calls.push("modelManagement")) },
    cleanupWebSelectionWatcher: jest.fn(),
  });

  return plugin;
}

async function flushTeardown(): Promise<void> {
  await (window as unknown as Record<symbol, Promise<void>>)[
    Symbol.for("obsidian-scribe:pending-teardown")
  ];
}

describe("main", () => {
  describe("ScribePlugin", () => {
    describe("loadChatById()", () => {
      it("opens a legacy note with no native session as a readable note https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const plugin = createPluginUnderTest([]);
        const file = new (TFile as unknown as new (path: string) => TFile)("scribe/old-chat.md");
        const openFile = jest.fn(async () => undefined);
        Object.assign(plugin, {
          app: {
            vault: {
              getAbstractFileByPath: () => file,
              adapter: {
                read: async () =>
                  "---\nmode: agent\nbackendId: native\n---\n\n**user**: Old message",
              },
            },
            metadataCache: { getFileCache: () => ({ frontmatter: { mode: "agent" } }) },
            workspace: { getLeaf: () => ({ openFile }) },
          },
        });
        await plugin.loadChatById(file.path);
        expect(openFile).toHaveBeenCalledWith(file);
      });
    });

    describe("copyChatLink", () => {
      beforeEach(() => jest.clearAllMocks());

      it("copies a native chat link without saving a note https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const plugin = createPluginUnderTest([]);
        const id = "scribe-agent-session://native/s1";
        const create = jest.fn();
        Object.assign(plugin, {
          app: { vault: { getName: () => "Notes", getAbstractFileByPath: () => null, create } },
          agentSessionManager: { getChatHistoryItems: async () => [{ id, title: "Native chat" }] },
        });
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
        await plugin.copyChatLink(async () => id);
        expect(writeText).toHaveBeenCalledWith(
          `[Native chat](obsidian://scribe-chat?vault=Notes&id=${encodeURIComponent(id)})`
        );
        expect(create).not.toHaveBeenCalled();
      });

      it("copies a markdown link titled by the chat topic that targets the note's epoch", async () => {
        const plugin = createPluginUnderTest([]);
        const frontmatter = { epoch: 1735732800000, topic: "Trip planning" };
        Object.assign(plugin, {
          app: {
            vault: {
              getName: () => "My Vault",
              getAbstractFileByPath: (path: string) =>
                new (TFile as unknown as new (path: string) => TFile)(path),
            },
            metadataCache: {
              getCache: () => ({ frontmatter }),
              getFileCache: () => ({ frontmatter }),
            },
          },
        });
        const writeText = jest.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });

        await plugin.copyChatLink(async () => "Scribe/conversations/renamed.md");

        expect(writeText).toHaveBeenCalledWith(
          "[Trip planning](obsidian://scribe-chat?vault=My%20Vault&id=epoch%3A1735732800000)"
        );
      });

      it.each([
        ["returns no note", async () => ""],
        [
          "throws",
          async () => {
            throw new Error("disk full");
          },
        ],
      ])(
        "reports a failure and copies nothing when saving the chat %s",
        async (_, resolveNotePath) => {
          const plugin = createPluginUnderTest([]);
          const writeText = jest.fn().mockResolvedValue(undefined);
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText },
          });

          await plugin.copyChatLink(resolveNotePath);

          expect(writeText).not.toHaveBeenCalled();
          expect(Notice).toHaveBeenCalledWith("Could not copy chat link.");
        }
      );
    });

    describe("openChatDeepLink", () => {
      beforeEach(() => jest.clearAllMocks());

      it("opens a saved ordinary chat as a note when its epoch link is followed", async () => {
        const plugin = createPluginUnderTest([]);
        const file = Object.assign(new TFile(), { path: "Scribe/conversations/renamed.md" });
        const openFile = jest.fn().mockResolvedValue(undefined);
        const getLeaf = jest.fn(() => ({ openFile }));
        Object.assign(plugin, {
          app: {
            vault: { getAbstractFileByPath: () => file },
            metadataCache: { getFileCache: () => ({ frontmatter: { mode: "chat" } }) },
            workspace: { getLeaf },
          },
        });
        jest.mocked(findChatFileByDeepLinkId).mockResolvedValue(file);

        await plugin.openChatDeepLink({ action: "scribe-chat", id: "epoch:1735732800000" });

        expect(findChatFileByDeepLinkId).toHaveBeenCalledWith(plugin.app, "epoch:1735732800000");
        expect(getLeaf).toHaveBeenCalledWith(true);
        expect(openFile).toHaveBeenCalledWith(file);
      });

      it("resumes a native agent session id without looking for a note", async () => {
        const plugin = createPluginUnderTest([]);
        const load = jest.spyOn(plugin, "loadChatById").mockResolvedValue(undefined);

        await plugin.openChatDeepLink({ id: "scribe-agent-session://codex/abc" });

        expect(findChatFileByDeepLinkId).not.toHaveBeenCalled();
        expect(load).toHaveBeenCalledWith("scribe-agent-session://codex/abc");
      });

      it("does not load anything when the id resolves to no note", async () => {
        const plugin = createPluginUnderTest([]);
        jest.mocked(findChatFileByDeepLinkId).mockResolvedValue(null);
        const load = jest.spyOn(plugin, "loadChatById").mockResolvedValue(undefined);

        await plugin.openChatDeepLink({ id: "Scribe/conversations/private.md" });

        expect(load).not.toHaveBeenCalled();
      });
    });

    describe("initWebSelectionWatcher", () => {
      it("enables desktop web selection tracking even when the retired preference was saved as false", () => {
        settingsStore.set(settingsAtom, {
          ...DEFAULT_SETTINGS,
          ...{ autoAddSelectionToContext: false, autoIncludeTextSelection: false },
        });
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
        const plugin = Object.create(ScribePlugin.prototype) as ScribePlugin;
        Object.assign(plugin, { app: {} });

        plugin.initWebSelectionWatcher();

        const options = mockSelectionTrackerOptions.mock.calls.at(
          -1
        )![0] as WebSelectionTrackingOptions;
        expect(options.isEnabled()).toBe(true);
        expect(mockStartSelectionTracker).toHaveBeenCalled();
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
      });

      it("attaches a web tab's selection and clears it once the tab deselects it", () => {
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
        const plugin = Object.create(ScribePlugin.prototype) as ScribePlugin;
        Object.assign(plugin, { app: {} });
        plugin.initWebSelectionWatcher();
        const options = mockSelectionTrackerOptions.mock.calls.at(
          -1
        )![0] as WebSelectionTrackingOptions;
        const quote = {
          id: "web-1",
          content: "Quote",
          sourceType: "web" as const,
          title: "Page",
          url: "https://example.com/",
        };

        options.onSelectionChange(quote);
        expect(getSelectedTextContexts()).toEqual([quote]);

        options.onSelectionClear({ url: quote.url, reason: "selection-cleared" });
        expect(getSelectedTextContexts()).toEqual([]);
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
      });
    });

    describe("addNoteToAgentChat", () => {
      class AgentView {
        eventTarget = { queueVisible: jest.fn() };
      }

      beforeEach(() => {
        jest.clearAllMocks();
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
      });

      it("reveals an existing Agent Chat and attaches the note to its active draft", async () => {
        const plugin = createPluginUnderTest([]);
        const leaf = { view: new AgentView() } as unknown as WorkspaceLeaf;
        const revealLeaf = jest.fn();
        const getRightLeaf = jest.fn();
        const addContextNoteToActiveChat = jest.fn().mockResolvedValue(undefined);
        Object.assign(plugin, {
          ScribeAgentView: AgentView,
          agentSessionManager: { addContextNoteToActiveChat },
          app: { workspace: { getLeavesOfType: jest.fn(() => [leaf]), revealLeaf, getRightLeaf } },
        });
        const note = Object.assign(new TFile(), { path: "Research.md" });

        await plugin.addNoteToAgentChat(note, true);

        expect(revealLeaf).toHaveBeenCalledWith(leaf);
        expect(getRightLeaf).not.toHaveBeenCalled();
        expect(addContextNoteToActiveChat).toHaveBeenCalledWith(note);
      });

      it("opens Agent Chat in the right sidebar before attaching the note when none is open", async () => {
        const plugin = createPluginUnderTest([]);
        const leaf = {
          view: new AgentView(),
          setViewState: jest.fn().mockResolvedValue(undefined),
        } as unknown as WorkspaceLeaf;
        const getRightLeaf = jest.fn(() => leaf);
        const getLeaf = jest.fn();
        const revealLeaf = jest.fn();
        const addContextNoteToActiveChat = jest.fn().mockResolvedValue(undefined);
        Object.assign(plugin, {
          ScribeAgentView: AgentView,
          agentSessionManager: { addContextNoteToActiveChat },
          app: {
            workspace: { getLeavesOfType: jest.fn(() => []), getRightLeaf, getLeaf, revealLeaf },
          },
        });
        const note = Object.assign(new TFile(), { path: "Journal.md" });

        await plugin.addNoteToAgentChat(note, true);

        expect(getRightLeaf).toHaveBeenCalledWith(false);
        expect(getLeaf).not.toHaveBeenCalled();
        expect(leaf.setViewState).toHaveBeenCalledWith({ type: CHAT_AGENT_VIEWTYPE, active: true });
        expect(revealLeaf).toHaveBeenCalledWith(leaf);
        expect(addContextNoteToActiveChat).toHaveBeenCalledWith(note);
      });

      it("reports a failed attachment without throwing", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("backend missing");
        Object.assign(plugin, {
          ScribeAgentView: AgentView,
          agentSessionManager: {
            addContextNoteToActiveChat: jest.fn().mockRejectedValue(failure),
          },
          app: {
            workspace: {
              getLeavesOfType: jest.fn(() => [{ view: new AgentView() }]),
              revealLeaf: jest.fn(),
            },
          },
        });

        await expect(
          plugin.addNoteToAgentChat(Object.assign(new TFile(), { path: "Research.md" }))
        ).resolves.toBeUndefined();

        expect(logError).toHaveBeenCalledWith("Failed to add a note to Agent Chat.", failure);
        expect(Notice).toHaveBeenCalledWith(
          "Could not add the note to Agent Chat. Check the Scribe log."
        );
      });

      it("reports a failure to open the Agent Chat pane without throwing", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("view state rejected");
        const addContextNoteToActiveChat = jest.fn();
        Object.assign(plugin, {
          ScribeAgentView: AgentView,
          agentSessionManager: { addContextNoteToActiveChat },
          app: {
            workspace: {
              getLeavesOfType: jest.fn(() => []),
              getRightLeaf: jest.fn(() => ({ setViewState: jest.fn().mockRejectedValue(failure) })),
            },
          },
        });

        await expect(
          plugin.addNoteToAgentChat(Object.assign(new TFile(), { path: "Research.md" }), true)
        ).resolves.toBeUndefined();

        expect(addContextNoteToActiveChat).not.toHaveBeenCalled();
        expect(logError).toHaveBeenCalledWith("Failed to add a note to Agent Chat.", failure);
        expect(Notice).toHaveBeenCalledWith(
          "Could not add the note to Agent Chat. Check the Scribe log."
        );
      });
    });

    describe("onload()", () => {
      const pendingTeardown = Symbol.for("obsidian-scribe:pending-teardown");

      beforeEach(() => {
        jest.clearAllMocks();
        delete (window as unknown as Record<symbol, unknown>)[pendingTeardown];
        (flushPersistence as jest.Mock).mockResolvedValue(undefined);
        (logFileManager.flush as jest.Mock).mockResolvedValue(undefined);
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
      });

      function createLoadingPlugin(loadSettings: () => Promise<void> = async () => undefined) {
        const plugin = createPluginUnderTest([]);
        const registrations = {
          register: jest.fn(),
          registerEvent: jest.fn(),
          registerDomEvent: jest.fn(),
          registerInterval: jest.fn(),
          registerView: jest.fn<void, [string, (leaf: WorkspaceLeaf) => unknown]>(),
          registerEditorExtension: jest.fn(),
          registerObsidianProtocolHandler: jest.fn(),
          addSettingTab: jest.fn(),
          addRibbonIcon: jest.fn(),
          addCommand: jest.fn<void, [{ id: string }]>(),
        };
        Object.assign(plugin, registrations, {
          app: {
            vault: { adapter: {}, configDir: "config", on: jest.fn(), getRoot: jest.fn() },
            workspace: {
              getLeavesOfType: jest.fn(() => []),
              on: jest.fn(),
              onLayoutReady: jest.fn(),
              getActiveViewOfType: jest.fn(() => null),
            },
            metadataCache: { on: jest.fn() },
            loadLocalStorage: jest.fn(),
          },
          manifest: { version: "4.0.13" },
          pluginLifecycleActive: true,
          initializedReady: false,
          startedViewCreators: new Map(),
          unload: jest.fn(),
          loadSettings: jest.fn(loadSettings),
          openChatDeepLink: jest.fn(async () => undefined),
        });
        const finishStartup = () =>
          (plugin as unknown as { initialization: Promise<void> }).initialization;
        const openScribeChatLink = (params: Record<string, string>) =>
          (
            registrations.registerObsidianProtocolHandler.mock.calls[0][1] as (
              params: Record<string, string>
            ) => void
          )(params);
        const openRegisteredView = (viewType: string) => {
          const call = registrations.registerView.mock.calls.find(([type]) => type === viewType);
          return call?.[1]({} as WorkspaceLeaf);
        };
        return { plugin, registrations, finishStartup, openScribeChatLink, openRegisteredView };
      }

      function deferred() {
        let resolve: () => void = () => undefined;
        const promise = new Promise<void>((done) => (resolve = done));
        return { promise, resolve };
      }

      it("selects Chinese before registering startup views and the settings tab", () => {
        const language = jest.mocked(getLanguage).mockReturnValue("zh");
        const settings = deferred();
        const { plugin, registrations } = createLoadingPlugin(() => settings.promise);
        const observed: string[] = [];
        registrations.addSettingTab.mockImplementation(() => observed.push(t("Chat link copied.")));
        try {
          plugin.onload();
          expect(observed).toEqual(["已复制聊天链接。"]);
        } finally {
          language.mockReturnValue("en");
          setInterfaceLocale("en");
        }
      });

      it("returns before settings load so Obsidian can open the vault without waiting for Scribe", () => {
        const settings = deferred();
        const { plugin, registrations } = createLoadingPlugin(() => settings.promise);

        expect(plugin.onload()).toBeUndefined();

        expect(registrations.registerObsidianProtocolHandler).toHaveBeenCalledWith(
          "scribe-chat",
          expect.any(Function)
        );
        expect(registrations.addCommand).not.toHaveBeenCalled();
        expect(plugin.isStarted()).toBe(false);
      });

      it("registers settings without registering any chat views on mobile", () => {
        const settings = deferred();
        const { plugin, registrations, openRegisteredView } = createLoadingPlugin(
          () => settings.promise
        );

        plugin.onload();

        expect(registrations.addSettingTab).toHaveBeenCalledTimes(1);
        expect(registrations.registerView).not.toHaveBeenCalled();
        expect(openRegisteredView("scribe-chat-view")).toBeUndefined();
      });

      it("registers Agent Chat and plan preview views up front on desktop", () => {
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
        const settings = deferred();
        const { plugin, registrations, openRegisteredView } = createLoadingPlugin(
          () => settings.promise
        );

        plugin.onload();

        expect(registrations.registerView.mock.calls.map(([type]) => type)).toEqual([
          CHAT_AGENT_VIEWTYPE,
          PLAN_PREVIEW_VIEW_TYPE,
        ]);
        expect(openRegisteredView(CHAT_AGENT_VIEWTYPE)).toBeInstanceOf(StartupLoadingView);
        expect(openRegisteredView("scribe-chat-view")).toBeUndefined();
      });

      it("finishes mobile startup with Quick Ask and Quick Command available and no chat view", async () => {
        const { plugin, registrations, finishStartup, openRegisteredView } = createLoadingPlugin();
        const createQuickAskExtension = jest.spyOn(QuickAskController.prototype, "createExtension");

        try {
          plugin.onload();

          await finishStartup();
          expect(plugin.isStarted()).toBe(true);
          expect(registrations.registerView).not.toHaveBeenCalled();
          expect(openRegisteredView("scribe-chat-view")).toBeUndefined();
          expect(plugin.quickAskController).toBeInstanceOf(QuickAskController);
          expect(createQuickAskExtension).toHaveBeenCalledTimes(1);
          expect(registrations.registerEditorExtension).toHaveBeenCalledWith(
            createQuickAskExtension.mock.results[0].value
          );
          expect(registrations.addCommand.mock.calls.map(([command]) => command.id)).toEqual(
            expect.arrayContaining([
              COMMAND_IDS.TRIGGER_QUICK_ASK,
              COMMAND_IDS.TRIGGER_QUICK_COMMAND,
            ])
          );
          expect(registrations.addRibbonIcon).not.toHaveBeenCalled();
          expect(registrations.registerObsidianProtocolHandler).toHaveBeenCalledTimes(1);
        } finally {
          createQuickAskExtension.mockRestore();
        }
      });

      it("keeps the active web tab when focus moves into Agent Chat on desktop", async () => {
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
        (startActiveWebTabTracking as jest.Mock).mockReturnValue({
          activeLeafRef: {},
          layoutRef: {},
        });
        const { plugin, finishStartup } = createLoadingPlugin();

        plugin.onload();

        await finishStartup();
        expect(startActiveWebTabTracking).toHaveBeenCalledWith(plugin.app, {
          preserveOnViewTypes: [CHAT_AGENT_VIEWTYPE],
        });
      });

      it.each([["settings load", "settings"]] as const)(
        "registers no commands and keeps restored tabs loading after Obsidian unloads it during %s",
        async (_step, pausedStep) => {
          (isDesktopRuntime as jest.Mock).mockReturnValue(true);
          const step = deferred();
          const { plugin, registrations, finishStartup, openRegisteredView } = createLoadingPlugin(
            pausedStep === "settings" ? () => step.promise : undefined
          );

          plugin.onload();
          plugin.onunload();
          step.resolve();

          await finishStartup();
          expect(registrations.register).not.toHaveBeenCalled();
          expect(registrations.addCommand).not.toHaveBeenCalled();
          expect(registrations.addRibbonIcon).not.toHaveBeenCalled();
          expect(plugin.isStarted()).toBe(false);
          expect(openRegisteredView(CHAT_AGENT_VIEWTYPE)).toBeInstanceOf(StartupLoadingView);
        }
      );

      it("loads settings only after the previous copy finishes shutting down", async () => {
        const calls: string[] = [];
        const previous = createPluginUnderTest(calls);
        (logFileManager.flush as jest.Mock).mockImplementation(async () => {
          calls.push("previousLogFlushed");
        });
        const next = createLoadingPlugin(async () => {
          calls.push("settingsLoaded");
        });

        previous.onunload();
        next.plugin.onload();

        await next.finishStartup();
        expect(calls.slice(-2)).toEqual(["previousLogFlushed", "settingsLoaded"]);
      });

      it("waits for every earlier copy's shutdown, not only the most recently unloaded one", async () => {
        jest.useFakeTimers();
        try {
          const slow = createPluginUnderTest([]);
          Object.assign(slow.agentSessionManager as object, {
            shutdown: jest.fn(() => new Promise<void>(() => undefined)),
          });
          const abandoned = createLoadingPlugin();
          const next = createLoadingPlugin();

          slow.onunload();
          abandoned.plugin.onload();
          abandoned.plugin.onunload();
          next.plugin.onload();
          await jest.advanceTimersByTimeAsync(9_999);

          expect(next.plugin.loadSettings).not.toHaveBeenCalled();
        } finally {
          jest.useRealTimers();
        }
      });

      it("skips settings load when Obsidian unloads it while it waits for the previous copy's shutdown", async () => {
        const previousTeardown = deferred();
        (window as unknown as Record<symbol, unknown>)[pendingTeardown] = previousTeardown.promise;
        const { plugin, finishStartup } = createLoadingPlugin();

        plugin.onload();
        plugin.onunload();
        previousTeardown.resolve();

        await finishStartup();
        expect(resetPersistenceState).not.toHaveBeenCalled();
        expect(plugin.loadSettings).not.toHaveBeenCalled();
      });

      it("keeps the next copy from loading settings until a copy unloaded mid-load settles", async () => {
        jest.useFakeTimers();
        try {
          const previousSettingsStarted = deferred();
          const previousSettings = deferred();
          const previous = createLoadingPlugin(() => {
            previousSettingsStarted.resolve();
            return previousSettings.promise;
          });
          const next = createLoadingPlugin();

          previous.plugin.onload();
          await previousSettingsStarted.promise;
          previous.plugin.onunload();
          next.plugin.onload();
          await jest.advanceTimersByTimeAsync(9_999);
          expect(next.plugin.loadSettings).not.toHaveBeenCalled();
          previousSettings.resolve();

          await next.finishStartup();
          expect(next.plugin.loadSettings).toHaveBeenCalledTimes(1);
        } finally {
          jest.useRealTimers();
        }
      });

      it("starts anyway after 10 seconds when the previous copy's shutdown hangs", async () => {
        jest.useFakeTimers();
        try {
          (window as unknown as Record<symbol, unknown>)[pendingTeardown] = new Promise(
            () => undefined
          );
          const { plugin, finishStartup } = createLoadingPlugin();

          plugin.onload();
          await jest.advanceTimersByTimeAsync(9_999);
          expect(plugin.loadSettings).not.toHaveBeenCalled();
          await jest.advanceTimersByTimeAsync(1);

          await finishStartup();
          expect(plugin.loadSettings).toHaveBeenCalledTimes(1);
          expect(logWarn).toHaveBeenCalledWith(
            "Scribe started before its previous copy finished shutting down.",
            expect.anything()
          );
        } finally {
          jest.useRealTimers();
        }
      });

      it("delays only the first start after a shutdown that never finishes", async () => {
        jest.useFakeTimers();
        try {
          (window as unknown as Record<symbol, unknown>)[pendingTeardown] = new Promise(
            () => undefined
          );
          const first = createLoadingPlugin();
          first.plugin.onload();
          await jest.advanceTimersByTimeAsync(10_000);
          await first.finishStartup();
          const second = createLoadingPlugin();

          first.plugin.onunload();
          second.plugin.onload();
          await jest.advanceTimersByTimeAsync(1);

          expect(second.plugin.loadSettings).toHaveBeenCalledTimes(1);
        } finally {
          jest.useRealTimers();
        }
      });

      it("opens a scribe-chat link that arrives during startup once the chat managers exist", async () => {
        const settings = deferred();
        const { plugin, finishStartup, openScribeChatLink } = createLoadingPlugin(
          () => settings.promise
        );

        plugin.onload();
        openScribeChatLink({ action: "scribe-chat", id: "epoch:1" });
        expect(plugin.openChatDeepLink).not.toHaveBeenCalled();
        settings.resolve();
        await finishStartup();

        expect(plugin.openChatDeepLink).toHaveBeenCalledWith({
          action: "scribe-chat",
          id: "epoch:1",
        });
      });

      it("ignores a scribe-chat link when Scribe is unloaded before startup finishes", async () => {
        const settings = deferred();
        const { plugin, finishStartup, openScribeChatLink } = createLoadingPlugin(
          () => settings.promise
        );

        plugin.onload();
        openScribeChatLink({ action: "scribe-chat", id: "epoch:1" });
        plugin.onunload();
        settings.resolve();
        await finishStartup();

        expect(plugin.openChatDeepLink).not.toHaveBeenCalled();
      });

      it("ignores a scribe-chat link when Scribe is unloaded before the link's queued open runs", async () => {
        const { plugin, finishStartup, openScribeChatLink } = createLoadingPlugin();
        plugin.onload();
        await finishStartup();

        openScribeChatLink({ action: "scribe-chat", id: "epoch:1" });
        plugin.onunload();
        await finishStartup();

        expect(plugin.openChatDeepLink).not.toHaveBeenCalled();
      });

      it.each([
        [
          "en",
          "Scribe failed to start. Back up your files, then disable Scribe until file-safety issues are fixed. Check the developer console for details.",
        ],
        [
          "zh",
          "Scribe 启动失败。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看开发者控制台了解详情。",
        ],
      ] as const)(
        "reports a startup failure in %s even with debug logging off, then unloads what startup registered",
        async (language, expected) => {
          jest.mocked(getLanguage).mockReturnValue(language);
          const failure = new Error("settings unreadable");
          const { plugin, finishStartup } = createLoadingPlugin(async () => {
            throw failure;
          });

          plugin.onload();

          await finishStartup();
          expect(logFatalError).toHaveBeenCalledWith("Scribe failed to start.", failure);
          expect(Notice).toHaveBeenCalledWith(expected);
          expect(plugin.unload).toHaveBeenCalledTimes(1);
        }
      );

      it.each([
        ["runs", "stays loaded", true],
        ["skips", "unloads", false],
      ] as const)(
        "%s the legacy command migration when Scribe %s while its files load",
        async (_outcome, _lifecycle, staysLoaded) => {
          const { plugin, finishStartup } = createLoadingPlugin();
          plugin.onload();
          await finishStartup();
          const layoutReady = (plugin.app.workspace.onLayoutReady as jest.Mock).mock
            .calls[0][0] as () => void;
          const filesLoaded = deferred();
          Object.assign(plugin, {
            customCommandRegister: { initialize: () => filesLoaded.promise, cleanup: jest.fn() },
            projectRegister: { initialize: async () => null, cleanup: jest.fn() },
          });

          layoutReady();
          if (!staysLoaded) plugin.onunload();
          filesLoaded.resolve();
          await filesLoaded.promise;

          expect(migrateCommands).toHaveBeenCalledTimes(staysLoaded ? 1 : 0);
          expect(migrateSystemPromptsFromSettings).toHaveBeenCalledTimes(1);
        }
      );

      it("skips legacy prompt and command migration when unloading before layout is ready", async () => {
        const { plugin, finishStartup } = createLoadingPlugin();
        plugin.onload();
        await finishStartup();
        const layoutReady = (plugin.app.workspace.onLayoutReady as jest.Mock).mock
          .calls[0][0] as () => void;

        plugin.onunload();
        layoutReady();

        expect(migrateCommands).not.toHaveBeenCalled();
        expect(migrateSystemPromptsFromSettings).not.toHaveBeenCalled();
      });
    });

    describe("onunload", () => {
      beforeEach(() => {
        jest.clearAllMocks();
        (disposeNotificationSound as jest.Mock).mockReset();
        (flushPersistence as jest.Mock).mockResolvedValue(undefined);
        (logFileManager.flush as jest.Mock).mockResolvedValue(undefined);
        (isDesktopRuntime as jest.Mock).mockReturnValue(false);
      });

      it("returns void so Obsidian's non-awaiting unload cannot drop the teardown promise", () => {
        const plugin = createPluginUnderTest([]);

        expect(plugin.onunload()).toBeUndefined();
      });

      it("revokes lifecycle-sensitive mutations before returning", () => {
        const plugin = createPluginUnderTest([]);
        Object.assign(plugin, { pluginLifecycleActive: true });
        expect(plugin.isPluginLifecycleActive()).toBe(true);

        plugin.onunload();

        expect(plugin.isPluginLifecycleActive()).toBe(false);
      });

      it("releases audio before asynchronous teardown can overlap a later plugin lifecycle", async () => {
        const calls: string[] = [];
        let releaseSessions: () => void = () => undefined;
        (disposeNotificationSound as jest.Mock).mockImplementation(() => calls.push("audio"));
        const plugin = createPluginUnderTest(calls);
        Object.assign(plugin, {
          agentSessionManager: {
            shutdown: () =>
              new Promise<void>((resolve) => {
                releaseSessions = resolve;
              }),
          },
        });

        plugin.onunload();

        expect(calls).toEqual(["audio", "highlight"]);
        releaseSessions();
        await flushTeardown();
      });

      it("tears down collaborators in order, draining settings writes only after it stops queuing them and the log last", async () => {
        const calls: string[] = [];
        const plugin = createPluginUnderTest(calls);
        (flushPersistence as jest.Mock).mockImplementation(async () => {
          calls.push("persistence");
        });
        (logFileManager.flush as jest.Mock).mockImplementation(async () => {
          calls.push("logFlush");
        });

        plugin.onunload();
        await flushTeardown();

        expect(calls).toEqual([
          "highlight",
          "sessions",
          "customCommands",
          "projects",
          "settings",
          "persistence",
          "modelManagement",
          "logFlush",
        ]);
        expect(logInfo).toHaveBeenCalledWith("Scribe plugin unloaded");
      });

      it("completes teardown when onload never assigned its collaborators", async () => {
        const calls: string[] = [];
        const plugin = createPluginUnderTest(calls);
        Object.assign(plugin, {
          chatSelectionHighlightController: undefined,
          agentSessionManager: undefined,
          customCommandRegister: undefined,
          projectRegister: undefined,
          settingsUnsubscriber: undefined,
          modelManagement: undefined,
        });

        plugin.onunload();
        await flushTeardown();

        expect(logError).not.toHaveBeenCalled();
        expect(logInfo).toHaveBeenCalledWith("Scribe plugin unloaded");
      });

      it("logs a teardown rejection instead of leaving an unhandled promise rejection", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("shutdown failed");
        (
          plugin.agentSessionManager as unknown as { shutdown: jest.Mock }
        ).shutdown.mockRejectedValue(failure);

        plugin.onunload();
        await flushTeardown();

        expect(logError).toHaveBeenCalledWith(
          "Scribe: plugin teardown failed during unload:",
          failure
        );
      });

      it("disposes the skill manager on a desktop runtime", async () => {
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
        const plugin = createPluginUnderTest([]);

        plugin.onunload();
        await flushTeardown();

        expect(mockSkillManagerDispose).toHaveBeenCalledTimes(1);
        expect(logInfo).toHaveBeenCalledWith("Scribe plugin unloaded");
      });

      it("skips the Node-backed skill cleanup on a mobile runtime, where the barrel import would crash", async () => {
        const plugin = createPluginUnderTest([]);

        plugin.onunload();
        await flushTeardown();

        expect(mockSkillManagerDispose).not.toHaveBeenCalled();
        expect(logInfo).toHaveBeenCalledWith("Scribe plugin unloaded");
      });
    });

    describe("newAgentChatWithDraft", () => {
      beforeEach(() => {
        jest.clearAllMocks();
        (isDesktopRuntime as jest.Mock).mockReturnValue(true);
      });

      it("opens a global Agent session with reviewable text left as a draft", async () => {
        const plugin = createPluginUnderTest([]);
        const createGlobalSessionWithDraft = jest.fn().mockResolvedValue(undefined);
        Object.assign(plugin.agentSessionManager as object, {
          createGlobalSessionWithDraft,
        });
        const activateAgentView = jest.spyOn(plugin, "activateAgentView").mockResolvedValue(null);

        await plugin.newAgentChatWithDraft("Repair this skill");

        expect(createGlobalSessionWithDraft).toHaveBeenCalledWith("Repair this skill");
        expect(activateAgentView).toHaveBeenCalledTimes(1);
        expect(createGlobalSessionWithDraft.mock.invocationCallOrder[0]).toBeLessThan(
          activateAgentView.mock.invocationCallOrder[0]
        );
      });

      it("surfaces session creation failures without sending or throwing", async () => {
        const plugin = createPluginUnderTest([]);
        const failure = new Error("create failed");
        Object.assign(plugin.agentSessionManager as object, {
          createGlobalSessionWithDraft: jest.fn().mockRejectedValue(failure),
        });
        const activateAgentView = jest.spyOn(plugin, "activateAgentView").mockResolvedValue(null);

        await expect(plugin.newAgentChatWithDraft("Repair this skill")).resolves.toBeUndefined();

        expect(logWarn).toHaveBeenCalledWith(
          "[ScribePlugin] Failed to create agent session with draft",
          failure
        );
        expect(activateAgentView).not.toHaveBeenCalled();
      });
    });
  });
});
