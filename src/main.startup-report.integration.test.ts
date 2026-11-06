import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  existsSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { parse, stringify } from "yaml";
import {
  FileSystemAdapter,
  TFile,
  TFolder,
  getLanguage,
  type App,
  type Modal,
  type PluginManifest,
} from "obsidian";
import { act } from "@testing-library/react";
import ScribePlugin from "@/main";
import { DEFAULT_SETTINGS } from "@/constants";
import { CURRENT_SETTINGS_VERSION } from "@/settings/migrations/version";
import { getCachedCustomCommands, updateCachedCommands } from "@/commands/state";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { updateCachedProjectRecords } from "@/projects/state";
import { flushPersistence } from "@/services/settingsPersistence";
import { getSettings } from "@/settings/model";

const mockOpenedModals: Modal[] = [];
const mockNotices: string[] = [];
let mockModalOpenFailure = false;

jest.mock("obsidian", () => {
  const actual = jest.requireActual<typeof import("obsidian")>("obsidian");
  const { StateField } =
    jest.requireActual<typeof import("@codemirror/state")>("@codemirror/state");
  interface TestPluginApp {
    readPluginData(): Promise<unknown>;
    writePluginData(data: unknown): Promise<void>;
  }
  class Plugin {
    app: TestPluginApp;
    manifest: unknown;
    registeredCommands: unknown[] = [];
    constructor(app: TestPluginApp, manifest: unknown) {
      this.app = app;
      this.manifest = manifest;
    }
    loadData() {
      return this.app.readPluginData();
    }
    saveData(data: unknown) {
      return this.app.writePluginData(data);
    }
    register() {}
    registerEvent() {}
    registerDomEvent() {}
    registerInterval() {}
    registerView() {}
    registerEditorExtension() {}
    registerObsidianProtocolHandler() {}
    addSettingTab() {}
    addRibbonIcon() {
      return document.createElement("div");
    }
    addCommand(command: unknown) {
      this.registeredCommands.push(command);
    }
    removeCommand() {}
    unload() {}
  }
  class OpenableModal extends actual.Modal {
    constructor(app: App) {
      super(app);
      delete (this as unknown as Record<string, unknown>).onOpen;
      delete (this as unknown as Record<string, unknown>).onClose;
      Object.assign(this, {
        setTitle: (title: string) => {
          this.titleEl.textContent = title;
          return this;
        },
      });
      this.open = () => {
        if (mockModalOpenFailure) throw new Error("Synthetic modal failure");
        mockOpenedModals.push(this);
        document.body.appendChild(this.containerEl);
        this.onOpen();
      };
      this.close = () => {
        this.onClose();
        this.containerEl.remove();
      };
    }
  }
  return {
    ...actual,
    getLanguage: jest.fn(() => "en"),
    editorInfoField: StateField.define<unknown>({ create: () => null, update: (value) => value }),
    Plugin,
    Modal: OpenableModal,
    Notice: class {
      constructor(message: string) {
        mockNotices.push(message);
      }
    },
    PluginSettingTab: class {},
    MarkdownView: class {},
    addIcon: jest.fn(),
  };
});
jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
  logFatalError: jest.fn(),
}));
jest.mock("@/logFileManager", () => ({
  logFileManager: { setApp: jest.fn(), flush: jest.fn(async () => {}) },
}));
jest.mock("@/settings/SettingsPage", () => ({ ScribeSettingTab: class {} }));
jest.mock("@/editor/registerNoteHeaderAction", () => ({ registerNoteHeaderAction: jest.fn() }));
jest.mock("@/utils/rendererEventsShim", () => ({ installRendererEventsShim: jest.fn() }));
jest.mock("@/utils/notificationSound", () => ({ disposeNotificationSound: jest.fn() }));
jest.mock("@/selection/selectionWatcher", () => ({
  watchSelections: jest.fn(),
  webSelectionReport: jest.fn(),
}));
jest.mock("@/state/vaultDataAtoms", () => ({
  VaultDataManager: { getInstance: () => ({ initialize: jest.fn(), cleanup: jest.fn() }) },
}));
jest.mock("@/editor", () => ({
  QuickAskController: class {
    createExtension() {
      return [];
    }
  },
  ChatSelectionHighlightController: class {
    initialize() {}
    cleanup() {}
  },
  SelectionHighlight: { hide: jest.fn() },
  hideChatSelectionHighlight: jest.fn(),
}));
jest.mock("@/services/webViewerService/webViewerServiceSingleton", () => ({
  getWebViewerService: () => ({
    stopActiveWebTabTracking() {},
    getActiveLeaf: () => null,
    getLastActiveLeaf: () => null,
  }),
  startActiveWebTabTracking: () => ({ activeLeafRef: {}, layoutRef: {} }),
}));
jest.mock("@/services/webViewerService/webViewerServiceSelection", () => ({
  WebSelectionTracker: class {
    start() {}
    stop() {}
  },
}));
jest.mock("@/agentMode", () => ({
  ScribeAgentView: class {},
  PlanPreviewView: class {},
  closeAgentDetailModals: jest.fn(),
  closeRestoredTurnDiffs: jest.fn(),
  registerTurnDiffCommands: jest.fn(),
  createAgentSessionManager: () => ({ shutdown: async () => {} }),
  SkillManager: { getInstance: () => ({}), hasInstance: () => false },
}));

