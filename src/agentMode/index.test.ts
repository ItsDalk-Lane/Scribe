import type { App } from "obsidian";
import type CopilotPlugin from "@/main";
import type { CopilotSettings } from "@/settings/model";
import type { InstallState } from "./session/types";
import type { BuiltinSkillRuntime } from "./skills/SkillManager";
import { createAgentSessionManager } from "./index";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { reconcileBuiltinSkills } from "./skills/builtin/reconcileBuiltinSkills";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";

jest.mock("@/constants", () => ({}));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
jest.mock("@/utils", () => ({ err2String: jest.fn() }));
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  subscribeToSettingsChange: (callback: SettingsSubscriber) => {
    mockSettingsSubscribers.push(callback);
    return () => {};
  },
}));
jest.mock("@/settings/copilotFolder", () => ({
  deriveSkillsFolder: (settings: CopilotSettings) => `${settings.copilotFolder}/skills`,
}));
jest.mock("@/settings/builtinSkillPreferences", () => ({ saveBuiltinPreferences: jest.fn() }));
jest.mock("@/utils/appPaths", () => ({
  copilotAppDataDir: () => "/tmp/copilot",
  getVaultId: () => "test-vault",
}));
jest.mock("./backends/registry", () => ({
  backendRegistry: {},
  listBackendDescriptors: () => mockDescriptors,
}));
jest.mock("./session/AgentChatPersistenceManager", () => ({
  AgentChatPersistenceManager: jest.fn(),
}));
jest.mock("./session/AgentModelPreloader", () => ({ AgentModelPreloader: jest.fn() }));
jest.mock("./session/AgentSessionIndex", () => ({ AgentSessionIndex: jest.fn() }));
jest.mock("./session/nodeFileStorage", () => ({
  createNodeFileStorage: jest.fn(),
  createNodeSnapshotStorage: jest.fn(),
}));
jest.mock("./session/AgentSessionManager", () => ({
  AgentSessionManager: jest.fn(() => mockManager),
}));
jest.mock("./skills", () => ({
  SkillManager: {
    initialize: (_app: App, _dirs: unknown, runtime: BuiltinSkillRuntime) => {
      mockRuntime = runtime;
      return { refresh: mockRefresh };
    },
  },
}));
jest.mock("./skills/builtin/reconcileBuiltinSkills", () => ({
  ...jest.requireActual("./skills/builtin/reconcileBuiltinSkills"),
  reconcileBuiltinSkills: jest.fn(),
}));
jest.mock("./skills/builtin/buildBuiltinSeedFs", () => ({ buildBuiltinSeedFs: jest.fn() }));
jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: jest.fn(),
}));
jest.mock("./ui/permissionPrompter", () => ({
  createDefaultPermissionPrompter: jest.fn(),
  createDefaultAskUserQuestionPrompter: jest.fn(),
}));
jest.mock("./ui/CopilotAgentView", () => ({}));
jest.mock("./ui/AgentExtensionsSettings", () => ({}));
jest.mock("./ui/useBackendDescriptor", () => ({}));
jest.mock("@/components/ui/ModelEnableList", () => ({}));
jest.mock("./ui/PlanPreviewView", () => ({}));
jest.mock("./ui/ReportIssueModal", () => ({}));
jest.mock("./session/debugSink", () => ({}));
jest.mock("./session/useBackendAuthState", () => ({}));

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
const RELOAD_ISSUE = "https://github.com/Brevilabs/obsidian-copilot-private/issues/475";
type SettingsSubscriber = (prev: CopilotSettings, next: CopilotSettings) => void;
const mockSettingsSubscribers: SettingsSubscriber[] = [];
let mockSettings: CopilotSettings;
let mockRuntime: BuiltinSkillRuntime;
let mockState: InstallState;
let mockInstallListener: () => void;
const mockDescriptor = {
  id: "native",
  onPluginLoad: jest.fn(async (_plugin: CopilotPlugin) => {}),
  skillsProjectDir: ".native/skills",
  getInstallState: () => mockState,
  subscribeInstallState: (_plugin: unknown, listener: () => void) => {
    mockInstallListener = listener;
  },
};
const mockDescriptors = [mockDescriptor];
const mockRefresh = jest.fn<Promise<unknown>, unknown[]>();
const mockManager = {
  preloadModels: jest.fn(async () => {}),
  noteSpawnConfigChanged: jest.fn(async (_id: string, _reason: string) => {}),
  registerPreload: jest.fn<void, [string, Promise<void>]>(),
  onInstallStateChanged: jest.fn(async (_id: string) => {}),
};
let plugin: CopilotPlugin;
const reconcile = jest.mocked(reconcileBuiltinSkills);

