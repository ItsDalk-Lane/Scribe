jest.mock("@/agentMode/subagents/SubagentManager", () => ({
  SubagentManager: { getInstance: () => ({ refresh: async () => [] }), reset: jest.fn() },
  getSubagents: () => [],
}));
import { FileSystemAdapter, type App } from "obsidian";
import { join } from "node:path";
import type ScribePlugin from "@/main";
import { DEFAULT_SETTINGS } from "@/constants";
import { getSettings, resetSettings, setSettings } from "@/settings/model";
import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import { NativeBackendProcess } from "@/agentMode/sdk/NativeBackendProcess";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
import { createNativeAdvancedTools } from "@/agentMode/sdk/nativeAdvancedTools";
import {
  getNativeScopedSkills,
  readNativeExtensionRuntime,
  readNativeExtensions,
  createNativeExtensionManager,
} from "@/agentMode/backends/native/nativeExtensions";
import { openScribeSettings } from "@/settings/openSettings";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import type { BackendState } from "@/agentMode/session/types";
import { createNativeModel } from "@/agentMode/backends/native/nativeModels";
import { buildNativeSystemPromptState } from "@/agentMode/backends/native/nativeSystemPrompt";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";
import { buildObsidianCommandEnv } from "@/agentMode/backends/shared/obsidianCommandEnv";
import { EMPTY_PROJECT_CONFIG } from "@/projects/constants";
import { getCachedProjectRecords, updateCachedProjectRecords } from "@/projects/state";
import type { AgentExtensionRuntimeSnapshot } from "@/agentMode/session/extensionInventory";

const mockStop = jest.fn().mockResolvedValue(undefined);
const mockShutdown = jest.fn().mockResolvedValue(undefined);
jest.mock("@/agentMode/sdk/NativeBackendProcess", () => ({ NativeBackendProcess: jest.fn() }));
jest.mock("@/agentMode/sdk/NativeSessionStorage", () => ({ NodeNativeSessionStorage: jest.fn() }));
jest.mock("@/agentMode/sdk/nativeCommandTasks", () => ({
  NativeCommandTasks: jest
    .fn()
    .mockImplementation(() => ({ stop: mockStop, shutdown: mockShutdown })),
}));
jest.mock("@/agentMode/sdk/nativeAdvancedTools", () => ({
  createNativeAdvancedTools: jest
    .fn()
    .mockReturnValue([{ name: "invoke_skill" }, { name: "excalidraw_read" }]),
}));
jest.mock("@/agentMode/backends/native/nativeExtensions", () => ({
  NATIVE_SKILLS_PROJECT_DIR: ".scribe/skills",
  getNativeScopedSkills: jest.fn().mockReturnValue([]),
  readNativeExtensionRuntime: jest.fn().mockReturnValue({ backendId: "native", commands: [] }),
  readNativeExtensions: jest.fn().mockReturnValue([]),
  createNativeExtensionManager: jest.fn(),
}));
jest.mock("@/excalidraw/excalidrawApi", () => ({
  getExcalidrawApi: jest.fn().mockReturnValue(null),
}));
jest.mock("@/agentMode/sdk/nativeTools", () => ({
  createNativeTools: jest.fn().mockReturnValue([]),
}));
const mockGetMcpServerManager = jest.fn().mockReturnValue(null);
jest.mock("@/agentMode/mcp/McpServerManager", () => ({
  getMcpServerManager: (...args: unknown[]) => mockGetMcpServerManager(...args),
}));
const mockCreateMcpTools = jest.fn().mockReturnValue({
  tools: [],
  autoApprovedTools: new Set<string>(),
});
jest.mock("@/agentMode/mcp/mcpTools", () => ({
  ...jest.requireActual("@/agentMode/mcp/mcpTools"),
  createMcpTools: (...args: unknown[]) => mockCreateMcpTools(...args),
}));
jest.mock("@/agentMode/backends/native/nativeSystemPrompt", () => ({
  buildNativeSystemPromptState: jest
    .fn()
    .mockResolvedValue({ content: "Vault prompt", sections: {} }),
}));
jest.mock("@/agentMode/backends/native/nativeModels", () => ({
  ...jest.requireActual("@/agentMode/backends/native/nativeModels"),
  createNativeModel: jest.fn().mockResolvedValue({ model: { id: "manual-model" } }),
}));
jest.mock("@/utils/appPaths", () => ({
  getScribeDataPath: () => "/synthetic-vault/.scribe",
}));
jest.mock("@/settings/openSettings", () => ({ openScribeSettings: jest.fn() }));
jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function configure(): void {
  setSettings({
    providers: {
      local: {
        providerId: "local",
        providerType: "openai-compatible",
        displayName: "Local model",
        baseUrl: "http://localhost:1234/v1",
        requiresApiKey: false,
        origin: { kind: "byok" },
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "manual-model",
        providerId: "local",
        info: {
          id: "manual-model",
          displayName: "Manual model",
          reasoningEfforts: ["low", "high"],
        },
        configuredAt: 1,
      },
    ],
    backends: { chat: { enabledModels: ["manual-model"] } },
    agentMode: { ...DEFAULT_SETTINGS.agentMode, backends: { native: { maxSteps: 75 } } },
  });
}

