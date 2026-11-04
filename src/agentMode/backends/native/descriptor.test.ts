import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
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
import { openCopilotSettings } from "@/settings/openSettings";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import type { BackendState } from "@/agentMode/session/types";
import { createNativeModel } from "@/agentMode/backends/native/nativeModels";
import { buildNativeSystemPrompt } from "@/agentMode/backends/native/nativeSystemPrompt";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";
import { buildBuiltinSkillEnv } from "@/agentMode/backends/shared/builtinSkillEnv";

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
jest.mock("@/agentMode/backends/native/nativeSystemPrompt", () => ({
  buildNativeSystemPrompt: jest.fn().mockResolvedValue("Vault prompt"),
}));
jest.mock("@/agentMode/backends/native/nativeModels", () => ({
  ...jest.requireActual("@/agentMode/backends/native/nativeModels"),
  createNativeModel: jest.fn().mockResolvedValue({ model: { id: "manual-model" } }),
}));
jest.mock("@/utils/appPaths", () => ({
  copilotAppDataDir: () => "/synthetic-scribe",
  getVaultId: () => "vault-scope",
}));
jest.mock("@/settings/openSettings", () => ({ openCopilotSettings: jest.fn() }));
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
        plugin: {} as CopilotPlugin,
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
          plugin: {} as CopilotPlugin,
          cwd: "/vault/project",
          signal: controller.signal,
        })
      ).rejects.toThrow();
      expect(readNativeExtensionRuntime).not.toHaveBeenCalled();
    });
  });
  describe("getInstallState()", () => {
    it("is immediately ready with an existing model and never requires an external binary or login", () => {
      expect(NativeBackendDescriptor.getInstallState(getSettings())).toEqual({
        kind: "ready",
        source: "managed",
      });
      expect(NativeBackendDescriptor.auth).toBeUndefined();
      expect(NativeBackendDescriptor.managedInstall).toBeUndefined();
      expect(NativeBackendDescriptor.getResolvedBinaryPath).toBeUndefined();
    });
    it("keeps the configuration controls reachable after every native model is disabled", () => {
      setSettings({ backends: { ...getSettings().backends, native: { enabledModels: [] } } });
      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
    });
    it("shows a model setup error when no BYOK chat model exists", () => {
      setSettings({ configuredModels: [] });
      expect(NativeBackendDescriptor.getInstallState(getSettings())).toEqual({
        kind: "error",
        message: expect.stringContaining("模型"),
      });
    });
  });
  describe("subscribeInstallState()", () => {
    it("reports settings changes until its subscription is disposed", () => {
      const listener = jest.fn();
      const dispose = NativeBackendDescriptor.subscribeInstallState({} as CopilotPlugin, listener);
      setSettings({ configuredModels: [] });
      expect(listener).toHaveBeenCalledTimes(1);
      dispose();
      setSettings({ configuredModels: [] });
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
  describe("openInstallUI()", () => {
    it("opens the existing BYOK settings in the active view's window", () => {
      const app = {
        workspace: {
          getMostRecentLeaf: () => ({ view: { containerEl: document.createElement("div") } }),
        },
      } as unknown as App;
      NativeBackendDescriptor.openInstallUI({ app } as CopilotPlugin);
      expect(openCopilotSettings).toHaveBeenCalledWith(app, window, "quickActions");
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
    it("reports the selected BYOK model's local destination", () => {
      expect(NativeBackendDescriptor.dataDestination?.(getSettings(), "/vault")).toEqual({
        kind: "local",
        label: "A server on this computer",
      });
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
    it("maps every existing permission mode to the matching native mode", () => {
      expect(NativeBackendDescriptor.getModeMapping?.(null, null)).toEqual({
        kind: "setMode",
        canonical: { default: "default", plan: "plan", auto: "auto" },
      });
    });
  });
  describe("createBackendProcess()", () => {
    it("constructs an in-process agent with vault-isolated native storage, existing model factory and independent command resources", async () => {
      const app = {} as App;
      NativeBackendDescriptor.createBackendProcess({
        app,
        plugin: {} as CopilotPlugin,
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
      expect(buildNativeSystemPrompt).toHaveBeenCalledWith(app, { cwd: "/vault" });
      const stepLimit = options.maxSteps;
      expect(typeof stepLimit).toBe("function");
      if (typeof stepLimit !== "function")
        throw new Error("The step limit must read current native settings.");
      expect(stepLimit()).toBe(75);
      await options.getExtensionRuntime?.("/vault/project");
      expect(readNativeExtensionRuntime).toHaveBeenCalledWith("/vault/project");
      expect(NodeNativeSessionStorage).toHaveBeenCalledWith(
        "/synthetic-scribe/vault-scope/native-agent/sessions"
      );
      const context = {
        sessionId: "native-session",
        cwd: "/vault/project",
        emit: jest.fn(),
        getMode: () => "default",
        requestPermission: jest.fn(),
        askUser: jest.fn(),
        onPlanApproved: jest.fn(),
        requester: "main",
      } as NativeToolContext;
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
      expect(advancedOptions.skills().map((skill) => skill.name)).toEqual(["enabled"]);
      expect(
        advancedOptions.offerFeedback({
          title: "Draft",
          whatHappened: "Error",
          repro: "Steps",
          userSaid: "",
        })
      ).toBe("unattributed");
      expect(NativeCommandTasks).toHaveBeenCalledWith(
        expect.objectContaining({
          cwd: "/vault/project",
          sessionId: "native-session",
          outputDirectory: "/synthetic-scribe/vault-scope/native-agent/tasks",
          getEnv: buildBuiltinSkillEnv,
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
    it("attributes a feedback draft to its source chat and registers drawing tools only when the drawing plugin is available", () => {
      jest.mocked(getExcalidrawApi).mockReturnValue({
        sceneElements: jest.fn(),
        renderPng: jest.fn(),
        execute: jest.fn(),
        connectLabelled: jest.fn(),
      });
      const offerFeedback = jest.fn().mockReturnValue("offered");
      const getSessionByBackendId = jest.fn().mockReturnValue({ offerFeedback });
      const plugin = { agentSessionManager: { getSessionByBackendId } } as unknown as CopilotPlugin;
      NativeBackendDescriptor.createBackendProcess({
        app: {} as App,
        plugin,
        clientVersion: "test",
        descriptor: NativeBackendDescriptor,
      });
      const options = jest.mocked(NativeBackendProcess).mock.calls[0][0];
      const tools = options.createTools({
        cwd: "/vault/project",
        sessionId: "source-chat",
        requester: "main",
        emit: jest.fn(),
        getMode: () => "default",
        requestPermission: jest.fn(),
        askUser: jest.fn(),
        onPlanApproved: jest.fn(),
      });
      expect(tools.tools.map((tool) => tool.name)).toContain("excalidraw_read");
      const advanced = jest.mocked(createNativeAdvancedTools).mock.calls[0][0];
      const draft = { title: "Draft", whatHappened: "Error", repro: "Steps", userSaid: "" };
      expect(advanced.offerFeedback(draft)).toBe("offered");
      expect(getSessionByBackendId).toHaveBeenCalledWith("source-chat");
      expect(offerFeedback).toHaveBeenCalledWith(draft);
    });
    it("rejects a disabled agent before constructing any runtime resources", () => {
      setSettings({
        agentMode: { ...getSettings().agentMode, backends: { native: { enabled: false } } },
      });
      expect(() =>
        NativeBackendDescriptor.createBackendProcess({
          app: {} as App,
          plugin: {} as CopilotPlugin,
          clientVersion: "test",
          descriptor: NativeBackendDescriptor,
        })
      ).toThrow("disabled");
      expect(NativeBackendProcess).not.toHaveBeenCalled();
    });
  });
});