function emitSettingsChange(next: CopilotSettings): void {
  const prev = mockSettings;
  mockSettings = next;
  for (const subscriber of mockSettingsSubscribers) subscriber(prev, next);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function startManager(app = {} as App): Promise<AgentSessionManager> {
  const manager = createAgentSessionManager(app, plugin);
  await mockManager.registerPreload.mock.calls[0][1];
  return manager;
}

describe("agentMode", () => {
  describe("createAgentSessionManager()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      mockState = { kind: "ready", source: "custom" };
      reconcile.mockResolvedValue(undefined);
      jest.mocked(isObsidianCliEnabled).mockReturnValue(false);
      mockRefresh.mockImplementation(() => mockRuntime.prepare("copilot/skills"));
      mockSettingsSubscribers.length = 0;
      mockSettings = {
        copilotFolder: "copilot",
        agentMode: { skills: {}, backends: {} },
        providers: {},
        configuredModels: [],
        backends: { native: { enabledModels: ["native-haiku"] } },
      } as unknown as CopilotSettings;
      plugin = {} as CopilotPlugin;
    });

    afterEach(async () => {
      await Promise.all(mockManager.registerPreload.mock.calls.map(([, ready]) => ready));
    });

    it("skips startup model preloading when the agent is disabled", () => {
      mockSettings.agentMode.backends.native = { enabled: false };
      createAgentSessionManager({} as App, plugin);
      expect(mockManager.registerPreload).not.toHaveBeenCalled();
      expect(mockManager.preloadModels).not.toHaveBeenCalled();
    });

    it(`waits for initial skill reconciliation before preloading Scribe ${ISSUE}`, async () => {
      const gate = deferred();
      reconcile.mockReturnValue(gate.promise);
      expect(createAgentSessionManager({} as App, plugin)).toBe(mockManager);
      expect(reconcile).toHaveBeenCalledWith(
        expect.objectContaining({ availableAgents: ["native"], registeredAgents: ["native"] })
      );
      expect(mockManager.preloadModels).not.toHaveBeenCalled();
      gate.resolve();
      await mockManager.registerPreload.mock.calls[0][1];
      expect(mockManager.preloadModels).toHaveBeenCalledTimes(1);
      expect(mockManager.preloadModels).toHaveBeenCalledWith("native");
    });

    it("waits for Scribe installation checks before preloading its models https://github.com/Brevilabs/obsidian-copilot-private/issues/530", async () => {
      const check = deferred();
      mockDescriptor.onPluginLoad.mockReturnValueOnce(check.promise);
      createAgentSessionManager({} as App, plugin);
      expect(mockManager.preloadModels).not.toHaveBeenCalled();
      check.resolve();
      await mockManager.registerPreload.mock.calls[0][1];
      expect(mockManager.preloadModels).toHaveBeenCalledWith("native");
    });

    it("does not refresh installation writes while startup owns the installation check https://github.com/Brevilabs/obsidian-copilot-private/issues/530", async () => {
      const check = deferred();
      mockDescriptor.onPluginLoad.mockReturnValueOnce(check.promise);
      createAgentSessionManager({} as App, plugin);
      mockInstallListener();
      check.resolve();
      await mockManager.registerPreload.mock.calls[0][1];
      expect(mockManager.onInstallStateChanged).not.toHaveBeenCalled();
    });

    it("preloads Scribe when its startup check discovers a ready installation https://github.com/Brevilabs/obsidian-copilot-private/issues/530", async () => {
      mockState = { kind: "checking", source: "custom" };
      mockDescriptor.onPluginLoad.mockImplementationOnce(async () => {
        mockState = { kind: "ready", source: "custom" };
      });
      await startManager();
      expect(mockManager.preloadModels).toHaveBeenCalledWith("native");
    });

    it.each(["reported", "rejected"])(
      `still preloads Scribe after a %s initial refresh failure ${ISSUE}`,
      async (failure) => {
        if (failure === "reported") mockRefresh.mockResolvedValueOnce({ ok: false });
        else mockRefresh.mockRejectedValueOnce(new Error("Disk unavailable"));
        await startManager();
        expect(mockManager.preloadModels).toHaveBeenCalledWith("native");
      }
    );

    it(`does not preload models while Scribe is unavailable ${ISSUE}`, async () => {
      mockState = { kind: "absent" };
      await startManager();
      expect(mockManager.preloadModels).not.toHaveBeenCalled();
      expect(reconcile).toHaveBeenCalledWith(expect.objectContaining({ availableAgents: [] }));
    });

    it("refreshes skills before Scribe starts when Obsidian's command line interface toggle changes, and still starts if the refresh fails https://github.com/Brevilabs/obsidian-copilot-private/issues/726", async () => {
      await startManager();
      const { beforeBackendStart } = jest.mocked(AgentSessionManager).mock.calls[0][2];
      const passes = reconcile.mock.calls.length;

      await beforeBackendStart!("native");
      expect(reconcile).toHaveBeenCalledTimes(passes);

      jest.mocked(isObsidianCliEnabled).mockReturnValue(true);
      await beforeBackendStart!("native");
      expect(reconcile).toHaveBeenCalledTimes(passes + 1);

      await beforeBackendStart!("native");
      expect(reconcile).toHaveBeenCalledTimes(passes + 1);

      mockRefresh.mockRejectedValueOnce(new Error("Disk unavailable"));
      jest.mocked(isObsidianCliEnabled).mockReturnValue(false);
      await expect(beforeBackendStart!("native")).resolves.toBeUndefined();
    });

    it(`settles skills before refreshing a newly available Scribe installation ${ISSUE}`, async () => {
      mockState = { kind: "absent" };
      await startManager();
      const gate = deferred();
      const handled = deferred();
      reconcile.mockReturnValueOnce(gate.promise);
      mockManager.onInstallStateChanged.mockImplementationOnce(async () => handled.resolve());
      mockState = { kind: "ready", source: "custom" };
      mockInstallListener();
      expect(reconcile).toHaveBeenLastCalledWith(
        expect.objectContaining({ availableAgents: ["native"] })
      );
      expect(mockManager.onInstallStateChanged).not.toHaveBeenCalled();
      gate.resolve();
      await handled.promise;
      expect(mockManager.onInstallStateChanged).toHaveBeenCalledWith("native");
    });

    it(`refreshes built-in skills after their preferences change without restarting Scribe ${RELOAD_ISSUE}`, async () => {
      await startManager();
      const refreshed = deferred();
      mockRefresh.mockImplementationOnce(async () => refreshed.resolve());

      emitSettingsChange({
        ...mockSettings,
        agentMode: {
          ...mockSettings.agentMode,
          skills: {
            ...mockSettings.agentMode.skills,
            builtinPreferences: { "obsidian-cli": { disabled: true } },
          },
        },
      });

      await refreshed.promise;
      expect(mockRefresh).toHaveBeenCalledTimes(2);
      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
    });

    it(`refreshes skills after the shared folder changes without restarting Scribe ${RELOAD_ISSUE}`, async () => {
      await startManager();
      const refreshed = deferred();
      mockRefresh.mockImplementationOnce(async () => refreshed.resolve());

      emitSettingsChange({ ...mockSettings, copilotFolder: "shared-scribe" });

      await refreshed.promise;
      expect(mockRefresh).toHaveBeenCalledTimes(2);
      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
    });

    it(`does not restart Scribe for model lists or feedback-card preferences ${RELOAD_ISSUE}`, async () => {
      await startManager();

      emitSettingsChange({
        ...mockSettings,
        agentMode: { ...mockSettings.agentMode, offerFeedbackCards: true },
        backends: { ...mockSettings.backends, native: { enabledModels: [] } },
      });

      expect(mockManager.noteSpawnConfigChanged).not.toHaveBeenCalled();
    });

    it(`retains Scribe's available skills while rechecking a previously ready installation ${ISSUE}`, async () => {
      await startManager();
      mockState = { kind: "checking", source: "custom" };
      const handled = deferred();
      mockManager.onInstallStateChanged.mockImplementationOnce(async () => handled.resolve());
      mockInstallListener();
      await handled.promise;
      expect(reconcile).toHaveBeenLastCalledWith(
        expect.objectContaining({ availableAgents: ["native"] })
      );
    });
  });
});