if (!window.structuredClone) {
  window.structuredClone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
}

const commandRel = "scribe/scribe-custom-prompts/Keep.md";
const selectedRel = "scribe/system-prompts/Selected.md";
const commandText =
  "---\nscribe-command-enabled: true\nscribe-command-slash-enabled: false\nscribe-command-context-menu-enabled: true\nuser-property: retained\n---\n\n  Original command instructions.\n";
const selectedText = "---\ntitle: Selected\n---\n\nSelected current instructions.\n";
const legacyPrompt = "Previous user instructions.\r\n  Keep the original spacing.\n";
const legacyCommands = [
  {
    name: "Old command",
    prompt: "Old instructions",
    showInContextMenu: false,
    future: { note: "retain" },
  },
];
const manifest = {
  id: "scribe",
  dir: "fixture-configuration/plugins/scribe",
  name: "Scribe",
  version: "1.0.0",
  minAppVersion: "1.0.0",
  description: "",
  author: "Test",
} as PluginManifest;

function fakeVault(
  root: string,
  failCommandRead = false,
  failProjectRead = false,
  failBackup = false
) {
  const FixtureFile = TFile as unknown as new (path: string) => TFile;
  const FixtureAdapter = FileSystemAdapter as unknown as new (
    basePath: string
  ) => FileSystemAdapter;
  const full = (rel: string) => join(root, rel);
  const getFile = (rel: string): TFile | TFolder | null => {
    if (failProjectRead && rel === "scribe/projects")
      throw new Error("Synthetic project read failure");
    if (!existsSync(full(rel))) return null;
    if (statSync(full(rel)).isFile()) return new FixtureFile(rel);
    const folder = new TFolder();
    Object.assign(folder, { path: rel, name: rel.split("/").pop(), children: [] });
    return folder;
  };
  const adapter = Object.assign(new FixtureAdapter(root), {
    exists: async (rel: string) => existsSync(full(rel)),
    stat: async (rel: string) =>
      existsSync(full(rel))
        ? {
            type: statSync(full(rel)).isDirectory() ? "folder" : "file",
            mtime: statSync(full(rel)).mtimeMs,
            ctime: statSync(full(rel)).ctimeMs,
            size: statSync(full(rel)).size,
          }
        : null,
    mkdir: async (rel: string) => {
      mkdirSync(full(rel), { recursive: true });
    },
    remove: async (rel: string) => {
      rmSync(full(rel));
    },
    list: async (rel: string) => {
      if (failProjectRead && rel === ".scribe/projects")
        throw new Error("Synthetic project read failure");
      if (failCommandRead && rel === ".scribe/scribe-custom-prompts")
        throw new Error("Synthetic read failure");
      if (!existsSync(full(rel))) return { files: [], folders: [] };
      const entries = readdirSync(full(rel), { withFileTypes: true });
      return {
        files: entries.filter((entry) => entry.isFile()).map((entry) => rel + "/" + entry.name),
        folders: entries
          .filter((entry) => entry.isDirectory())
          .map((entry) => rel + "/" + entry.name),
      };
    },
    read: async (rel: string) => readFileSync(full(rel), "utf8"),
    write: async (rel: string, text: string) => {
      if (failBackup && rel.endsWith(".writing")) throw new Error("Synthetic backup failure");
      mkdirSync(dirname(full(rel)), { recursive: true });
      writeFileSync(full(rel), text);
    },
    rename: async (from: string, to: string) => renameSync(full(from), full(to)),
  });
  const vault = {
    adapter,
    configDir: "fixture-configuration",
    on: jest.fn(() => ({})),
    off: jest.fn(),
    offref: jest.fn(),
    getAbstractFileByPath: (path: string) => (path.startsWith(".scribe") ? null : getFile(path)),
    getRoot: () => getFile(""),
    getFiles: () => {
      const walk = (folder: string): TFile[] =>
        readdirSync(folder, { withFileTypes: true }).flatMap((entry) => {
          const target = join(folder, entry.name);
          return entry.isDirectory()
            ? walk(target)
            : [new FixtureFile(relative(root, target).replace(/\\/g, "/"))];
        });
      return walk(root);
    },
    read: async (file: TFile) => {
      if (failCommandRead && file.path === commandRel) throw new Error("Synthetic read failure");
      return readFileSync(full(file.path), "utf8");
    },
    createFolder: async (rel: string) => {
      mkdirSync(full(rel), { recursive: true });
    },
    create: async (rel: string, content: string) => {
      mkdirSync(dirname(full(rel)), { recursive: true });
      writeFileSync(full(rel), content, { flag: "wx" });
      return new FixtureFile(rel);
    },
    process: async (file: TFile, update: (text: string) => string) => {
      writeFileSync(full(file.path), update(readFileSync(full(file.path), "utf8")));
    },
    modify: async (file: TFile, text: string) => {
      writeFileSync(full(file.path), text);
    },
  };
  const metadataCache = {
    on: jest.fn(),
    off: jest.fn(),
    getFileCache(file: TFile) {
      const raw = readFileSync(full(file.path), "utf8");
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
      return header
        ? { frontmatter: parse(header[1]) as Record<string, unknown> }
        : { frontmatter: {} };
    },
  };
  const fileManager = {
    processFrontMatter: async (file: TFile, update: (meta: Record<string, unknown>) => void) => {
      const text = readFileSync(full(file.path), "utf8");
      const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
      const data = (header ? parse(header[1]) : {}) as Record<string, unknown>;
      update(data);
      const body = header ? text.slice(header[0].length) : text;
      writeFileSync(full(file.path), `---\n${stringify(data)}---\n\n${body}`);
    },
  };
  return { full, vault, metadataCache, fileManager };
}

