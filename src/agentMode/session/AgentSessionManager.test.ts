import { FileSystemAdapter, App, Notice, TFile } from "obsidian";
import { mockTFile } from "@/__tests__/mockObsidian";
import { join } from "node:path";
import { waitFor } from "@testing-library/react";
import { AgentSession, type AgentTask } from "./AgentSession";
import { buildNativeChatId } from "@/utils/nativeChatId";
import { AI_SENDER, CHAT_AGENT_VIEWTYPE, USER_SENDER } from "@/constants";
import { formatDateTime } from "@/utils";
import { playNotificationSound } from "@/utils/notificationSound";
import { AgentSessionIndex } from "./AgentSessionIndex";
import { AgentSessionManager } from "./AgentSessionManager";
import {
  AgentSessionSnapshots,
  type AgentSessionSnapshot,
} from "@/agentMode/session/AgentSessionSnapshots";
import { GLOBAL_SCOPE } from "./scope";
import {
  getSettings as mockedGetSettings,
  setSettings as mockedSetSettings,
} from "@/settings/model";
import * as projectsState from "@/projects/state";
import { buildProjectContext } from "@/context/manifestBuilder";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { type ProjectConfig } from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import type {
  AgentChatMessage,
  BackendProcess,
  BackendDescriptor,
  BackendId,
  BackendModelCatalog,
  BackendState,
  InstallState,
  SessionEvent,
} from "./types";

const mockBuildProjectContext = buildProjectContext as jest.Mock;
const getSettingsMock = mockedGetSettings as jest.Mock;
const setSettingsMock = mockedSetSettings as jest.Mock;
const noticeMock = Notice as unknown as jest.Mock;

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

const settingsChangeCallbacks = new Set<
  (prev: { agentMode: unknown }, next: { agentMode: unknown }) => void
>();

const ensureAgentsFileForDiscoverySpy = jest.fn<Promise<void>, unknown[]>(async () => undefined);
jest.mock("@/instructions/agentsFile", () => ({
  ...jest.requireActual("@/instructions/agentsFile"),
  ensureAgentsFileForDiscovery: (...a: unknown[]): Promise<void> =>
    ensureAgentsFileForDiscoverySpy(...a),
}));

const mockTouchProjectLastUsed = jest.fn(async () => undefined);
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: {
    getInstance: jest.fn(() => ({ touchProjectLastUsed: mockTouchProjectLastUsed })),
  },
}));

jest.mock("@/context/manifestBuilder", () => ({
  buildProjectContext: jest.fn(() => "<project_context>\n</project_context>"),
}));

let mockNotificationSound = true;

jest.mock("@/utils/notificationSound", () => ({
  playNotificationSound: jest.fn(),
}));

function mockDefaultSettings() {
  return {
    agentMode: {
      activeBackend: "native",
      backends: {},
      notificationSound: mockNotificationSound,
      notificationSoundId: "piano",
    },
  };
}

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(mockDefaultSettings),
  setSettings: jest.fn(),
  subscribeToSettingsChange: jest.fn(
    (cb: (prev: { agentMode: unknown }, next: { agentMode: unknown }) => void) => {
      settingsChangeCallbacks.add(cb);
      return () => settingsChangeCallbacks.delete(cb);
    }
  ),
  settingsStore: { get: jest.fn(() => ({})), set: jest.fn() },
}));

function emitSettingsChange(prev: { agentMode: unknown }, next: { agentMode: unknown }): void {
  for (const cb of settingsChangeCallbacks) cb(prev, next);
}

function mockSavedDefault(saved: { baseModelId: string; effort: string | null } | null): void {
  getSettingsMock.mockReturnValue({
    agentMode: {
      activeBackend: "native",
      backends: { native: { defaultModel: saved } },
      notificationSound: false,
      notificationSoundId: "piano",
    },
  });
}

function changeSavedDefault(
  from: { baseModelId: string; effort: string | null } | null,
  to: { baseModelId: string; effort: string | null } | null
): void {
  mockSavedDefault(to);
  emitSettingsChange(
    { agentMode: { backends: { native: { defaultModel: from } } } },
    { agentMode: { backends: { native: { defaultModel: to } } } }
  );
}

let mockBackendIsRunning = true;
const mockBackendShutdown = jest.fn(async () => undefined);
const mockBackendStart = jest.fn(async () => undefined);
const mockBackendExitListeners = new Set<() => void>();
const mockSetPermissionPrompter = jest.fn();
let mockUnhealthyHandler: (() => void) | null = null;

function makeMockBackendProcess() {
  return {
    start: mockBackendStart,
    setPermissionPrompter: mockSetPermissionPrompter,
    setUnhealthyHandler: (handler: () => void) => {
      mockUnhealthyHandler = handler;
    },
    onExit: (fn: () => void) => {
      mockBackendExitListeners.add(fn);
      return () => mockBackendExitListeners.delete(fn);
    },
    isRunning: () => mockBackendIsRunning,
    shutdown: mockBackendShutdown,
    closeSession: jest.fn(async (_params: { sessionId: string }) => undefined),
    registerSessionHandler: jest.fn(() => () => {}),
  };
}

const mockSessionDispose = jest.fn(async () => undefined);
const mockSessionCancel = jest.fn(async () => undefined);
let nextBackendSessionId = 1;

type MockSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

interface MockSessionTestHandle {
  setStatus(status: MockSessionStatus): void;
  setMessages(
    messages: Array<{ message: string } & Partial<AgentChatMessage>>,
    notify?: boolean
  ): void;
  setHasUserVisibleMessages(value: boolean): void;
  setTaskStatuses(statuses: AgentTask["status"][], kinds?: AgentTask["kind"][]): void;
  setPendingPermissionCount(count: number): void;
  setQueuedPromptCount(count: number): void;
  disconnect(): void;
}

const sessionTestHandles = new Map<string, MockSessionTestHandle>();

function getSessionTestHandle(session: AgentSession): MockSessionTestHandle {
  const handle = sessionTestHandles.get(session.internalId);
  if (!handle) throw new Error(`No test handle for ${session.internalId}`);
  return handle;
}

function makeMockSession(overrides: {
  internalId: string;
  chatInputId?: string;
  backendSessionId?: string;
  backendId: string;
  backend?: BackendProcess;
  projectId?: string;
  cwd?: string;
  ready?: Promise<void>;
  label?: string;
}): AgentSession {
  const sessionId = overrides.backendSessionId ?? `backend-${nextBackendSessionId++}`;
  let label: string | null = overrides.label ?? null;
  let labelSource: "user" | "agent" | null = overrides.label ? "agent" : null;
  let status: MockSessionStatus = "idle";
  let needsAttention = false;
  let backendSuspended = false;
  let displayMessages: { message: string }[] = [];
  let hasUserVisibleMessages = false;
  let tasks: AgentTask[] = [];
  let pendingPermissions: unknown[] = [];
  let queuedPrompts: unknown[] = [];
  const listeners = new Set<{
    onMessagesChanged?: () => void;
    onStatusChanged?: (s: typeof status) => void;
    onNeedsAttentionChanged?: (v: boolean) => void;
    onTasksChanged?: () => void;
    onDisconnected?: () => void;
  }>();
  const session = {
    internalId: overrides.internalId,
    chatInputId: overrides.chatInputId ?? overrides.internalId,
    backendId: overrides.backendId,
    projectId: overrides.projectId ?? GLOBAL_SCOPE,
    cwd: overrides.cwd ?? null,
    ready: overrides.ready ?? Promise.resolve(),
    getBackendSessionId: () => sessionId,
    isBackendSuspended: () => backendSuspended,
    suspendBackend: jest.fn(() => {
      backendSuspended = true;
    }),
    resumeBackend: jest.fn(async () => {
      backendSuspended = false;
    }),
    withdrawPrompt: jest.fn(async (id: string) => {
      queuedPrompts = queuedPrompts.filter((prompt) => (prompt as { id: string }).id !== id);
    }),
    getStatus: () => status,
    isReplyRunning: () => status === "running",
    restoreBranchState: jest.fn(),
    getBranchState: () => null,
    store: { getDisplayMessages: () => displayMessages, fillMissingTimestamps: jest.fn() },
    cancel: mockSessionCancel,
    backend: overrides.backend,
    backendSessionId: sessionId,
    releaseBackendSession: AgentSession.prototype.releaseBackendSession,
    dispose: mockSessionDispose,
    setModel: jest.fn(),
    setMode: jest.fn(),
    setConfigOption: jest.fn(),
    getLabel: () => label,
    getLabelSource: () => labelSource,
    restoreLabel: (next: string, source: "user" | "agent") => {
      label = next;
      labelSource = source;
    },
    setLabel: jest.fn(),
    loadDisplayMessages: jest.fn((messages) => {
      displayMessages = messages;
      hasUserVisibleMessages = messages.length > 0;
    }),
    seedSessionUsage: jest.fn(),
    resendSavedHistoryOnNextTurn: jest.fn(),
    getSessionUsage: () => null,
    subscribe: (l: Parameters<typeof listeners.add>[0]) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    hasUserVisibleMessages: () => hasUserVisibleMessages,
    getState: () => null,
    getRawSnapshot: () => ({ models: null, modes: null, configOptions: null }),
    getTasks: () => tasks,
    getTaskSnapshots: () => tasks.map((task) => ({ task, messages: [] })),
    rememberTaskOutput: (toolCallId: string, output: { text: string; truncated: boolean }) => {
      tasks = tasks.map((task) =>
        task.toolCallId === toolCallId ? { ...task, savedOutput: output } : task
      );
    },
    restoreTaskSnapshots: jest.fn(),
    getPendingToolPermissions: () => pendingPermissions,
    getQueuedPrompts: () => queuedPrompts,
    getNeedsAttention: () => needsAttention,
    markNeedsAttention: () => {
      if (needsAttention) return;
      needsAttention = true;
      for (const l of listeners) l.onNeedsAttentionChanged?.(true);
    },
    clearNeedsAttention: () => {
      if (!needsAttention) return;
      needsAttention = false;
      for (const l of listeners) l.onNeedsAttentionChanged?.(false);
    },
  } as unknown as AgentSession;
  sessionTestHandles.set(overrides.internalId, {
    setStatus: (next) => {
      if (status === next) return;
      status = next;
      for (const l of listeners) l.onStatusChanged?.(next);
    },
    setMessages: (messages, notify = false) => {
      displayMessages = messages;
      if (notify) for (const l of listeners) l.onMessagesChanged?.();
    },
    setHasUserVisibleMessages: (value) => {
      hasUserVisibleMessages = value;
    },
    setTaskStatuses: (statuses, kinds = []) => {
      tasks = statuses.map((taskStatus, i) => ({
        taskId: `task-${i}`,
        toolCallId: `tool-${i}`,
        kind: kinds[i] ?? "subagent",
        description: `Task ${i}`,
        status: taskStatus,
      }));
      for (const l of listeners) l.onTasksChanged?.();
    },
    setPendingPermissionCount: (count) => {
      pendingPermissions = Array.from({ length: count }, (_, i) => ({ id: i }));
    },
    setQueuedPromptCount: (count) => {
      queuedPrompts = Array.from({ length: count }, (_, i) => ({ id: `prompt-${i}` }));
    },
    disconnect: () => {
      for (const l of listeners) l.onDisconnected?.();
    },
  });
  return session;
}

const sessionCreateSpy = jest.spyOn(AgentSession, "start").mockImplementation((opts) =>
  makeMockSession({
    internalId: opts.internalId,
    chatInputId: opts.chatInputId,
    backendId: opts.backendId,
    backend: opts.backend,
    projectId: opts.projectId,
    cwd: opts.cwd ?? undefined,
  })
);

type MockAgentChatFocus =
  | "none"
  | "inside"
  | "inside-sidebar"
  | "outside"
  | "other-leaf"
  | "unfocused-window";
let mockAgentChatFocus: MockAgentChatFocus = "none";

function buildWorkspace(): unknown {
  const inside = {} as Element;
  const outside = {} as Element;
  const ownerDocument = {
    hasFocus: () => mockAgentChatFocus !== "unfocused-window",
    get activeElement() {
      return ["inside", "inside-sidebar", "unfocused-window"].includes(mockAgentChatFocus)
        ? inside
        : outside;
    },
  } as Document;
  const containerEl = {
    doc: ownerDocument,
    ownerDocument,
    contains: (element: Element | null) => element === inside,
  } as HTMLElement;
  const chatLeaf = {
    view: {
      containerEl,
      getViewType: () => CHAT_AGENT_VIEWTYPE,
    },
  };
  const otherLeaf = {
    view: {
      containerEl: { ownerDocument } as HTMLElement,
      getViewType: () => "markdown",
    },
  };
  return {
    getMostRecentLeaf: jest.fn(() => {
      if (mockAgentChatFocus === "none") return null;
      if (["inside-sidebar", "other-leaf"].includes(mockAgentChatFocus)) return otherLeaf;
      return chatLeaf;
    }),
    getLeavesOfType: jest.fn((viewType: string) =>
      viewType === CHAT_AGENT_VIEWTYPE ? [chatLeaf] : []
    ),
    getActiveFile: jest.fn(() => null),
  };
}

function buildApp(basePath = "/vault"): App {
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(basePath);
  const events = {
    on: jest.fn(() => ({}) as never),
    offref: jest.fn(),
  };
  const vaultFiles = {
    getAbstractFileByPath: jest.fn(() => null),
    getFiles: jest.fn(() => []),
    create: jest.fn(),
    read: jest.fn(async () => ""),
    modify: jest.fn(),
  };
  return {
    vault: { adapter, ...events, ...vaultFiles },
    metadataCache: { ...events },
    workspace: buildWorkspace(),
  } as unknown as App;
}

function buildDescriptor(overrides: Record<string, unknown> = {}): BackendDescriptor {
  return {
    id: "native",
    displayName: "native",
    summarizesSessionTitle: true,
    getInstallState: jest.fn(() => ({ kind: "ready" })),
    subscribeInstallState: jest.fn(),
    openInstallUI: jest.fn(),
    createBackendProcess: jest.fn(() => makeMockBackendProcess()),
    ...overrides,
  } as unknown as BackendDescriptor;
}

function buildApplySelectionDescriptor(applySelection: jest.Mock): BackendDescriptor {
  return buildDescriptor({
    getInstallState: jest.fn(() => ({ kind: "ready", source: "custom" })),
    wire: {
      encode: ({ baseModelId, effort }: { baseModelId: string; effort: string | null }) =>
        effort ? `${baseModelId}/${effort}` : baseModelId,
      decode: (id: string) => ({ selection: { baseModelId: id, effort: null }, provider: null }),
    },
    applySelection,
  });
}

function modelCatalog(baseModelId: string): BackendModelCatalog {
  return {
    availableModels: [{ baseModelId, name: baseModelId, provider: null, effortOptions: [] }],
  };
}

type ManagerDeps = ConstructorParameters<typeof AgentSessionManager>[2];

interface ManagerOptions {
  app?: App;
  plugin?: unknown;
  descriptor?: BackendDescriptor;
  preloader?: Record<string, unknown>;
  persistence?: unknown;
  sessionIndex?: AgentSessionIndex;
  sessionSnapshots?: AgentSessionSnapshots;
  taskOutputReader?: ManagerDeps["taskOutputReader"];
  beforeBackendStart?: ManagerDeps["beforeBackendStart"];
}

const builtManagers: AgentSessionManager[] = [];

function buildManager(options: ManagerOptions = {}): AgentSessionManager {
  const descriptor = options.descriptor ?? buildDescriptor();
  const manager = new AgentSessionManager(
    options.app ?? buildApp(),
    (options.plugin ?? {
      manifest: { version: "1.0.0" },
    }) as ConstructorParameters<typeof AgentSessionManager>[1],
    {
      permissionPrompter: jest.fn(),
      resolveDescriptor: (id) => (id === descriptor.id ? descriptor : undefined),
      modelPreloader: {
        getCachedModelCatalog: jest.fn(() => null),
        getEffortCatalog: jest.fn(() => null),
        preload: jest.fn(async () => undefined),
        refresh: jest.fn(() => null),
        subscribe: jest.fn(() => () => {}),
        shutdown: jest.fn(),
        clearCached: jest.fn(),
        stop: jest.fn(async () => undefined),
        takeWarm: jest.fn(() => null),
        getWarmProcs: jest.fn(() => []),
        ...options.preloader,
      } as unknown as ManagerDeps["modelPreloader"],
      persistenceManager: options.persistence as ManagerDeps["persistenceManager"],
      sessionIndex: options.sessionIndex,
      sessionSnapshots: options.sessionSnapshots,
      taskOutputReader: options.taskOutputReader,
      beforeBackendStart: options.beforeBackendStart,
    }
  );
  builtManagers.push(manager);
  return manager;
}

function seedProjects(...ids: string[]): void {
  projectsState.updateCachedProjectRecords(
    ids.map(
      (id) =>
        ({
          project: { id },
          filePath: `Projects/${id}/project.md`,
          folderName: id,
        }) as unknown as ProjectFileRecord
    )
  );
}

const flushTimers = () => new Promise((resolve) => window.setTimeout(resolve, 0));

function nativeIdOf(session: AgentSession): string {
  return buildNativeChatId(session.backendId, session.getBackendSessionId()!);
}

function endTurn(session: AgentSession, endStatus: MockSessionStatus = "idle"): void {
  const handle = getSessionTestHandle(session);
  handle.setStatus("running");
  handle.setStatus(endStatus);
}

async function createActiveAndBackgroundSessions(
  mgr: AgentSessionManager
): Promise<{ active: AgentSession; background: AgentSession }> {
  const active = await mgr.createSession();
  const background = await mgr.createSession();
  mgr.setActiveSession(active.internalId);
  return { active, background };
}

function untilClosed(mgr: AgentSessionManager, session: AgentSession): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = mgr.subscribe(() => {
      if (mgr.getSessions().includes(session)) return;
      unsubscribe();
      resolve();
    });
  });
}

function closedSessions(): unknown[] {
  return mockSessionCancel.mock.contexts;
}

async function hideChats(mgr: AgentSessionManager, count: number): Promise<AgentSession[]> {
  const chats: AgentSession[] = [];
  for (let i = 0; i < count; i++) chats.push(await mgr.createSession());
  await mgr.createSession();
  for (const chat of chats) mgr.detachSessionFromTab(chat.internalId);
  return chats;
}

async function enterWithConversation(
  mgr: AgentSessionManager,
  projectId: string
): Promise<AgentSession> {
  await mgr.enterProject(projectId);
  const session = mgr.getActiveSession()!;
  getSessionTestHandle(session).setHasUserVisibleMessages(true);
  await mgr.exitProject();
  return session;
}

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function buildResumeOnlyBackend(overrides: Record<string, unknown> = {}) {
  return {
    ...makeMockBackendProcess(),
    loadSession: jest.fn(async () => {
      throw new MethodUnsupportedError("session/load");
    }),
    resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      state: { model: null, mode: null },
    })),
    ...overrides,
  };
}

function holdNextBackendShutdown(): { started: Promise<void>; release: () => void } {
  let release!: () => void;
  const started = new Promise<void>((resolveStarted) => {
    mockBackendShutdown.mockImplementationOnce(
      () =>
        new Promise<undefined>((resolve) => {
          resolveStarted();
          release = () => resolve(undefined);
        })
    );
  });
  return { started, release: () => release() };
}

type ReplayFrame = SessionEvent["update"];

function buildReplayingBackend(
  opts: {
    onLoad?: (emit: (update: ReplayFrame) => void) => void;
    loadSession?: jest.Mock;
    resumeSession?: jest.Mock;
  } = {}
) {
  const handlers = new Map<string, (event: SessionEvent) => void>();
  const buffered: SessionEvent[] = [];
  const unregister = jest.fn();
  const handlerCountAtOpen: Record<"load" | "resume", number> = { load: -1, resume: -1 };
  const deliver = (sessionId: string, update: ReplayFrame) => {
    const handler = handlers.get(sessionId);
    if (handler) handler({ sessionId, update });
    else buffered.push({ sessionId, update });
  };
  const state = { model: null, mode: null };
  const backend = {
    ...makeMockBackendProcess(),
    registerSessionHandler: jest.fn((sessionId: string, handler: (event: SessionEvent) => void) => {
      handlers.set(sessionId, handler);
      for (const event of buffered.splice(0)) handler(event);
      return unregister;
    }),
    loadSession:
      opts.loadSession ??
      jest.fn(async ({ sessionId }: { sessionId: string }) => {
        handlerCountAtOpen.load = handlers.size;
        opts.onLoad?.((update) => deliver(sessionId, update));
        return { sessionId, state };
      }),
    resumeSession:
      opts.resumeSession ??
      jest.fn(async ({ sessionId }: { sessionId: string }) => {
        handlerCountAtOpen.resume = handlers.size;
        return { sessionId, state };
      }),
  };
  return { backend, unregister, handlerCountAtOpen, emit: deliver };
}

const replayChunk = (
  sessionUpdate: "user_message_chunk" | "agent_message_chunk",
  text: string,
  messageId: string
): ReplayFrame => ({ sessionUpdate, content: { type: "text", text }, messageId });

function senderAndText(session: AgentSession): [string, string][] {
  return session.store.getDisplayMessages().map((m) => [m.sender, m.message]);
}

function buildManagerWithReplay(
  backendOverrides: Record<string, unknown> = {},
  descriptorOverrides: Partial<BackendDescriptor> = {}
): AgentSessionManager {
  const backend = {
    ...makeMockBackendProcess(),
    loadSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
      sessionId,
      state: { model: null, mode: null },
    })),
    ...backendOverrides,
  };
  return buildManager({
    descriptor: buildDescriptor({ createBackendProcess: () => backend, ...descriptorOverrides }),
  });
}

function readPersistedDefault(
  setSettings: jest.Mock,
  backendId: string
): { baseModelId: string; effort: string | null } | undefined {
  let backends: Record<string, { defaultModel?: { baseModelId: string; effort: string | null } }> =
    {};
  for (const call of setSettings.mock.calls) {
    const updater = call[0];
    if (typeof updater !== "function") continue;
    const patch = updater({ agentMode: { backends } });
    if (patch?.agentMode?.backends) {
      backends = { ...backends, ...patch.agentMode.backends };
    }
  }
  return backends[backendId]?.defaultModel;
}

function savedNoteFixture() {
  jest.useFakeTimers();
  getSettingsMock.mockReturnValue({ ...getSettingsMock(), autosaveChat: true });
  const saveSession = jest.fn(
    async (): Promise<{ path: string } | null> => ({
      path: "chats/saved.md",
    })
  );
  const setPinnedAt = jest.fn(async () => undefined);
  return {
    mgr: buildManager({ persistence: { saveSession, setPinnedAt } }),
    saveSession,
    setPinnedAt,
  };
}

