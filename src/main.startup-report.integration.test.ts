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
import { buildNativeSystemPrompt } from "@/agentMode/backends/native/nativeSystemPrompt";
import { flushPersistence } from "@/services/settingsPersistence";
import { updateSetting } from "@/settings/model";
import { logError } from "@/logger";
import { StartupFailure, StartupFailureChinese } from "@/components/modals/ConfirmModal.stories";

const mockSummaries: string[] = [];
const mockSummaryTitles: string[] = [];
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
  acpFrameSink: { narrowLegacyLogs: async () => {} },
  setFrameSinkVaultBasePath: jest.fn(),
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
    getAbstractFileByPath: getFile,
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
      getSecret: (id: string) => {
        if (options.failKeychain) throw new Error("Synthetic keychain failure");
        return secrets.get(id) ?? null;
      },
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
        mockSummaries.length = 0;
        mockSummaryTitles.length = 0;
        mockNotices.length = 0;
        mockModalOpenFailure = false;
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
          const handoff = window as unknown as Record<symbol, Promise<void>>;
          await handoff[Symbol.for("obsidian-scribe:pending-teardown")];
        }
        (window as unknown as { require?: unknown }).require = previousRequire;
        if (root) rmSync(root, { recursive: true, force: true });
        plugin = undefined;
      });

      async function start(options: {
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
        const f = createFixture(options);
        root = f.root;
        plugin = new ScribePlugin(f.app, manifest);
        const task = jest.spyOn(
          plugin as unknown as { runStartupMigrations(): Promise<void> },
          "runStartupMigrations"
        );
        plugin.onload();
        await plugin.whenStarted();
        expect(plugin.isStarted()).toBe(true);
        await act(async () => {
          f.fireLayout();
          await task.mock.results[0].value;
          await flushPersistence();
        });
        mockSummaries.push(
          ...mockOpenedModals.map(
            (modal) => modal.contentEl.querySelector(".tw-whitespace-pre-wrap")?.textContent ?? ""
          )
        );
        mockSummaryTitles.push(...mockOpenedModals.map((modal) => modal.titleEl.textContent ?? ""));
        return f;
      }

      it.each([
        [
          "en",
          "Scribe could not finish startup migration. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
        ],
        [
          "zh",
          "Scribe 未能完成启动迁移。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
        ],
      ] as const)(
        "advises safe action in the %s notification when presenting the startup report fails",
        async (language, expected) => {
          jest.mocked(getLanguage).mockReturnValue(language);
          const fixture = createFixture({
            commands: false,
            selected: false,
            failCommandRead: true,
          });
          root = fixture.root;
          plugin = new ScribePlugin(fixture.app, manifest);
          const task = jest.spyOn(
            plugin as unknown as { runStartupMigrations(): Promise<void> },
            "runStartupMigrations"
          );
          plugin.onload();
          await plugin.whenStarted();
          mockModalOpenFailure = true;
          await act(async () => {
            fixture.fireLayout();
            await expect(task.mock.results[0].value).rejects.toThrow("Synthetic modal failure");
          });
          expect(mockNotices).toContain(expected);
        }
      );

      it("shows an honest English startup report when loading commands fails", async () => {
        await start({ commands: false, selected: false, failCommandRead: true });
        expect(mockSummaries[0]).toContain("Scribe startup report.");
        expect(mockSummaryTitles).toEqual(["Scribe startup report"]);
        expect(mockSummaries[0]).toContain("Custom commands — Failed");
        expect(mockSummaries[0]).toContain(
          "Custom commands could not be loaded or migrated. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
        );
        expect(mockSummaries[0]).not.toContain("Scribe finished updating this vault.");
        expect(mockSummaries[0]).toBe(StartupFailure.args?.content);
      });

      it("shows an honest English startup report when loading projects fails", async () => {
        await start({ commands: false, selected: false, failProjectRead: true });
        expect(mockSummaries[0]).toContain("Scribe startup report.");
        expect(mockSummaryTitles).toEqual(["Scribe startup report"]);
        expect(mockSummaries[0]).toContain("Projects — Failed");
        expect(mockSummaries[0]).toContain(
          "Projects could not be loaded or migrated. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
        );
        expect(mockNotices).toContain("Failed to load projects. Check available logs.");
      });

      it("shows an honest Chinese startup report and notification when loading projects fails", async () => {
        jest.mocked(getLanguage).mockReturnValue("zh");
        await start({ commands: false, selected: false, failProjectRead: true });
        expect(mockSummaries[0]).toContain("项目 — 失败");
        expect(mockSummaries[0]).toContain(
          "无法加载或迁移项目。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。"
        );
        expect(mockNotices).toContain("加载项目失败，请查看可用日志了解详情。");
      });

      it("shows an honest Chinese startup report when loading commands fails", async () => {
        jest.mocked(getLanguage).mockReturnValue("zh");
        await start({ commands: false, selected: false, failCommandRead: true });
        expect(mockSummaries[0]).toContain("Scribe 启动报告。");
        expect(mockSummaryTitles).toEqual(["Scribe 启动报告"]);
        expect(mockSummaries[0]).toContain("自定义指令 — 失败");
        expect(mockSummaries[0]).toContain(
          "无法加载或迁移自定义指令。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。"
        );
        expect(mockSummaries[0]).not.toContain("Scribe 已完成此资料库的升级。");
        expect(mockSummaries[0]).toBe(StartupFailureChinese.args?.content);
      });

      it.each([
        [
          "en",
          "System prompts could not be loaded or migrated. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
        ],
        [
          "zh",
          "无法加载或迁移系统提示词。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
        ],
      ] as const)(
        "advises safe action in the %s startup report when malformed prompt data fails",
        async (language, expected) => {
          jest.mocked(getLanguage).mockReturnValue(language);
          await start({ commands: false, selected: false, malformedPrompt: true });
          expect(mockSummaries[0]).toContain(expected);
        }
      );

      it.each([
        [
          "en",
          "Scribe failed to save settings. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
        ],
        [
          "zh",
          "Scribe 保存设置失败。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
        ],
      ] as const)(
        "advises safe action in the %s notification when a later save is blocked",
        async (language, expected) => {
          jest.mocked(getLanguage).mockReturnValue(language);
          await start({ commands: false, selected: false, legacyKey: true, failBackup: true });
          let signal!: () => void;
          const failed = new Promise<void>((resolve) => {
            signal = resolve;
          });
          jest.mocked(logError).mockImplementation((message) => {
            if (message === "Failed to persist settings.") signal();
          });
          updateSetting("debug", true);
          await failed;
          expect(mockNotices).toContain(expected);
          jest.mocked(logError).mockReset();
        }
      );

      it.each([
        [
          "en",
          "Check that the vault is writable. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
        ],
        [
          "zh",
          "请确认资料库可以写入。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
        ],
      ] as const)(
        "advises safe action in the %s startup report when credential backup fails",
        async (language, expected) => {
          jest.mocked(getLanguage).mockReturnValue(language);
          const fixture = await start({
            commands: false,
            selected: false,
            legacyKey: true,
            failBackup: true,
          });
          expect(mockSummaries[0]).toContain(expected);
          expect(readFileSync(fixture.dataPath, "utf8")).toContain("fixture-only-key");
        }
      );

      it.each([
        [
          "en",
          "Check that the vault is writable. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
        ],
        [
          "zh",
          "请确认资料库可以写入。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
        ],
      ] as const)(
        "advises safe action in the %s startup report when saving migrated credentials fails",
        async (language, expected) => {
          jest.mocked(getLanguage).mockReturnValue(language);
          await start({ commands: false, selected: false, legacyKey: true, failSave: true });
          expect(mockSummaries[0]).toContain(expected);
        }
      );

      it.each([
        [
          "en",
          "Some API keys could not be loaded from the Obsidian Keychain. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
        ],
        [
          "zh",
          "部分 API 密钥无法从 Obsidian 钥匙串加载。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
        ],
      ] as const)(
        "advises safe action in the %s startup report when keychain reads fail",
        async (language, expected) => {
          jest.mocked(getLanguage).mockReturnValue(language);
          await start({ commands: false, selected: false, legacyKey: true, failKeychain: true });
          expect(mockSummaries[0]).toContain(expected);
        }
      );

      it.each([
        [
          "en",
          "After the file-safety issues are fixed, re-enter the keys in Settings. The backup may contain API keys; keep it private and review it before making changes.",
        ],
        [
          "zh",
          "文件安全问题修复后，请在设置中重新输入密钥。备份可能包含 API 密钥，请妥善保管，并在作出更改前检查。",
        ],
      ] as const)(
        "advises preserving the credential backup in the %s startup report",
        async (language, expected) => {
          jest.mocked(getLanguage).mockReturnValue(language);
          const fixture = await start({ commands: false, selected: false, legacyKey: true });
          expect(mockSummaries[0]).toContain(expected);
          expect(mockSummaries[0]).toContain(
            language === "en" ? "Settings backup location:" : "设置备份位置："
          );
          expect(mockSummaries[0]).not.toMatch(/Previous keys were copied|原有密钥已复制/);
          expect(mockSummaries[0]).not.toMatch(/delete (the )?(backup|file)|删除(该|备份)文件/i);
          const backups = readdirSync(dirname(fixture.dataPath)).filter(
            (name) => name.startsWith("data-v3-credentials-backup-") && name.endsWith(".json")
          );
          expect(backups).toHaveLength(1);
          expect(readFileSync(join(dirname(fixture.dataPath), backups[0]), "utf8")).toContain(
            "fixture-only-key"
          );
        }
      );

      it.each([
        [
          "en",
          "The backup may contain encrypted keys that Scribe cannot read. After the file-safety issues are fixed, get fresh keys from those providers if needed. Keep the backup private and review it before making changes.",
        ],
        [
          "zh",
          "备份可能含有 Scribe 无法读取的加密密钥。文件安全问题修复后，如有需要，请从相应供应商获取新密钥。请妥善保管备份，并在作出更改前检查。",
        ],
      ] as const)(
        "advises preserving the encrypted credential backup in the %s startup report",
        async (language, expected) => {
          jest.mocked(getLanguage).mockReturnValue(language);
          await start({ commands: false, selected: false, encryptedKey: true });
          expect(mockSummaries[0]).toContain(expected);
        }
      );

      it("continues reporting and registering a successfully migrated command", async () => {
        const f = await start({ commands: true, selected: false });
        expect(mockSummaryTitles).toEqual(["Scribe startup report"]);
        expect(mockSummaries[0]).toContain("Custom commands — Completed");
        expect(mockSummaries[0]).toContain("1 command was migrated to note files.");
        expect(getCachedCustomCommands().some((item) => item.title === "Old command")).toBe(true);
        expect(existsSync(f.disk.full("scribe/scribe-custom-prompts/Old command.md"))).toBe(true);
      });

      it("continues reporting a successful prompt migration", async () => {
        const f = await start({ commands: false, selected: false, hasPrompt: true });
        expect(mockSummaryTitles).toEqual(["Scribe startup report"]);
        expect(mockSummaries[0]).toContain("System prompt — Completed");
        expect(mockSummaries[0]).toContain('Migrated "Migrated Custom System Prompt"');
        expect(await buildNativeSystemPrompt(f.app, { cwd: root })).toContain(
          "Previous user instructions."
        );
      });

      it("does not open a startup report when there are no outcomes", async () => {
        await start({ commands: false, selected: false });
        expect(mockOpenedModals).toHaveLength(0);
      });
    });
  });
});