function createFixture(options: {
  commands: boolean;
  selected: boolean;
  hasPrompt?: boolean;
  malformedPrompt?: boolean;
  failCommandRead?: boolean;
  failProjectRead?: boolean;
  legacyKey?: boolean;
  encryptedKey?: boolean;
  failBackup?: boolean;
  failSave?: boolean;
  failKeychain?: boolean;
}) {
  const root = mkdtempSync(join(tmpdir(), "scribe-startup-preservation-"));
  const disk = fakeVault(
    root,
    options.failCommandRead,
    options.failProjectRead,
    options.failBackup
  );
  mkdirSync(dirname(disk.full(commandRel)), { recursive: true });
  writeFileSync(disk.full(commandRel), commandText);
  if (options.selected) {
    mkdirSync(dirname(disk.full(selectedRel)), { recursive: true });
    writeFileSync(disk.full(selectedRel), selectedText);
  }
  const raw = {
    ...structuredClone(DEFAULT_SETTINGS),
    settingsVersion: CURRENT_SETTINGS_VERSION,
    _keychainVaultId: "1234abcd",
    scribeFolder: "scribe",
    scribeRootHistory: ["scribe"],
    openAIApiKey: options.encryptedKey
      ? "enc_desk_fixture"
      : options.legacyKey
        ? "fixture-only-key"
        : "",
    inlineEditCommands: options.commands ? structuredClone(legacyCommands) : [],
    userSystemPrompt: (options.malformedPrompt
      ? 42
      : options.hasPrompt
        ? legacyPrompt
        : "") as string,
    defaultSystemPromptTitle: options.selected ? "Selected" : "",
  };
  delete (raw.agentMode as unknown as Record<string, unknown>).byok;
  const dataPath = disk.full("fixture-configuration/plugins/scribe/data.json");
  mkdirSync(dirname(dataPath), { recursive: true });
  writeFileSync(dataPath, JSON.stringify(raw));
  let layoutReady: (() => void) | undefined;
  const secrets = new Map<string, string>();
  const app = {
    ...disk,
    secretStorage: {
      getSecret: jest.fn((id: string) => {
        if (options.failKeychain) throw new Error("Synthetic keychain failure");
        return secrets.get(id) ?? null;
      }),
      setSecret: (id: string, value: string) => secrets.set(id, value),
      deleteSecret: (id: string) => secrets.delete(id),
      listSecrets: () => [...secrets.keys()],
    },
    workspace: {
      on: jest.fn(() => ({})),
      getLeavesOfType: () => [],
      getActiveViewOfType: () => null,
      onLayoutReady: (callback: () => void) => {
        layoutReady = callback;
      },
    },
    loadLocalStorage: () => null,
    saveLocalStorage: jest.fn(),
    readPluginData: async (): Promise<unknown> =>
      JSON.parse(readFileSync(dataPath, "utf8")) as unknown,
    writePluginData: async (data: unknown) => {
      if (options.failSave) throw new Error("Synthetic settings save failure");
      writeFileSync(dataPath, JSON.stringify(data));
    },
  };
  return {
    root,
    disk,
    app: app as unknown as App,
    dataPath,
    fireLayout: () => {
      if (!layoutReady) throw new Error("Missing layout callback");
      layoutReady();
    },
  };
}