beforeEach(() => {
  mockBackendIsRunning = true;
  mockNotificationSound = true;
  mockAgentChatFocus = "none";
  (playNotificationSound as jest.Mock).mockClear();
  mockBackendStart.mockClear();
  mockBackendShutdown.mockClear();
  mockSetPermissionPrompter.mockClear();
  mockUnhealthyHandler = null;
  mockBackendExitListeners.clear();
  mockSessionCancel.mockClear();
  mockSessionDispose.mockClear();
  sessionCreateSpy.mockClear();
  nextBackendSessionId = 1;
  settingsChangeCallbacks.clear();
  getSettingsMock.mockImplementation(mockDefaultSettings);
  setSettingsMock.mockReset();
  noticeMock.mockClear();
  mockBuildProjectContext.mockClear();
  mockTouchProjectLastUsed.mockClear();
  ensureAgentsFileForDiscoverySpy.mockClear();
  projectsState.updateCachedProjectRecords([]);
});

afterEach(async () => {
  jest.useRealTimers();
  await Promise.all(builtManagers.splice(0).map((mgr) => mgr.shutdown().catch(() => {})));
  projectsState.updateCachedProjectRecords([]);
});

const MockTFile = TFile as unknown as new (path: string) => TFile & {
  stat: { ctime: number; mtime: number };
};

interface FakeFrontmatter {
  epoch?: number;
  topic?: string;
  backendId?: string;
  sessionId?: string;
  lastAccessedAt?: number;
  projectId?: string;
  pinnedAt?: number;
}

function makeIndexStorage() {
  const files = new Map<string, string>();
  return {
    exists: async (p: string) => files.has(p),
    read: async (p: string) => {
      const content = files.get(p);
      if (content === undefined) throw new Error(`ENOENT: ${p}`);
      return content;
    },
    write: async (p: string, c: string) => {
      files.set(p, c);
    },
  };
}

function buildHistoryHarness(opts?: {
  files?: Record<string, FakeFrontmatter>;
  hiddenFiles?: Record<string, string>;
  listSessions?: jest.Mock;
  warmListSessions?: jest.Mock;
  warmSessionExistsLocally?: jest.Mock;
  indexStorage?: ReturnType<typeof makeIndexStorage>;
  probeSessionId?: string;
  summarizesSessionTitle?: boolean;
  backendId?: BackendId;
  installState?: InstallState;
  createBackendProcess?: jest.Mock;
  applyInitialSessionConfig?: BackendDescriptor["applyInitialSessionConfig"];
  sessionSnapshots?: AgentSessionSnapshots;
}) {
  const frontmatterByPath = opts?.files ?? {};
  const hiddenByPath = opts?.hiddenFiles ?? {};
  const tfiles = [...Object.keys(frontmatterByPath), ...Object.keys(hiddenByPath)].map((p) => {
    const f = new MockTFile(p);
    f.stat = { ctime: 1_000, mtime: 1_000, size: 0 };
    return f;
  });
  const adapter = new (FileSystemAdapter as unknown as new (basePath: string) => unknown)(
    "/vault"
  ) as { read: jest.Mock };
  adapter.read.mockImplementation(async (p: string) => {
    const content = hiddenByPath[p];
    if (content === undefined) throw new Error(`ENOENT: ${p}`);
    return content;
  });
  const app = {
    vault: {
      adapter,
      getAbstractFileByPath: (p: string) =>
        tfiles.find((f: { path: string }) => f.path === p) ?? null,
      on: jest.fn(() => ({}) as never),
      offref: jest.fn(),
    },
    metadataCache: {
      getCache: (path: string) =>
        frontmatterByPath[path] ? { frontmatter: frontmatterByPath[path] } : null,
      getFileCache: (file: { path: string }) => {
        const fm = frontmatterByPath[file.path];
        return fm ? { frontmatter: fm } : null;
      },
      on: jest.fn(() => ({}) as never),
      offref: jest.fn(),
    },
  } as unknown as App;
  const plugin = {
    manifest: { version: "1.0.0" },
    getChatHistoryLastAccessedAtManager: () => ({
      getEffectiveLastUsedAt: (_path: string, fallback: number) => fallback,
    }),
  };
  const persistence = {
    getAgentChatHistoryFiles: jest.fn(async () => tfiles),
    updateTopic: jest.fn(async () => undefined),
    deleteFile: jest.fn(async () => undefined),
    saveSession: jest.fn(async () => ({ path: "chats/agent__saved.md" })),
    setPinnedAt: jest.fn(async () => undefined),
  };
  const indexStorage = opts?.indexStorage ?? makeIndexStorage();
  const index = new AgentSessionIndex(indexStorage, "plugins/scribe/index.json");
  const backendId = opts?.backendId ?? "native";
  const descriptor = buildDescriptor({
    id: backendId,
    getInstallState: jest.fn(() => opts?.installState ?? { kind: "ready", source: "custom" }),
    summarizesSessionTitle: opts?.summarizesSessionTitle ?? true,
    getProbeSessionId: jest.fn(() => opts?.probeSessionId),
    applyInitialSessionConfig: opts?.applyInitialSessionConfig,
    ...(opts?.createBackendProcess
      ? { createBackendProcess: opts.createBackendProcess }
      : opts?.listSessions
        ? {
            createBackendProcess: jest.fn(() => ({
              ...makeMockBackendProcess(),
              listSessions: opts.listSessions,
            })),
          }
        : {}),
  });
  const manager = buildManager({
    app,
    plugin,
    descriptor,
    persistence,
    sessionIndex: index,
    sessionSnapshots: opts?.sessionSnapshots,
    preloader: {
      getWarmProcs: jest.fn(() => {
        if (!opts?.warmListSessions && !opts?.warmSessionExistsLocally) return [];
        const proc: Record<string, unknown> = { ...makeMockBackendProcess() };
        if (opts.warmListSessions) proc.listSessions = opts.warmListSessions;
        if (opts.warmSessionExistsLocally)
          proc.sessionExistsLocally = opts.warmSessionExistsLocally;
        return [{ backendId, proc }];
      }),
    },
  });
  return { manager, index, persistence, descriptor };
}

const HISTORY_PROJECT_ID = "proj-1";

function snapshotFixture(overrides: Partial<AgentSessionSnapshot> = {}): AgentSessionSnapshot {
  return {
    version: 1,
    chatId: "stable-chat",
    backendId: "native",
    sessionId: "saved-chat",
    projectId: GLOBAL_SCOPE,
    savedAtMs: 1000,
    label: "Saved title",
    branch: null,
    messages: [
      { id: "u1", sender: USER_SENDER, message: "Review", timestamp: null, isVisible: true },
      {
        id: "a1",
        sender: AI_SENDER,
        message: "Reviewed",
        timestamp: null,
        isVisible: true,
        turnStopReason: "end_turn",
        turnDurationMs: 5200,
      },
    ],
    tasks: [
      {
        task: {
          toolCallId: "old-task",
          kind: "command",
          description: "Check",
          status: "completed",
          savedOutput: { text: "passed", truncated: false },
        },
        messages: [],
      },
    ],
    ...overrides,
  };
}

function snapshotHarness() {
  const files = new Map<string, string>();
  const snapshots = new AgentSessionSnapshots(
    {
      exists: async (path) => files.has(path),
      read: async (path) => files.get(path)!,
      write: async (path, content) => {
        files.set(path, content);
      },
      remove: async (path) => {
        files.delete(path);
      },
    },
    "/snapshots",
    () => null
  );
  return { snapshots, files };
}