describe("nativeDescriptor", () => {
  function toolContext(overrides: Partial<NativeToolContext> = {}): NativeToolContext {
    const selected = new Set<string>();
    return {
      sessionId: "native-session",
      cwd: "/vault/project",
      emit: jest.fn(),
      getMode: () => "default",
      requestPermission: jest.fn(),
      askUser: jest.fn(),
      onPlanApproved: jest.fn(),
      requester: "main",
      mcpToolSelections: {
        names: () => [...selected],
        select: (name) => {
          selected.add(name);
        },
      },
      registerTool: jest.fn(),
      ...overrides,
    };
  }
  beforeEach(() => {
    resetSettings();
    jest.clearAllMocks();
    jest.mocked(getExcalidrawApi).mockReturnValue(null);
    configure();
  });
  describe("createExtensionManager()", () => {
    it("uses the native manager for the requested working directory", () => {
      NativeBackendDescriptor.createExtensionManager?.({
        settings: getSettings(),
        cwd: "/vault/project",
      });
      expect(createNativeExtensionManager).toHaveBeenCalledWith({
        settings: getSettings(),
        cwd: "/vault/project",
      });
    });
  });
  describe("readExtensions()", () => {
    it("reads only the native inventory for the selected scope", async () => {
      await NativeBackendDescriptor.readExtensions?.({
        settings: getSettings(),
        cwd: "/vault/project",
      });
      expect(readNativeExtensions).toHaveBeenCalledWith({
        settings: getSettings(),
        cwd: "/vault/project",
      });
    });
  });
  describe("checkExtensions()", () => {
    it("reports the current native runtime without starting a model turn", async () => {
      await NativeBackendDescriptor.checkExtensions?.({
        plugin: {} as ScribePlugin,
        cwd: "/vault/project",
      });
      expect(readNativeExtensionRuntime).toHaveBeenCalledWith("/vault/project");
      expect(NativeBackendProcess).not.toHaveBeenCalled();
    });
    it("cancels an aborted availability check before reading the inventory", async () => {
      const controller = new AbortController();
      controller.abort();
      await expect(
        NativeBackendDescriptor.checkExtensions?.({
          plugin: {} as ScribePlugin,
          cwd: "/vault/project",
          signal: controller.signal,
        })
      ).rejects.toThrow();
      expect(readNativeExtensionRuntime).not.toHaveBeenCalled();
    });
  });
  describe("getInstallState()", () => {
    it("does not construct model display capabilities to determine readiness (https://github.com/ItsDalk-Lane/Scribe/issues/21)", () => {
      setSettings({
        configuredModels: getSettings().configuredModels.map((model) => ({
          ...model,
          info: {
            ...model.info,
            modalities: { input: 42 as unknown as string[], output: ["text"] },
          },
        })),
      });
      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
    });
    it("is immediately ready with an existing model and never requires an external binary or login", () => {
      expect(NativeBackendDescriptor.getInstallState(getSettings())).toEqual({
        kind: "ready",
        source: "managed",
      });
      expect(NativeBackendDescriptor.auth).toBeUndefined();
      expect(NativeBackendDescriptor.managedInstall).toBeUndefined();
      expect(NativeBackendDescriptor.getResolvedBinaryPath).toBeUndefined();
    });
    it("keeps configured models ready despite legacy disabled lists https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      setSettings({ backends: { ...getSettings().backends, native: { enabledModels: [] } } });
      expect(NativeBackendDescriptor.getInstallState(getSettings())).toMatchObject({
        kind: "ready",
      });
    });
    it("shows a localized model setup error when no BYOK chat model exists (https://github.com/ItsDalk-Lane/Scribe/issues/28)", () => {
      setSettings({ configuredModels: [] });
      expect(NativeBackendDescriptor.getInstallState(getSettings())).toEqual({
        kind: "error",
        reason: "configuration",
        message: expect.stringContaining("chat model"),
      });
    });
  });
  describe("setupDescription", () => {
    it("carries the English source string so the UI can localize it (https://github.com/ItsDalk-Lane/Scribe/issues/28)", () => {
      expect(NativeBackendDescriptor.setupDescription).toBe(
        "Runs note tasks inside Scribe using the chat models you configure."
      );
    });
  });
  describe("subscribeInstallState()", () => {
    it("reports model configuration changes without restarting for selection preferences or obsolete switches https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      const listener = jest.fn();
      const dispose = NativeBackendDescriptor.subscribeInstallState({} as ScribePlugin, listener);
      setSettings((current) => ({
        agentMode: {
          ...current.agentMode,
          backends: {
            native: {
              defaultModel: { baseModelId: "manual-model", effort: "high" },
              defaultMode: "auto",
              maxSteps: 50,
            },
          },
        },
        backends: { native: { enabledModels: [] } },
      }));
      expect(listener).not.toHaveBeenCalled();

      setSettings({ configuredModels: [] });
      expect(listener).toHaveBeenCalledTimes(1);
      dispose();
      setSettings({ configuredModels: [] });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
  describe("openInstallUI()", () => {
    it("opens the existing model and provider settings in the active view's window", () => {
      const app = {
        workspace: {
          getMostRecentLeaf: () => ({ view: { containerEl: document.createElement("div") } }),
        },
      } as unknown as App;
      NativeBackendDescriptor.openInstallUI({ app } as ScribePlugin);
      expect(openScribeSettings).toHaveBeenCalledWith(app, window, "quickActions");
    });
  });
  describe("getEnabledModelEntries()", () => {
    it("exposes the existing chat model under its configured identity", () => {
      expect(NativeBackendDescriptor.getEnabledModelEntries?.(getSettings())).toEqual([
        expect.objectContaining({ baseModelId: "manual-model", credentialState: "ok" }),
      ]);
    });
  });
  describe("getWireBaseId()", () => {
    it("preserves enabled configured identities and rejects identities outside this model list", () => {
      expect(NativeBackendDescriptor.getWireBaseId?.("manual-model", getSettings())).toBe(
        "manual-model"
      );
      expect(NativeBackendDescriptor.getWireBaseId?.("other-model", getSettings())).toBeNull();
    });
  });
  describe("wire.encode()", () => {
    it("keeps the selected configured model identity unchanged", () => {
      expect(
        NativeBackendDescriptor.wire.encode({ baseModelId: "manual-model", effort: "high" })
      ).toBe("manual-model");
    });
  });
  describe("wire.decode()", () => {
    it("decodes the configured identity without choosing another provider or effort", () => {
      expect(NativeBackendDescriptor.wire.decode("manual-model")).toEqual({
        selection: { baseModelId: "manual-model", effort: null },
        provider: null,
      });
    });
  });
  describe("wire.effortConfigFor()", () => {
    it("offers only reasoning levels recorded for that exact model", () => {
      expect(NativeBackendDescriptor.wire.effortConfigFor?.("manual-model")).toEqual({
        id: "effort",
        type: "select",
        name: "Reasoning effort",
        currentValue: "default",
        options: [
          { value: "default", name: "Default" },
          { value: "low", name: "low" },
          { value: "high", name: "high" },
        ],
      });
      expect(NativeBackendDescriptor.wire.effortConfigFor?.("other-model")).toBeNull();
    });
  });
  describe("dataDestination()", () => {
    it("reports the selected configured model's destination and a generic provider label without a selection", () => {
      expect(NativeBackendDescriptor.dataDestination?.(getSettings(), "/vault")).toEqual({
        kind: "local",
        label: "A server on this computer",
      });
      expect(
        NativeBackendDescriptor.dataDestination?.(
          { ...getSettings(), configuredModels: [] },
          "/vault"
        )
      ).toEqual({ kind: "cloud", label: "Model provider" });
    });
  });
  describe("applySelection()", () => {
    it("applies a different selected model before applying its reasoning level", async () => {
      const applyModelWireId = jest.fn().mockResolvedValue(undefined);
      const setConfigOption = jest.fn().mockResolvedValue(undefined);
      await NativeBackendDescriptor.applySelection(
        { getState: () => null, applyModelWireId, setConfigOption },
        { baseModelId: "manual-model", effort: "high" }
      );
      expect(applyModelWireId).toHaveBeenCalledWith("manual-model");
      expect(setConfigOption).toHaveBeenCalledWith("effort", "high");
      expect(applyModelWireId.mock.invocationCallOrder[0]).toBeLessThan(
        setConfigOption.mock.invocationCallOrder[0]
      );
    });
    it("does not reload an unchanged model and restores the provider default independently of off", async () => {
      const applyModelWireId = jest.fn();
      const setConfigOption = jest.fn().mockResolvedValue(undefined);
      await NativeBackendDescriptor.applySelection(
        {
          getState: () => ({ model: { current: { baseModelId: "manual-model" } } }) as BackendState,
          applyModelWireId,
          setConfigOption,
        },
        { baseModelId: "manual-model", effort: null }
      );
      expect(applyModelWireId).not.toHaveBeenCalled();
      expect(setConfigOption).toHaveBeenCalledWith("effort", "default");
    });
  });
  describe("getModeMapping()", () => {
    it("maps every existing permission mode to the matching native mode (full: https://github.com/ItsDalk-Lane/Scribe/issues/38)", () => {
      expect(NativeBackendDescriptor.getModeMapping?.(null, null)).toEqual({
        kind: "setMode",
        canonical: { default: "default", plan: "plan", auto: "auto", full: "full" },
      });
    });
  });
  describe("createBackendProcess()", () => {
    it("rebuilds the request declaration from the current project selection and leaves global requests without project sources", () => {
      const previous = getCachedProjectRecords();
      const record = {
        project: {
          ...EMPTY_PROJECT_CONFIG,
          id: "sources-live",
          workspacePath: "Project",
          contextSource: { webUrls: "https://old.example" },
        },
        filePath: ".scribe/projects/sources-live/project.md",
        folderName: "sources-live",
      };
      const app = { vault: { adapter: {}, getFiles: () => [] } } as unknown as App;
      try {
        updateCachedProjectRecords([record]);
        NativeBackendDescriptor.createBackendProcess({
          app,
          plugin: {} as ScribePlugin,
          clientVersion: "test",
          descriptor: NativeBackendDescriptor,
        });
        const options = jest.mocked(NativeBackendProcess).mock.calls[0][0];
        const input = { cwd: "/synthetic-vault/Project", projectId: "sources-live" };
        expect(options.getRequestContext?.(input)).toContain("https://old.example");
        updateCachedProjectRecords([
          {
            ...record,
            project: { ...record.project, contextSource: { webUrls: "https://new.example" } },
          },
        ]);
        const replaced = options.getRequestContext?.(input);
        expect(replaced).toContain("https://new.example");
        expect(replaced).not.toContain("https://old.example");
        updateCachedProjectRecords([
          { ...record, project: { ...record.project, contextSource: {} } },
        ]);
        expect(options.getRequestContext?.(input)).toContain("No context sources are configured");
        expect(options.getRequestContext?.({ cwd: "/synthetic-vault" })).toBe("");
        expect(
          options.getRequestContext?.({ cwd: "/synthetic-vault", projectId: "__global__" })
        ).toBe("");
      } finally {
        updateCachedProjectRecords(previous);
      }
    });

    it("changes the capability revision when a scoped skill is disabled or updated https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const skill = {
        name: "scoped",
        description: "Scoped skill",
        body: "Original",
        enabledAgents: ["native"],
        filePath: "/skills/scoped/SKILL.md",
        dirPath: "/skills/scoped",
        location: { kind: "canonical" as const },
      };
      jest.mocked(getNativeScopedSkills).mockReturnValue([skill]);
      NativeBackendDescriptor.createBackendProcess({
        app: {} as App,
        plugin: {} as ScribePlugin,
        clientVersion: "test",
        descriptor: NativeBackendDescriptor,
      });
      const options = jest.mocked(NativeBackendProcess).mock.calls[0][0];
      const initial = options.getCapabilityRevision?.("/vault");
      expect(typeof initial).toBe("string");
      jest.mocked(getNativeScopedSkills).mockReturnValue([{ ...skill, enabledAgents: [] }]);
      expect(options.getCapabilityRevision?.("/vault")).not.toBe(initial);
      jest.mocked(getNativeScopedSkills).mockReturnValue([{ ...skill, body: "Changed" }]);
      expect(options.getCapabilityRevision?.("/vault")).not.toBe(initial);
    });

    it("rechecks the current project folder on each operation and accepts only the updated location https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const previous = getCachedProjectRecords();
      const record = {
        project: { ...EMPTY_PROJECT_CONFIG, id: "scope-live", workspacePath: "Old" },
        filePath: ".scribe/projects/scope-live/project.md",
        folderName: "scope-live",
      };
      try {
        updateCachedProjectRecords([record]);
        NativeBackendDescriptor.createBackendProcess({
          app: {} as App,
          plugin: {} as ScribePlugin,
          clientVersion: "test",
          descriptor: NativeBackendDescriptor,
        });
        const options = jest.mocked(NativeBackendProcess).mock.calls[0][0];
        expect(() =>
          options.assertScope?.({ cwd: "/synthetic-vault/Old", projectId: "scope-live" })
        ).not.toThrow();
        updateCachedProjectRecords([
          { ...record, project: { ...record.project, workspacePath: "New" } },
        ]);
        expect(() =>
          options.assertScope?.({ cwd: "/synthetic-vault/Old", projectId: "scope-live" })
        ).toThrow("项目工作位置已改变");
        expect(() =>
          options.assertScope?.({ cwd: "/synthetic-vault/New", projectId: "scope-live" })
        ).not.toThrow();
      } finally {
        updateCachedProjectRecords(previous);
      }
    });

    it("rejects a child operation after its project is removed instead of accepting the old working directory https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      NativeBackendDescriptor.createBackendProcess({
        app: {} as App,
        plugin: {} as ScribePlugin,
        clientVersion: "test",
        descriptor: NativeBackendDescriptor,
      });
      const options = jest.mocked(NativeBackendProcess).mock.calls[0][0];
      expect(() =>
        options.assertScope?.({ cwd: "/synthetic-vault/removed", projectId: "removed-project" })
      ).toThrow("no longer available");
    });

    it("shares child admission across chats in one app and keeps separate vault instances independent https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
      const app = {} as App;
      for (const owner of [app, app, {} as App])
        NativeBackendDescriptor.createBackendProcess({
          app: owner,
          plugin: {} as ScribePlugin,
          clientVersion: "test",
          descriptor: NativeBackendDescriptor,
        });
      const calls = jest.mocked(NativeBackendProcess).mock.calls.map(([options]) => options);
      expect(calls[0].getSubagentLimits?.()).toEqual({
        maxConcurrent: 3,
        maxQueued: 20,
        maxTaskRequests: 100,
      });
      const releases = await Promise.all([
        calls[0].acquireSubagentSlot!(),
        calls[1].acquireSubagentSlot!(),
        calls[1].acquireSubagentSlot!(),
      ]);
      const stop = new AbortController();
      const waiting = calls[0].acquireSubagentSlot!(stop.signal);
      const independent = await calls[2].acquireSubagentSlot!();
      independent();
      stop.abort();
      await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
      releases.forEach((release) => release());
    });
    it("constructs an in-process agent with vault-isolated native storage, existing model factory and independent command resources", async () => {
      const app = {} as App;
      NativeBackendDescriptor.createBackendProcess({
        app,
        plugin: {} as ScribePlugin,
        clientVersion: "test",
        descriptor: NativeBackendDescriptor,
      });
      const options = jest.mocked(NativeBackendProcess).mock.calls[0][0];
      expect(options.getDefaultModelId()).toBe("manual-model");
      expect(options.getModels()).toEqual([
        expect.objectContaining({ baseModelId: "manual-model" }),
      ]);
      await options.createModel("manual-model");
      expect(createNativeModel).toHaveBeenCalledWith(app, "manual-model");
      await options.getSystemPrompt({ cwd: "/vault" });
      expect(buildNativeSystemPromptState).toHaveBeenCalledWith(app, { cwd: "/vault" });
      const stepLimit = options.maxSteps;
      expect(typeof stepLimit).toBe("function");
      if (typeof stepLimit !== "function")
        throw new Error("The step limit must read current native settings.");
      expect(stepLimit()).toBe(75);
      await options.getExtensionRuntime?.("/vault/project");
      expect(readNativeExtensionRuntime).toHaveBeenCalledWith("/vault/project");
      expect(NodeNativeSessionStorage).toHaveBeenCalledWith(
        join("/synthetic-vault/.scribe", "chats", "v2"),
        expect.objectContaining({ directory: join("/synthetic-vault/.scribe", "attachments") })
      );
      const context = toolContext();
      jest.mocked(getNativeScopedSkills).mockReturnValue(
        [
          {
            name: "enabled",
            description: "Enabled",
            body: "Enabled skill",
            enabledAgents: ["native"],
          },
          { name: "disabled", description: "Disabled", body: "Disabled skill", enabledAgents: [] },
          {
            name: "manual",
            description: "Manual only",
            body: "Manual skill",
            enabledAgents: ["native"],
            disableModelInvocation: true,
          },
        ].map((skill) => ({
          ...skill,
          filePath: `/skills/${skill.name}/SKILL.md`,
          dirPath: `/skills/${skill.name}`,
          location: { kind: "canonical" as const },
        }))
      );
      const tools = options.createTools(context);
      expect(tools.tools.map((tool) => tool.name)).toEqual(["invoke_skill"]);
      const advancedOptions = jest.mocked(createNativeAdvancedTools).mock.calls[0][0];
      // 目录条目携带调用资格状态，可用性过滤转移到工具层。https://github.com/ItsDalk-Lane/Scribe/issues/41
      expect(advancedOptions.skills()).toEqual([
        expect.objectContaining({ name: "enabled", status: "available" }),
        expect.objectContaining({ name: "disabled", status: "disabled" }),
        expect.objectContaining({ name: "manual", status: "manual-only" }),
      ]);
      expect(NativeCommandTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/vault/project",
          sessionId: "native-session",
          outputDirectory: join("/synthetic-vault/.scribe", "chats", "v2", "tasks"),
          getEnv: buildObsidianCommandEnv,
        })
      );
      expect(createNativeTools).toHaveBeenCalledWith(
        expect.objectContaining({ app, cwd: "/vault/project", requester: "main" })
      );
      await tools.stopTask?.("command-id");
      await tools.shutdown?.();
      expect(mockStop).toHaveBeenCalledWith("command-id");
      expect(mockShutdown).toHaveBeenCalledTimes(1);
    });
    it("replaces a previously published skill catalog when all skills are removed https://github.com/ItsDalk-Lane/Scribe/issues/42", () => {
      const actual = jest.requireActual<typeof import("@/agentMode/sdk/nativeAdvancedTools")>(
        "@/agentMode/sdk/nativeAdvancedTools"
      );
      jest.mocked(createNativeAdvancedTools).mockImplementation(actual.createNativeAdvancedTools);
      NativeBackendDescriptor.createBackendProcess({
        app: { vault: { adapter: new FileSystemAdapter() } } as unknown as App,
        plugin: {} as ScribePlugin,
        clientVersion: "test",
        descriptor: NativeBackendDescriptor,
      });
      const options = jest.mocked(NativeBackendProcess).mock.calls[0][0];
      let published = false;
      const context = toolContext({
        skillCatalog: {
          everPublished: () => published,
          markPublished: () => {
            published = true;
          },
        },
      });
      jest.mocked(getNativeScopedSkills).mockReturnValue([
        {
          name: "notes",
          description: "Organize notes",
          body: "Use headings",
          enabledAgents: ["native"],
          filePath: "/skills/notes/SKILL.md",
          dirPath: "/skills/notes",
          location: { kind: "canonical" },
        },
      ]);
      expect(
        options.createTools(context).tools.find((tool) => tool.name === "invoke_skill")?.description
      ).toContain("notes");
      jest.mocked(getNativeScopedSkills).mockReturnValue([]);
      expect(
        options.createTools(context).tools.find((tool) => tool.name === "invoke_skill")?.description
      ).toContain("No skills are currently available");
      jest
        .mocked(createNativeAdvancedTools)
        .mockReturnValue([{ name: "invoke_skill" }, { name: "excalidraw_read" }] as never);
    });
    describe("mcp integration", () => {
      function managerStub(overrides: {
        signature?: string;
        statuses?: readonly { name: string; status: string; toolCount: number }[];
      }) {
        return {
          signature: () => overrides.signature ?? "sig-1",
          listServerStatuses: () => overrides.statuses ?? [],
          listEnabledServers: () => [],
          getTools: () => [],
        };
      }

      afterEach(() => {
        mockGetMcpServerManager.mockReturnValue(null);
        mockCreateMcpTools.mockReturnValue({
          tools: [],
          autoApprovedTools: new Set<string>(),
        });
      });

      function createAndCaptureOptions() {
        NativeBackendDescriptor.createBackendProcess({
          app: {} as App,
          plugin: {} as ScribePlugin,
          clientVersion: "test",
          descriptor: NativeBackendDescriptor,
        });
        return jest.mocked(NativeBackendProcess).mock.calls.at(-1)![0];
      }

      it("appends mcp tools and their auto-approval list to the session tool bundle", () => {
        const mcpTool = { name: "mcp__files__search" };
        mockGetMcpServerManager.mockReturnValue(managerStub({}));
        mockCreateMcpTools.mockReturnValue({
          tools: [mcpTool],
          autoApprovedTools: new Set(["mcp__files__search"]),
        });
        const options = createAndCaptureOptions();
        const bundle = options.createTools(toolContext({ sessionId: "s", cwd: "/vault" }));
        expect(bundle.tools).toContain(mcpTool);
        expect([...(bundle.autoApproveTools ?? [])]).toEqual(["mcp__files__search"]);
      });

      it("registers tool_search alongside selected tools when deferred loading is active https://github.com/ItsDalk-Lane/Scribe/issues/65", () => {
        const mcpTool = { name: "mcp__files__search" };
        mockGetMcpServerManager.mockReturnValue(managerStub({}));
        mockCreateMcpTools.mockReturnValue({
          tools: [mcpTool],
          autoApprovedTools: new Set<string>(),
        });
        setSettings({
          agentMode: { ...getSettings().agentMode, mcpToolLoading: "always" },
        });
        const options = createAndCaptureOptions();
        const bundle = options.createTools(toolContext());
        expect(mockCreateMcpTools).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ selectedNames: [] })
        );
        expect(bundle.tools).toContain(mcpTool);
        expect(bundle.tools.map((tool) => tool.name)).toContain("tool_search");
      });

      it("hands the session's selected deferred tools back to the bundle on rebuild https://github.com/ItsDalk-Lane/Scribe/issues/65", () => {
        mockGetMcpServerManager.mockReturnValue(managerStub({}));
        mockCreateMcpTools.mockReturnValue({
          tools: [],
          autoApprovedTools: new Set<string>(),
        });
        setSettings({
          agentMode: { ...getSettings().agentMode, mcpToolLoading: "always" },
        });
        const options = createAndCaptureOptions();
        const context = toolContext();
        context.mcpToolSelections.select("mcp__files__search");
        options.createTools(context);
        expect(mockCreateMcpTools).toHaveBeenLastCalledWith(
          expect.anything(),
          expect.objectContaining({ selectedNames: ["mcp__files__search"] })
        );
      });

      it("keeps full registration below the auto threshold without registering tool_search https://github.com/ItsDalk-Lane/Scribe/issues/65", () => {
        mockGetMcpServerManager.mockReturnValue(managerStub({}));
        mockCreateMcpTools.mockReturnValue({
          tools: [],
          autoApprovedTools: new Set<string>(),
        });
        const options = createAndCaptureOptions();
        const bundle = options.createTools(toolContext());
        expect(mockCreateMcpTools).toHaveBeenLastCalledWith(expect.anything());
        expect(bundle.tools.map((tool) => tool.name)).not.toContain("tool_search");
      });

      it("keeps full registration for children whose allowed tools name an mcp tool https://github.com/ItsDalk-Lane/Scribe/issues/65", () => {
        mockGetMcpServerManager.mockReturnValue(managerStub({}));
        mockCreateMcpTools.mockReturnValue({
          tools: [],
          autoApprovedTools: new Set<string>(),
        });
        setSettings({
          agentMode: { ...getSettings().agentMode, mcpToolLoading: "always" },
        });
        const options = createAndCaptureOptions();
        const bundle = options.createTools(toolContext({ allowedTools: ["mcp__files__search"] }));
        expect(mockCreateMcpTools).toHaveBeenLastCalledWith(expect.anything());
        expect(bundle.tools.map((tool) => tool.name)).not.toContain("tool_search");
      });

      it("rebuilds the tool list when the mcp signature changes", () => {
        mockGetMcpServerManager.mockReturnValue(managerStub({ signature: "before" }));
        const options = createAndCaptureOptions();
        const before = options.getCapabilityRevision?.("/vault");
        mockGetMcpServerManager.mockReturnValue(managerStub({ signature: "after" }));
        expect(options.getCapabilityRevision?.("/vault")).not.toBe(before);
      });

      it("keeps the capability revision stable when no mcp manager exists", () => {
        const options = createAndCaptureOptions();
        expect(options.getCapabilityRevision?.("/vault")).toBe(
          options.getCapabilityRevision?.("/vault")
        );
      });

      it("maps live mcp server statuses into the extension runtime snapshot", () => {
        mockGetMcpServerManager.mockReturnValue(
          managerStub({
            statuses: [
              { name: "files", status: "connected", toolCount: 3 },
              { name: "stream", status: "connecting", toolCount: 0 },
              { name: "broken", status: "error", toolCount: 0 },
              { name: "off", status: "disabled", toolCount: 0 },
            ],
          })
        );
        const options = createAndCaptureOptions();
        const snapshot = options.getExtensionRuntime?.("/vault") as AgentExtensionRuntimeSnapshot;
        expect(snapshot.mcpServers).toEqual([
          { name: "files", status: "connected", toolCount: 3 },
          { name: "stream", status: "pending", toolCount: 0 },
          { name: "broken", status: "failed", toolCount: 0 },
          { name: "off", status: "disabled", toolCount: 0 },
        ]);
      });

      it("answers mcp status queries from the manager and null without one", () => {
        mockGetMcpServerManager.mockReturnValue(
          managerStub({ statuses: [{ name: "files", status: "connected", toolCount: 2 }] })
        );
        const options = createAndCaptureOptions();
        expect(options.getMcpServerStatus?.()).toEqual([
          { name: "files", status: "connected", toolCount: 2 },
        ]);
        mockGetMcpServerManager.mockReturnValue(null);
        expect(options.getMcpServerStatus?.()).toBeNull();
      });
    });
    it("permits explicit manual-only skill references while rejecting disabled or hidden manual references", () => {
      NativeBackendDescriptor.createBackendProcess({
        app: {} as App,
        plugin: {} as ScribePlugin,
        clientVersion: "test",
        descriptor: NativeBackendDescriptor,
      });
      const options = jest.mocked(NativeBackendProcess).mock.calls[0][0];
      jest.mocked(getNativeScopedSkills).mockReturnValue(
        [
          { name: "manual", enabledAgents: ["native"], disableModelInvocation: true },
          { name: "disabled", enabledAgents: [] },
          { name: "private", enabledAgents: ["native"], userInvocable: false },
        ].map((skill) => ({
          ...skill,
          description: "Skill",
          body: "Instructions",
          filePath: `/skills/${skill.name}/SKILL.md`,
          dirPath: `/skills/${skill.name}`,
          location: { kind: "canonical" as const },
        }))
      );
      expect(options.getManuallyInvokedSkill?.("manual", "/vault")).toMatchObject({
        name: "manual",
        body: "Instructions",
        dirPath: "/skills/manual",
      });
      expect(() => options.getManuallyInvokedSkill?.("disabled", "/vault")).toThrow("manual use");
      expect(() => options.getManuallyInvokedSkill?.("private", "/vault")).toThrow("manual use");
      expect(options.getManuallyInvokedSkill?.("missing", "/vault")).toBeNull();
    });

    it("registers drawing tools when the drawing plugin is available", () => {
      jest.mocked(getExcalidrawApi).mockReturnValue({
        sceneElements: jest.fn(),
        renderPng: jest.fn(),
        execute: jest.fn(),
        connectLabelled: jest.fn(),
      });
      NativeBackendDescriptor.createBackendProcess({
        app: {} as App,
        plugin: {} as ScribePlugin,
        clientVersion: "test",
        descriptor: NativeBackendDescriptor,
      });
      const options = jest.mocked(NativeBackendProcess).mock.calls[0][0];
      const tools = options.createTools(
        toolContext({ cwd: "/vault/project", sessionId: "source-chat" })
      );
      expect(tools.tools.map((tool) => tool.name)).toContain("excalidraw_read");
    });
    it("constructs native runtime despite a legacy disabled flag https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
      setSettings({
        agentMode: { ...getSettings().agentMode, backends: { native: { enabled: false } } },
      });
      expect(() =>
        NativeBackendDescriptor.createBackendProcess({
          app: {} as App,
          plugin: {} as ScribePlugin,
          clientVersion: "test",
          descriptor: NativeBackendDescriptor,
        })
      ).not.toThrow();
      expect(NativeBackendProcess).toHaveBeenCalled();
    });
  });
});