describe("main", () => {
  describe("ScribePlugin", () => {
    describe("onload()", () => {
      let root = "";
      let plugin: ScribePlugin | undefined;
      let previousRequire: unknown;
      beforeEach(() => {
        jest.clearAllMocks();
        mockOpenedModals.length = 0;
        mockNotices.length = 0;
        jest.mocked(getLanguage).mockReturnValue("en");
        updateCachedCommands([]);
        updateCachedProjectRecords([]);
        (CustomCommandManager as unknown as { instance?: unknown }).instance = undefined;
        (ProjectFileManager as unknown as { instance?: unknown }).instance = undefined;
        previousRequire = (window as unknown as { require?: unknown }).require;
        (window as unknown as { require: unknown }).require = () => ({
          ipcRenderer: { sendSync: () => false },
        });
      });
      afterEach(async () => {
        act(() => mockOpenedModals.splice(0).forEach((modal) => modal.close()));
        if (plugin) {
          plugin.onunload();
          await (window as unknown as Record<symbol, Promise<void>>)[
            Symbol.for("obsidian-scribe:pending-teardown")
          ];
        }
        (window as unknown as { require?: unknown }).require = previousRequire;
        if (root) rmSync(root, { recursive: true, force: true });
        plugin = undefined;
      });
      async function start(
        options = {
          commands: true,
          selected: true,
          hasPrompt: true,
          legacyKey: true,
          failKeychain: true,
        }
      ) {
        const fixture = createFixture(options);
        root = fixture.root;
        mkdirSync(fixture.disk.full(".scribe/scribe-custom-prompts"), { recursive: true });
        writeFileSync(fixture.disk.full(".scribe/scribe-custom-prompts/New.md"), commandText);
        plugin = new ScribePlugin(fixture.app, manifest);
        const task = jest.spyOn(
          plugin as unknown as { runStartupMigrations(): Promise<void> },
          "runStartupMigrations"
        );
        plugin.onload();
        await plugin.whenStarted();
        expect(plugin.isStarted()).toBe(true);
        await act(async () => {
          fixture.fireLayout();
          await task.mock.results[0].value;
          await flushPersistence();
        });
        return fixture;
      }
      it("loads commands from the hidden directory without importing old commands, prompts, or keys", async () => {
        const fixture = await start();
        expect(getCachedCustomCommands().map((command) => command.title)).toEqual(["New"]);
        expect(getSettings().openAIApiKey).toBe("");
        expect(getSettings()).not.toHaveProperty("userSystemPrompt");
        expect(fixture.app.secretStorage!.getSecret).not.toHaveBeenCalled();
        expect(fixture.app.saveLocalStorage).not.toHaveBeenCalled();
        expect(readFileSync(fixture.disk.full(commandRel), "utf8")).toBe(commandText);
        expect(readFileSync(fixture.disk.full(selectedRel), "utf8")).toBe(selectedText);
      });
      it("saves only allowed configuration fields and does not create plaintext credential backups", async () => {
        const fixture = await start();
        const settings = JSON.parse(readFileSync(fixture.dataPath, "utf8")) as Record<
          string,
          unknown
        >;
        expect(settings.storageId).toBeTruthy();
        for (const key of [
          "openAIApiKey",
          "scribeFolder",
          "scribeRootHistory",
          "userSystemPrompt",
          "inlineEditCommands",
        ])
          expect(settings).not.toHaveProperty(key);
        expect(readdirSync(dirname(fixture.dataPath))).toEqual(["data.json"]);
        expect(existsSync(fixture.disk.full(".scribe/secrets"))).toBe(false);
      });
    });
  });
});