describe("AgentSessionManager", () => {
  describe("AgentSessionManager", () => {
    describe("flushSessionSnapshot", () => {
      it("persists the full visible chat even when Markdown autosave is disabled", async () => {
        const { snapshots } = snapshotHarness();
        const manager = buildManager({ sessionSnapshots: snapshots });
        const session = await manager.createSession();
        const handle = getSessionTestHandle(session);
        handle.setHasUserVisibleMessages(true);
        handle.setMessages(snapshotFixture().messages);

        await manager.flushSessionSnapshot(session);

        expect(
          await snapshots.load(session.backendId, session.getBackendSessionId()!)
        ).toMatchObject({ chatId: session.chatInputId, messages: snapshotFixture().messages });
      });

      it("saves background-only task changes without requiring a new main-chat message", async () => {
        jest.useFakeTimers();
        const { snapshots } = snapshotHarness();
        const save = jest.spyOn(snapshots, "save");
        const manager = buildManager({ sessionSnapshots: snapshots });
        const session = await manager.createSession();
        const handle = getSessionTestHandle(session);
        handle.setHasUserVisibleMessages(true);
        handle.setMessages(snapshotFixture().messages);
        handle.setTaskStatuses(["completed"]);

        await jest.advanceTimersByTimeAsync(500);

        expect(save).toHaveBeenCalledWith(
          expect.objectContaining({
            tasks: [{ task: expect.objectContaining({ status: "completed" }), messages: [] }],
          })
        );
      });

      it("captures the final terminal output and preserves it when the temporary output file disappears", async () => {
        const { snapshots } = snapshotHarness();
        let exists = true;
        const text = new TextEncoder().encode("tests passed\n");
        const manager = buildManager({
          sessionSnapshots: snapshots,
          taskOutputReader: {
            size: async () => (exists ? text.length : null),
            read: async () => text,
          },
        });
        const session = await manager.createSession();
        const handle = getSessionTestHandle(session);
        handle.setHasUserVisibleMessages(true);
        handle.setMessages(snapshotFixture().messages);
        const captured = [
          {
            task: {
              toolCallId: "command",
              kind: "command" as const,
              description: "Tests",
              status: "completed" as const,
              outputFile: "/tmp/output",
            } as AgentTask,
            messages: [],
          },
        ];
        jest.spyOn(session, "getTaskSnapshots").mockReturnValue(captured);
        jest.spyOn(session, "getTasks").mockReturnValue(captured.map((entry) => entry.task));
        jest.spyOn(session, "rememberTaskOutput").mockImplementation((_id, output) => {
          captured[0].task.savedOutput = output;
        });

        await manager.flushSessionSnapshot(session);
        exists = false;
        await manager.flushSessionSnapshot(session);

        expect(
          (await snapshots.load(session.backendId, session.getBackendSessionId()!))!.tasks[0].task
            .savedOutput!.text
        ).toBe("tests passed\n");
      });

      it("reports a save failure once, keeps the chat open, and allows a later successful retry", async () => {
        const { snapshots } = snapshotHarness();
        jest
          .spyOn(snapshots, "save")
          .mockRejectedValueOnce(new Error("disk full"))
          .mockRejectedValueOnce(new Error("disk full"));
        const manager = buildManager({ sessionSnapshots: snapshots });
        const session = await manager.createSession();
        getSessionTestHandle(session).setHasUserVisibleMessages(true);
        getSessionTestHandle(session).setMessages(snapshotFixture().messages);
        const prior = noticeMock.mock.calls.length;

        await expect(manager.flushSessionSnapshot(session)).rejects.toThrow("disk full");
        await expect(manager.flushSessionSnapshot(session)).rejects.toThrow("disk full");
        expect(noticeMock.mock.calls.length).toBe(prior + 1);
        expect(manager.getActiveSession()).toBe(session);
        await manager.flushSessionSnapshot(session);
        expect(
          await snapshots.load(session.backendId, session.getBackendSessionId()!)
        ).not.toBeNull();
      });
    });
    describe("constructor", () => {
      it("keeps a live chat's explicit model and reasoning when obsolete defaults change", async () => {
        const applySelection = jest.fn(async () => undefined);
        const manager = buildManager({ descriptor: buildApplySelectionDescriptor(applySelection) });
        const session = await manager.createSession();
        await session.ready;
        changeSavedDefault(null, { baseModelId: "opus", effort: "high" });
        changeSavedDefault({ baseModelId: "opus", effort: "high" }, null);
        expect(manager.getActiveSession()).toBe(session);
        expect(applySelection).not.toHaveBeenCalled();
      });
    });

    describe("noteExtensionsChanged", () => {
      it("does not restart or run new sessions on save, and refreshes the saved configuration on the next idle prompt", async () => {
        const refresh = jest.fn();
        const stop = jest.fn(async () => undefined);
        const create = jest.fn(() => ({
          ...makeMockBackendProcess(),
          refreshSessionConfiguration: refresh,
        }));
        const manager = buildManager({
          descriptor: buildDescriptor({ createBackendProcess: create }),
          preloader: { stop },
        });
        const session = await manager.createSession();
        await session.ready;
        const beforePrompt = sessionCreateSpy.mock.calls[0][0].beforePrompt!;
        getSessionTestHandle(session).setStatus("running");
        manager.noteExtensionsChanged("native");
        expect(create).toHaveBeenCalledTimes(1);
        expect(stop).toHaveBeenCalledWith("native");
        expect(refresh).not.toHaveBeenCalled();
        beforePrompt();
        expect(refresh).not.toHaveBeenCalled();
        getSessionTestHandle(session).setStatus("idle");
        beforePrompt();
        expect(refresh).toHaveBeenCalledWith(session.getBackendSessionId());
        beforePrompt();
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(manager.getActiveSession()).toBe(session);
        expect(create).toHaveBeenCalledTimes(1);
      });
    });

    describe("isExtensionChangePending", () => {
      it("reports no pending change before configuration is saved", async () => {
        const manager = buildManager();
        const session = await manager.createSession();
        await session.ready;
        expect(manager.isExtensionChangePending("native", { kind: "user" })).toBe(false);
      });
      it("reports a saved project change only for affected project chats", async () => {
        seedProjects("notes", "research");
        const manager = buildManager();
        const selected = await manager.createSession(undefined, "notes");
        const other = await manager.createSession(undefined, "research");
        await Promise.all([selected.ready, other.ready]);
        getSessionTestHandle(selected).setStatus("running");
        manager.noteExtensionsChanged("native", { kind: "project", cwd: selected.cwd! });
        expect(
          manager.isExtensionChangePending("native", { kind: "project", cwd: selected.cwd! })
        ).toBe(true);
        expect(
          manager.isExtensionChangePending("native", { kind: "project", cwd: other.cwd! })
        ).toBe(false);
        expect(
          manager.isExtensionChangePending("claude", { kind: "project", cwd: selected.cwd! })
        ).toBe(false);
      });
      it("keeps a user change pending after its page closes and clears it when the task finishes", async () => {
        const manager = buildManager();
        const session = await manager.createSession();
        await session.ready;
        getSessionTestHandle(session).setStatus("running");
        const controller = new AbortController();
        const applied = manager.applyExtensionChanges(
          "native",
          { kind: "user" },
          controller.signal
        );
        controller.abort();
        await expect(applied).rejects.toMatchObject({ name: "AbortError" });
        expect(manager.isExtensionChangePending("native", { kind: "user" })).toBe(true);
        expect(
          manager.isExtensionChangePending("native", { kind: "project", cwd: session.cwd! })
        ).toBe(true);
        getSessionTestHandle(session).setStatus("idle");
        expect(manager.isExtensionChangePending("native", { kind: "user" })).toBe(false);
      });
    });

    describe("applyExtensionChanges", () => {
      it("finishes immediately when a failed chat has no backend instance to refresh", async () => {
        const refresh = jest.fn();
        const manager = buildManager({
          descriptor: buildDescriptor({
            createBackendProcess: () => ({
              ...makeMockBackendProcess(),
              refreshSessionConfiguration: refresh,
            }),
          }),
        });
        const session = await manager.createSession();
        await session.ready;
        getSessionTestHandle(session).setStatus("error");
        jest.spyOn(session, "getBackendSessionId").mockReturnValue(null);
        await manager.applyExtensionChanges("native", { kind: "user" });
        expect(refresh).not.toHaveBeenCalled();
        expect(session.getStatus()).toBe("error");
      });
      it("waits for a running task to finish before refreshing its configuration", async () => {
        const refresh = jest.fn();
        const manager = buildManager({
          descriptor: buildDescriptor({
            createBackendProcess: () => ({
              ...makeMockBackendProcess(),
              refreshSessionConfiguration: refresh,
            }),
          }),
        });
        const session = await manager.createSession();
        await session.ready;
        getSessionTestHandle(session).setStatus("running");
        const applied = manager.applyExtensionChanges("native", { kind: "user" });
        expect(refresh).not.toHaveBeenCalled();
        getSessionTestHandle(session).setStatus("idle");
        await applied;
        expect(refresh).toHaveBeenCalledWith(session.getBackendSessionId());
        expect(manager.getActiveSession()).toBe(session);
      });
      it("waits for an idle chat's background task to finish before refreshing", async () => {
        const refresh = jest.fn();
        const manager = buildManager({
          descriptor: buildDescriptor({
            createBackendProcess: () => ({
              ...makeMockBackendProcess(),
              refreshSessionConfiguration: refresh,
            }),
          }),
        });
        const session = await manager.createSession();
        await session.ready;
        const handle = getSessionTestHandle(session);
        handle.setTaskStatuses(["running"]);
        const applied = manager.applyExtensionChanges("native", { kind: "user" });
        expect(refresh).not.toHaveBeenCalled();
        handle.setTaskStatuses(["completed"]);
        await applied;
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledWith(session.getBackendSessionId());
        expect(mockSessionCancel).not.toHaveBeenCalled();
      });
      it("refreshes only the selected project without waiting for another project's running chat", async () => {
        seedProjects("notes", "research");
        const refresh = jest.fn();
        const manager = buildManager({
          descriptor: buildDescriptor({
            createBackendProcess: () => ({
              ...makeMockBackendProcess(),
              refreshSessionConfiguration: refresh,
            }),
          }),
        });
        const selected = await manager.createSession(undefined, "notes");
        const other = await manager.createSession(undefined, "research");
        await Promise.all([selected.ready, other.ready]);
        getSessionTestHandle(other).setStatus("running");
        await manager.applyExtensionChanges("native", { kind: "project", cwd: selected.cwd! });
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(refresh).toHaveBeenCalledWith(selected.getBackendSessionId());
        getSessionTestHandle(other).setStatus("idle");
        expect(refresh).toHaveBeenCalledTimes(1);
      });
      it("updates user-level changes across projects after each affected chat finishes", async () => {
        seedProjects("notes", "research");
        const refresh = jest.fn();
        const manager = buildManager({
          descriptor: buildDescriptor({
            createBackendProcess: () => ({
              ...makeMockBackendProcess(),
              refreshSessionConfiguration: refresh,
            }),
          }),
        });
        const first = await manager.createSession(undefined, "notes");
        const second = await manager.createSession(undefined, "research");
        await Promise.all([first.ready, second.ready]);
        getSessionTestHandle(second).setStatus("running");
        const applied = manager.applyExtensionChanges("native", { kind: "user" });
        expect(refresh).toHaveBeenCalledWith(first.getBackendSessionId());
        expect(refresh).not.toHaveBeenCalledWith(second.getBackendSessionId());
        getSessionTestHandle(second).setStatus("idle");
        await applied;
        expect(refresh).toHaveBeenCalledTimes(2);
        expect(refresh).toHaveBeenCalledWith(second.getBackendSessionId());
      });
      it("abandons only the waiting check when its page closes", async () => {
        const refresh = jest.fn();
        const manager = buildManager({
          descriptor: buildDescriptor({
            createBackendProcess: () => ({
              ...makeMockBackendProcess(),
              refreshSessionConfiguration: refresh,
            }),
          }),
        });
        const session = await manager.createSession();
        await session.ready;
        getSessionTestHandle(session).setStatus("running");
        const controller = new AbortController();
        const applied = manager.applyExtensionChanges(
          "native",
          { kind: "user" },
          controller.signal
        );
        controller.abort();
        await expect(applied).rejects.toMatchObject({ name: "AbortError" });
        expect(session.getStatus()).toBe("running");
        getSessionTestHandle(session).setStatus("idle");
        expect(refresh).toHaveBeenCalledWith(session.getBackendSessionId());
      });
      it("keeps a saved change pending even when its page already cancelled the wait", async () => {
        const refresh = jest.fn();
        const manager = buildManager({
          descriptor: buildDescriptor({
            createBackendProcess: () => ({
              ...makeMockBackendProcess(),
              refreshSessionConfiguration: refresh,
            }),
          }),
        });
        const session = await manager.createSession();
        await session.ready;
        const controller = new AbortController();
        controller.abort();
        await expect(
          manager.applyExtensionChanges("native", { kind: "user" }, controller.signal)
        ).rejects.toMatchObject({ name: "AbortError" });
        sessionCreateSpy.mock.calls[0][0].beforePrompt!();
        expect(refresh).toHaveBeenCalledWith(session.getBackendSessionId());
      });
    });

    describe("createSession", () => {
      it("starts native chats with the first runnable model and auto mode despite a legacy disabled flag https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        getSettingsMock.mockReturnValue({
          agentMode: { activeBackend: "native", backends: { native: { enabled: false } } },
        });
        const manager = buildManager({
          descriptor: buildDescriptor({
            getEnabledModelEntries: () => [
              { baseModelId: "missing-key", name: "Missing key", credentialState: "missing_key" },
              { baseModelId: "first", name: "First", credentialState: "ok" },
            ],
          }),
        });
        const session = await manager.createSession("native");
        await session.ready;
        expect(manager.isBackendEnabled("native")).toBe(true);
        expect(sessionCreateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            defaultModelSelection: { baseModelId: "first", effort: null },
            defaultMode: "auto",
          })
        );
      });
      it("restores the previous model, effort and mode from existing saved settings https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        getSettingsMock.mockReturnValue({
          agentMode: {
            activeBackend: "native",
            backends: {
              native: {
                defaultModel: { baseModelId: "second", effort: "high" },
                defaultMode: "plan",
              },
            },
          },
        });
        const manager = buildManager({
          descriptor: buildDescriptor({
            getEnabledModelEntries: () => [
              { baseModelId: "first", name: "First", credentialState: "ok" },
              { baseModelId: "second", name: "Second", credentialState: "ok" },
            ],
          }),
        });
        await manager.createSession("native");
        expect(sessionCreateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            defaultModelSelection: { baseModelId: "second", effort: "high" },
            defaultMode: "plan",
          })
        );
      });

      it("uses the first enabled complete-list model with default reasoning for a new Claude chat", async () => {
        getSettingsMock.mockReturnValue({
          agentMode: {
            activeBackend: "claude",
            backends: { claude: { defaultModel: { baseModelId: "old", effort: "high" } } },
          },
        });
        const manager = buildManager({
          descriptor: buildDescriptor({
            id: "claude",
            usesConfiguredModels: false,
            getEnabledModelEntries: () => [
              { baseModelId: "first", name: "First", credentialState: "ok" },
              { baseModelId: "second", name: "Second", credentialState: "ok" },
            ],
          }),
        });
        await manager.createSession();
        expect(sessionCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ defaultModelSelection: { baseModelId: "first", effort: null } })
        );
      });

      it.each([undefined, { baseModelId: "disabled-model", effort: null }])(
        "does not call a disabled native model when every configured model is off, including carried selection %p",
        async (seed) => {
          const descriptor = buildDescriptor({
            usesConfiguredModels: false,
            getEnabledModelEntries: () => [],
          });
          const manager = buildManager({ descriptor });
          await expect(manager.createSession(undefined, GLOBAL_SCOPE, seed)).rejects.toThrow(
            "Configure a runnable model"
          );
          expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
        }
      );

      it("creates a session and sets it as the active one", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        expect(mgr.getSessions()).toEqual([session]);
        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.getActiveChatUIState()).not.toBeNull();
        expect(mgr.getChatUIState(session.internalId)).toBe(mgr.getActiveChatUIState());
      });

      it("starts the native agent when no default agent was saved", async () => {
        getSettingsMock.mockReturnValue({ agentMode: {} });
        const manager = buildManager();
        expect((await manager.createSession()).backendId).toBe("native");
      });

      it.each(["claude", "opencode", "codex", "unavailable"])(
        "rejects the removed %s agent without creating a native replacement or carrying its model",
        async (backendId) => {
          const manager = buildManager();
          await expect(
            manager.createSession(backendId, GLOBAL_SCOPE, {
              baseModelId: "retired-agent-model",
              effort: "high",
            })
          ).rejects.toThrow("Unknown backend");
          expect(sessionCreateSpy).not.toHaveBeenCalled();
          expect(setSettingsMock).not.toHaveBeenCalled();
        }
      );

      it("refuses to start a chat, and asks for an enabled model, when a backend that may only run enabled models has none", async () => {
        mockSavedDefault(null);
        const mgr = buildManager({
          descriptor: buildDescriptor({
            usesConfiguredModels: true,
            getEnabledModelEntries: () => [],
          }),
        });

        await expect(mgr.createSession()).rejects.toThrow(
          "Configure a runnable model for native in Models to start a chat."
        );
        expect(mgr.getLastError()).toBe(
          "Configure a runnable model for native in Models to start a chat."
        );
        expect(mockBackendStart).not.toHaveBeenCalled();
        expect(mgr.getIsStarting()).toBe(false);
      });

      it("hands the saved mode to the new session so startup waits for that mode to arrive", async () => {
        getSettingsMock.mockReturnValue({
          agentMode: {
            activeBackend: "native",
            backends: { native: { defaultMode: "default" } },
          },
        });
        const mgr = buildManager();

        await mgr.createSession();

        expect(sessionCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ defaultMode: "default" })
        );
      });

      it("hands a project session a first-message context builder and a global session none", async () => {
        seedProjects("proj-ctx");
        mockBuildProjectContext.mockReturnValueOnce(
          "<project_context>\n- `/vault/Shared`\n</project_context>"
        );
        const mgr = buildManager();

        await mgr.createSession(undefined, "proj-ctx");
        await mgr.createSession(undefined, GLOBAL_SCOPE);

        const [projectOpts, globalOpts] = sessionCreateSpy.mock.calls.map(([opts]) => opts);
        expect(projectOpts).toMatchObject({ projectId: "proj-ctx" });
        expect(mockBuildProjectContext).not.toHaveBeenCalled();
        expect(projectOpts.getProjectContextBlock!()).toBe(
          "<project_context>\n- `/vault/Shared`\n</project_context>"
        );
        expect(globalOpts.getProjectContextBlock).toBeUndefined();
      });

      it("only spawns the backend once across multiple createSession calls", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await mgr.createSession();
        await mgr.createSession();
        expect(mockBackendStart).toHaveBeenCalledTimes(1);
      });

      it("two concurrent createSession calls each spawn their own session", async () => {
        const mgr = buildManager();
        const [a, b] = await Promise.all([mgr.createSession(), mgr.createSession()]);
        expect(a).not.toBe(b);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(2);
        expect(mgr.getSessions()).toHaveLength(2);
      });

      it.each([false, true])(
        "waits for the startup upgrade and respects shutdown=%s before launching",
        async (shutdown) => {
          const upgrade = deferred();
          const beforeBackendStart = jest.fn(() => upgrade.promise);
          const mgr = buildManager({ beforeBackendStart });
          const creating = mgr.createSession();
          await waitFor(() => expect(beforeBackendStart).toHaveBeenCalled());
          expect(mockBackendStart).not.toHaveBeenCalled();
          if (shutdown) await mgr.shutdown();
          upgrade.resolve();
          if (shutdown) await expect(creating).rejects.toThrow("shut down");
          else {
            await creating;
            expect(mockBackendStart).toHaveBeenCalledTimes(1);
          }
        }
      );

      it("keeps a validated running process usable when another installation is selected", async () => {
        const descriptor = buildDescriptor();
        const mgr = buildManager({ descriptor });
        await mgr.createSession();
        (descriptor.getInstallState as jest.Mock).mockReturnValue({
          kind: "incompatible",
          message: "Update required",
        });
        await expect(mgr.createSession()).resolves.toBeDefined();
        expect(mockBackendStart).toHaveBeenCalledTimes(1);
      });

      it("rejects an unsupported installation before starting its process", async () => {
        const mgr = buildManager({
          descriptor: buildDescriptor({
            getInstallState: jest.fn(() => ({ kind: "incompatible", message: "Update required" })),
          }),
        });
        await expect(mgr.createSession()).rejects.toThrow("Update required");
        expect(mockBackendStart).not.toHaveBeenCalled();
      });

      it("runs a fresh session on the preloader's warm process instead of spawning another", async () => {
        const warmProc = makeMockBackendProcess();
        const descriptor = buildDescriptor();
        const mgr = buildManager({
          descriptor,
          preloader: {
            takeWarm: jest.fn().mockReturnValueOnce({ proc: warmProc }).mockReturnValue(null),
          },
        });

        await mgr.createSession();

        expect(mockBackendStart).not.toHaveBeenCalled();
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        const opts = sessionCreateSpy.mock.calls[0][0];
        expect(opts.backend).toBe(warmProc);
        expect(opts).not.toHaveProperty("backendSessionId");
      });

      it("waits for an in-flight preload and adopts its process instead of spawning a second one", async () => {
        let preloadSettled = false;
        const preloadGate = deferred();
        const preload = jest.fn(() => preloadGate.promise);
        const takeWarm = jest.fn(() =>
          preloadSettled ? { proc: makeMockBackendProcess() } : null
        );
        const descriptor = buildDescriptor();
        const mgr = buildManager({ descriptor, preloader: { preload, takeWarm } });
        mgr.registerPreload("native", preloadGate.promise);

        const sessionPromise = mgr.createSession();
        await flushTimers();

        expect(preload).toHaveBeenCalledWith("native");
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();

        preloadSettled = true;
        preloadGate.resolve();
        await sessionPromise;

        expect(takeWarm).toHaveBeenCalledWith("native");
        expect(descriptor.createBackendProcess).not.toHaveBeenCalled();
        expect(mockBackendStart).not.toHaveBeenCalled();
      });

      it("leaves the seed unset when a catalog exists but no explicit default is stored", async () => {
        const mgr = buildManager({
          preloader: { getCachedModelCatalog: jest.fn(() => modelCatalog("catalog-first")) },
        });

        await mgr.createSession();

        expect(sessionCreateSpy).toHaveBeenCalledWith(
          expect.objectContaining({ defaultModelSelection: undefined })
        );
      });

      it("a concurrent create that succeeds does not wipe a sibling create's lastError", async () => {
        const mgr = buildManager();
        sessionCreateSpy
          .mockImplementationOnce((opts) =>
            makeMockSession({
              internalId: opts.internalId,
              backendId: opts.backendId,
              ready: (async () => {
                await Promise.resolve();
                await Promise.resolve();
                throw new Error("boom");
              })(),
            })
          )
          .mockImplementationOnce((opts) =>
            makeMockSession({
              internalId: opts.internalId,
              backendSessionId: "backend-ok",
              backendId: opts.backendId,
            })
          );

        const failingSession = await mgr.createSession();
        const succeedingSession = await mgr.createSession();
        await failingSession.ready.catch(() => undefined);
        await succeedingSession.ready;
        await Promise.resolve();
        for (let i = 0; i < 10; i++) await Promise.resolve();

        expect(mgr.getLastError()).toMatch(/boom/);
      });

      it.each([
        { effort: null, confirmed: "low", expected: "low" },
        { effort: "removed", confirmed: "low", expected: "low" },
        { effort: "high", confirmed: "high", expected: undefined },
        { effort: "removed", confirmed: "high", expected: undefined },
      ])(
        "does not write obsolete default reasoning after confirming $confirmed from saved $effort",
        async ({ effort, confirmed }) => {
          mockSavedDefault({ baseModelId: "opus", effort });
          sessionCreateSpy.mockImplementationOnce((opts) => {
            const session = makeMockSession({
              internalId: opts.internalId,
              backendId: opts.backendId,
            });
            jest.spyOn(session, "getState").mockReturnValue({
              model: {
                current: { baseModelId: "opus", effort: confirmed },
                apply: { kind: "setModel" },
                availableModels: [
                  {
                    baseModelId: "opus",
                    name: "Opus",
                    provider: null,
                    effortOptions: [
                      { value: "high", label: "High" },
                      { value: "low", label: "Low" },
                    ],
                  },
                ],
              },
              mode: null,
            });
            return session;
          });
          const mgr = buildManager({ descriptor: buildApplySelectionDescriptor(jest.fn()) });

          await mgr.createSession();
          for (let i = 0; i < 12; i++) await Promise.resolve();

          expect(readPersistedDefault(setSettingsMock, "native")).toBeUndefined();
        }
      );

      it("wires the project-context update hooks into a project session but not a global one", async () => {
        seedProjects("proj-hooks");
        const mgr = buildManager();

        await mgr.enterProject("proj-hooks");
        const projectOpts = sessionCreateSpy.mock.calls[0][0];
        expect(typeof projectOpts.getProjectContextUpdates).toBe("function");
        expect(typeof projectOpts.markProjectContextUpdatesDelivered).toBe("function");

        await mgr.exitProject();
        sessionCreateSpy.mockClear();
        await mgr.createSession();
        const globalOpts = sessionCreateSpy.mock.calls[0][0];
        expect(globalOpts.getProjectContextUpdates).toBeUndefined();
        expect(globalOpts.markProjectContextUpdatesDelivered).toBeUndefined();
      });

      it("chimes when a session starts awaiting permission", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();

        endTurn(session, "awaiting_permission");

        expect(playNotificationSound).toHaveBeenCalledTimes(1);
        expect(session.getNeedsAttention()).toBe(false);
      });

      it.each([
        ["no Agent Chat is open", "none"],
        ["a modal outside the chat has focus", "outside"],
        ["another workspace leaf has focus", "other-leaf"],
        ["the Obsidian window is unfocused", "unfocused-window"],
      ] as const)("chimes when a turn ends while %s", async (_label, focus) => {
        mockAgentChatFocus = focus;
        const mgr = buildManager();
        const session = await mgr.createSession();

        endTurn(session);

        expect(playNotificationSound).toHaveBeenCalledTimes(1);
        expect(playNotificationSound).toHaveBeenCalledWith("piano");
        expect(session.getNeedsAttention()).toBe(false);
      });

      it.each([
        ["the most recent Agent Chat", "inside"],
        ["a sidebar Agent Chat whose leaf is not most recent", "inside-sidebar"],
      ] as const)("stays silent when focus is inside %s", async (_label, focus) => {
        mockAgentChatFocus = focus;
        const mgr = buildManager();
        const session = await mgr.createSession();

        endTurn(session);

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(session.getNeedsAttention()).toBe(false);
      });

      it("stays silent when the focused Agent Chat starts awaiting permission", async () => {
        mockAgentChatFocus = "inside";
        const mgr = buildManager();
        const session = await mgr.createSession();

        endTurn(session, "awaiting_permission");

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(session.getNeedsAttention()).toBe(false);
      });

      it("chimes and flags a backgrounded session that finishes while the chat is focused", async () => {
        mockAgentChatFocus = "inside";
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        endTurn(background);

        expect(playNotificationSound).toHaveBeenCalledWith("piano");
        expect(background.getNeedsAttention()).toBe(true);
      });

      it("stays silent but still flags a backgrounded session when the notification sound setting is off", async () => {
        mockNotificationSound = false;
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        endTurn(background);

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(background.getNeedsAttention()).toBe(true);
      });

      it("neither chimes nor flags a backgrounded session moving from starting to idle", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        const handle = getSessionTestHandle(background);
        handle.setStatus("starting");
        handle.setStatus("idle");

        expect(playNotificationSound).not.toHaveBeenCalled();
        expect(background.getNeedsAttention()).toBe(false);
      });
    });

    describe("forkSessionAtMessage", () => {
      it("opens an independent branch through the selected reply after its snapshot is saved", async () => {
        const mgr = buildManager();
        const source = await mgr.createSession();
        const original: AgentChatMessage[] = [
          {
            id: "u1",
            sender: USER_SENDER,
            message: "Question",
            timestamp: null,
            isVisible: true,
            context: { notes: [], tags: ["#saved"] },
            content: [{ type: "image_url", image_url: { url: "data:image/png;base64,AQID" } }],
          },
          {
            id: "a1",
            sender: AI_SENDER,
            message: "Answer",
            timestamp: null,
            isVisible: true,
            turnStopReason: "end_turn",
            turnDurationMs: 12000,
            parts: [
              {
                kind: "tool_call",
                id: "launch",
                title: "Background command",
                status: "in_progress",
              },
            ],
          },
          { id: "u2", sender: USER_SENDER, message: "Later", timestamp: null, isVisible: true },
        ];
        sessionTestHandles.get(source.internalId)!.setMessages(original);
        sessionTestHandles.get(source.internalId)!.setTaskStatuses(["running"]);
        const save = jest.spyOn(mgr, "flushSessionSnapshot").mockImplementation(async () => {
          expect(mgr.getActiveSession()).toBe(source);
        });
        const fork = await mgr.forkSessionAtMessage(source.internalId, "a1");
        expect(save).toHaveBeenCalledWith(fork);
        expect(mgr.getActiveSession()).toBe(fork);
        expect(fork.store.getDisplayMessages()).toEqual([
          original[0],
          { ...original[1], parts: [{ ...original[1].parts![0], status: "cancelled" }] },
        ]);
        expect(original[1].parts![0]).toMatchObject({ status: "in_progress" });
        expect(fork.getTasks()).toEqual([]);
        expect(fork.restoreBranchState).toHaveBeenCalledWith({
          sourceChatId: source.chatInputId,
          sourceMessageId: "a1",
          historyPending: true,
          inheritedMessageCount: 2,
          createdAtMs: expect.any(Number),
        });
        fork.store.getDisplayMessages()[0].context!.tags!.push("#branch");
        expect(original[0].context!.tags).toEqual(["#saved"]);
        expect(source.store.getDisplayMessages()).toHaveLength(3);
      });

      it("leaves the original chat selected if saving the branch fails", async () => {
        const mgr = buildManager();
        const source = await mgr.createSession();
        sessionTestHandles
          .get(source.internalId)!
          .setMessages([
            { id: "a1", sender: AI_SENDER, message: "Answer", timestamp: null, isVisible: true },
          ]);
        jest.spyOn(mgr, "flushSessionSnapshot").mockRejectedValue(new Error("disk full"));
        await expect(mgr.forkSessionAtMessage(source.internalId, "a1")).rejects.toThrow(
          "disk full"
        );
        expect(mgr.getActiveSession()).toBe(source);
        expect(mgr.getSessions()).toEqual([source]);
      });

      it("refuses a reply still being written and a missing reply", async () => {
        const mgr = buildManager();
        const source = await mgr.createSession();
        sessionTestHandles
          .get(source.internalId)!
          .setMessages([
            { id: "a1", sender: AI_SENDER, message: "Partial", timestamp: null, isVisible: true },
          ]);
        sessionTestHandles.get(source.internalId)!.setStatus("running");
        await expect(mgr.forkSessionAtMessage(source.internalId, "a1")).rejects.toThrow(
          "Wait for this reply"
        );
        await expect(mgr.forkSessionAtMessage(source.internalId, "missing")).rejects.toThrow(
          "Choose an assistant"
        );
      });
    });

    describe("createGlobalSessionWithDraft", () => {
      it("writes the unsent text into the new chat's own draft", async () => {
        const mgr = buildManager();

        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.drafts.get(session.chatInputId)?.input).toBe("Review this repair");
      });

      it("switches directly to the requested scope without spawning an extra blank session", async () => {
        const projectId = "project-with-no-global-session";
        seedProjects(projectId);
        const mgr = buildManager();
        await mgr.createSession(undefined, projectId);

        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        expect(mgr.getSessions()).toHaveLength(2);
        expect(
          mgr.getSessions().filter((candidate) => candidate.projectId === GLOBAL_SCOPE)
        ).toEqual([session]);
        expect(mgr.getActiveSession()).toBe(session);
      });

      it("drops the drafted text when its session closes", async () => {
        const mgr = buildManager();
        const session = await mgr.createGlobalSessionWithDraft("Review this repair");

        await mgr.closeSession(session.internalId);

        expect(mgr.drafts.get(session.chatInputId)).toBeUndefined();
      });

      it("leaves no draft behind when session creation fails", async () => {
        const projectId = "project-before-failed-draft";
        seedProjects(projectId);
        const mgr = buildManager();
        await mgr.enterProject(projectId);
        const previousSession = mgr.getActiveSession();
        expect(previousSession).not.toBeNull();
        let failedChatInputId: string | undefined;
        sessionCreateSpy.mockImplementationOnce((opts) => {
          failedChatInputId = opts.chatInputId;
          throw new Error("session creation failed");
        });

        await expect(mgr.createGlobalSessionWithDraft("Review this repair")).rejects.toThrow(
          "session creation failed"
        );

        expect(failedChatInputId).toBeDefined();
        expect(mgr.drafts.get(failedChatInputId as string)).toBeUndefined();
        expect(mgr.getActiveSession()).toBe(previousSession);
      });

      it("does not roll back across newer ABA scope navigation", async () => {
        seedProjects("project-a", "project-b");
        const mgr = buildManager();
        const globalSession = await mgr.createSession(undefined, GLOBAL_SCOPE);
        const projectBSession = await mgr.createSession(undefined, "project-b");
        const projectASession = await mgr.createSession(undefined, "project-a");
        mgr.setActiveSession(projectASession.internalId);

        let releaseInstructionEnsure: (() => void) | undefined;
        ensureAgentsFileForDiscoverySpy.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              releaseInstructionEnsure = resolve;
            })
        );
        sessionCreateSpy.mockImplementationOnce(() => {
          throw new Error("session creation failed");
        });

        const pendingDraft = mgr.createGlobalSessionWithDraft("Review this repair");
        await waitFor(() => expect(releaseInstructionEnsure).toBeDefined());
        mgr.setActiveSession(projectBSession.internalId);
        mgr.setActiveSession(globalSession.internalId);
        releaseInstructionEnsure?.();

        await expect(pendingDraft).rejects.toThrow("session creation failed");
        expect(mgr.getActiveProjectId()).toBe(GLOBAL_SCOPE);
        expect(mgr.getActiveSession()).toBe(globalSession);
      });
    });

    describe("addContextNoteToActiveChat", () => {
      it("attaches the note to the active chat's draft", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        const note = mockTFile({ path: "Research.md" });

        await mgr.addContextNoteToActiveChat(note);

        expect(mgr.drafts.get(session.chatInputId)?.contextNotes).toEqual([note]);
      });

      it("starts the first chat when none exists so the note has a draft to land in", async () => {
        const mgr = buildManager();
        const note = mockTFile({ path: "Research.md" });

        await mgr.addContextNoteToActiveChat(note);

        const session = mgr.getActiveSession();
        expect(mgr.getSessions()).toEqual([session]);
        expect(mgr.drafts.get(session!.chatInputId)?.contextNotes).toEqual([note]);
      });
    });

    describe("getOrCreateActiveSession", () => {
      it("returns the existing active session on subsequent calls", async () => {
        const mgr = buildManager();
        const a = await mgr.getOrCreateActiveSession();
        const again = await mgr.getOrCreateActiveSession();
        expect(again).toBe(a);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
      });

      it("dedupes concurrent auto-spawn callers into a single session", async () => {
        const mgr = buildManager();
        const [a, b] = await Promise.all([
          mgr.getOrCreateActiveSession(),
          mgr.getOrCreateActiveSession(),
        ]);
        expect(a).toBe(b);
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(mgr.getSessions()).toHaveLength(1);
      });
    });

    describe("setActiveSession", () => {
      it("moves the active pointer to the given id", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        expect(mgr.getActiveSession()).toBe(b);
        mgr.setActiveSession(a.internalId);
        expect(mgr.getActiveSession()).toBe(a);
      });

      it("is a silent no-op on unknown id", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        expect(() => mgr.setActiveSession("nope")).not.toThrow();
        expect(mgr.getActiveSession()).toBe(a);
      });

      it("re-attaches a session detached from its tab when it is surfaced", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        await mgr.enterProject("proj-detach");
        expect(mgr.getSessionsForScope("proj-detach")).not.toContain(old);

        mgr.setActiveSession(old.internalId);

        expect(mgr.getSessionsForScope("proj-detach")).toContain(old);
        expect(mgr.getActiveSession()).toBe(old);
      });
    });

    describe("closeSession", () => {
      it("removes the session from the pool and cancels + disposes it", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        await mgr.closeSession(a.internalId);
        expect(mgr.getSessions()).toEqual([]);
        expect(mgr.getActiveSession()).toBeNull();
        expect(mockSessionCancel).toHaveBeenCalled();
        expect(mockSessionDispose).toHaveBeenCalled();
      });

      it("releases the dropped chat's backend session, so reopening it from history starts one with a live feedback token", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const proc = mgr.getBackendProcess(a.backendId)!;

        await mgr.closeSession(a.internalId);

        expect(proc.closeSession).toHaveBeenCalledWith({ sessionId: a.getBackendSessionId() });
      });

      it("runs a held Reload once the idle chat whose subagent held it is closed, since nothing on that chat can change status again", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        getSessionTestHandle(a).setTaskStatuses(["running"]);
        await mgr.noteSpawnConfigChanged("native", "skills changed");
        await mgr.applyHeldConfigChange("native");
        expect(mockBackendShutdown).not.toHaveBeenCalled();

        const shutDown = new Promise<void>((resolve) =>
          mockBackendShutdown.mockImplementationOnce(async () => {
            resolve();
            return undefined;
          })
        );
        await mgr.closeSession(a.internalId, { releaseBackend: true });
        await shutDown;

        expect(mgr.hasHeldConfigChange("native")).toBe(false);
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
      });

      it("still closes the chat when the backend cannot release its session", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const proc = mgr.getBackendProcess(a.backendId)!;
        jest.mocked(proc.closeSession!).mockRejectedValueOnce(new Error("session/close timed out"));

        await mgr.closeSession(a.internalId);

        expect(mgr.getSessions()).toEqual([]);
        expect(mockSessionDispose).toHaveBeenCalled();
      });

      it("when the active session is closed, picks the right neighbor as active", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        const c = await mgr.createSession();
        mgr.setActiveSession(b.internalId);
        await mgr.closeSession(b.internalId);
        expect(mgr.getActiveSession()).toBe(c);
        expect(mgr.getSessions()).toEqual([a, c]);
      });

      it("when the rightmost active session is closed, falls back to the new last", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        expect(mgr.getActiveSession()).toBe(b);
        await mgr.closeSession(b.internalId);
        expect(mgr.getActiveSession()).toBe(a);
      });

      it("closing a non-active session leaves the active pointer alone", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        await mgr.closeSession(a.internalId);
        expect(mgr.getActiveSession()).toBe(b);
        expect(mgr.getSessions()).toEqual([b]);
      });

      it("is a no-op for unknown ids", async () => {
        const mgr = buildManager();
        await mgr.closeSession("does-not-exist");
        expect(mgr.getSessions()).toEqual([]);
      });

      it("picks a visible neighbor, never a session detached from its tab", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        await mgr.enterProject("proj-detach");
        const fresh = mgr.getActiveSession()!;

        await mgr.closeSession(fresh.internalId);

        expect(mgr.getActiveSession()).not.toBe(old);
      });

      it("never writes a chat note after a turn or when closing https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const { mgr, saveSession } = savedNoteFixture();
        const session = await mgr.createSession();
        getSessionTestHandle(session).setMessages([{ message: "Unsaved turn" }], true);
        await jest.advanceTimersByTimeAsync(2000);
        await mgr.closeSession(session.internalId);
        expect(saveSession).not.toHaveBeenCalled();
        await mgr.shutdown();
      });
    });

    describe("replaceSessionInPlace", () => {
      async function flushBackgroundClose(): Promise<void> {
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }

      it("inserts the replacement at the old session's tab-strip index", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        const c = await mgr.createSession();
        const replacement = await mgr.replaceSessionInPlace(b.internalId);
        await flushBackgroundClose();
        expect(mgr.getSessions()).toEqual([a, replacement, c]);
        expect(mgr.getActiveSession()).toBe(replacement);
      });

      it("preserves the leftmost slot when replacing the first tab", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        mgr.setActiveSession(a.internalId);
        const replacement = await mgr.replaceSessionInPlace(a.internalId);
        await flushBackgroundClose();
        expect(mgr.getSessions()).toEqual([replacement, b]);
        expect(mgr.getActiveSession()).toBe(replacement);
      });

      it("gives the replacement the old tab's chat UI state slot", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        mgr.setActiveSession(a.internalId);
        const replacement = await mgr.replaceSessionInPlace(a.internalId);
        await flushBackgroundClose();
        expect(mgr.getActiveChatUIState()).toBe(mgr.getChatUIState(replacement.internalId));
        expect(mgr.getChatUIState(b.internalId)).not.toBeNull();
      });

      it("closes the old session in the background", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        await mgr.replaceSessionInPlace(a.internalId);
        await flushBackgroundClose();
        expect(mockSessionCancel).toHaveBeenCalled();
        expect(mockSessionDispose).toHaveBeenCalled();
        expect(mgr.getSessions().some((s) => s.internalId === a.internalId)).toBe(false);
      });

      it("falls back to plain create when the old id is unknown", async () => {
        const mgr = buildManager();
        const replacement = await mgr.replaceSessionInPlace("does-not-exist");
        expect(mgr.getSessions()).toEqual([replacement]);
        expect(mgr.getActiveSession()).toBe(replacement);
      });

      it("preserves the logical chat input only when explicitly requested", async () => {
        const mgr = buildManager();
        const freshSource = await mgr.createSession();
        expect(freshSource.chatInputId).not.toBe(freshSource.internalId);
        const freshReplacement = await mgr.replaceSessionInPlace(freshSource.internalId);
        expect(freshReplacement.chatInputId).not.toBe(freshSource.chatInputId);

        const preservedSource = freshReplacement;
        const preservedReplacement = await mgr.replaceSessionInPlace(
          preservedSource.internalId,
          undefined,
          { preserveChatInput: true }
        );
        expect(preservedReplacement.chatInputId).toBe(preservedSource.chatInputId);
      });

      it("keeps the last successful replacement when a queued replacement fails", async () => {
        const mgr = buildManager();
        const source = await mgr.createSession();
        const createSession = mgr.createSession.bind(mgr);
        const secondStarted = deferred();
        const secondGate = deferred();
        let replacementCount = 0;
        jest.spyOn(mgr, "createSession").mockImplementation(async (...args) => {
          replacementCount++;
          if (replacementCount === 2) {
            secondStarted.resolve();
            await secondGate.promise;
            throw new Error("replacement failed");
          }
          return createSession(...args);
        });

        const first = mgr.replaceSessionInPlace(source.internalId, "native", {
          preserveChatInput: true,
          seedSelection: { baseModelId: "first-model", effort: null },
        });
        const second = mgr.replaceSessionInPlace(source.internalId, "native", {
          preserveChatInput: true,
          seedSelection: { baseModelId: "latest-model", effort: "high" },
        });
        const firstReplacement = await first;
        await secondStarted.promise;
        const third = mgr.replaceSessionInPlace(firstReplacement.internalId, "native", {
          preserveChatInput: true,
          seedSelection: { baseModelId: "final-model", effort: "low" },
        });
        secondGate.resolve();
        await expect(second).rejects.toThrow("replacement failed");
        const thirdReplacement = await third;
        await flushBackgroundClose();

        expect(thirdReplacement).not.toBe(firstReplacement);
        expect(thirdReplacement.chatInputId).toBe(source.chatInputId);
        expect(sessionCreateSpy).toHaveBeenLastCalledWith(
          expect.objectContaining({
            defaultModelSelection: { baseModelId: "final-model", effort: "low" },
          })
        );
        expect(mgr.getSessions()).toEqual([thirdReplacement]);
      });
    });

    describe("subscribe", () => {
      it("notifies subscribers on session create / close / activate", async () => {
        const mgr = buildManager();
        const listener = jest.fn();
        mgr.subscribe(listener);

        const a = await mgr.createSession();
        const b = await mgr.createSession();
        mgr.setActiveSession(a.internalId);
        await mgr.closeSession(b.internalId);

        expect(listener.mock.calls.length).toBeGreaterThanOrEqual(4);
      });
    });

    describe("shutdown", () => {
      it("cancels and disposes every session and clears state", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await mgr.createSession();
        expect(mgr.getSessions()).toHaveLength(2);

        await mgr.shutdown();
        expect(mgr.getSessions()).toEqual([]);
        expect(mgr.getActiveSession()).toBeNull();
        expect(mockSessionCancel).toHaveBeenCalledTimes(2);
        expect(mockSessionDispose).toHaveBeenCalledTimes(2);
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
      });
    });

    describe("getLastError", () => {
      it("reports an unexpected backend exit and drops every session", async () => {
        const mgr = buildManager();
        const listener = jest.fn();
        mgr.subscribe(listener);
        await mgr.createSession();
        await mgr.createSession();

        for (const fn of mockBackendExitListeners) fn();

        expect(mgr.getSessions()).toEqual([]);
        expect(mgr.getActiveSession()).toBeNull();
        expect(mgr.getLastError()).toMatch(/stopped unexpectedly/);
        expect(listener).toHaveBeenCalled();
      });
    });

    describe("getOpenChatIds", () => {
      it("includes idle and running conversations and removes released sessions", async () => {
        const mgr = buildManager();
        const empty = mgr.getOpenChatIds();
        expect(mgr.getOpenChatIds()).toBe(empty);
        const idle = await mgr.createSession();
        const running = await mgr.createSession();
        getSessionTestHandle(running).setStatus("running");
        const idleId = nativeIdOf(idle);
        const runningId = nativeIdOf(running);
        expect(mgr.getOpenChatIds()).toEqual(new Set([idleId, runningId]));
        await mgr.closeChatSession(idleId);
        expect(mgr.getOpenChatIds()).toEqual(new Set([runningId]));
      });
    });

    describe("detachSessionFromTab", () => {
      it("keeps the backend session open and discoverable in history", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        const proc = mgr.getBackendProcess(session.backendId)!;

        mgr.detachSessionFromTab(session.internalId);

        expect(mgr.getSessionsForScope(session.projectId)).not.toContain(session);
        expect(mgr.getSessions()).toContain(session);
        expect(mgr.getOpenChatIds()).toContain(nativeIdOf(session));
        expect(proc.closeSession).not.toHaveBeenCalled();
        expect(mockSessionCancel).not.toHaveBeenCalled();
        expect(mockSessionDispose).not.toHaveBeenCalled();
      });

      it("closes the least recently hidden idle chat once a fourth chat of a process-per-chat backend is hidden, keeping the other three", async () => {
        const mgr = buildManager({ descriptor: buildDescriptor({ processPerChat: true }) });
        const chats = await hideChats(mgr, 3);
        expect(closedSessions()).toEqual([]);
        const fourth = await mgr.createSession();
        const closed = untilClosed(mgr, chats[0]);

        mgr.detachSessionFromTab(fourth.internalId);
        await closed;

        expect(closedSessions()).toEqual([chats[0]]);
        expect(mgr.getBackendProcess(chats[0].backendId)!.closeSession).toHaveBeenCalledWith({
          sessionId: chats[0].getBackendSessionId(),
        });
        expect(mgr.getSessions()).toEqual(expect.arrayContaining([...chats.slice(1), fourth]));
      });

      it.each([
        ["runs its main turn", (s: AgentSession) => getSessionTestHandle(s).setStatus("running")],
        [
          "waits on the user's answer",
          (s: AgentSession) => getSessionTestHandle(s).setStatus("awaiting_permission"),
        ],
        [
          "runs a background task",
          (s: AgentSession) => getSessionTestHandle(s).setTaskStatuses(["completed", "running"]),
        ],
        [
          "holds a task's permission request",
          (s: AgentSession) => getSessionTestHandle(s).setPendingPermissionCount(1),
        ],
        [
          "holds a sent message the agent has not taken yet",
          (s: AgentSession) => getSessionTestHandle(s).setQueuedPromptCount(1),
        ],
        ["has a result the user has not seen", (s: AgentSession) => s.markNeedsAttention()],
        [
          "holds only webpage attachments in its composer",
          (s: AgentSession, mgr: AgentSessionManager) =>
            mgr.drafts.update(s.chatInputId, (draft) => ({
              ...draft,
              webTabs: [{ url: "https://example.com/saved" }],
            })),
        ],
        [
          "holds only note attachments in its composer",
          (s: AgentSession, mgr: AgentSessionManager) =>
            mgr.drafts.update(s.chatInputId, (draft) => ({
              ...draft,
              contextNotes: [mockTFile({ path: "Saved.md" })],
            })),
        ],
        [
          "holds unsent text in its composer",
          (s: AgentSession, mgr: AgentSessionManager) =>
            mgr.drafts.update(s.chatInputId, (draft) => ({ ...draft, input: "half-written" })),
        ],
      ])(
        "keeps the oldest hidden chat while it %s and closes the next idle one",
        async (_label, occupy) => {
          const mgr = buildManager({ descriptor: buildDescriptor({ processPerChat: true }) });
          const first = await mgr.createSession();
          occupy(first, mgr);
          mgr.detachSessionFromTab(first.internalId);

          const rest = await hideChats(mgr, 3);

          expect(closedSessions()).toEqual([rest[0]]);
          expect(mgr.getSessions()).toContain(first);
        }
      );

      it("lets hidden chats exceed the cap while every one of them is busy", async () => {
        const mgr = buildManager({ descriptor: buildDescriptor({ processPerChat: true }) });
        const chats = [];
        for (let i = 0; i < 4; i++) {
          const chat = await mgr.createSession();
          getSessionTestHandle(chat).setStatus("running");
          chats.push(chat);
        }
        await mgr.createSession();

        for (const chat of chats) mgr.detachSessionFromTab(chat.internalId);

        expect(closedSessions()).toEqual([]);
        expect(mgr.getSessions()).toEqual(expect.arrayContaining(chats));
      });

      it("closes the over-cap chat once a busy hidden chat stops running", async () => {
        const mgr = buildManager({ descriptor: buildDescriptor({ processPerChat: true }) });
        const chats = [];
        for (let i = 0; i < 4; i++) {
          const chat = await mgr.createSession();
          getSessionTestHandle(chat).setTaskStatuses(["running"]);
          chats.push(chat);
        }
        for (const chat of chats) mgr.detachSessionFromTab(chat.internalId);

        const closed = untilClosed(mgr, chats[0]);
        getSessionTestHandle(chats[0]).setTaskStatuses(["completed"]);
        await closed;

        expect(closedSessions()).toEqual([chats[0]]);
        expect(mgr.getSessions()).toEqual(expect.arrayContaining(chats.slice(1)));
      });

      it("never closes hidden chats of a backend that shares one process across its chats", async () => {
        const mgr = buildManager();

        const chats = await hideChats(mgr, 5);

        expect(closedSessions()).toEqual([]);
        expect(mgr.getSessions()).toEqual(expect.arrayContaining(chats));
      });
    });

    describe("closeChatSession", () => {
      it("releases only the selected backend session while preserving another active chat", async () => {
        const mgr = buildManager();
        const selected = await mgr.createSession();
        const sibling = await mgr.createSession();
        const proc = mgr.getBackendProcess(selected.backendId)!;
        await mgr.closeChatSession(nativeIdOf(selected));
        expect(proc.closeSession).toHaveBeenCalledWith({
          sessionId: selected.getBackendSessionId(),
        });
        expect(mgr.getSessions()).toEqual([sibling]);
        expect(mgr.getActiveSession()).toBe(sibling);
        expect(proc.shutdown).not.toHaveBeenCalled();
      });

      it("releases a hidden chat's backend session while its task runs, so its query and tasks end,", async () => {
        const mgr = buildManager();
        const [hidden] = await hideChats(mgr, 1);
        getSessionTestHandle(hidden).setTaskStatuses(["running"]);
        const proc = mgr.getBackendProcess(hidden.backendId)!;

        await mgr.closeChatSession(nativeIdOf(hidden));

        expect(proc.closeSession).toHaveBeenCalledWith({ sessionId: hidden.getBackendSessionId() });
        expect(mgr.getSessions()).not.toContain(hidden);
        expect(mgr.getRunningChatIds().size).toBe(0);
      });
    });

    describe("getRunningChatIds", () => {
      it("keys a running native session by its native chat id", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        getSessionTestHandle(a).setStatus("running");
        expect(mgr.getRunningChatIds().has(nativeIdOf(a))).toBe(true);
      });

      it("excludes a starting session while including a running one", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const b = await mgr.createSession();
        getSessionTestHandle(a).setStatus("running");
        getSessionTestHandle(b).setStatus("starting");
        const ids = mgr.getRunningChatIds();
        expect(ids.has(nativeIdOf(a))).toBe(true);
        expect(ids.has(nativeIdOf(b))).toBe(false);
      });

      it("returns the same frozen empty set when nothing is running", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const first = mgr.getRunningChatIds();
        expect(first.size).toBe(0);
        expect(mgr.getRunningChatIds()).toBe(first);
      });

      it("notifies subscribers when a session's running membership flips", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const listener = jest.fn();
        mgr.subscribe(listener);
        getSessionTestHandle(a).setStatus("running");
        expect(listener).toHaveBeenCalledTimes(1);
        listener.mockClear();
        getSessionTestHandle(a).setStatus("idle");
        expect(listener).toHaveBeenCalledTimes(1);
      });

      it("lists a chat whose main turn is idle while one of its tasks runs, until the task ends,", async () => {
        const mgr = buildManager();
        const chats = await hideChats(mgr, 1);
        const nativeId = nativeIdOf(chats[0]);

        getSessionTestHandle(chats[0]).setTaskStatuses(["running", "completed"]);
        expect(mgr.getRunningChatIds().has(nativeId)).toBe(true);

        getSessionTestHandle(chats[0]).setTaskStatuses(["completed", "stopped"]);
        expect(mgr.getRunningChatIds().has(nativeId)).toBe(false);
      });

      it("notifies subscribers when a chat's first task starts and its last running task ends, not on other task updates,", async () => {
        const mgr = buildManager();
        const a = await mgr.createSession();
        const listener = jest.fn();
        mgr.subscribe(listener);

        getSessionTestHandle(a).setTaskStatuses(["running"]);
        getSessionTestHandle(a).setTaskStatuses(["running", "running"]);
        expect(listener).toHaveBeenCalledTimes(1);
        getSessionTestHandle(a).setTaskStatuses(["completed", "running"]);
        getSessionTestHandle(a).setTaskStatuses(["completed", "completed"]);
        expect(listener).toHaveBeenCalledTimes(2);
      });

      it("keeps a session detached from its tab listed as running so history shows its spinner", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        getSessionTestHandle(old).setStatus("running");

        await mgr.enterProject("proj-detach");

        expect(mgr.getSessionsForScope("proj-detach")).not.toContain(old);
        expect(mgr.getRunningChatIds().has(nativeIdOf(old))).toBe(true);
      });
    });

    describe("getAttentionChatIds", () => {
      it("hands a backgrounded finished session over from running to attention", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);
        const nativeId = nativeIdOf(background);

        getSessionTestHandle(background).setStatus("running");
        expect(mgr.getRunningChatIds().has(nativeId)).toBe(true);
        expect(mgr.getAttentionChatIds().has(nativeId)).toBe(false);

        getSessionTestHandle(background).setStatus("idle");
        expect(mgr.getRunningChatIds().has(nativeId)).toBe(false);
        expect(mgr.getAttentionChatIds().has(nativeId)).toBe(true);
      });

      it.each(["error", "awaiting_permission"] as const)(
        "includes a backgrounded session whose turn ends in %s",
        async (endStatus) => {
          const mgr = buildManager();
          const { active, background } = await createActiveAndBackgroundSessions(mgr);

          endTurn(background, endStatus);

          expect(mgr.getAttentionChatIds().has(nativeIdOf(background))).toBe(true);
          expect(mgr.getAttentionChatIds().has(nativeIdOf(active))).toBe(false);
        }
      );

      it("does not include a backgrounded session moving from starting to idle", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);

        const handle = getSessionTestHandle(background);
        handle.setStatus("starting");
        handle.setStatus("idle");

        expect(mgr.getAttentionChatIds().size).toBe(0);
      });

      it("does not include the active session even when its chat is not focused", async () => {
        const mgr = buildManager();
        const active = await mgr.createSession();

        endTurn(active);

        expect(mgr.getAttentionChatIds().size).toBe(0);
      });

      it("drops the id once the user activates the flagged tab", async () => {
        const mgr = buildManager();
        const { background } = await createActiveAndBackgroundSessions(mgr);
        endTurn(background);
        expect(mgr.getAttentionChatIds().has(nativeIdOf(background))).toBe(true);

        mgr.setActiveSession(background.internalId);

        expect(mgr.getAttentionChatIds().has(nativeIdOf(background))).toBe(false);
        expect(background.getNeedsAttention()).toBe(false);
      });

      it("returns the same frozen empty set when nothing needs attention", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const first = mgr.getAttentionChatIds();
        expect(first.size).toBe(0);
        expect(mgr.getAttentionChatIds()).toBe(first);
      });

      it("keeps a session detached from its tab listed so history shows its attention dot", async () => {
        seedProjects("proj-detach");
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, "proj-detach");
        old.markNeedsAttention();

        await mgr.enterProject("proj-detach");

        expect(mgr.getSessionsForScope("proj-detach")).not.toContain(old);
        expect(mgr.getAttentionChatIds().has(nativeIdOf(old))).toBe(true);
      });
    });

    describe("noteSpawnConfigChanged", () => {
      it("keeps an open session alive and holds the restart for the user", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();

        await mgr.noteSpawnConfigChanged("native", "managed skills changed");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(session);
        expect(mgr.hasHeldConfigChange("native")).toBe(true);
      });

      it("restarts straight away when no session is open on the backend", async () => {
        const mgr = buildManager();
        const session = await mgr.createSession();
        await mgr.closeSession(session.internalId);

        await mgr.noteSpawnConfigChanged("native", "byok key saved");

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("native")).toBe(false);
      });

      it("refreshes a warm probe that no session has adopted", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const mgr = buildManager({ preloader: { refresh } });

        await mgr.noteSpawnConfigChanged("native", "byok key saved");

        expect(refresh).toHaveBeenCalledWith("native");
        expect(mgr.hasHeldConfigChange("native")).toBe(false);
      });

      it("reports one held change however many times config changes", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const listener = jest.fn();
        mgr.subscribe(listener);

        await mgr.noteSpawnConfigChanged("native", "managed skills changed");
        await mgr.noteSpawnConfigChanged("native", "provider config changed");

        expect(listener).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("native")).toBe(true);
      });
    });

    describe("applyHeldConfigChange", () => {
      it("restarts the backend and clears the offer", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        await mgr.noteSpawnConfigChanged("native", "managed skills changed");

        await mgr.applyHeldConfigChange("native");

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("native");
        expect(mgr.hasHeldConfigChange("native")).toBe(false);
      });

      it("does nothing when the backend has no held change", async () => {
        const mgr = buildManager();
        await mgr.createSession();

        await mgr.applyHeldConfigChange("native");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("replaces an errored session with corrected configuration", async () => {
        sessionCreateSpy.mockImplementationOnce((opts) =>
          makeMockSession({
            ...opts,
            ready: Promise.reject(new Error("Invalid API key")),
          })
        );
        const mgr = buildManager();
        const failed = await mgr.createSession();
        getSessionTestHandle(failed).setStatus("error");
        await flushTimers();
        expect(mgr.getLastError()).toContain("Invalid API key");
        await mgr.noteSpawnConfigChanged("native", "key corrected");
        await mgr.applyHeldConfigChange("native");
        await flushTimers();
        expect(mgr.getActiveSession()).not.toBe(failed);
        expect(mgr.getActiveSession()?.getStatus()).toBe("idle");
        expect(mgr.getLastError()).toBeNull();
      });

      it("reports the restart as pending until a running turn releases it", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        await mgr.noteSpawnConfigChanged("native", "managed skills changed");
        getSessionTestHandle(first).setStatus("running");
        const listener = jest.fn();
        mgr.subscribe(listener);

        await mgr.applyHeldConfigChange("native");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(mgr.isBackendRestartPending("native")).toBe(true);
        expect(listener).toHaveBeenCalled();

        getSessionTestHandle(first).setStatus("idle");
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.isBackendRestartPending("native")).toBe(false);
        expect(mgr.hasHeldConfigChange("native")).toBe(false);
      });

      it("clears the held config after a backend exit so retry does not offer another reload", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await mgr.noteSpawnConfigChanged("native", "key corrected");
        for (const exit of mockBackendExitListeners) exit();
        expect(mgr.hasHeldConfigChange("native")).toBe(false);
        const recovered = await mgr.getOrCreateActiveSession();
        await mgr.applyHeldConfigChange("native");
        expect(mgr.getActiveSession()).toBe(recovered);
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("keeps every tab's composer live throughout reload and restores the selected tab", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const second = await mgr.createSession();
        mgr.setActiveSession(first.internalId);
        const ids = [first.chatInputId, second.chatInputId];
        const drafts = new Map([
          [first.chatInputId, "First unsent draft"],
          [second.chatInputId, "Second unsent draft"],
        ]);
        mgr.subscribe(() => {
          const live = new Set(mgr.getLiveChatInputIds());
          for (const id of drafts.keys()) if (!live.has(id)) drafts.delete(id);
        });
        await mgr.noteSpawnConfigChanged("native", "key corrected");
        await mgr.applyHeldConfigChange("native");
        expect([...drafts.values()]).toEqual(["First unsent draft", "Second unsent draft"]);
        expect(mgr.getSessions().map((s) => s.chatInputId)).toEqual(ids);
        expect(mgr.getActiveSession()?.chatInputId).toBe(first.chatInputId);
      });

      it("preserves composers across scopes without surfacing detached conversations", async () => {
        const projectId = "project-with-drafts";
        seedProjects(projectId);
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, projectId);
        const global = mgr.getActiveSession()!;
        await mgr.enterProject(projectId);
        const landing = mgr.getActiveSession()!;
        await mgr.noteSpawnConfigChanged("native", "models changed");
        await mgr.applyHeldConfigChange("native");
        expect(new Set(mgr.getLiveChatInputIds())).toEqual(
          new Set([old.chatInputId, global.chatInputId, landing.chatInputId])
        );
        expect(mgr.getSessionsForScope(projectId).map((s) => s.chatInputId)).toEqual([
          landing.chatInputId,
        ]);
        expect(mgr.getActiveSession()?.chatInputId).toBe(landing.chatInputId);
        expect(mgr.getActiveProjectId()).toBe(projectId);
      });
    });

    describe("restartBackend", () => {
      it("returns false when the backend has not been started", async () => {
        const mgr = buildManager();

        await expect(mgr.restartBackend("native", "skills changed")).resolves.toBe(false);
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("restarts an idle backend and replaces the active affected session", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const proc = mgr.getBackendProcess(first.backendId)!;

        await expect(mgr.restartBackend("native", "skills changed")).resolves.toBe(true);

        expect(proc.closeSession).not.toHaveBeenCalled();
        expect(mockSessionCancel).toHaveBeenCalledWith();
        expect(mockSessionDispose).toHaveBeenCalledWith();
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getSessions()).toHaveLength(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("native");
      });

      it("refreshes a warm preload probe when the manager owns no process yet", async () => {
        const refresh = jest.fn(() => Promise.resolve());
        const mgr = buildManager({ preloader: { refresh } });

        await expect(mgr.restartBackend("native", "byok key added")).resolves.toBe(true);
        expect(refresh).toHaveBeenCalledWith("native");
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("does not refresh a warm probe when nothing was preloaded", async () => {
        const refresh = jest.fn(() => null);
        const mgr = buildManager({ preloader: { refresh } });

        await expect(mgr.restartBackend("native", "byok key added")).resolves.toBe(false);
        expect(refresh).toHaveBeenCalledWith("native");
      });

      it("re-probes after restart when no replacement session is created", async () => {
        const preload = jest.fn(async () => undefined);
        const mgr = buildManager({ preloader: { preload } });
        const session = await mgr.createSession();
        await mgr.closeSession(session.internalId);
        preload.mockClear();

        await expect(mgr.restartBackend("native", "byok save")).resolves.toBe(true);

        expect(mockBackendShutdown).toHaveBeenCalled();
        expect(preload).toHaveBeenCalledWith("native");
      });

      it("re-probes before creating the replacement so the effort catalog is rebuilt", async () => {
        const preload = jest.fn(async () => undefined);
        const mgr = buildManager({ preloader: { preload } });
        const first = await mgr.createSession();
        preload.mockClear();
        sessionCreateSpy.mockClear();

        await expect(mgr.restartBackend("native", "backend enabled models changed")).resolves.toBe(
          true
        );

        expect(preload).toHaveBeenCalledTimes(1);
        expect(preload).toHaveBeenCalledWith("native");
        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(preload.mock.invocationCallOrder[0]).toBeLessThan(
          sessionCreateSpy.mock.invocationCallOrder[0]
        );
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("native");
      });

      it("gives the replacement the replaced session's chat input so the composer draft survives", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const chatInputId = first.chatInputId;
        mgr.drafts.update(chatInputId, (draft) => ({ ...draft, input: "half-written question" }));

        await mgr.restartBackend("native", "byok key saved");

        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.chatInputId).toBe(chatInputId);
        expect(mgr.drafts.get(chatInputId)?.input).toBe("half-written question");
      });

      it("reports the replaced chat input as live while no session owns it", async () => {
        const liveDuringGap: string[][] = [];
        const mgr: AgentSessionManager = buildManager({
          preloader: {
            preload: jest.fn(async () => {
              liveDuringGap.push([...mgr.getLiveChatInputIds()]);
            }),
          },
        });
        const first = await mgr.createSession();
        const chatInputId = first.chatInputId;

        await mgr.restartBackend("native", "byok key saved");

        expect(liveDuringGap.at(-1)).toContain(chatInputId);
        expect(mgr.getLiveChatInputIds()).toEqual([chatInputId]);
      });

      it("brings the replaced tab back on its own conversation", async () => {
        const loadSession = jest.fn(async ({ sessionId }: { sessionId: string }) => ({
          sessionId,
          state: { model: null, mode: null },
        }));
        const mgr = buildManagerWithReplay({ loadSession });
        const first = await mgr.createSession();
        const backendSessionId = first.getBackendSessionId();
        const chatInputId = first.chatInputId;

        await mgr.restartBackend("native", "managed skills changed");

        expect(loadSession).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: backendSessionId })
        );
        const replacement = mgr.getActiveSession();
        expect(replacement).not.toBe(first);
        expect(replacement?.getBackendSessionId()).toBe(backendSessionId);
        expect(replacement?.chatInputId).toBe(chatInputId);
        expect(mgr.getSessions()).toHaveLength(1);
      });

      it("rebuilds the replaced tab with the tool calls its backend replays during load", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "list the notes", "u1"));
            emit({
              sessionUpdate: "tool_call",
              toolCallId: "tool-ls",
              title: "Bash: ls",
              kind: "execute",
              status: "in_progress",
            });
            emit({ sessionUpdate: "tool_call_update", toolCallId: "tool-ls", status: "completed" });
          },
        });
        const mgr = buildManager({
          descriptor: buildDescriptor({ createBackendProcess: () => replay.backend }),
        });
        await mgr.createSession();

        await mgr.restartBackend("native", "managed skills changed");

        expect(senderAndText(mgr.getActiveSession()!)).toEqual([
          [USER_SENDER, "list the notes"],
          [AI_SENDER, ""],
        ]);
        expect(mgr.getActiveSession()!.store.getDisplayMessages()[1].parts).toMatchObject([
          { kind: "tool_call", id: "tool-ls", status: "completed" },
        ]);
      });

      describe("with a saved note", () => {
        const asked = { epoch: 1791866733161, display: "2026/10/12 21:45:33", fileName: "" };
        const answered = { epoch: 1791866740000, display: "2026/10/12 21:45:40", fileName: "" };
        const noteTurns = [
          { sender: USER_SENDER, message: "list the notes", isVisible: true, timestamp: asked },
          { sender: AI_SENDER, message: "Two notes.", isVisible: true, timestamp: answered },
        ] as AgentChatMessage[];

        async function restartSavedChat(
          replay: ReturnType<typeof buildReplayingBackend>,
          opts: { onScreen?: AgentChatMessage[]; failed?: boolean; saveFirst?: boolean } = {}
        ) {
          jest.useFakeTimers();
          const note = mockTFile({ path: "chats/agent__list_the_notes@20261012_214533.md" });
          const app = buildApp();
          jest
            .mocked(app.vault.getAbstractFileByPath)
            .mockImplementation((path) => (path === note.path ? note : null));
          const saveSession = jest.fn(async () => ({ path: note.path }));
          const mgr = buildManager({
            app,
            persistence: {
              saveSession,
              loadFile: jest.fn(async () => ({
                backendId: "native",
                sessionId: first.getBackendSessionId(),
                projectId: GLOBAL_SCOPE,
                messages: noteTurns,
              })),
            },
            descriptor: buildDescriptor({ createBackendProcess: () => replay.backend }),
          });
          const first = await mgr.createSession();
          getSessionTestHandle(first).setMessages(opts.onScreen ?? noteTurns, true);
          if (opts.failed) getSessionTestHandle(first).setStatus("error");
          if (opts.saveFirst ?? true) await mgr.loadSessionFromHistory(note);

          await mgr.restartBackend("native", "managed skills changed");
          return { mgr, first, note, saveSession, rebuilt: mgr.getActiveSession()! };
        }

        it("still shows a failed turn and its error after the restart while keeping the note", async () => {
          const failedTurn = [
            {
              sender: USER_SENDER,
              message: "Summarize this note",
              isVisible: true,
              timestamp: asked,
            },
            {
              sender: AI_SENDER,
              message: "OpenCode's internal service stopped. Please try again.",
              isVisible: true,
              isErrorMessage: true,
              timestamp: answered,
            },
          ] as AgentChatMessage[];
          const replay = buildReplayingBackend({
            onLoad: (emit) => {
              emit(replayChunk("user_message_chunk", "list the notes", "u1"));
              emit(replayChunk("agent_message_chunk", "Two notes.", "a1"));
            },
          });
          const { mgr, note, rebuilt } = await restartSavedChat(replay, {
            onScreen: [...noteTurns, ...failedTurn],
            failed: true,
          });

          expect(rebuilt.store.getDisplayMessages().map((m) => m.message)).toEqual([
            "list the notes",
            "Two notes.",
            "Summarize this note",
            "OpenCode's internal service stopped. Please try again.",
          ]);
          expect(mgr.getSessionSourcePath(rebuilt.internalId)).toBe(note.path);
          await mgr.shutdown();
        });

        it("shows the note's turns when the agent replays fewer turns than the note holds", async () => {
          const replay = buildReplayingBackend();
          const { mgr, rebuilt } = await restartSavedChat(replay);

          expect(senderAndText(rebuilt)).toEqual([
            [USER_SENDER, "list the notes"],
            [AI_SENDER, "Two notes."],
          ]);
          await mgr.shutdown();
        });

        it("keeps an unavailable native chat's note separate from a blank retry after restart", async () => {
          const replay = buildReplayingBackend({
            loadSession: jest.fn(async () => {
              throw new MethodUnsupportedError("session/load");
            }),
            resumeSession: jest.fn(async () => {
              throw new MethodUnsupportedError("session/resume");
            }),
          });
          const { mgr, first, rebuilt } = await restartSavedChat(replay);
          expect(rebuilt.getBackendSessionId()).not.toBe(first.getBackendSessionId());
          expect(rebuilt.loadDisplayMessages).not.toHaveBeenCalled();
          expect(rebuilt.resendSavedHistoryOnNextTurn).not.toHaveBeenCalled();
          expect(mgr.getSessionSourcePath(rebuilt.internalId)).toBe("");
          await mgr.shutdown();
        });
      });

      it("keeps the replaced tab's title across the restart", async () => {
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
        first.restoreLabel("Refactor the importer", "user");

        await mgr.restartBackend("native", "managed skills changed");

        expect(mgr.getActiveSession()?.getLabel()).toBe("Refactor the importer");
      });

      it("opens a fresh chat when the backend cannot replay the conversation", async () => {
        const mgr = buildManagerWithReplay({
          loadSession: jest.fn(async () => {
            throw new MethodUnsupportedError("session/load");
          }),
          resumeSession: jest.fn(async () => {
            throw new MethodUnsupportedError("session/resume");
          }),
        });
        const first = await mgr.createSession();
        const chatInputId = first.chatInputId;

        await mgr.restartBackend("native", "managed skills changed");

        const replacement = mgr.getActiveSession();
        expect(replacement).not.toBe(first);
        expect(replacement?.getBackendSessionId()).not.toBe(first.getBackendSessionId());
        expect(replacement?.chatInputId).toBe(chatInputId);
        expect(mgr.getSessions()).toHaveLength(1);
      });

      it("defers restart until an active turn leaves running", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        getSessionTestHandle(first).setStatus("running");

        await expect(mgr.restartBackend("native", "skills changed")).resolves.toBe(true);
        expect(mockBackendShutdown).not.toHaveBeenCalled();

        getSessionTestHandle(first).setStatus("idle");
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(mgr.getActiveSession()?.backendId).toBe("native");
      });

      it("restarts at once while only a background command runs, since a command may never end", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        getSessionTestHandle(first).setTaskStatuses(["running"], ["command"]);

        await mgr.restartBackend("native", "skills changed");

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
      });

      it("holds a Reload while a background subagent runs and restarts after the reply the agent starts once it ends, even with a background command still running", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const handle = getSessionTestHandle(first);
        handle.setTaskStatuses(["running", "running"], ["subagent", "command"]);
        await mgr.noteSpawnConfigChanged("native", "skills changed");

        await mgr.applyHeldConfigChange("native");
        handle.setTaskStatuses(["completed", "running"], ["subagent", "command"]);
        handle.setStatus("running");
        expect(mgr.hasHeldConfigChange("native")).toBe(true);

        const shutDown = new Promise<void>((resolve) =>
          mockBackendShutdown.mockImplementationOnce(async () => {
            resolve();
            return undefined;
          })
        );
        handle.setStatus("idle");
        await shutDown;

        expect(mgr.hasHeldConfigChange("native")).toBe(false);
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
      });

      it("runs a held Reload once an idle chat's connection drops while its subagent runs, since no reply about the subagent can follow", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const handle = getSessionTestHandle(first);
        handle.setTaskStatuses(["running"]);
        await mgr.noteSpawnConfigChanged("native", "skills changed");
        await mgr.applyHeldConfigChange("native");
        expect(mockBackendShutdown).not.toHaveBeenCalled();

        const shutDown = new Promise<void>((resolve) =>
          mockBackendShutdown.mockImplementationOnce(async () => {
            resolve();
            return undefined;
          })
        );
        handle.setTaskStatuses(["stopped"]);
        handle.disconnect();
        await shutDown;

        expect(mgr.hasHeldConfigChange("native")).toBe(false);
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
      });

      it("interrupts a busy turn when a privacy-boundary restart cannot be deferred", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        getSessionTestHandle(first).setStatus("running");

        await expect(
          mgr.restartBackend("native", "agent configuration changed", { deferWhileBusy: false })
        ).resolves.toBe(true);

        expect(mockSessionCancel).toHaveBeenCalledWith();
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
      });

      it("runs a non-deferrable restart immediately even with a held config change", async () => {
        const mgr = buildManager();
        await mgr.createSession();

        await mgr.noteSpawnConfigChanged("native", "managed skills changed");
        await mgr.restartBackend("native", "agent configuration changed", {
          deferWhileBusy: false,
        });

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.hasHeldConfigChange("native")).toBe(false);
      });

      it("queues a second concurrent restart so the latest settings are not lost", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        const shutdown = holdNextBackendShutdown();

        const first = mgr.restartBackend("native", "byok save #1");
        await shutdown.started;
        const second = mgr.restartBackend("native", "byok save #2");
        shutdown.release();
        await Promise.all([first, second]);
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(2);
      });

      it("keeps a queued privacy-boundary restart non-deferrable", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        sessionCreateSpy.mockImplementationOnce((opts) => {
          const replacement = makeMockSession({
            internalId: opts.internalId,
            chatInputId: opts.chatInputId,
            backendId: opts.backendId,
            projectId: opts.projectId,
          });
          getSessionTestHandle(replacement).setStatus("running");
          return replacement;
        });
        const shutdown = holdNextBackendShutdown();

        const ordinaryRestart = mgr.restartBackend("native", "managed env changed");
        await shutdown.started;
        const privacyRestart = mgr.restartBackend("native", "agent configuration changed", {
          deferWhileBusy: false,
        });
        shutdown.release();
        await Promise.all([ordinaryRestart, privacyRestart]);
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(2);
      });

      it("restarts after the failed turn settles and keeps its user message and clear error", async () => {
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
        const firstHandle = getSessionTestHandle(first);
        firstHandle.setStatus("running");

        mockUnhealthyHandler?.();
        expect(mockBackendShutdown).not.toHaveBeenCalled();

        const failedTurn = [
          { message: "Summarize this note" },
          {
            message: "OpenCode's internal service stopped. Please try again.",
            isErrorMessage: true,
          },
        ];
        firstHandle.setMessages(failedTurn, true);
        firstHandle.setStatus("error");
        await flushTimers();

        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(first);
        expect(
          mgr
            .getActiveSession()
            ?.store.getDisplayMessages()
            .map((m) => m.message)
        ).toEqual(failedTurn.map((m) => m.message));
        expect(mgr.getActiveSession()?.store.getDisplayMessages().at(-1)?.isErrorMessage).toBe(
          true
        );
      });

      it("keeps failed turns from two chats sharing the same OpenCode process", async () => {
        const mgr = buildManagerWithReplay();
        const first = await mgr.createSession();
        const second = await mgr.createSession();
        getSessionTestHandle(first).setStatus("running");
        getSessionTestHandle(second).setStatus("running");

        mockUnhealthyHandler?.();
        const firstMessages = [
          { message: "First question" },
          { message: "Internal error: Internal service failure", isErrorMessage: true },
        ];
        const secondMessages = [
          { message: "Second question" },
          {
            message: "OpenCode's internal service stopped. Please try again.",
            isErrorMessage: true,
          },
        ];
        getSessionTestHandle(first).setMessages(firstMessages);
        getSessionTestHandle(first).setStatus("error");
        expect(mockBackendShutdown).not.toHaveBeenCalled();
        getSessionTestHandle(second).setMessages(secondMessages);
        getSessionTestHandle(second).setStatus("error");
        await flushTimers();

        const replaced = mgr.getSessions();
        expect(mockBackendShutdown).toHaveBeenCalledTimes(1);
        expect(
          replaced
            .find((s) => s.chatInputId === first.chatInputId)
            ?.store.getDisplayMessages()
            .map((m) => m.message)
        ).toEqual(firstMessages.map((m) => m.message));
        expect(
          replaced
            .find((s) => s.chatInputId === second.chatInputId)
            ?.store.getDisplayMessages()
            .map((m) => m.message)
        ).toEqual(secondMessages.map((m) => m.message));
      });

      it("leaves ordinary restarts to replay the backend transcript", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        getSessionTestHandle(first).setMessages([{ message: "Local draft transcript" }]);

        await mgr.restartBackend("native", "models changed");

        expect(mgr.getActiveSession()?.store.getDisplayMessages()).toEqual([]);
      });

      it("keeps a fresh fallback free of messages the new backend never received", async () => {
        const mgr = buildManager();
        const first = await mgr.createSession();
        const handle = getSessionTestHandle(first);
        handle.setStatus("running");
        mockUnhealthyHandler?.();
        handle.setMessages([
          { message: "Unsaved prompt" },
          { message: "OpenCode's internal service stopped. Please try again." },
        ]);
        handle.setStatus("error");
        await flushTimers();

        expect(mgr.getActiveSession()?.getBackendSessionId()).not.toBe(first.getBackendSessionId());
        expect(mgr.getActiveSession()?.store.getDisplayMessages()).toEqual([]);
      });
    });

    describe("onInstallStateChanged", () => {
      function buildInstallStateManager(opts: {
        installState: InstallState;
        refreshResult?: Promise<void> | null;
      }) {
        let installState = opts.installState;
        const preloader = {
          preload: jest.fn(async () => undefined),
          refresh: jest.fn(() => opts.refreshResult ?? null),
          clearCached: jest.fn(),
          stop: jest.fn(async () => undefined),
        };
        const mgr = buildManager({
          descriptor: buildDescriptor({ getInstallState: jest.fn(() => installState) }),
          preloader,
        });
        return {
          mgr,
          preloader,
          setInstallState: (state: InstallState) => (installState = state),
        };
      }

      it("keeps the live chat when model configuration becomes unavailable (https://github.com/ItsDalk-Lane/Scribe/issues/21)", async () => {
        const { mgr, preloader, setInstallState } = buildInstallStateManager({
          installState: { kind: "ready", source: "custom" },
        });
        const chat = await mgr.createSession();
        mockBackendShutdown.mockClear();
        const configurationError = {
          kind: "error",
          reason: "configuration",
          message: "Enable a chat model.",
        } as const;
        setInstallState(configurationError);

        await mgr.onInstallStateChanged("native");

        expect(mgr.getActiveSession()).toBe(chat);
        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(preloader.clearCached).toHaveBeenCalledWith("native");
      });

      it("preloads a freshly-installed backend that was never probed", async () => {
        const { mgr, preloader } = buildInstallStateManager({
          installState: { kind: "ready", source: "custom" },
        });

        await mgr.onInstallStateChanged("native");

        expect(preloader.preload).toHaveBeenCalledWith("native");
        expect(preloader.clearCached).not.toHaveBeenCalled();
        expect(mockBackendShutdown).not.toHaveBeenCalled();
      });

      it("refreshes a warm probe against the new binary without a fresh preload", async () => {
        const { mgr, preloader } = buildInstallStateManager({
          installState: { kind: "ready", source: "custom" },
          refreshResult: Promise.resolve(),
        });

        await mgr.onInstallStateChanged("native");

        expect(preloader.refresh).toHaveBeenCalledWith("native");
        expect(preloader.preload).not.toHaveBeenCalled();
      });

      it("restarts a live backend against the new binary", async () => {
        const { mgr, preloader } = buildInstallStateManager({
          installState: { kind: "ready", source: "custom" },
        });
        await mgr.createSession();
        mockBackendShutdown.mockClear();
        preloader.preload.mockClear();

        await mgr.onInstallStateChanged("native");

        expect(mockBackendShutdown).toHaveBeenCalled();
        expect(preloader.preload).toHaveBeenCalledWith("native");
      });

      it("tears down and drops the warm probe when the binary is no longer available", async () => {
        const { mgr, preloader, setInstallState } = buildInstallStateManager({
          installState: { kind: "ready", source: "custom" },
        });
        await mgr.createSession();
        mockBackendShutdown.mockClear();
        sessionCreateSpy.mockClear();

        setInstallState({ kind: "absent" });
        await mgr.onInstallStateChanged("native");

        expect(mockBackendShutdown).toHaveBeenCalled();
        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(preloader.clearCached).toHaveBeenCalledWith("native");
        expect(preloader.preload).not.toHaveBeenCalled();
      });

      it("clears a settled preload status when the backend becomes absent", async () => {
        const { mgr, setInstallState } = buildInstallStateManager({
          installState: { kind: "ready", source: "custom" },
        });
        mgr.registerPreload("native", Promise.resolve());
        await Promise.resolve();
        expect(mgr.getPreloadStatus("native")).toBe("ready");

        setInstallState({ kind: "absent" });
        await mgr.onInstallStateChanged("native");

        expect(mgr.getPreloadStatus("native")).toBe("absent");
      });

      it("keeps the preload status when the backend becomes incompatible", async () => {
        const { mgr, setInstallState } = buildInstallStateManager({
          installState: { kind: "ready", source: "custom" },
        });
        mgr.registerPreload("native", Promise.resolve());
        await Promise.resolve();

        setInstallState({
          kind: "incompatible",
          source: "custom",
          currentVersion: "1.0.0",
          minVersion: "2.0.0",
          message: "too old",
        });
        await mgr.onInstallStateChanged("native");

        expect(mgr.getPreloadStatus("native")).toBe("ready");
      });

      it("keeps live and warm backend state while a compatibility check is in flight", async () => {
        const { mgr, preloader } = buildInstallStateManager({
          installState: { kind: "checking", source: "custom" },
        });
        await mgr.createSession();
        mockBackendShutdown.mockClear();

        await mgr.onInstallStateChanged("native");

        expect(mockBackendShutdown).not.toHaveBeenCalled();
        expect(preloader.clearCached).not.toHaveBeenCalled();
        expect(preloader.refresh).not.toHaveBeenCalled();
        expect(preloader.preload).not.toHaveBeenCalled();
      });
    });

    describe("registerPreload", () => {
      it("moves a backend from pending to ready once the preload resolves", async () => {
        const mgr = buildManager();
        let resolve!: () => void;
        const promise = new Promise<void>((res) => {
          resolve = res;
        });
        mgr.registerPreload("native", promise);
        expect(mgr.getPreloadStatus("native")).toBe("pending");
        expect(mgr.isPreloadReady("native")).toBe(false);
        resolve();
        await promise;
        await Promise.resolve();
        expect(mgr.getPreloadStatus("native")).toBe("ready");
        expect(mgr.isPreloadReady("native")).toBe(true);
      });

      it("moves a backend from pending to error when the preload rejects yet still reports ready so chat unblocks", async () => {
        const mgr = buildManager();
        mgr.registerPreload(
          "native",
          Promise.reject(new Error("preload failed")).catch((e) => {
            throw e;
          })
        );
        await flushTimers();
        expect(mgr.getPreloadStatus("native")).toBe("error");
        expect(mgr.isPreloadReady("native")).toBe(true);
      });
    });

    describe("isPreloadReady", () => {
      it("treats a backend with no registered preload as ready", () => {
        expect(buildManager().isPreloadReady("native")).toBe(true);
      });
    });

    describe("getPreloadStatus", () => {
      it("reports absent for a backend with no registered preload", () => {
        expect(buildManager().getPreloadStatus("native")).toBe("absent");
      });
    });

    describe("getCachedModelCatalog", () => {
      it("returns the catalog owned by the preloader's probe", () => {
        const catalog = modelCatalog("catalog");
        const mgr = buildManager({ preloader: { getCachedModelCatalog: jest.fn(() => catalog) } });

        expect(mgr.getCachedModelCatalog("native")).toBe(catalog);
      });
    });

    describe("getModelCacheSignature", () => {
      it("is stable when shared discovery is unchanged", () => {
        const catalog = modelCatalog("catalog");
        const first = buildManager({ preloader: { getCachedModelCatalog: () => catalog } });
        const second = buildManager({ preloader: { getCachedModelCatalog: () => catalog } });

        expect(first.getModelCacheSignature("native")).toBe(
          second.getModelCacheSignature("native")
        );
      });

      it("changes when shared model discovery changes", () => {
        const first = buildManager({
          preloader: { getCachedModelCatalog: () => modelCatalog("first-catalog") },
        });
        const second = buildManager({
          preloader: { getCachedModelCatalog: () => modelCatalog("second-catalog") },
        });

        expect(first.getModelCacheSignature("native")).not.toBe(
          second.getModelCacheSignature("native")
        );
      });
    });

    describe("persistDefaultSelection()", () => {
      it("reuses the saved model field while preserving mode and step preferences https://github.com/ItsDalk-Lane/Scribe/issues/31", () => {
        const manager = buildManager();
        setSettingsMock.mockClear();
        const selection = { baseModelId: "chosen", effort: "high" };
        manager.persistDefaultSelection("native", selection);
        const update = setSettingsMock.mock.calls[0][0];
        const result = update({
          agentMode: {
            notificationSound: true,
            backends: { native: { defaultMode: "plan", maxSteps: 50 } },
          },
        });
        expect(result.agentMode).toEqual({
          notificationSound: true,
          backends: { native: { defaultMode: "plan", maxSteps: 50, defaultModel: selection } },
        });
      });
    });

    describe("applySelection", () => {
      it("does not replace the remembered model when switching fails https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const applySelection = jest.fn().mockRejectedValue(new Error("switch failed"));
        const manager = buildManager({ descriptor: buildApplySelectionDescriptor(applySelection) });
        sessionCreateSpy.mockImplementationOnce((opts) => {
          const session = makeMockSession({
            internalId: opts.internalId,
            backendId: opts.backendId,
          });
          (session as unknown as { getState: () => unknown }).getState = () => ({
            model: { current: { baseModelId: "previous", effort: "low" }, availableModels: [] },
            mode: null,
          });
          return session;
        });
        await manager.createSession();
        setSettingsMock.mockClear();
        await expect(manager.applySelection({ baseModelId: "unavailable" })).rejects.toThrow(
          "switch failed"
        );
        expect(setSettingsMock).not.toHaveBeenCalled();
      });

      it("no-ops when no session is active", async () => {
        const mgr = buildManager();
        await expect(
          mgr.applySelection({ effort: "high" }, { expectBackendId: "native" })
        ).resolves.toBeUndefined();
      });

      it("no-ops when the active session is on a different backend", async () => {
        const mgr = buildManager();
        await mgr.createSession();
        await expect(
          mgr.applySelection({ effort: "high" }, { expectBackendId: "claude" })
        ).resolves.toBeUndefined();
      });

      it("persists a successful model and effort selection for later chats https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const applySelection = jest.fn(async () => {});
        const mgr = buildManager({ descriptor: buildApplySelectionDescriptor(applySelection) });
        const entry = {
          baseModelId: "anthropic/sonnet",
          name: "Sonnet",
          provider: "anthropic",
          effortOptions: [
            { value: null, label: "Default" },
            { value: "high", label: "High" },
          ],
        };
        sessionCreateSpy.mockImplementationOnce((opts) => {
          const s = makeMockSession({ internalId: opts.internalId, backendId: opts.backendId });
          (s as unknown as { getState: () => unknown }).getState = () => ({
            model: {
              current: { baseModelId: entry.baseModelId, effort: null },
              availableModels: [entry],
            },
            mode: null,
          });
          return s;
        });
        const session = await mgr.createSession();

        setSettingsMock.mockClear();
        await mgr.applySelection({ effort: "high" }, { expectBackendId: "native" });
        expect(applySelection).toHaveBeenCalledWith(session, {
          baseModelId: "anthropic/sonnet",
          effort: "high",
        });
        expect(readPersistedDefault(setSettingsMock, "native")).toEqual({
          baseModelId: "anthropic/sonnet",
          effort: "high",
        });

        applySelection.mockClear();
        setSettingsMock.mockClear();
        await mgr.applySelection({ baseModelId: "anthropic/opus", effort: null });
        expect(applySelection).toHaveBeenCalledWith(session, {
          baseModelId: "anthropic/opus",
          effort: null,
        });
        expect(readPersistedDefault(setSettingsMock, "native")).toEqual({
          baseModelId: "anthropic/opus",
          effort: null,
        });
      });
    });

    describe("applyMode", () => {
      function buildModeManager(
        getModeMapping: BackendDescriptor["getModeMapping"]
      ): AgentSessionManager {
        return buildManager({
          descriptor: buildDescriptor({ id: "claude", displayName: "Claude", getModeMapping }),
        });
      }

      it("saves a manually selected permission mode as the default for later chats", async () => {
        const manager = buildManager({
          descriptor: buildDescriptor({
            id: "native",
            displayName: "Scribe",
            getModeMapping: () => ({
              kind: "setMode",
              canonical: { default: "default", plan: "plan", auto: "auto" },
            }),
          }),
        });
        await manager.createSession("native");
        setSettingsMock.mockClear();

        await manager.applyMode("native", "auto", { kind: "setMode", nativeId: "auto" });

        const update = setSettingsMock.mock.calls.at(-1)?.[0] as
          | ((
              settings: ReturnType<typeof mockDefaultSettings>
            ) => ReturnType<typeof mockDefaultSettings>)
          | undefined;
        expect(update).toBeDefined();
        if (!update) throw new Error("Missing settings update");
        getSettingsMock.mockReturnValue(update(mockDefaultSettings()));
        expect(manager.getDefaultMode("native")).toBe("auto");
      });

      it("refreshes a state-independent native mapping before dispatch", async () => {
        const manager = buildModeManager(() => ({
          kind: "setMode",
          canonical: { default: "default", plan: "plan", auto: "auto" },
        }));
        const session = await manager.createSession("claude");

        await manager.applyMode("claude", "auto", {
          kind: "setMode",
          nativeId: "bypassPermissions",
        });

        expect(session.setMode).toHaveBeenCalledWith("auto");
      });

      it("uses the translated spec when the mapping requires live backend state", async () => {
        const manager = buildModeManager((modeState) =>
          modeState
            ? {
                kind: "setMode",
                canonical: { default: "default", plan: "plan", auto: "full-access" },
              }
            : null
        );
        const session = await manager.createSession("claude");

        await manager.applyMode("claude", "auto", {
          kind: "setMode",
          nativeId: "cached-auto",
        });

        expect(session.setMode).toHaveBeenCalledWith("cached-auto");
      });

      it("preserves translated mode ids without an inventory", async () => {
        const manager = buildModeManager(() => ({ kind: "setMode", canonical: {} }));
        const session = await manager.createSession("claude");

        for (const [mode, nativeId] of [
          ["default", "read-only"],
          ["auto", "agent"],
        ] as const) {
          await manager.applyMode("claude", mode, { kind: "setMode", nativeId });
        }

        expect(session.setMode).toHaveBeenNthCalledWith(1, "read-only");
        expect(session.setMode).toHaveBeenNthCalledWith(2, "agent");
      });

      it("applies a sequence of Plan settings without replacing the translated choice", async () => {
        const manager = buildModeManager(() => ({ kind: "setMode", canonical: {} }));
        const session = await manager.createSession("claude");

        await manager.applyMode("claude", "plan", {
          kind: "sequence",
          steps: [
            { kind: "setMode", nativeId: "agent" },
            { kind: "setConfigOption", configId: "collaboration_mode", value: "plan" },
          ],
        });

        expect(session.setMode).toHaveBeenCalledWith("agent");
        expect(session.setConfigOption).toHaveBeenCalledWith("collaboration_mode", "plan");
      });
    });

    describe("getSessionSourcePath", () => {
      it("uses the loaded conversation file before any save", async () => {
        const file = mockTFile({ path: "chat/Loaded.md" });
        const loadFile = jest.fn().mockResolvedValue({
          backendId: "native",
          sessionId: "saved-native-source",
          projectId: GLOBAL_SCOPE,
          messages: [{ message: "Loaded" }],
        });
        const replay = buildReplayingBackend();
        const mgr = buildManager({
          persistence: { loadFile },
          descriptor: buildDescriptor({ createBackendProcess: () => replay.backend }),
        });
        const loaded = await mgr.loadSessionFromHistory(file);
        expect(mgr.getSessionSourcePath(loaded.internalId)).toBe(file.path);
        file.path = "archive/Loaded.md";
        expect(mgr.getSessionSourcePath(loaded.internalId)).toBe(file.path);
      });
    });

    describe("getChatHistoryItems", () => {
      it("merges markdown and native entries, de-duplicated on backend session id", async () => {
        const { manager, index } = buildHistoryHarness({
          files: {
            "chats/agent__a.md": {
              epoch: 1_000,
              topic: "Saved chat",
              backendId: "native",
              sessionId: "s1",
              lastAccessedAt: 2_000,
            },
          },
        });
        await index.recordSession({
          backendId: "native",
          sessionId: "s1",
          title: "Saved chat",
          createdAtMs: 1_000,
          lastAccessedAtMs: 5_000,
        });
        await index.recordSession({
          backendId: "native",
          sessionId: "s2",
          title: "Native only chat",
          createdAtMs: 3_000,
          lastAccessedAtMs: 4_000,
        });

        const items = await manager.getChatHistoryItems();
        expect(items).toHaveLength(2);
        const markdown = items.find((i) => i.id === "chats/agent__a.md");
        expect(markdown).toBeDefined();
        expect(markdown?.lastAccessedAt.getTime()).toBe(5_000);
        const native = items.find((i) => i.id !== "chats/agent__a.md");
        expect(native?.id).toBe(buildNativeChatId("native", "s2"));
        expect(native?.title).toBe("Native only chat");
        expect(native?.backendId).toBe("native");
      });

      it("reports when saved chats were pinned, including notes in hidden folders outside the metadata cache", async () => {
        const { manager } = buildHistoryHarness({
          files: {
            "chats/agent__pinned.md": { epoch: 1_000, backendId: "native", pinnedAt: 4_000 },
            "chats/agent__unpinned.md": { epoch: 1_000, backendId: "native" },
          },
          hiddenFiles: {
            ".scribe/chats/agent__hidden.md":
              "---\nepoch: 1000\nmode: agent\nbackendId: native\npinnedAt: 5000\n---\n\n**user**: hi",
          },
        });

        const items = await manager.getChatHistoryItems();

        expect(Object.fromEntries(items.map((item) => [item.id, item.pinnedAt]))).toEqual({
          "chats/agent__pinned.md": 4_000,
          "chats/agent__unpinned.md": undefined,
          ".scribe/chats/agent__hidden.md": 5_000,
        });
      });

      it("de-duplicates hidden-folder chats via the adapter frontmatter fallback", async () => {
        const { manager, index } = buildHistoryHarness({
          hiddenFiles: {
            ".scribe/chats/agent__hidden.md":
              '---\nepoch: 1000\nmode: agent\nbackendId: native\nsessionId: "s1"\n---\n\n**user**: hi',
          },
        });
        await index.recordSession({
          backendId: "native",
          sessionId: "s1",
          title: "Hidden twin",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
        });
        const items = await manager.getChatHistoryItems();
        expect(items).toHaveLength(1);
        expect(items[0]?.id).toBe(".scribe/chats/agent__hidden.md");
      });

      it("scopes a project view's native entries by the index's recorded projectId", async () => {
        const { manager, index } = buildHistoryHarness();
        await index.recordSession({
          backendId: "codex",
          sessionId: "in-project",
          title: "Project chat",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
          projectId: HISTORY_PROJECT_ID,
        });
        await index.recordSession({
          backendId: "codex",
          sessionId: "global-chat",
          title: "Global chat",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
        });

        const projectItems = await manager.getChatHistoryItems(HISTORY_PROJECT_ID);
        expect(projectItems).toHaveLength(1);
        expect(projectItems[0]?.id).toBe(buildNativeChatId("codex", "in-project"));

        expect(await manager.getChatHistoryItems()).toHaveLength(2);
      });

      it("keeps markdown chats when no running backend can confirm the session is absent", async () => {
        const { manager } = buildHistoryHarness({
          files: {
            "chats/agent__a.md": {
              epoch: 1_000,
              topic: "Unknowable",
              backendId: "native",
              sessionId: "s1",
            },
          },
        });
        const titles = (await manager.getChatHistoryItems()).map((i) => i.title);
        expect(titles).toContain("Unknowable");
      });

      it("hides a markdown chat whose backend session is absent on this device", async () => {
        const sessionExistsLocally = jest.fn(
          async ({ sessionId }: { sessionId: string }) => sessionId === "local"
        );
        const { manager } = buildHistoryHarness({
          files: {
            "chats/agent__local.md": {
              epoch: 2_000,
              topic: "Made here",
              backendId: "native",
              sessionId: "local",
            },
            "chats/agent__foreign.md": {
              epoch: 1_000,
              topic: "Made elsewhere",
              backendId: "native",
              sessionId: "foreign",
            },
          },
          warmSessionExistsLocally: sessionExistsLocally,
        });

        const titles = (await manager.getChatHistoryItems()).map((i) => i.title);
        expect(titles).toContain("Made here");
        expect(titles).not.toContain("Made elsewhere");
        expect(sessionExistsLocally).toHaveBeenCalledWith({ sessionId: "foreign", cwd: "/vault" });
      });

      it("tombstones the native twin of a dropped non-local markdown chat", async () => {
        const { manager, index } = buildHistoryHarness({
          files: {
            "chats/agent__foreign.md": {
              epoch: 1_000,
              topic: "Made elsewhere",
              backendId: "native",
              sessionId: "foreign",
            },
          },
          warmSessionExistsLocally: jest.fn(async () => false),
        });
        await index.recordSession({
          backendId: "native",
          sessionId: "foreign",
          title: "Made elsewhere",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
        });

        const items = await manager.getChatHistoryItems();
        expect(items).toHaveLength(0);
        expect(await index.isTombstoned("native", "foreign")).toBe(true);
      });

      it("probes a project chat's resumability with its project cwd, not the vault root", async () => {
        seedProjects(HISTORY_PROJECT_ID);
        const sessionExistsLocally = jest.fn(
          async ({ cwd }: { cwd: string }) => cwd === join("/vault", "Projects", "proj-1")
        );
        const { manager } = buildHistoryHarness({
          files: {
            "chats/agent__p.md": {
              epoch: 2_000,
              topic: "Project chat",
              backendId: "native",
              sessionId: "proj-sess",
              projectId: HISTORY_PROJECT_ID,
            },
          },
          warmSessionExistsLocally: sessionExistsLocally,
        });

        const titles = (await manager.getChatHistoryItems(HISTORY_PROJECT_ID)).map((i) => i.title);
        expect(titles).toContain("Project chat");
        expect(sessionExistsLocally).toHaveBeenCalledWith({
          sessionId: "proj-sess",
          cwd: join("/vault", "Projects", "proj-1"),
        });
      });

      it("probes each chat with its own scope cwd in the global flat view", async () => {
        seedProjects(HISTORY_PROJECT_ID);
        const sessionExistsLocally = jest.fn(async () => true);
        const { manager } = buildHistoryHarness({
          files: {
            "chats/agent__g.md": {
              epoch: 2_000,
              topic: "Global chat",
              backendId: "native",
              sessionId: "g-sess",
            },
            "chats/agent__p.md": {
              epoch: 1_000,
              topic: "Project chat",
              backendId: "native",
              sessionId: "p-sess",
              projectId: HISTORY_PROJECT_ID,
            },
          },
          warmSessionExistsLocally: sessionExistsLocally,
        });

        const titles = (await manager.getChatHistoryItems()).map((i) => i.title);
        expect(titles).toEqual(expect.arrayContaining(["Global chat", "Project chat"]));
        expect(sessionExistsLocally).toHaveBeenCalledWith({ sessionId: "g-sess", cwd: "/vault" });
        expect(sessionExistsLocally).toHaveBeenCalledWith({
          sessionId: "p-sess",
          cwd: join("/vault", "Projects", "proj-1"),
        });
      });

      it("sweeps the preloader's warm probe procs before any chat starts a backend", async () => {
        const warmListSessions = jest.fn(async () => ({
          sessions: [
            {
              sessionId: "pre-existing",
              cwd: "/vault",
              title: "Chat from before this app session",
              updatedAt: new Date(6_000).toISOString(),
            },
          ],
        }));
        const { manager } = buildHistoryHarness({ warmListSessions });
        const items = await manager.getChatHistoryItems();
        expect(warmListSessions).toHaveBeenCalledWith({ cwd: "/vault" });
        expect(items).toHaveLength(1);
        expect(items[0]?.id).toBe(buildNativeChatId("native", "pre-existing"));
      });

      it("sweeps running backends' listSessions into history, scoped to the vault cwd", async () => {
        const listSessions = jest.fn(async () => ({
          sessions: [
            {
              sessionId: "in-vault",
              cwd: "/vault",
              title: "Real chat",
              updatedAt: new Date(7_000).toISOString(),
            },
            {
              sessionId: "other-vault",
              cwd: "/elsewhere",
              title: "Foreign chat",
              updatedAt: null,
            },
            { sessionId: "untitled", cwd: "/vault", title: null, updatedAt: null },
            {
              sessionId: "placeholder",
              cwd: "/vault",
              title: "New session - 1",
              updatedAt: null,
            },
            { sessionId: "probe-1", cwd: "/vault", title: "Probe", updatedAt: null },
          ],
        }));
        const { manager } = buildHistoryHarness({ listSessions, probeSessionId: "probe-1" });
        await manager.createSession("native");

        const items = await manager.getChatHistoryItems();
        expect(listSessions).toHaveBeenCalledWith({ cwd: "/vault" });
        const native = items.filter((i) => i.id.startsWith("scribe-agent-session://"));
        expect(native).toHaveLength(1);
        expect(native[0]?.id).toBe(buildNativeChatId("native", "in-vault"));
        expect(native[0]?.title).toBe("Real chat");
        expect(native[0]?.lastAccessedAt.getTime()).toBe(7_000);
      });

      it("skips native title discovery for non-summarizing backends (codex)", async () => {
        const listSessions = jest.fn(async () => ({
          sessions: [
            {
              sessionId: "ctx-leak",
              cwd: "/vault",
              title: "<scribe-context> The user attached the following vault items",
              updatedAt: null,
            },
          ],
        }));
        const { manager } = buildHistoryHarness({ listSessions, summarizesSessionTitle: false });
        await manager.createSession("native");

        const items = await manager.getChatHistoryItems();
        expect(listSessions).not.toHaveBeenCalled();
        expect(items.filter((i) => i.id.startsWith("scribe-agent-session://"))).toHaveLength(0);
      });
    });

    describe("deleteChatHistory", () => {
      it.each([
        [buildNativeChatId("native", "to-delete"), buildNativeChatId("native", "to-delete")],
        ["chats/agent__old.md", "epoch:1000"],
      ])(
        "removes the pin override when deleting %s https://github.com/ItsDalk-Lane/Scribe/issues/31",
        async (id, identity) => {
          const indexStorage = makeIndexStorage();
          const { manager, index } = buildHistoryHarness({
            indexStorage,
            files: { "chats/agent__old.md": { epoch: 1000, backendId: "native" } },
          });
          await manager.setChatPinned(id, true);
          await manager.deleteChatHistory(id);
          await index.flush();
          expect(await index.getPinOverride(identity)).toBeUndefined();
          const reloaded = new AgentSessionIndex(indexStorage, "plugins/scribe/index.json");
          expect(await reloaded.getPinOverride(identity)).toBeUndefined();
        }
      );

      it("removes the backend's stored native transcript before removing its saved note", async () => {
        const deleted: string[] = [];
        const deleteSession = jest.fn(async ({ sessionId }: { sessionId: string }) => {
          deleted.push(sessionId);
        });
        const { manager, index } = buildHistoryHarness({
          backendId: "native",
          createBackendProcess: jest.fn(() => ({ ...makeMockBackendProcess(), deleteSession })),
        });
        await index.recordSession({
          backendId: "native",
          sessionId: "native-session-7",
          title: "Delete",
          createdAtMs: 1000,
          lastAccessedAtMs: 2000,
        });
        await manager.deleteChatHistory(buildNativeChatId("native", "native-session-7"));
        expect(deleted).toEqual(["native-session-7"]);
        expect(
          (await manager.getChatHistoryItems()).some((item) => item.id.includes("native-session-7"))
        ).toBe(false);
      });
      it("tombstones a native entry without touching persistence", async () => {
        const { manager, index, persistence } = buildHistoryHarness();
        await index.recordSession({
          backendId: "native",
          sessionId: "s1",
          title: "Doomed",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
        });
        await manager.deleteChatHistory(buildNativeChatId("native", "s1"));
        expect(await manager.getChatHistoryItems()).toHaveLength(0);
        expect(await index.isTombstoned("native", "s1")).toBe(true);
        expect(persistence.deleteFile).not.toHaveBeenCalled();
      });

      it("deletes a markdown chat and also tombstones its native twin", async () => {
        const { manager, index, persistence } = buildHistoryHarness({
          files: {
            "chats/agent__a.md": {
              epoch: 1_000,
              backendId: "native",
              sessionId: "s1",
            },
          },
        });
        await index.recordSession({
          backendId: "native",
          sessionId: "s1",
          title: "Twin",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
        });
        await manager.deleteChatHistory("chats/agent__a.md");
        expect(persistence.deleteFile).toHaveBeenCalledWith("chats/agent__a.md");
        expect(await index.isTombstoned("native", "s1")).toBe(true);
      });

      it("touches only Scribe's own copy of the chat", async () => {
        const { manager, index, persistence } = buildHistoryHarness({
          files: { "chats/agent__a.md": { epoch: 1_000, backendId: "native", sessionId: "s1" } },
        });
        await index.recordSession({
          backendId: "native",
          sessionId: "s1",
          title: "Doomed",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
        });

        await manager.deleteChatHistory("chats/agent__a.md");

        expect(persistence.deleteFile).toHaveBeenCalledTimes(1);
        expect(persistence.deleteFile).toHaveBeenCalledWith("chats/agent__a.md");
        expect(await index.getEntry("native", "s1")).toBeNull();
      });

      async function persistedNoteFixture() {
        const notePath = "chats/agent__a.md";
        const content =
          "---\nbackendId: native\nsessionId: s1\nepoch: 1000\n---\nSaved conversation";
        const notes: Record<string, string> = { [notePath]: content };
        const indexStorage = makeIndexStorage();
        const reload = () => {
          const harness = buildHistoryHarness({ hiddenFiles: notes, indexStorage });
          harness.persistence.deleteFile.mockImplementation(async () => {
            delete notes[notePath];
            harness.persistence.getAgentChatHistoryFiles.mockResolvedValue([]);
            return undefined;
          });
          return harness;
        };
        const harness = reload();
        await harness.index.recordSession({
          backendId: "native",
          sessionId: "s1",
          title: "Saved conversation",
          createdAtMs: 1000,
          lastAccessedAtMs: 2000,
        });
        await harness.index.flushOrThrow();
        return { ...harness, notePath, content, notes, indexStorage, reload };
      }

      it("preserves the note while the index write is pending or fails, keeps it visible after reload, and allows retry", async () => {
        const { manager, persistence, notePath, content, notes, indexStorage, reload } =
          await persistedNoteFixture();
        let rejectWrite!: (error: Error) => void;
        let signalWriteStarted!: () => void;
        const writeStarted = new Promise<void>((resolve) => {
          signalWriteStarted = resolve;
        });
        jest.spyOn(indexStorage, "write").mockImplementationOnce(() => {
          signalWriteStarted();
          return new Promise<void>((_resolve, reject) => {
            rejectWrite = reject;
          });
        });

        const deleting = manager.deleteChatHistory(notePath);
        const failed = expect(deleting).rejects.toThrow("disk full");
        await writeStarted;
        try {
          expect(persistence.deleteFile).not.toHaveBeenCalled();
          expect(notes[notePath]).toBe(content);
        } finally {
          rejectWrite(new Error("disk full"));
          await failed;
        }
        expect(persistence.deleteFile).not.toHaveBeenCalled();
        expect(notes[notePath]).toBe(content);
        expect((await manager.getChatHistoryItems()).map((item) => item.id)).toContain(notePath);

        const reloaded = reload();
        expect(await reloaded.index.isTombstoned("native", "s1")).toBe(false);
        expect((await reloaded.manager.getChatHistoryItems()).map((item) => item.id)).toContain(
          notePath
        );
        await reloaded.manager.deleteChatHistory(notePath);
        expect(notes[notePath]).toBeUndefined();
        expect(await reload().manager.getChatHistoryItems()).toEqual([]);
        expect(await reload().index.isTombstoned("native", "s1")).toBe(true);
      });

      it("keeps a note visible after file-removal failure and reload despite its persisted marker, and allows retry", async () => {
        const { manager, persistence, notePath, content, notes, reload } =
          await persistedNoteFixture();
        persistence.deleteFile.mockRejectedValueOnce(new Error("locked"));

        await expect(manager.deleteChatHistory(notePath)).rejects.toThrow("locked");
        expect(notes[notePath]).toBe(content);
        expect((await manager.getChatHistoryItems()).map((item) => item.id)).toContain(notePath);
        const reloaded = reload();
        expect(await reloaded.index.isTombstoned("native", "s1")).toBe(true);
        expect((await reloaded.manager.getChatHistoryItems()).map((item) => item.id)).toContain(
          notePath
        );

        await reloaded.manager.deleteChatHistory(notePath);
        expect(notes[notePath]).toBeUndefined();
        expect(await reload().manager.getChatHistoryItems()).toEqual([]);
      });

      describe("when the chat is open", () => {
        const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/1";

        async function openChat() {
          const harness = buildHistoryHarness();
          const session = await harness.manager.createSession("native");
          const sessionId = session.getBackendSessionId()!;
          await harness.index.recordSession({
            backendId: "native",
            sessionId,
            title: "Open",
            createdAtMs: 1_000,
            lastAccessedAtMs: 2_000,
          });
          return {
            ...harness,
            session,
            sessionId,
            chatId: buildNativeChatId("native", sessionId),
          };
        }

        it(`${issue} closes the live session before it deletes the history entry`, async () => {
          const { manager, index, sessionId, chatId } = await openChat();

          await manager.deleteChatHistory(chatId);

          expect(manager.getSessions()).toEqual([]);
          expect(await index.isTombstoned("native", sessionId)).toBe(true);
        });

        it(`${issue} never saves a pending autosave while it deletes the chat`, async () => {
          jest.useFakeTimers();
          const { manager, persistence, session, chatId } = await openChat();
          getSessionTestHandle(session).setMessages([{ message: "First turn" }], true);

          await manager.deleteChatHistory(chatId);

          expect(persistence.saveSession).not.toHaveBeenCalled();
          expect(persistence.deleteFile).not.toHaveBeenCalled();
        });
      });
    });

    describe("getSessionHistoryId()", () => {
      it("uses the existing native session identity without saving a note https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const manager = buildManager();
        const session = await manager.createSession();
        expect(manager.getSessionHistoryId(session.internalId)).toBe(nativeIdOf(session));
        expect(manager.getSessionHistoryId("missing")).toBe("");
      });
    });

    describe("getChatLinkId()", () => {
      it("keeps native links independent of notes and preserves legacy epoch links https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const { manager } = buildHistoryHarness({
          files: { "chats/agent__old.md": { epoch: 1000, backendId: "native" } },
        });
        const native = buildNativeChatId("native", "s1");
        expect(await manager.getChatLinkId(native)).toBe(native);
        expect(await manager.getChatLinkId("chats/agent__old.md")).toBe("epoch:1000");
        expect(await manager.getChatLinkId("missing.md")).toBeNull();
      });
    });

    describe("setChatPinned()", () => {
      it("pins native chats in the internal index without creating notes https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const { manager, index, persistence } = buildHistoryHarness();
        const native = buildNativeChatId("native", "s1");
        const pinned = await manager.setChatPinned(native, true);
        expect(pinned.id).toBe(native);
        expect(pinned.pinnedAt).toEqual(expect.any(Number));
        expect(await index.getPinOverride(native)).toBe(pinned.pinnedAt);
        expect(persistence.saveSession).not.toHaveBeenCalled();
        expect(persistence.setPinnedAt).not.toHaveBeenCalled();
      });
      it("keeps an explicit unpin over a legacy note's stored pin after reloading the index https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const indexStorage = makeIndexStorage();
        const files = {
          "chats/agent__old.md": { epoch: 1000, backendId: "native", pinnedAt: 4000 },
        };
        const first = buildHistoryHarness({ files, indexStorage });
        expect((await first.manager.getChatHistoryItems())[0].pinnedAt).toBe(4000);
        await first.manager.setChatPinned("chats/agent__old.md", false);
        await first.index.flush();
        const next = buildHistoryHarness({ files, indexStorage });
        expect((await next.manager.getChatHistoryItems())[0].pinnedAt).toBeUndefined();
        expect(next.persistence.setPinnedAt).not.toHaveBeenCalled();
      });
    });

    describe("updateChatTitle", () => {
      it("updates the index title of a native entry", async () => {
        const { manager, index } = buildHistoryHarness();
        await index.recordSession({
          backendId: "native",
          sessionId: "s1",
          title: "Old title",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
        });
        await manager.updateChatTitle(buildNativeChatId("native", "s1"), "New title");
        expect((await index.getEntry("native", "s1"))?.title).toBe("New title");
      });

      it("matches the live session by backend, not session id alone", async () => {
        const { manager, index } = buildHistoryHarness();
        const live = await manager.createSession("native");
        const liveId = live.getBackendSessionId()!;
        await index.recordSession({
          backendId: "codex",
          sessionId: liveId,
          title: "Codex entry",
          createdAtMs: 1_000,
          lastAccessedAtMs: 2_000,
        });

        await manager.updateChatTitle(buildNativeChatId("codex", liveId), "Codex renamed");
        expect((await index.getEntry("codex", liveId))?.title).toBe("Codex renamed");
        expect(live.setLabel).not.toHaveBeenCalled();
      });
    });

    describe("loadSessionFromHistory", () => {
      const savedAt = formatDateTime(new Date("2026-01-02T03:04:05Z"));
      const savedChat = (messages: AgentChatMessage[]) =>
        jest.fn().mockResolvedValue({
          backendId: "native",
          sessionId: "native-1",
          projectId: GLOBAL_SCOPE,
          messages,
        });
      const savedTurn: AgentChatMessage[] = [
        {
          id: "s1",
          sender: USER_SENDER,
          message: "saved question",
          isVisible: true,
          timestamp: savedAt,
        },
        {
          id: "s2",
          sender: AI_SENDER,
          message: "saved answer",
          isVisible: true,
          timestamp: savedAt,
        },
      ];
      const openSavedChat = (
        replay: ReturnType<typeof buildReplayingBackend>,
        messages: AgentChatMessage[] = savedTurn
      ) =>
        buildManager({
          persistence: { loadFile: savedChat(messages) },
          descriptor: buildDescriptor({ createBackendProcess: () => replay.backend }),
        }).loadSessionFromHistory(mockTFile({ path: "chat/Saved.md" }));

      it.each(["claude", "opencode", "codex"])(
        "rejects a saved %s note without starting a replacement or changing its contents",
        async (backendId) => {
          const replay = buildReplayingBackend();
          const saved = {
            backendId,
            sessionId: "retired-session",
            projectId: GLOBAL_SCOPE,
            messages: savedTurn,
          };
          const manager = buildManager({
            descriptor: buildDescriptor({ createBackendProcess: () => replay.backend }),
            persistence: { loadFile: async () => saved },
          });
          await expect(
            manager.loadSessionFromHistory(mockTFile({ path: "chat/Saved.md" }))
          ).rejects.toThrow("Unknown backend");
          expect(saved.messages).toEqual(savedTurn);
          expect(replay.backend.loadSession).not.toHaveBeenCalled();
          expect(sessionCreateSpy).not.toHaveBeenCalled();
          expect(manager.getSessions()).toEqual([]);
        }
      );

      it("reopens a saved branch note without merging its inherited prefix a second time", async () => {
        const { snapshots } = snapshotHarness();
        const snapshot = snapshotFixture({
          branch: {
            sourceChatId: "parent",
            sourceMessageId: "a1",
            inheritedMessageCount: 2,
            historyPending: false,
          },
        });
        snapshot.messages.push(
          { id: "u2", sender: USER_SENDER, message: "Continue", timestamp: null, isVisible: true },
          { id: "a2", sender: AI_SENDER, message: "Continuation", timestamp: null, isVisible: true }
        );
        await snapshots.save(snapshot);
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "Continue", "u2"));
            emit(replayChunk("agent_message_chunk", "Continuation", "a2"));
          },
        });
        const manager = buildManager({
          sessionSnapshots: snapshots,
          descriptor: buildDescriptor({ createBackendProcess: () => replay.backend }),
          persistence: {
            loadFile: async () => ({
              messages: snapshot.messages,
              backendId: "native",
              sessionId: "saved-chat",
              projectId: GLOBAL_SCOPE,
            }),
          },
        });

        const session = await manager.loadSessionFromHistory(
          mockTFile({ path: "chats/branch.md" })
        );

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "Review"],
          [AI_SENDER, "Reviewed"],
          [USER_SENDER, "Continue"],
          [AI_SENDER, "Continuation"],
        ]);
        expect(session.chatInputId).toBe("stable-chat");
      });

      it("shows the replayed chat with its tool calls instead of the note's text when the session reattaches, and drops frames that arrive after the load response", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "replayed question", "u1"));
            emit({
              sessionUpdate: "tool_call",
              toolCallId: "tool-read",
              title: "Read note.md",
              kind: "read",
              status: "completed",
            });
            emit(replayChunk("agent_message_chunk", "replayed answer", "a1"));
          },
        });

        const session = await openSavedChat(replay);
        replay.emit("native-1", replayChunk("agent_message_chunk", "late replayed answer", "a1"));

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "replayed question"],
          [AI_SENDER, "replayed answer"],
        ]);
        expect(session.store.getDisplayMessages()[1].parts?.map((p) => p.kind)).toEqual([
          "tool_call",
          "text",
        ]);
      });

      it("gives replayed messages without send times the note's times so the next autosave keeps them", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "replayed question", "u1"));
            emit(replayChunk("agent_message_chunk", "replayed answer", "a1"));
          },
        });

        const session = await openSavedChat(replay);

        expect(session.store.getDisplayMessages().map((m) => [m.message, m.timestamp])).toEqual([
          ["replayed question", savedAt],
          ["replayed answer", savedAt],
        ]);
      });

      it("preserves a saved note and reports a missing native record without importing it into a replacement", async () => {
        const replay = buildReplayingBackend({
          loadSession: jest.fn(async () => {
            throw new Error("Native session not found");
          }),
        });
        await expect(openSavedChat(replay)).rejects.toThrow("Could not resume");
        expect(savedTurn).toHaveLength(2);
        expect(sessionCreateSpy).not.toHaveBeenCalled();
      });

      it("does not resend the note's turns when the saved session reattaches", async () => {
        const resend = jest.spyOn(AgentSession.prototype, "resendSavedHistoryOnNextTurn");
        const replay = buildReplayingBackend({
          loadSession: jest.fn(async () => {
            throw new MethodUnsupportedError("session/load");
          }),
        });

        const session = await openSavedChat(replay);

        expect(session.getBackendSessionId()).toBe("native-1");
        expect(resend).not.toHaveBeenCalled();
        resend.mockRestore();
      });

      it("reattaches a project chat to its project scope", async () => {
        seedProjects("proj-ctx");
        const replay = buildReplayingBackend();

        await buildManager({
          persistence: {
            loadFile: jest.fn().mockResolvedValue({
              backendId: "native",
              sessionId: "native-1",
              projectId: "proj-ctx",
              messages: savedTurn,
            }),
          },
          descriptor: buildDescriptor({ createBackendProcess: () => replay.backend }),
        }).loadSessionFromHistory(mockTFile({ path: "chat/Saved.md" }));

        expect(replay.backend.loadSession).toHaveBeenCalledWith(
          expect.objectContaining({ sessionId: "native-1", projectId: "proj-ctx" })
        );
      });

      it("keeps the replayed chat when the note also holds a /compact turn that the agent's replay omits", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "replayed question", "u1"));
            emit({
              sessionUpdate: "tool_call",
              toolCallId: "tool-read",
              title: "Read note.md",
              kind: "read",
              status: "completed",
            });
            emit(replayChunk("agent_message_chunk", "replayed answer", "a1"));
          },
        });

        const session = await openSavedChat(replay, [
          ...savedTurn,
          { id: "s3", sender: USER_SENDER, message: "/compact", isVisible: true, timestamp: null },
        ]);

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "replayed question"],
          [AI_SENDER, "replayed answer"],
        ]);
        expect(session.store.getDisplayMessages()[1].parts?.map((p) => p.kind)).toEqual([
          "tool_call",
          "text",
        ]);
      });

      it("shows the note's messages when the reattached session replays nothing", async () => {
        const replay = buildReplayingBackend({
          loadSession: jest.fn(async () => {
            throw new MethodUnsupportedError("session/load");
          }),
        });

        const session = await openSavedChat(replay);

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "saved question"],
          [AI_SENDER, "saved answer"],
        ]);
      });

      it("keeps the replayed chat and its compaction row when the note also holds the /compact turn the replay never repeats", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "replayed question", "u1"));
            emit(replayChunk("agent_message_chunk", "replayed answer", "a1"));
            emit({ sessionUpdate: "compaction", id: "c1", status: "completed", trigger: "manual" });
          },
        });

        const session = await openSavedChat(replay, [
          ...savedTurn,
          { id: "s3", sender: USER_SENDER, message: "/compact", isVisible: true, timestamp: null },
          { id: "s4", sender: AI_SENDER, message: "", isVisible: true, timestamp: null },
        ]);

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "replayed question"],
          [AI_SENDER, "replayed answer"],
        ]);
        expect(
          session.store
            .getDisplayMessages()
            .flatMap((m) => m.parts ?? [])
            .filter((p) => p.kind === "compaction")
        ).toHaveLength(1);
      });

      it("shows the note's messages when the note holds a refused turn that never reached the agent", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "replayed question", "u1"));
            emit(replayChunk("agent_message_chunk", "replayed answer", "a1"));
          },
        });
        const refusal = "This chat's model isn't enabled. Pick an enabled model to continue.";

        const session = await openSavedChat(replay, [
          ...savedTurn,
          { id: "s3", sender: USER_SENDER, message: "try again", isVisible: true, timestamp: null },
          { id: "s4", sender: AI_SENDER, message: refusal, isVisible: true, timestamp: null },
        ]);

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "saved question"],
          [AI_SENDER, "saved answer"],
          [USER_SENDER, "try again"],
          [AI_SENDER, refusal],
        ]);
      });
    });

    describe("loadNativeSessionFromHistory", () => {
      it.each(["claude", "opencode", "codex"])(
        "rejects a saved %s snapshot and preserves the original record",
        async (backendId) => {
          const { snapshots } = snapshotHarness();
          const snapshot = snapshotFixture({
            backendId,
            selection: { baseModelId: "retired-agent-model", effort: "high" },
          });
          await snapshots.save(snapshot);
          const replay = buildReplayingBackend();
          const { manager } = buildHistoryHarness({
            sessionSnapshots: snapshots,
            createBackendProcess: jest.fn(() => replay.backend),
          });
          await expect(
            manager.loadNativeSessionFromHistory(backendId, "saved-chat")
          ).rejects.toThrow("Unknown backend");
          expect(replay.backend.loadSession).not.toHaveBeenCalled();
          expect(sessionCreateSpy).not.toHaveBeenCalled();
          expect(await snapshots.load(backendId, "saved-chat")).toEqual(snapshot);
        }
      );

      it("preserves the display snapshot and reports a missing native record without creating alias history", async () => {
        const { snapshots } = snapshotHarness();
        const snapshot = snapshotFixture();
        await snapshots.save(snapshot);
        const replay = buildReplayingBackend({
          loadSession: jest.fn(async () => {
            throw new Error("Native history missing");
          }),
        });
        const { manager } = buildHistoryHarness({
          sessionSnapshots: snapshots,
          createBackendProcess: jest.fn(() => replay.backend),
        });
        await expect(manager.loadNativeSessionFromHistory("native", "saved-chat")).rejects.toThrow(
          "Could not resume"
        );
        expect(await snapshots.load("native", "saved-chat")).toEqual(snapshot);
        expect(manager.getSessions()).toEqual([]);
        expect(sessionCreateSpy).not.toHaveBeenCalled();
      });

      it("restores stable chat identity, every reply's duration, file changes and completed tasks after reopening", async () => {
        const { snapshots } = snapshotHarness();
        const snapshot = snapshotFixture();
        snapshot.messages[1].fileChanges = [
          {
            path: "Welcome.md",
            status: "modified",
            before: "old",
            after: "new",
            additions: 1,
            deletions: 1,
          },
        ];
        await snapshots.save(snapshot);
        const replay = buildReplayingBackend();
        const { manager } = buildHistoryHarness({
          sessionSnapshots: snapshots,
          createBackendProcess: jest.fn(() => replay.backend),
        });

        const session = await manager.loadNativeSessionFromHistory("native", "saved-chat");

        expect(session.chatInputId).toBe("stable-chat");
        expect(session.store.getDisplayMessages()).toEqual(snapshot.messages);
        expect(session.getTasks()[0].savedOutput!.text).toBe("passed");
      });

      it("keeps a branch's inherited prefix and its newer saved continuation when native replay lacks the prefix", async () => {
        const { snapshots } = snapshotHarness();
        const snapshot = snapshotFixture({
          branch: {
            sourceChatId: "parent",
            sourceMessageId: "a1",
            inheritedMessageCount: 2,
            historyPending: false,
          },
        });
        snapshot.messages.push(
          { id: "u2", sender: USER_SENDER, message: "Continue", timestamp: null, isVisible: true },
          {
            id: "a2",
            sender: AI_SENDER,
            message: "Continuation",
            timestamp: null,
            isVisible: true,
            turnDurationMs: 2300,
          }
        );
        await snapshots.save(snapshot);
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "Continue", "u2"));
            emit(replayChunk("agent_message_chunk", "Continuation", "a2"));
          },
        });
        const { manager } = buildHistoryHarness({
          sessionSnapshots: snapshots,
          createBackendProcess: jest.fn(() => replay.backend),
        });

        const session = await manager.loadNativeSessionFromHistory("native", "saved-chat");

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "Review"],
          [AI_SENDER, "Reviewed"],
          [USER_SENDER, "Continue"],
          [AI_SENDER, "Continuation"],
        ]);
        expect(session.getBranchState()!.historyPending).toBe(false);
        expect(session.store.getDisplayMessages()[3].turnDurationMs).toBe(2300);
      });

      it("merges a newer native continuation after the preserved branch prefix", async () => {
        const { snapshots } = snapshotHarness();
        await snapshots.save(
          snapshotFixture({
            branch: {
              sourceChatId: "parent",
              sourceMessageId: "a1",
              inheritedMessageCount: 2,
              historyPending: false,
            },
          })
        );
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "New turn", "u2"));
            emit(replayChunk("agent_message_chunk", "New answer", "a2"));
          },
        });
        const { manager } = buildHistoryHarness({
          sessionSnapshots: snapshots,
          createBackendProcess: jest.fn(() => replay.backend),
        });

        const session = await manager.loadNativeSessionFromHistory("native", "saved-chat");

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "Review"],
          [AI_SENDER, "Reviewed"],
          [USER_SENDER, "New turn"],
          [AI_SENDER, "New answer"],
        ]);
      });

      it("keeps the frames replayed before the load response as history bubbles and drops out-of-turn frames that arrive after it", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "test", "u1"));
            emit(replayChunk("agent_message_chunk", "first ", "a1"));
          },
        });
        const { manager } = buildHistoryHarness({
          createBackendProcess: jest.fn(() => replay.backend),
        });

        const session = await manager.loadNativeSessionFromHistory("native", "saved-chat");
        replay.emit("saved-chat", replayChunk("agent_message_chunk", "second", "a1"));

        expect(senderAndText(session)).toEqual([
          [USER_SENDER, "test"],
          [AI_SENDER, "first "],
        ]);
      });

      it("shows a reopened Claude chat's thinking, tool call with its result, todo plan, and reply from the frames its backend replays during load", async () => {
        const replay = buildReplayingBackend({
          onLoad: (emit) => {
            emit(replayChunk("user_message_chunk", "rename the note", "u1"));
            emit({ sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "mv" } });
            emit({
              sessionUpdate: "tool_call",
              toolCallId: "tool-mv",
              title: "Bash: mv a.md b.md",
              kind: "execute",
              status: "in_progress",
            });
            emit({ sessionUpdate: "tool_call_update", toolCallId: "tool-mv", status: "completed" });
            emit({
              sessionUpdate: "plan",
              entries: [{ content: "Rename the note", status: "completed", priority: "medium" }],
            });
            emit(replayChunk("agent_message_chunk", "Renamed.", "a1"));
          },
        });
        const { manager } = buildHistoryHarness({
          backendId: "claude",
          createBackendProcess: jest.fn(() => replay.backend),
        });

        const session = await manager.loadNativeSessionFromHistory("claude", "saved-chat");

        const [user, reply] = session.store.getDisplayMessages();
        expect(session.store.getDisplayMessages()).toHaveLength(2);
        expect([user.sender, user.message]).toEqual([USER_SENDER, "rename the note"]);
        expect(reply.parts?.map((p) => p.kind)).toEqual(["thought", "tool_call", "plan", "text"]);
        expect(reply.parts?.find((p) => p.kind === "tool_call")).toMatchObject({
          id: "tool-mv",
          status: "completed",
        });
      });

      it("registers the chat's handler before asking the backend to load the session", async () => {
        const replay = buildReplayingBackend();
        const { manager } = buildHistoryHarness({
          createBackendProcess: jest.fn(() => replay.backend),
        });

        await manager.loadNativeSessionFromHistory("native", "saved-chat");

        expect(replay.handlerCountAtOpen.load).toBe(1);
      });

      it("registers the chat's handler before falling back to resumeSession when load is unsupported", async () => {
        const replay = buildReplayingBackend({
          loadSession: jest.fn(async () => {
            throw new MethodUnsupportedError("session/load");
          }),
        });
        const { manager } = buildHistoryHarness({
          createBackendProcess: jest.fn(() => replay.backend),
        });

        await manager.loadNativeSessionFromHistory("native", "saved-chat");

        expect(replay.backend.resumeSession).toHaveBeenCalledTimes(1);
        expect(replay.handlerCountAtOpen.resume).toBe(1);
      });

      it("drops out-of-turn agent frames for a chat reopened through resumeSession, which replays nothing", async () => {
        const replay = buildReplayingBackend({
          loadSession: jest.fn(async () => {
            throw new MethodUnsupportedError("session/load");
          }),
        });
        const { manager } = buildHistoryHarness({
          createBackendProcess: jest.fn(() => replay.backend),
        });

        const session = await manager.loadNativeSessionFromHistory("native", "saved-chat");
        replay.emit("saved-chat", replayChunk("agent_message_chunk", "background", "a1"));

        expect(senderAndText(session)).toEqual([]);
      });

      it.each([
        ["load fails", new Error("load blew up"), undefined],
        [
          "load is unsupported and resume fails",
          new MethodUnsupportedError("session/load"),
          new Error("resume blew up"),
        ],
      ] as const)(
        "disposes the attached chat and opens nothing when %s",
        async (_case, loadError, resumeError) => {
          const replay = buildReplayingBackend({
            loadSession: jest.fn(async () => {
              throw loadError;
            }),
            ...(resumeError
              ? {
                  resumeSession: jest.fn(async () => {
                    throw resumeError;
                  }),
                }
              : {}),
          });
          const { manager } = buildHistoryHarness({
            createBackendProcess: jest.fn(() => replay.backend),
          });

          await expect(
            manager.loadNativeSessionFromHistory("native", "saved-chat")
          ).rejects.toThrow("Could not resume");

          expect(replay.unregister).toHaveBeenCalledTimes(1);
          expect(manager.getSessions()).toEqual([]);
        }
      );

      it("matches live sessions by the (backendId, sessionId) pair, not session id alone", async () => {
        const { manager } = buildHistoryHarness();
        const session = await manager.createSession("native");
        const liveId = session.getBackendSessionId()!;

        await expect(manager.loadNativeSessionFromHistory("native", liveId)).resolves.toBe(session);

        await expect(manager.loadNativeSessionFromHistory("codex", liveId)).rejects.toThrow();
        expect(manager.getActiveSession()).toBe(session);
      });

      it("does not spawn or load history through an incompatible binary", async () => {
        const createBackendProcess = jest.fn(() => makeMockBackendProcess());
        const { manager } = buildHistoryHarness({
          installState: {
            kind: "incompatible",
            source: "custom",
            currentVersion: "1",
            minVersion: "2",
            message: "Update required",
          },
          createBackendProcess,
        });
        await expect(manager.loadNativeSessionFromHistory("native", "saved-chat")).rejects.toThrow(
          "Could not resume"
        );
        expect(createBackendProcess).not.toHaveBeenCalled();
        expect(manager.getActiveSession()).toBeNull();
        expect(manager.getLastError()).toContain("Update required");
      });

      it("keeps the native history model and mode instead of applying the new-chat defaults https://github.com/ItsDalk-Lane/Scribe/issues/31", async () => {
        const state: BackendState = {
          model: {
            current: { baseModelId: "history-model", effort: "low" },
            availableModels: [
              { baseModelId: "history-model", name: "History", provider: null, effortOptions: [] },
              {
                baseModelId: "new-chat-model",
                name: "New chat",
                provider: null,
                effortOptions: [],
              },
            ],
            apply: { kind: "setModel" },
          },
          mode: {
            current: "plan",
            options: [
              { value: "plan", label: "Plan" },
              { value: "auto", label: "Auto" },
            ],
            apply: {
              plan: { kind: "setMode", nativeId: "plan" },
              auto: { kind: "setMode", nativeId: "auto" },
            },
          },
        };
        const setSessionModel = jest.fn(async () => state);
        const setSessionMode = jest.fn(async () => state);
        const backend = buildResumeOnlyBackend({
          resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
            sessionId,
            state,
          })),
          setSessionModel,
          setSessionMode,
        });
        const { manager } = buildHistoryHarness({ createBackendProcess: jest.fn(() => backend) });
        getSettingsMock.mockReturnValue({
          agentMode: {
            activeBackend: "native",
            backends: {
              native: {
                defaultModel: { baseModelId: "new-chat-model", effort: "high" },
                defaultMode: "auto",
              },
            },
          },
        });
        const session = await manager.loadNativeSessionFromHistory("native", "saved-chat");
        expect(session.getState()?.model?.current).toEqual({
          baseModelId: "history-model",
          effort: "low",
        });
        expect(session.getState()?.mode?.current).toBe("plan");
        expect(setSessionModel).not.toHaveBeenCalled();
        expect(setSessionMode).not.toHaveBeenCalled();
      });

      it("applies persisted backend config and mode before returning a resumed session", async () => {
        const backendState = (effort: string, mode: "default" | "auto"): BackendState => ({
          model: {
            current: { baseModelId: "sonnet", effort },
            availableModels: [],
            apply: { kind: "setModel" },
          },
          mode: {
            current: mode,
            options: [
              { value: "default", label: "Default" },
              { value: "auto", label: "Auto" },
            ],
            apply: {
              default: { kind: "setMode", nativeId: "default" },
              auto: { kind: "setMode", nativeId: "bypassPermissions" },
            },
          },
        });
        const setSessionConfigOption = jest.fn(async () => backendState("high", "default"));
        const setSessionMode = jest.fn(async () => backendState("high", "auto"));
        const backend = buildResumeOnlyBackend({
          resumeSession: jest.fn(async ({ sessionId }: { sessionId: string }) => ({
            sessionId,
            state: backendState("low", "default"),
          })),
          setSessionConfigOption,
          setSessionMode,
        });
        const applyStarted = deferred();
        const applyRelease = deferred();
        const applyInitialSessionConfig = jest.fn(async (session: AgentSession) => {
          applyStarted.resolve();
          await applyRelease.promise;
          await session.setConfigOption("effort", "high");
        });
        const { manager } = buildHistoryHarness({
          backendId: "claude",
          createBackendProcess: jest.fn(() => backend),
          applyInitialSessionConfig,
        });
        getSettingsMock.mockReturnValue({
          agentMode: {
            activeBackend: "claude",
            backends: { claude: { defaultMode: "auto" } },
          },
        });

        let returned = false;
        const loading = manager
          .loadNativeSessionFromHistory("claude", "saved-chat")
          .then((session) => {
            returned = true;
            return session;
          });
        await applyStarted.promise;
        await Promise.resolve();
        expect(returned).toBe(false);

        applyRelease.resolve();
        const session = await loading;

        expect(applyInitialSessionConfig).toHaveBeenCalledWith(
          session,
          expect.objectContaining({ agentMode: expect.any(Object) }),
          undefined
        );
        expect(setSessionConfigOption).toHaveBeenCalledWith({
          sessionId: "saved-chat",
          configId: "effort",
          value: "high",
        });
        expect(setSessionMode).toHaveBeenCalledWith({
          sessionId: "saved-chat",
          modeId: "bypassPermissions",
        });
        expect(session.getState()?.model?.current.effort).toBe("high");
        expect(session.getState()?.mode?.current).toBe("auto");
      });

      it("keeps focus on the most recently opened history row when resumes finish out of order", async () => {
        const backend = buildResumeOnlyBackend();
        const firstStarted = deferred();
        const firstRelease = deferred();
        const applyInitialSessionConfig = jest.fn(async (session: AgentSession) => {
          if (session.getBackendSessionId() !== "first-chat") return;
          firstStarted.resolve();
          await firstRelease.promise;
        });
        const { manager } = buildHistoryHarness({
          backendId: "claude",
          createBackendProcess: jest.fn(() => backend),
          applyInitialSessionConfig,
        });

        const firstLoading = manager.loadNativeSessionFromHistory("claude", "first-chat");
        await firstStarted.promise;
        const second = await manager.loadNativeSessionFromHistory("claude", "second-chat");
        expect(manager.getActiveSession()).toBe(second);

        firstRelease.resolve();
        const first = await firstLoading;

        expect(first).not.toBe(second);
        expect(manager.getSessions()).toHaveLength(2);
        expect(manager.getActiveSession()).toBe(second);
      });

      it("shares one in-flight resume when the same history row is opened twice", async () => {
        const backend = buildResumeOnlyBackend();
        const applyStarted = deferred();
        const applyRelease = deferred();
        const applyInitialSessionConfig = jest.fn(async () => {
          applyStarted.resolve();
          await applyRelease.promise;
        });
        const { manager } = buildHistoryHarness({
          backendId: "claude",
          createBackendProcess: jest.fn(() => backend),
          applyInitialSessionConfig,
        });

        const firstLoading = manager.loadNativeSessionFromHistory("claude", "saved-chat");
        await applyStarted.promise;
        const secondLoading = manager.loadNativeSessionFromHistory("claude", "saved-chat");
        applyRelease.resolve();
        const [first, second] = await Promise.all([firstLoading, secondLoading]);

        expect(first).toBe(second);
        expect(backend.resumeSession).toHaveBeenCalledTimes(1);
        expect(applyInitialSessionConfig).toHaveBeenCalledTimes(1);
        expect(manager.getSessions()).toEqual([first]);
        expect(manager.getActiveSession()).toBe(first);
      });

      it("rolls the active scope back when a cross-scope history load fails to resume", async () => {
        seedProjects("proj-rollback");
        const mgr = buildManager();
        await mgr.enterProject("proj-rollback");
        const projectSession = mgr.getActiveSession();
        expect(mgr.getActiveProjectId()).toBe("proj-rollback");

        await expect(mgr.loadNativeSessionFromHistory("codex", "missing")).rejects.toThrow();

        expect(mgr.getActiveProjectId()).toBe("proj-rollback");
        expect(mgr.getActiveSession()).toBe(projectSession);
      });
    });

    describe("enterProject", () => {
      const PROJECT_ID = "proj-enter";

      function makeRecord(
        contextSource: ProjectConfig["contextSource"],
        usageTimestamps = 0,
        systemPrompt = ""
      ): ProjectFileRecord {
        return {
          project: {
            id: PROJECT_ID,
            name: PROJECT_ID,
            systemPrompt,
            contextSource,
            created: 0,
            UsageTimestamps: usageTimestamps,
          },
          filePath: `Projects/${PROJECT_ID}/project.md`,
          folderName: PROJECT_ID,
        };
      }

      function publish(record: ProjectFileRecord): void {
        projectsState.updateCachedProjectRecords([record]);
      }

      beforeEach(() => seedProjects(PROJECT_ID));

      it("closes the project's least recently hidden idle chat once entering it hides a fourth chat of a process-per-chat backend", async () => {
        const mgr = buildManager({ descriptor: buildDescriptor({ processPerChat: true }) });
        const chats = [];
        for (let i = 0; i < 4; i++) chats.push(await enterWithConversation(mgr, PROJECT_ID));
        expect(closedSessions()).toEqual([]);

        await mgr.enterProject(PROJECT_ID);

        expect(closedSessions()).toEqual([chats[0]]);
      });

      it("touches last-used after a successful enter that spawns a session", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        expect(ProjectFileManager.getInstance).toHaveBeenCalled();
        expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(PROJECT_ID);
      });

      it("ensures vault-root instruction discovery before a project session, not just global", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        expect(ensureAgentsFileForDiscoverySpy).toHaveBeenCalledWith(expect.anything(), "");
        expect(ensureAgentsFileForDiscoverySpy).toHaveBeenCalledWith(
          expect.anything(),
          `Projects/${PROJECT_ID}`
        );
      });

      it("touches last-used on the restored-session path (no re-spawn)", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await mgr.exitProject();
        mockTouchProjectLastUsed.mockClear();
        sessionCreateSpy.mockClear();

        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(PROJECT_ID);
      });

      it("does not touch a re-click of the already-active project", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        mockTouchProjectLastUsed.mockClear();

        await mgr.enterProject(PROJECT_ID);

        expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
      });

      it("does not touch when the spawn fails", async () => {
        const mgr = buildManager();
        mockBackendStart.mockRejectedValueOnce(new Error("spawn boom"));

        await expect(mgr.enterProject(PROJECT_ID)).rejects.toThrow();

        expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
      });

      it("touches only the current scope when another enter wins the spawn race", async () => {
        const OTHER_ID = "proj-other";
        seedProjects(PROJECT_ID, OTHER_ID);
        const mgr = buildManager();

        const enterStale = mgr.enterProject(PROJECT_ID);
        const enterWinner = mgr.enterProject(OTHER_ID);
        await Promise.all([enterStale, enterWinner]);

        expect(mockTouchProjectLastUsed).toHaveBeenCalledWith(OTHER_ID);
        expect(mockTouchProjectLastUsed).not.toHaveBeenCalledWith(PROJECT_ID);
      });

      it("rolls the entered scope back when its auto-spawn fails", async () => {
        const OTHER_ID = "proj-other-fail";
        seedProjects(PROJECT_ID, OTHER_ID);
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const projectSession = mgr.getActiveSession();
        expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);

        sessionCreateSpy.mockImplementationOnce(() => {
          throw new Error("spawn boom");
        });
        await expect(mgr.enterProject(OTHER_ID)).rejects.toThrow();

        expect(mgr.getActiveProjectId()).toBe(PROJECT_ID);
        expect(mgr.getActiveSession()).toBe(projectSession);
      });

      it("detaches a conversational session on re-entry and spawns a fresh one", async () => {
        const mgr = buildManager();
        const old = await enterWithConversation(mgr, PROJECT_ID);

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        const visible = mgr.getSessionsForScope(PROJECT_ID);
        expect(visible).toHaveLength(1);
        expect(visible[0].internalId).not.toBe(old.internalId);
        expect(mgr.getSessions()).toContain(old);
      });

      it("reuses an empty landing session instead of stacking a blank tab", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession();
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(landing);
        expect(mgr.getSessionsForScope(PROJECT_ID)).toHaveLength(1);
      });

      it("does not reuse an error-state landing; spawns a fresh session instead", async () => {
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        getSessionTestHandle(landing).setStatus("error");
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(landing);
      });

      it("replaces an empty landing on re-entry after the project's sources change", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();

        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        const visible = mgr.getSessionsForScope(PROJECT_ID);
        expect(visible).toHaveLength(1);
        expect(visible[0]).not.toBe(landing);
      });

      it("reuses the replacement landing on a later re-entry when nothing changed since", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));
        await mgr.enterProject(PROJECT_ID);
        await flushTimers();
        const fresh = mgr.getActiveSession();
        await mgr.exitProject();

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(fresh);
      });

      it("reuses an empty landing after a usage-timestamp-only touch", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession();
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com" }, 12345));

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(landing);
      });

      it("does not reuse an empty landing after a System-Prompt-only edit", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }, 0, "old instructions"));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        await mgr.exitProject();

        publish(makeRecord({ webUrls: "https://a.com" }, 0, "new instructions"));

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).toHaveBeenCalledTimes(1);
        expect(mgr.getActiveSession()).not.toBe(landing);
      });

      it("reuses an empty landing after vault content inside the project's sources changes, building its context at the first message", async () => {
        jest.useFakeTimers();
        publish(makeRecord({ inclusions: "Notes" }));
        const app = buildApp();
        const mgr = buildManager({ app });
        await mgr.enterProject(PROJECT_ID);
        const landing = mgr.getActiveSession()!;
        await mgr.exitProject();

        const onModify = (app.vault.on as jest.Mock).mock.calls.find(
          ([event]) => event === "modify"
        )![1];
        onModify(mockTFile({ path: "Notes/topic.md", extension: "md" }));
        jest.advanceTimersByTime(2000);

        sessionCreateSpy.mockClear();
        await mgr.enterProject(PROJECT_ID);

        expect(sessionCreateSpy).not.toHaveBeenCalled();
        expect(mgr.getActiveSession()).toBe(landing);
      });

      it("leaves the first message without an update note, since its context block is built from the current vault", async () => {
        jest.useFakeTimers();
        publish(makeRecord({ inclusions: "Notes" }));
        const app = buildApp();
        const mgr = buildManager({ app });
        await mgr.enterProject(PROJECT_ID);
        const hooks = sessionCreateSpy.mock.calls.at(-1)![0];

        const onModify = (app.vault.on as jest.Mock).mock.calls.find(
          ([event]) => event === "modify"
        )![1];
        onModify(mockTFile({ path: "Notes/topic.md", extension: "md" }));

        hooks.getProjectContextBlock!();
        expect(hooks.getProjectContextUpdates!()).toBeNull();
      });

      it("hands a project session the update note once per change until it acknowledges the epoch", async () => {
        publish(makeRecord({ webUrls: "https://a.com" }));
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        await flushTimers();
        const hooks = sessionCreateSpy.mock.calls.at(-1)![0];
        expect(hooks.getProjectContextUpdates!()).toBeNull();

        publish(makeRecord({ webUrls: "https://a.com\nhttps://b.com" }));

        const update = hooks.getProjectContextUpdates!();
        expect(update?.block).toContain("<project_context_updates>");
        hooks.markProjectContextUpdatesDelivered!(update!.epoch);
        expect(hooks.getProjectContextUpdates!()).toBeNull();
      });
    });

    describe("exitProject", () => {
      const PROJECT_ID = "proj-exit";

      it("does not touch last-used when returning to the global scope", async () => {
        seedProjects(PROJECT_ID);
        const mgr = buildManager();
        await mgr.enterProject(PROJECT_ID);
        mockTouchProjectLastUsed.mockClear();

        await mgr.exitProject();

        expect(mockTouchProjectLastUsed).not.toHaveBeenCalled();
      });
    });
  });
});
