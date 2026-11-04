import { t } from "@/lib/i18n";
import { isAgentBackendEnabled } from "@/settings/agentEnablement";
import { isCompactCommand } from "@/commands/compactCommand";
import type { AgentMcpServer } from "@/agentMode/session/types";
import type { ScribeMcpServer, FeedbackOfferHandler } from "@/agentMode/session/scribeMcpServer";
import { logError, logInfo, logWarn } from "@/logger";
import type ScribePlugin from "@/main";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import {
  AgentInputDraftStore,
  type AgentInputDraft,
} from "@/agentMode/session/AgentInputDraftStore";
import { getSettings, setSettings, subscribeToSettingsChange } from "@/settings/model";
import { buildProjectContext } from "@/context/manifestBuilder";
import { err2String } from "@/utils";
import type { ChatHistoryItem } from "@/components/chat-components/ChatHistoryPopover";
import {
  fileToHistoryItem,
  parseChatPinnedAt,
  readChatPathProjectId,
} from "@/utils/chatHistoryUtils";
import { readFrontmatterViaAdapter } from "@/utils/vaultAdapterUtils";
import { App, FileSystemAdapter, Notice, Platform, TFile } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { AgentSession, ATTENTION_TRIGGER_STATUSES, DEFAULT_TITLE_PREFIX } from "./AgentSession";
import type { AgentChatPersistenceManager, LoadedAgentChat } from "./AgentChatPersistenceManager";
import type { AgentModelPreloader } from "./AgentModelPreloader";
import { buildNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
import { CHAT_AGENT_VIEWTYPE, USER_SENDER } from "@/constants";
import { playNotificationSound } from "@/utils/notificationSound";
import type { AgentSessionIndex, AgentSessionIndexEntry } from "./AgentSessionIndex";
import type {
  AgentSessionSnapshots,
  AgentSessionSnapshot,
} from "@/agentMode/session/AgentSessionSnapshots";
import {
  createNodeTaskOutputReader,
  TaskOutputTail,
  type TaskOutputReader,
} from "@/agentMode/session/taskOutputTail";
import { mergeSnapshotReplay } from "@/agentMode/session/sessionSnapshotMessages";
import {
  deriveChatTitleFromMessages,
  mergeChatHistoryItems,
  type MarkdownChatEntry,
} from "./chatHistoryMerge";
import { MethodUnsupportedError } from "./errors";
import { replayPersistedMode } from "./replayPersistedMode";
import { applyModeSpec } from "./modeApply";
import { modelCatalogSignature } from "./translateBackendState";
import { GLOBAL_SCOPE, type ProjectScopeId } from "./scope";
import {
  OrphanedProjectError,
  pickScopeNeighbor,
  resolveProjectIdForCwd,
  resolveScopeCwd,
} from "./sessionScope";
import {
  getCachedProjectRecordById,
  getCachedProjectRecords,
  subscribeToProjectRecords,
} from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";
import {
  getProjectContextSignature,
  getProjectLandingCaptureSignature,
} from "@/projects/projectContextSignature";
import { ProjectContentTracker } from "@/context/projectContentTracker";
import { buildProjectContextUpdatesBlock } from "@/context/contextUpdatesBlockBuilder";
import { ensureAgentsFileForDiscovery } from "@/instructions/agentsFile";
import { moveProjectPromptToAgentsFile } from "@/projects/moveProjectPrompt";
import { getProjectAnchorFromConfigPath } from "@/projects/projectPaths";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  BackendDescriptor,
  BackendId,
  BackendModelCatalog,
  BackendProcess,
  ScribeMode,
  EffortOption,
  LoadSessionOutput,
  ModeApplySpec,
  ModelSelection,
  PermissionDecision,
  PermissionPrompt,
  SessionId,
} from "./types";

const AUTOSAVE_DEBOUNCE_MS = 500;
const LIST_SESSIONS_TIMEOUT_MS = 1_500;

function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise<T>((resolve) => {
    const timer = window.setTimeout(() => resolve(fallback), ms);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      () => {
        window.clearTimeout(timer);
        resolve(fallback);
      }
    );
  });
}

function sessionRefFromFrontmatter(
  frontmatter: Record<string, unknown> | undefined
): { backendId: BackendId; sessionId: string } | null {
  const backendId = typeof frontmatter?.backendId === "string" ? frontmatter.backendId.trim() : "";
  const sessionId = typeof frontmatter?.sessionId === "string" ? frontmatter.sessionId.trim() : "";
  if (!backendId || !sessionId) return null;
  return { backendId, sessionId };
}

function isSameCwd(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/[/\\]+$/, "");
  return norm(a) === norm(b);
}

const EMPTY_SESSIONS = Object.freeze([]) as unknown as AgentSession[];
const EMPTY_HISTORY_ITEMS = Object.freeze([]) as unknown as ChatHistoryItem[];
const EMPTY_RECENT_CHAT_IDS: ReadonlySet<string> = new Set();
const EMPTY_CHAT_INPUT_IDS: readonly string[] = Object.freeze([]);
const EMPTY_MCP_SERVERS: ReadonlyArray<AgentMcpServer> = Object.freeze([]);

const RESUMED_SESSION_BEHIND_EPOCH = -1;
const MAX_HIDDEN_PROCESS_CHATS = 3;

function hasUnsentInput(draft: AgentInputDraft | undefined): boolean {
  return (
    !!draft &&
    (draft.input.trim() !== "" ||
      draft.images.length > 0 ||
      draft.contextNotes.length > 0 ||
      draft.webTabs.length > 0 ||
      draft.queue.length > 0)
  );
}

function hasRunningTask(session: AgentSession): boolean {
  return session.getTasks().some((task) => task.status === "running");
}

function hasRunningSubagent(session: AgentSession): boolean {
  return session.getTasks().some((task) => task.kind === "subagent" && task.status === "running");
}

export type PermissionPrompter = (req: PermissionPrompt) => Promise<PermissionDecision>;

export type AskUserQuestionPrompter = (req: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;

export type DescriptorResolver = (id: BackendId) => BackendDescriptor | undefined;

export interface PinnedChat {
  id: string;
  pinnedAt?: number;
}

export interface ReplaceSessionOptions {
  preserveChatInput?: boolean;
  seedSelection?: ModelSelection;
}

export interface AgentSessionManagerOptions {
  permissionPrompter: PermissionPrompter;
  askUserQuestionPrompter?: AskUserQuestionPrompter;
  resolveDescriptor: DescriptorResolver;
  modelPreloader: AgentModelPreloader;
  beforeBackendStart?: (id: BackendId) => Promise<void>;
  persistenceManager?: AgentChatPersistenceManager;
  sessionIndex?: AgentSessionIndex;
  sessionSnapshots?: AgentSessionSnapshots;
  taskOutputReader?: TaskOutputReader;
  scribeMcpServer?: ScribeMcpServer;
}

export class AgentSessionManager {
  private backends = new Map<BackendId, BackendProcess>();
  private starting = new Map<BackendId, Promise<BackendProcess>>();
  private sessions = new Map<string, AgentSession>();
  private chatUIStates = new Map<string, AgentChatUIState>();
  private activeSessionId: string | null = null;
  private activeProjectId: ProjectScopeId = GLOBAL_SCOPE;
  private scopeSeq = 0;
  private readonly lastActiveByScope = new Map<ProjectScopeId, string>();
  private readonly detachedFromTabIds = new Set<string>();
  private readonly landingCaptureSignatures = new Map<string, string>();
  private readonly contentTracker: ProjectContentTracker;
  private readonly lastSeenProjectContentEpochBySession = new Map<string, number>();
  private previousProjectRecords: ProjectFileRecord[] = [];
  private projectRecordsUnsubscriber?: () => void;
  private readonly firstSessionPromiseByScope = new Map<ProjectScopeId, Promise<AgentSession>>();
  private readonly replacementCursorByChatInputId = new Map<string, Promise<string>>();
  readonly drafts: AgentInputDraftStore;
  private readonly resumedSessionPromiseById = new Map<string, Promise<AgentSession | null>>();
  private latestHistoryLoadRequestId = 0;
  private pendingCreates = 0;
  private listeners = new Set<() => void>();
  private disposed = false;
  private startingBackendId: BackendId | null = null;
  private lastError: string | null = null;
  private lastErrorSeq = 0;

  private readonly pendingBackendRestarts = new Map<
    BackendId,
    { reason: string; immediate: boolean }
  >();
  private readonly restartingBackends = new Set<BackendId>();
  private readonly heldConfigChanges = new Map<BackendId, string>();
  private readonly retainedChatInputIds = new Set<string>();
  private readonly warnedUnavailableModels = new Set<string>();
  private readonly preloader: AgentModelPreloader;
  private readonly preloadStatus = new Map<BackendId, "pending" | "ready" | "error">();
  private readonly sessionState = new Map<
    string,
    {
      source?: { path: string };
      timer?: number;
      saving?: Promise<unknown>;
      indexTimer?: number;
      unsub?: () => void;
      signature?: string;
      dirty?: boolean;
      attentionUnsub?: () => void;
      snapshotTimer?: number;
      snapshotSaving?: Promise<void>;
      snapshotFailureReported?: boolean;
    }
  >();

  private readonly pendingBackendDisables = new Set<BackendId>();
  private readonly dirtyExtensionSessions = new Set<string>();
  private readonly backendStops = new Map<BackendId, Promise<void>>();
  private readonly backendEnablementWork = new Map<
    BackendId,
    { enabled: boolean; work: Promise<void> }
  >();
  private readonly settingsUnsub: () => void;

  private getSessionState(internalId: string) {
    let entry = this.sessionState.get(internalId);
    if (!entry) {
      entry = {};
      this.sessionState.set(internalId, entry);
    }
    return entry;
  }

  constructor(
    private readonly app: App,
    private readonly plugin: ScribePlugin,
    private readonly opts: AgentSessionManagerOptions
  ) {
    if (Platform.isMobile) {
      throw new Error("AgentSessionManager is desktop only");
    }
    this.preloader = opts.modelPreloader;
    this.drafts = new AgentInputDraftStore(app, (chatInputId) =>
      this.getLiveChatInputIds().includes(chatInputId)
    );
    this.settingsUnsub = subscribeToSettingsChange((prev, next) => {
      const ids = new Set([
        ...Object.keys(prev.agentMode?.backends ?? {}),
        ...Object.keys(next.agentMode?.backends ?? {}),
      ]);
      for (const id of ids) {
        if (!this.opts.resolveDescriptor(id)) continue;
        const enabled = isAgentBackendEnabled(next, id);
        const changed = isAgentBackendEnabled(prev, id) !== enabled;
        const modelsChanged =
          prev.backends?.[id as keyof typeof prev.backends] !==
          next.backends?.[id as keyof typeof next.backends];
        if (
          changed ||
          (enabled &&
            modelsChanged &&
            this.getSessions().some(
              (session) => session.backendId === id && session.isBackendSuspended()
            ))
        ) {
          void this.queueBackendEnablement(id, enabled).catch((error) => {
            this.setLastError(err2String(error));
            this.notify();
          });
        }
      }
    });
    this.contentTracker = new ProjectContentTracker(this.app);
    this.setupProjectRecordChangeMonitor();
  }

  isBackendEnabled(backendId: BackendId): boolean {
    return isAgentBackendEnabled(getSettings(), backendId);
  }

  isBackendDisablePending(backendId: BackendId): boolean {
    return this.pendingBackendDisables.has(backendId);
  }

  noteExtensionsChanged(
    backendId: BackendId,
    scope?: import("./extensionManagement").AgentExtensionScope
  ): void {
    for (const session of this.sessions.values()) {
      if (
        session.backendId === backendId &&
        (!scope || scope.kind === "user" || session.cwd === scope.cwd)
      )
        this.dirtyExtensionSessions.add(session.internalId);
    }
    void this.preloader.stop(backendId).catch((error) => {
      logWarn(`[AgentMode] clearing extension probe failed: ${backendId}`, error);
    });
    this.preloadStatus.delete(backendId);
    this.notify();
  }

  isExtensionChangePending(
    backendId: BackendId,
    scope: import("./extensionManagement").AgentExtensionScope
  ): boolean {
    for (const id of this.dirtyExtensionSessions) {
      const session = this.sessions.get(id);
      if (session?.backendId === backendId && (scope.kind === "user" || session.cwd === scope.cwd))
        return true;
    }
    return false;
  }

  async applyExtensionChanges(
    backendId: BackendId,
    scope: import("./extensionManagement").AgentExtensionScope,
    signal?: AbortSignal
  ): Promise<void> {
    this.noteExtensionsChanged(backendId, scope);
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    await new Promise<void>((resolve, reject) => {
      const finish = () => {
        unsubscribe();
        signal?.removeEventListener("abort", abort);
      };
      const abort = () => {
        finish();
        const reason: unknown = signal?.reason;
        reject(reason instanceof Error ? reason : new DOMException("Aborted", "AbortError"));
      };
      const check = () => {
        for (const session of this.sessions.values()) {
          if (
            session.backendId !== backendId ||
            (scope.kind === "project" && session.cwd !== scope.cwd)
          )
            continue;
          this.prepareNextPrompt(session.internalId);
          if (this.dirtyExtensionSessions.has(session.internalId)) return;
        }
        finish();
        resolve();
      };
      const unsubscribe = this.subscribe(check);
      signal?.addEventListener("abort", abort, { once: true });
      check();
    });
  }

  private prepareNextPrompt(internalId: string): void {
    if (!this.dirtyExtensionSessions.has(internalId)) return;
    const session = this.sessions.get(internalId);
    if (
      !session ||
      ["starting", "running", "awaiting_permission"].includes(session.getStatus()) ||
      hasRunningTask(session)
    )
      return;
    const sessionId = session.getBackendSessionId();
    if (sessionId) this.backends.get(session.backendId)?.refreshSessionConfiguration?.(sessionId);
    this.dirtyExtensionSessions.delete(internalId);
    this.notify();
  }

  async setBackendEnabled(backendId: BackendId, enabled: boolean): Promise<void> {
    this.resolveDescriptor(backendId);
    setSettings((current) => ({
      agentMode: {
        ...current.agentMode,
        backends: {
          ...current.agentMode.backends,
          [backendId]: {
            ...current.agentMode.backends[backendId as keyof typeof current.agentMode.backends],
            enabled,
          },
        },
      },
    }));
    await this.queueBackendEnablement(backendId, enabled);
  }

  private queueBackendEnablement(backendId: BackendId, enabled: boolean): Promise<void> {
    const prior = this.backendEnablementWork.get(backendId);
    if (prior?.enabled === enabled) return prior.work;
    const work = (prior?.work ?? Promise.resolve())
      .catch(() => undefined)
      .then(async () => {
        if (this.disposed || this.isBackendEnabled(backendId) !== enabled) return;
        if (!enabled) {
          this.pendingBackendDisables.add(backendId);
          this.notify();
          await this.preloader.stop(backendId);
          for (const session of this.sessions.values()) {
            if (session.backendId !== backendId) continue;
            for (const prompt of session.getQueuedPrompts())
              await session.withdrawPrompt(prompt.id);
          }
          await this.finishBackendDisableIfReady(backendId);
          return;
        }
        this.pendingBackendDisables.delete(backendId);
        await this.backendStops.get(backendId);
        if (this.disposed || !this.isBackendEnabled(backendId)) return;
        const descriptor = this.resolveDescriptor(backendId);
        if (descriptor.getInstallState(getSettings()).kind !== "ready") {
          this.notify();
          return;
        }
        if (
          !this.backends.get(backendId)?.isRunning() &&
          !this.preloader.getCachedModelCatalog(backendId)
        ) {
          const preload = this.preloader.preload(backendId);
          this.registerPreload(backendId, preload);
          await preload;
        }
        for (const session of this.sessions.values()) {
          if (session.backendId !== backendId || !session.isBackendSuspended()) continue;
          const selection = this.getSeedSelection(backendId, session.getState()?.model?.current);
          if (!selection) continue;
          const backend = await this.ensureBackend(backendId, descriptor);
          const mcpServers = await this.connectScribeMcpServer(
            session.internalId,
            descriptor,
            session.cwd ?? this.resolveSessionCwd(session.projectId)
          );
          await session.resumeBackend(backend, selection, mcpServers);
        }
        this.notify();
      });
    const entry = { enabled, work };
    this.backendEnablementWork.set(backendId, entry);
    void work
      .finally(() => {
        if (this.backendEnablementWork.get(backendId) === entry)
          this.backendEnablementWork.delete(backendId);
      })
      .catch(() => {});
    return work;
  }

  private async finishBackendDisableIfReady(backendId: BackendId): Promise<void> {
    if (!this.pendingBackendDisables.has(backendId) || this.isBackendEnabled(backendId)) return;
    if (
      this.getSessions().some(
        (session) =>
          session.backendId === backendId &&
          (["starting", "running", "awaiting_permission"].includes(session.getStatus()) ||
            hasRunningTask(session))
      )
    )
      return;
    const stopping = this.backendStops.get(backendId);
    if (stopping) return stopping;
    const work = (async () => {
      await this.starting.get(backendId)?.catch(() => undefined);
      if (this.disposed || this.isBackendEnabled(backendId)) return;
      const affected = this.getSessions().filter((session) => session.backendId === backendId);
      for (const session of affected) await this.drainAutoSave(session);
      if (this.isBackendEnabled(backendId)) return;
      if (
        affected.some(
          (session) =>
            ["starting", "running", "awaiting_permission"].includes(session.getStatus()) ||
            hasRunningTask(session)
        )
      )
        return;
      for (const session of affected) {
        session.suspendBackend();
        this.opts.scribeMcpServer?.disconnect(session.internalId);
      }
      const proc = this.backends.get(backendId);
      this.backends.delete(backendId);
      await proc?.shutdown();
      this.pendingBackendDisables.delete(backendId);
      this.preloadStatus.delete(backendId);
      this.pendingBackendRestarts.delete(backendId);
      this.heldConfigChanges.delete(backendId);
      this.notify();
    })();
    this.backendStops.set(backendId, work);
    try {
      await work;
    } finally {
      if (this.backendStops.get(backendId) === work) this.backendStops.delete(backendId);
    }
  }

  private setupProjectRecordChangeMonitor(): void {
    this.previousProjectRecords = getCachedProjectRecords();
    this.projectRecordsUnsubscriber?.();
    this.projectRecordsUnsubscriber = subscribeToProjectRecords((nextRecords) => {
      this.handleProjectRecordsChanged(nextRecords);
    });
  }

  private handleProjectRecordsChanged(nextRecords: ProjectFileRecord[]): void {
    if (this.disposed) return;
    const prevRecords = this.previousProjectRecords;
    this.previousProjectRecords = nextRecords;

    for (const nextRecord of nextRecords) {
      const prevRecord = prevRecords.find((r) => r.project.id === nextRecord.project.id);
      if (!prevRecord) continue;
      const nextSignature = getProjectContextSignature(nextRecord);
      if (getProjectContextSignature(prevRecord) === nextSignature) continue;

      this.contentTracker.bumpEpoch(nextRecord.project.id);
    }
  }

  private buildFirstProjectContextBlock(internalId: string, projectId: ProjectScopeId): string {
    this.contentTracker.flushNow();
    this.lastSeenProjectContentEpochBySession.set(
      internalId,
      this.contentTracker.getEpoch(projectId)
    );
    return buildProjectContext(this.app, projectId);
  }

  private getProjectContextUpdates(
    internalId: string,
    projectId: ProjectScopeId
  ): { epoch: number; block: string } | null {
    if (projectId === GLOBAL_SCOPE) return null;
    this.contentTracker.flushNow();
    const epoch = this.contentTracker.getEpoch(projectId);
    const lastSeen = this.lastSeenProjectContentEpochBySession.get(internalId) ?? 0;
    if (epoch <= lastSeen) return null;
    return { epoch, block: buildProjectContextUpdatesBlock() };
  }

  private markProjectContextUpdatesDelivered(internalId: string, epoch: number): void {
    const lastSeen = this.lastSeenProjectContentEpochBySession.get(internalId) ?? 0;
    if (epoch > lastSeen) this.lastSeenProjectContentEpochBySession.set(internalId, epoch);
  }

  async getChatHistoryItems(scope?: ProjectScopeId): Promise<ChatHistoryItem[]> {
    const persistence = this.opts.persistenceManager;
    const index = this.opts.sessionIndex;
    if (!persistence && !index) return EMPTY_HISTORY_ITEMS;

    const liveAttentionPaths = this.collectLiveAttentionPaths();

    let files: TFile[] = [];
    let markdownEntries: MarkdownChatEntry[] = [];
    if (persistence) {
      files = await persistence.getAgentChatHistoryFiles();
      const tracker = this.plugin.getChatHistoryLastAccessedAtManager();
      markdownEntries = await Promise.all(
        files.map(async (file) => {
          const frontmatter = await this.readChatFrontmatter(file.path);
          const ref = sessionRefFromFrontmatter(frontmatter);
          const item = fileToHistoryItem(this.app, file, tracker);
          return {
            item: {
              ...item,
              pinnedAt: parseChatPinnedAt(frontmatter?.pinnedAt),
              ...(liveAttentionPaths.has(item.id) ? { needsAttention: true } : {}),
            },
            backendId: ref?.backendId,
            sessionId: ref?.sessionId,
          };
        })
      );
    }

    if (scope && scope !== GLOBAL_SCOPE) {
      const resolved = await Promise.all(
        files.map(async (file, i) => {
          const projectId =
            (await readChatPathProjectId(this.app, file.path))?.trim() || GLOBAL_SCOPE;
          return projectId === scope ? markdownEntries[i] : null;
        })
      );
      const scopedMarkdown = await this.dropNonLocalMarkdownEntries(
        resolved.filter((entry): entry is MarkdownChatEntry => entry !== null)
      );
      if (!index) {
        const items = scopedMarkdown.map((e) => e.item);
        return items.length === 0 ? EMPTY_HISTORY_ITEMS : items;
      }
      await this.refreshNativeSessionsFromBackends();
      const scopedNative = (await index.getEntries()).filter((e) => e.projectId === scope);
      const merged = mergeChatHistoryItems(scopedMarkdown, scopedNative);
      return merged.length === 0 ? EMPTY_HISTORY_ITEMS : merged;
    }

    markdownEntries = await this.dropNonLocalMarkdownEntries(markdownEntries);
    if (!index) return markdownEntries.map((e) => e.item);

    await this.refreshNativeSessionsFromBackends();
    const nativeEntries = await index.getEntries();
    return mergeChatHistoryItems(markdownEntries, nativeEntries);
  }

  private collectLiveAttentionPaths(): Set<string> {
    const paths = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (!session.getNeedsAttention()) continue;
      const path = this.sessionState.get(internalId)?.source?.path;
      if (path) paths.add(path);
    }
    return paths;
  }

  private recentChatIdsForSession(internalId: string, session: AgentSession): string[] {
    const ids: string[] = [];
    const path = this.sessionState.get(internalId)?.source?.path;
    if (path) ids.push(path);
    const backendSessionId = session.getBackendSessionId();
    if (backendSessionId) ids.push(buildNativeChatId(session.backendId, backendSessionId));
    return ids;
  }

  getOpenChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (!session.getBackendSessionId()) continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  async closeChatSession(historyId: string): Promise<void> {
    for (const [internalId, session] of this.sessions) {
      if (this.recentChatIdsForSession(internalId, session).includes(historyId)) {
        await this.closeSession(internalId, { releaseBackend: true });
        return;
      }
    }
  }

  detachSessionFromTab(id: string): void {
    const session = this.sessions.get(id);
    if (!session || this.detachedFromTabIds.has(id)) return;
    const scopeIdsBefore = this.getSessionIdsForScope(session.projectId);
    const closedIndex = scopeIdsBefore.indexOf(id);
    this.detachedFromTabIds.add(id);

    if (this.lastActiveByScope.get(session.projectId) === id) {
      this.lastActiveByScope.delete(session.projectId);
    }
    if (this.activeSessionId === id) {
      const nextId = pickScopeNeighbor(
        this.getSessionIdsForScope(session.projectId),
        closedIndex,
        this.lastActiveByScope.get(session.projectId)
      );
      this.activeSessionId = nextId;
      if (nextId) this.lastActiveByScope.set(session.projectId, nextId);
    }
    this.closeIdleHiddenChatsOverCap();
    this.notify();
  }

  private closeIdleHiddenChatsOverCap(): void {
    const hidden = Array.from(this.detachedFromTabIds, (id) => this.sessions.get(id)).filter(
      (session): session is AgentSession =>
        !!session && this.opts.resolveDescriptor(session.backendId)?.processPerChat === true
    );
    let excess = hidden.length - MAX_HIDDEN_PROCESS_CHATS;
    for (const session of hidden) {
      if (excess <= 0) return;
      const status = session.getStatus();
      if (status !== "idle" && status !== "error") continue;
      if (hasRunningTask(session) || session.getPendingToolPermissions().length > 0) continue;
      if (session.getQueuedPrompts().length > 0 || session.getNeedsAttention()) continue;
      if (hasUnsentInput(this.drafts.get(session.chatInputId))) continue;
      excess--;
      void this.closeSession(session.internalId).catch((e) =>
        logWarn(`[AgentMode] closing an idle hidden chat failed`, e)
      );
    }
  }

  getRunningChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (session.getStatus() !== "running" && !hasRunningTask(session)) continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  getAttentionChatIds(): ReadonlySet<string> {
    const ids = new Set<string>();
    for (const [internalId, session] of this.sessions) {
      if (!session.getNeedsAttention()) continue;
      for (const id of this.recentChatIdsForSession(internalId, session)) ids.add(id);
    }
    return ids.size === 0 ? EMPTY_RECENT_CHAT_IDS : ids;
  }

  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const native = parseNativeChatId(fileId);
    if (native) {
      const index = this.opts.sessionIndex;
      if (!index) throw new Error("Agent session index is not configured.");
      await index.setTitle(native.backendId, native.sessionId, newTitle);
      this.findLiveSession(native.backendId, native.sessionId)?.setLabel(newTitle);
      return;
    }
    const persistence = this.opts.persistenceManager;
    if (!persistence) throw new Error("Agent chat persistence is not configured.");
    await persistence.updateTopic(fileId, newTitle);
  }

  async setChatPinned(id: string, pinned: boolean): Promise<PinnedChat> {
    const persistence = this.opts.persistenceManager;
    if (!persistence) throw new Error("Agent chat persistence is not configured.");
    const path = await this.ensureChatNote(id);
    const pinnedAt = pinned ? Date.now() : null;
    await persistence.setPinnedAt(path, pinnedAt);
    return { id: path, pinnedAt: pinnedAt ?? undefined };
  }

  async ensureChatNote(id: string): Promise<string> {
    const native = parseNativeChatId(id);
    return native ? this.saveNativeChatAsNote(native.backendId, native.sessionId) : id;
  }

  private async saveNativeChatAsNote(backendId: BackendId, sessionId: string): Promise<string> {
    const live = this.findLiveSession(backendId, sessionId);
    if (live) return this.saveAsNote(live, sessionId);
    const { entry, projectId } = await this.readNativeChatEntry(backendId, sessionId);
    const session = await this.resumeNativeChat(backendId, sessionId, entry, projectId);
    try {
      return await this.saveAsNote(session, sessionId);
    } finally {
      if (this.activeSessionId !== session.internalId) await this.closeSession(session.internalId);
    }
  }

  private async saveAsNote(session: AgentSession, sessionId: string): Promise<string> {
    const saved = await this.saveSessionNow(session);
    if (!saved) throw new Error(`Could not save chat ${sessionId} as a note.`);
    return saved.path;
  }

  async deleteChatHistory(fileId: string): Promise<void> {
    const index = this.opts.sessionIndex;
    const persistence = this.opts.persistenceManager;
    const native = parseNativeChatId(fileId);
    if (native && !index) throw new Error("Agent session index is not configured.");
    if (!native && !persistence) throw new Error("Agent chat persistence is not configured.");

    const ref = native ?? (await this.readSessionRefFromFile(fileId));
    const snapshot = ref ? await this.readSessionSnapshot(ref.backendId, ref.sessionId) : null;
    const snapshotIds = [
      ...new Set([
        ...(ref ? [ref.sessionId] : []),
        ...(snapshot?.aliases ?? []),
        ...(snapshot?.currentSessionId ? [snapshot.currentSessionId] : []),
      ]),
    ];

    const savedPaths = await this.closeOpenChatForDelete(fileId);

    if (ref && index) {
      this.cancelPendingIndexTouch(ref.backendId, ref.sessionId);
      await index.deleteSession(ref.backendId, ref.sessionId);
      for (const alias of snapshotIds)
        if (alias !== ref.sessionId) await index.deleteSession(ref.backendId, alias);
      await index.flushOrThrow();
    }
    if (ref) {
      const descriptor = this.opts.resolveDescriptor(ref.backendId);
      if (descriptor) {
        const backend = await this.ensureBackend(ref.backendId, descriptor);
        for (const sessionId of snapshotIds) await backend.deleteSession?.({ sessionId });
      }
    }
    const notePaths = new Set(native ? savedPaths : [fileId, ...savedPaths]);
    if (persistence) {
      for (const path of notePaths) await persistence.deleteFile(path);
    }
    if (ref)
      for (const snapshotId of snapshotIds)
        await this.opts.sessionSnapshots?.remove(ref.backendId, snapshotId);
  }

  private async closeOpenChatForDelete(historyId: string): Promise<string[]> {
    const savedPaths: string[] = [];
    for (const [internalId, session] of Array.from(this.sessions)) {
      if (!this.recentChatIdsForSession(internalId, session).includes(historyId)) continue;
      const state = this.sessionState.get(internalId);
      if (state) this.stopAutoSave(state);
      await this.closeSession(internalId);
      if (state?.source?.path) savedPaths.push(state.source.path);
    }
    return savedPaths;
  }

  private cancelPendingIndexTouch(backendId: BackendId, sessionId: string): void {
    for (const session of this.sessions.values()) {
      if (session.backendId !== backendId) continue;
      if (session.getBackendSessionId() !== sessionId) continue;
      const state = this.sessionState.get(session.internalId);
      if (state?.indexTimer) {
        window.clearTimeout(state.indexTimer);
        state.indexTimer = undefined;
      }
    }
  }

  private async readSessionRefFromFile(
    fileId: string
  ): Promise<{ backendId: BackendId; sessionId: string } | null> {
    return sessionRefFromFrontmatter(await this.readChatFrontmatter(fileId));
  }

  private async readChatFrontmatter(fileId: string): Promise<Record<string, unknown> | undefined> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    const cached =
      file instanceof TFile ? this.app.metadataCache.getFileCache(file)?.frontmatter : undefined;
    if (cached) return cached;
    try {
      return (await readFrontmatterViaAdapter(this.app, fileId)) ?? undefined;
    } catch {
      return undefined;
    }
  }

  private async refreshNativeSessionsFromBackends(): Promise<void> {
    const index = this.opts.sessionIndex;
    if (!index) return;
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return;
    const vaultBasePath = adapter.getBasePath();
    const procs = this.getRunningProcsByBackend();
    if (procs.size === 0) return;
    const sweeps = Array.from(procs, ([backendId, proc]) =>
      this.sweepNativeSessions(backendId, proc, vaultBasePath)
    );
    await withTimeout(
      Promise.allSettled(sweeps).then(() => undefined),
      LIST_SESSIONS_TIMEOUT_MS,
      undefined
    );
  }

  private getRunningProcsByBackend(): Map<BackendId, BackendProcess> {
    const procs = new Map<BackendId, BackendProcess>();
    for (const { backendId, proc } of this.preloader.getWarmProcs()) {
      if (proc.isRunning()) procs.set(backendId, proc);
    }
    for (const [backendId, proc] of this.backends) {
      if (proc.isRunning()) procs.set(backendId, proc);
    }
    return procs;
  }

  private async dropNonLocalMarkdownEntries(
    entries: MarkdownChatEntry[]
  ): Promise<MarkdownChatEntry[]> {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) return entries;
    const vaultRoot = adapter.getBasePath();
    const procs = this.getRunningProcsByBackend();
    const keep = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.backendId || !entry.sessionId) return true;
        const proc = procs.get(entry.backendId);
        if (!proc?.sessionExistsLocally) return true;
        let cwd: string;
        try {
          const projectId =
            (await readChatPathProjectId(this.app, entry.item.id))?.trim() || GLOBAL_SCOPE;
          cwd = resolveScopeCwd(vaultRoot, projectId);
        } catch {
          return true;
        }
        try {
          return await proc.sessionExistsLocally({ sessionId: entry.sessionId, cwd });
        } catch {
          return true;
        }
      })
    );
    const index = this.opts.sessionIndex;
    if (index) {
      await Promise.all(
        entries.map(async (entry, i) => {
          if (keep[i] || !entry.backendId || !entry.sessionId) return;
          this.cancelPendingIndexTouch(entry.backendId, entry.sessionId);
          await index.deleteSession(entry.backendId, entry.sessionId);
        })
      );
    }
    return entries.filter((_, i) => keep[i]);
  }

  private async sweepNativeSessions(
    backendId: BackendId,
    proc: BackendProcess,
    vaultBasePath: string
  ): Promise<void> {
    const index = this.opts.sessionIndex;
    if (!index) return;
    const descriptor = this.opts.resolveDescriptor(backendId);
    if (!descriptor?.summarizesSessionTitle) return;
    let sessions;
    try {
      ({ sessions } = await proc.listSessions({ cwd: vaultBasePath }));
    } catch (err) {
      if (!(err instanceof MethodUnsupportedError)) {
        logWarn(`[AgentMode] listSessions sweep failed for ${backendId}`, err);
      }
      return;
    }
    const probeSessionId = descriptor.getProbeSessionId?.(getSettings());
    const now = Date.now();
    const discovered = [];
    for (const s of sessions) {
      const inVaultRoot = isSameCwd(s.cwd, vaultBasePath);
      const projectId = inVaultRoot ? undefined : resolveProjectIdForCwd(vaultBasePath, s.cwd);
      if (!inVaultRoot && !projectId) continue;
      if (probeSessionId && s.sessionId === probeSessionId) continue;
      const title = s.title?.trim();
      if (!title || title.startsWith(DEFAULT_TITLE_PREFIX)) continue;
      const updatedAtMs = s.updatedAt ? Date.parse(s.updatedAt) : NaN;
      const timestamp = Number.isFinite(updatedAtMs) && updatedAtMs > 0 ? updatedAtMs : now;
      discovered.push({
        backendId,
        sessionId: s.sessionId,
        title,
        createdAtMs: timestamp,
        lastAccessedAtMs: timestamp,
        projectId,
      });
    }
    if (discovered.length > 0) await index.mergeDiscoveredSessions(discovered);
  }

  async getOrCreateActiveSession(): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const active = this.getActiveSession();
    if (active && active.projectId === this.activeProjectId && active.getStatus() !== "closed") {
      return active;
    }
    const scope = this.activeProjectId;
    const pending = this.firstSessionPromiseByScope.get(scope);
    if (pending) return pending;
    const promise = this.createSession(undefined, scope);
    this.firstSessionPromiseByScope.set(scope, promise);
    try {
      return await promise;
    } finally {
      this.firstSessionPromiseByScope.delete(scope);
    }
  }

  async createSession(
    backendId?: BackendId,
    projectId: ProjectScopeId = this.activeProjectId,
    seedSelection?: ModelSelection,
    chatInputId?: string,
    activate = true
  ): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }

    const resolvedId = backendId ?? getSettings().agentMode?.activeBackend ?? "native";
    const errorSeqAtStart = this.lastErrorSeq;
    const descriptor = this.resolveDescriptor(resolvedId);
    if (!this.isBackendEnabled(resolvedId)) {
      throw new Error("This agent is disabled. Enable it in Agent settings to continue.");
    }
    const resolvedSeed = this.getSeedSelection(resolvedId, seedSelection) ?? undefined;
    if (!resolvedSeed && (descriptor.usesConfiguredModels || descriptor.getEnabledModelEntries)) {
      const message = `Enable a model for ${descriptor.displayName} in Scribe's model settings to start a chat.`;
      this.setLastError(message);
      this.notify();
      throw new Error(message);
    }

    const projectRecord =
      projectId === GLOBAL_SCOPE ? undefined : getCachedProjectRecordById(projectId);

    await this.ensureScopeInstructions(projectId, projectRecord);

    const landingCaptureSignature = projectRecord
      ? getProjectLandingCaptureSignature(this.app, projectRecord)
      : undefined;

    const cwd = this.resolveSessionCwd(projectId);

    this.pendingCreates++;
    this.startingBackendId = resolvedId;
    this.notify();

    let backend: BackendProcess;
    try {
      backend = await this.ensureBackend(resolvedId, descriptor);
    } catch (err) {
      this.setLastError(err2String(err));
      this.finishPendingCreate();
      throw err;
    }

    const internalId = uuidv4();
    const mcpServers = await this.connectScribeMcpServer(internalId, descriptor, cwd);

    if (this.disposed || !this.isBackendEnabled(resolvedId)) {
      this.finishPendingCreate();
      this.opts.scribeMcpServer?.disconnect(internalId);
      throw new Error("Agent is unavailable during session creation");
    }

    const resolvedChatInputId = chatInputId ?? uuidv4();
    const session = AgentSession.start({
      backend,
      cwd,
      internalId,
      chatInputId: resolvedChatInputId,
      backendId: resolvedId,
      projectId,
      defaultModelSelection: resolvedSeed,
      defaultMode: this.getDefaultMode(resolvedId),
      getDescriptor: () => this.opts.resolveDescriptor(resolvedId),
      getDisplayName: (backendId) => this.resolveDescriptor(backendId).displayName,
      getApp: () => this.app,
      mcpServers,
      beforePrompt: () => this.prepareNextPrompt(internalId),
      ...(projectId !== GLOBAL_SCOPE
        ? {
            getProjectContextBlock: () => this.buildFirstProjectContextBlock(internalId, projectId),
            getProjectContextUpdates: () => this.getProjectContextUpdates(internalId, projectId),
            markProjectContextUpdatesDelivered: (epoch: number) =>
              this.markProjectContextUpdatesDelivered(internalId, epoch),
          }
        : {}),
    });
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
    if (landingCaptureSignature) {
      this.landingCaptureSignatures.set(session.internalId, landingCaptureSignature);
    } else {
      this.landingCaptureSignatures.delete(session.internalId);
    }
    if (activate) {
      this.detachedFromTabIds.delete(session.internalId);
      this.lastActiveByScope.set(projectId, session.internalId);
      if (projectId === this.activeProjectId) this.activeSessionId = session.internalId;
    } else {
      this.detachedFromTabIds.add(session.internalId);
    }
    if (activate) {
      this.attachAutoSave(session);
      this.attachAttentionTracking(session);
    }
    this.notify();

    void session.ready
      .then(async () => {
        if (descriptor.applyInitialSessionConfig) {
          try {
            await descriptor.applyInitialSessionConfig(session, getSettings(), resolvedSeed);
          } catch (e) {
            logWarn(
              `[AgentMode] applyInitialSessionConfig failed for ${resolvedId}; continuing`,
              e
            );
          }
        }
        if (this.lastErrorSeq === errorSeqAtStart) {
          this.lastError = null;
        }
        logInfo(
          `[AgentMode] session ready (internal=${session.internalId} backend-id=${session.getBackendSessionId()} backend=${resolvedId}); pool size=${this.sessions.size}`
        );
        await replayPersistedMode(session, this.getDefaultMode(resolvedId));
      })
      .catch((err) => {
        this.setLastError(err2String(err));
      })
      .finally(() => this.finishPendingCreate());

    return session;
  }

  async forkSessionAtMessage(sourceInternalId: string, messageId: string): Promise<AgentSession> {
    const source = this.sessions.get(sourceInternalId);
    if (!source || source.getStatus() === "closed")
      throw new Error("The source chat is unavailable.");
    const messages = source.store.getDisplayMessages();
    const messageIndex = messages.findIndex((message) => message.id === messageId);
    const target = messages[messageIndex];
    if (!target || target.sender === USER_SENDER)
      throw new Error("Choose an assistant reply to fork.");
    if (source.isReplyRunning() && !target.turnStopReason && messageIndex === messages.length - 1) {
      throw new Error("Wait for this reply to finish before forking.");
    }
    const inherited = messages.slice(0, messageIndex + 1).map((message) => {
      const { context, ...rest } = message;
      const copy = JSON.parse(JSON.stringify(rest)) as typeof message;
      copy.parts = copy.parts?.map((part) =>
        (part.kind === "tool_call" &&
          (part.status === "pending" || part.status === "in_progress")) ||
        (part.kind === "compaction" && part.status === "in_progress")
          ? { ...part, status: "cancelled" }
          : part
      );
      if (context) {
        copy.context = {
          ...JSON.parse(JSON.stringify({ ...context, notes: [] })),
          notes: [...context.notes],
        };
      }
      return copy;
    });
    const fork = await this.createSession(
      source.backendId,
      source.projectId,
      source.getState()?.model?.current,
      undefined,
      false
    );
    try {
      await fork.ready;
      fork.restoreBranchState({
        sourceChatId: source.chatInputId,
        sourceMessageId: messageId,
        historyPending: true,
        inheritedMessageCount: inherited.length,
        createdAtMs: Date.now(),
      });
      fork.loadDisplayMessages(inherited);
      await this.flushSessionSnapshot(fork);
      await this.flushIndexTouch(fork);
      await this.opts.sessionIndex?.flushOrThrow();
      this.attachAutoSave(fork);
      this.attachAttentionTracking(fork);
      this.setActiveSession(fork.internalId);
      return fork;
    } catch (error) {
      await this.closeSession(fork.internalId);
      throw error;
    }
  }

  async createGlobalSessionWithDraft(initialDraft: string): Promise<AgentSession> {
    const projectId = GLOBAL_SCOPE;
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);
    let session: AgentSession;
    try {
      session = await this.createSession(undefined, projectId);
    } catch (error) {
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw error;
    }
    this.drafts.update(session.chatInputId, (draft) => ({ ...draft, input: initialDraft }));
    return session;
  }

  async addContextNoteToActiveChat(note: TFile): Promise<void> {
    const session = await this.getOrCreateActiveSession();
    this.drafts.addContextNote(session.chatInputId, note);
  }

  private setLastError(message: string): void {
    this.lastError = message;
    this.lastErrorSeq++;
  }

  private finishPendingCreate(): void {
    this.pendingCreates--;
    if (this.pendingCreates === 0) this.startingBackendId = null;
    this.notify();
  }

  private resolveDescriptor(backendId: BackendId): BackendDescriptor {
    const descriptor = this.opts.resolveDescriptor(backendId);
    if (!descriptor) {
      throw new Error(`Unknown backend "${backendId}". Did you forget to register it?`);
    }
    return descriptor;
  }

  private resolveSessionCwd(projectId: ProjectScopeId): string {
    const adapter = this.app.vault.adapter;
    if (!(adapter instanceof FileSystemAdapter)) {
      throw new Error("Agent Chat requires Obsidian on desktop.");
    }
    return resolveScopeCwd(adapter.getBasePath(), projectId);
  }

  getActiveProjectId(): ProjectScopeId {
    return this.activeProjectId;
  }

  getSessionsForScope(projectId: ProjectScopeId): AgentSession[] {
    const scoped: AgentSession[] = [];
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (this.detachedFromTabIds.has(session.internalId)) continue;
      scoped.push(session);
    }
    return scoped.length === 0 ? EMPTY_SESSIONS : scoped;
  }

  private getSessionIdsForScope(projectId: ProjectScopeId): string[] {
    const ids: string[] = [];
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (this.detachedFromTabIds.has(session.internalId)) continue;
      ids.push(session.internalId);
    }
    return ids;
  }

  async enterProject(projectId: ProjectScopeId): Promise<void> {
    if (this.disposed) return;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice(t("This project no longer exists. Restore it to open its chats."));
      return;
    }
    const current = this.getActiveSession();
    if (
      projectId === this.activeProjectId &&
      current &&
      current.projectId === projectId &&
      current.getStatus() !== "closed"
    ) {
      return;
    }

    const previousActiveProjectId = this.activeProjectId;
    const previousActiveSessionId = this.activeSessionId;
    const scopeSeq = this.setActiveScope(projectId);

    if (projectId !== GLOBAL_SCOPE) {
      const reusable = this.pickReusableLandingSession(projectId);
      this.detachSessionsForProjectEntry(projectId, { includeEmpty: !reusable });
      this.closeIdleHiddenChatsOverCap();
      if (reusable) {
        this.detachedFromTabIds.delete(reusable.internalId);
        this.activeSessionId = reusable.internalId;
        this.lastActiveByScope.set(projectId, reusable.internalId);
        reusable.clearNeedsAttention();
        this.notify();
        this.touchProjectUsage(projectId);
        return;
      }
      this.activeSessionId = null;
      this.notify();
      await this.spawnEnteredScopeOrRollback(
        previousActiveProjectId,
        previousActiveSessionId,
        scopeSeq
      );
      this.touchProjectUsage(projectId);
      return;
    }

    const restored = this.restoreScopeActiveSession(projectId);
    if (restored) {
      this.activeSessionId = restored.internalId;
      this.lastActiveByScope.set(projectId, restored.internalId);
      restored.clearNeedsAttention();
      this.notify();
      this.touchProjectUsage(projectId);
      return;
    }

    this.activeSessionId = null;
    this.notify();
    await this.getOrCreateActiveSession();
    this.touchProjectUsage(projectId);
  }

  private detachSessionsForProjectEntry(
    projectId: ProjectScopeId,
    opts: { includeEmpty: boolean }
  ): void {
    for (const session of this.sessions.values()) {
      if (session.projectId !== projectId) continue;
      if (session.getStatus() === "closed") continue;
      if (!opts.includeEmpty && !session.hasUserVisibleMessages()) continue;
      this.detachedFromTabIds.add(session.internalId);
    }
  }

  private pickReusableLandingSession(projectId: ProjectScopeId): AgentSession | null {
    const expected = this.currentLandingCaptureSignature(projectId);
    if (!expected) return null;
    const isReusable = (session: AgentSession): boolean =>
      this.isReusableLandingShell(session, projectId) &&
      !this.detachedFromTabIds.has(session.internalId) &&
      this.landingCaptureSignatures.get(session.internalId) === expected;

    const mruId = this.lastActiveByScope.get(projectId);
    const mru = mruId ? this.sessions.get(mruId) : undefined;
    if (mru && isReusable(mru)) return mru;

    let fallback: AgentSession | null = null;
    for (const session of this.sessions.values()) {
      if (isReusable(session)) fallback = session;
    }
    return fallback;
  }

  private isReusableLandingShell(session: AgentSession, projectId: ProjectScopeId): boolean {
    return (
      session.projectId === projectId &&
      (session.getStatus() === "idle" || session.getStatus() === "starting") &&
      !session.hasUserVisibleMessages()
    );
  }

  private currentLandingCaptureSignature(projectId: ProjectScopeId): string | null {
    if (projectId === GLOBAL_SCOPE) return null;
    const record = getCachedProjectRecordById(projectId);
    return record ? getProjectLandingCaptureSignature(this.app, record) : null;
  }

  private async ensureScopeInstructions(
    projectId: ProjectScopeId,
    record: ProjectFileRecord | undefined
  ): Promise<void> {
    if (projectId === GLOBAL_SCOPE) {
      await ensureAgentsFileForDiscovery(this.app, "");
      return;
    }
    if (!record) return;
    await ensureAgentsFileForDiscovery(this.app, "");
    await moveProjectPromptToAgentsFile(this.app, record);
    await ensureAgentsFileForDiscovery(
      this.app,
      getProjectAnchorFromConfigPath(record.filePath).projectFolderPath
    );
  }

  private touchProjectUsage(projectId: ProjectScopeId): void {
    if (this.disposed || projectId === GLOBAL_SCOPE || this.activeProjectId !== projectId) return;
    void ProjectFileManager.getInstance(this.app).touchProjectLastUsed(projectId);
  }

  async exitProject(): Promise<void> {
    await this.enterProject(GLOBAL_SCOPE);
  }

  private parkActiveScope(): void {
    const active = this.getActiveSession();
    if (active && active.getStatus() !== "closed") {
      this.lastActiveByScope.set(active.projectId, active.internalId);
    }
  }

  private restoreScopeActiveSession(projectId: ProjectScopeId): AgentSession | null {
    const mruId = this.lastActiveByScope.get(projectId);
    if (mruId) {
      const mru = this.sessions.get(mruId);
      if (mru && mru.getStatus() !== "closed") return mru;
    }
    const scoped = this.getSessionsForScope(projectId);
    return scoped.length > 0 ? scoped[scoped.length - 1] : null;
  }

  private setActiveScope(projectId: ProjectScopeId): number {
    if (projectId === this.activeProjectId) return this.scopeSeq;
    this.parkActiveScope();
    this.activeProjectId = projectId;
    return ++this.scopeSeq;
  }

  private rollbackOptimisticScopeSwitch(
    previousProjectId: ProjectScopeId,
    attemptedScopeVersion: number
  ): void {
    if (this.scopeSeq === attemptedScopeVersion) {
      this.activeProjectId = previousProjectId;
      this.scopeSeq++;
      this.notify();
    }
  }

  private async spawnEnteredScopeOrRollback(
    previousProjectId: ProjectScopeId,
    previousActiveSessionId: string | null,
    attemptedScopeVersion: number
  ): Promise<void> {
    try {
      await this.getOrCreateActiveSession();
    } catch (err) {
      if (this.scopeSeq === attemptedScopeVersion) {
        this.activeProjectId = previousProjectId;
        this.scopeSeq++;
        this.activeSessionId = previousActiveSessionId;
        this.notify();
      }
      throw err;
    }
  }

  setDefaultBackend(backendId: BackendId): void {
    if (getSettings().agentMode?.activeBackend === backendId) return;
    setSettings((cur) => ({
      agentMode: { ...cur.agentMode, activeBackend: backendId },
    }));
    this.notify();
  }

  getDefaultSelection(backendId: BackendId): ModelSelection | null {
    const offered = this.opts.resolveDescriptor(backendId)?.getEnabledModelEntries?.(getSettings());
    if (offered) {
      const first = offered.find((entry) => entry.credentialState === "ok");
      return first ? { baseModelId: first.baseModelId, effort: null } : null;
    }
    const backends = getSettings().agentMode?.backends as
      | Record<string, { defaultModel?: ModelSelection | null } | undefined>
      | undefined;
    return backends?.[backendId]?.defaultModel ?? null;
  }

  getSeedSelection(backendId: BackendId, preferred?: ModelSelection | null): ModelSelection | null {
    const saved = this.getDefaultSelection(backendId);
    const descriptor = this.opts.resolveDescriptor(backendId);
    const offered = descriptor?.getEnabledModelEntries?.(getSettings());
    const requested = preferred ?? saved;
    if (!offered) return requested;

    const runnable = offered.filter((entry) => entry.credentialState === "ok");
    if (!requested && descriptor?.usesConfiguredModels !== true) return null;

    const resolved =
      [preferred, saved].find(
        (selection): selection is ModelSelection =>
          !!selection && runnable.some((entry) => entry.baseModelId === selection.baseModelId)
      ) ?? (runnable[0] ? { baseModelId: runnable[0].baseModelId, effort: null } : null);
    if (requested && resolved?.baseModelId !== requested.baseModelId) {
      const replacementName = runnable.find(
        (entry) => entry.baseModelId === resolved?.baseModelId
      )?.name;
      this.warnSelectionNotRunnable(backendId, requested.baseModelId, replacementName);
    }
    return resolved;
  }

  private warnSelectionNotRunnable(
    backendId: BackendId,
    baseModelId: string,
    replacementName?: string
  ): void {
    const key = `${backendId}:${baseModelId}`;
    if (this.warnedUnavailableModels.has(key)) return;
    this.warnedUnavailableModels.add(key);
    const agent = this.resolveDescriptor(backendId).displayName;
    const model = baseModelId.split("/").pop() || baseModelId;
    logInfo(`[AgentMode] ${backendId} cannot start a chat on ${baseModelId}`);
    new Notice(
      replacementName
        ? `${agent} couldn't use ${model}. Using ${replacementName} instead.`
        : `${agent} couldn't use ${model}. Enable a model ${agent} can run.`
    );
  }

  async applySelection(
    patch: { baseModelId?: string; effort?: string | null },
    opts?: { expectBackendId?: BackendId }
  ): Promise<void> {
    const session = this.getActiveSession();
    if (!session) return;
    if (opts?.expectBackendId && session.backendId !== opts.expectBackendId) return;
    const current = session.getState()?.model?.current;
    if (!current) return;
    const descriptor = this.resolveDescriptor(session.backendId);
    const resolved: ModelSelection = {
      baseModelId: patch.baseModelId ?? current.baseModelId,
      effort: patch.effort !== undefined ? patch.effort : current.effort,
    };
    await descriptor.applySelection(session, resolved);
  }

  async applyMode(backendId: BackendId, mode: ScribeMode, spec: ModeApplySpec): Promise<void> {
    const session = this.getActiveSession();
    if (!session || session.backendId !== backendId) return;
    const latestMapping = this.resolveDescriptor(backendId).getModeMapping?.(null, null);
    const latestNativeId =
      latestMapping?.kind === "setMode" ? latestMapping.canonical[mode] : undefined;
    const resolvedSpec: ModeApplySpec = latestNativeId
      ? { kind: "setMode", nativeId: latestNativeId }
      : spec;
    await applyModeSpec(session, resolvedSpec);
    await this.persistDefaultMode(backendId, mode);
  }

  getDefaultMode(backendId: BackendId): ScribeMode | null {
    const backends = getSettings().agentMode?.backends as
      | Record<string, { defaultMode?: ScribeMode | null } | undefined>
      | undefined;
    return backends?.[backendId]?.defaultMode ?? null;
  }

  async persistDefaultMode(backendId: BackendId, mode: ScribeMode | null): Promise<void> {
    setSettings((cur) => {
      const existing = (cur.agentMode.backends as Record<string, unknown> | undefined)?.[
        backendId
      ] as Record<string, unknown> | undefined;
      return {
        agentMode: {
          ...cur.agentMode,
          backends: {
            ...cur.agentMode.backends,
            [backendId]: { ...(existing ?? {}), defaultMode: mode },
          },
        },
      };
    });
  }

  getBackendProcess(backendId: BackendId): BackendProcess | null {
    return this.backends.get(backendId) ?? null;
  }

  async restartBackend(
    backendId: BackendId,
    reason: string,
    options?: { deferWhileBusy?: boolean }
  ): Promise<boolean> {
    if (this.disposed || !this.isBackendEnabled(backendId)) return false;
    const inflight = this.starting.get(backendId);
    if (inflight) {
      await inflight.catch(() => undefined);
    }
    const backend = this.backends.get(backendId);
    if (!backend) return this.refreshWarmProbe(backendId, reason);
    if (options?.deferWhileBusy !== false && this.hasBusySession(backendId)) {
      const prev = this.pendingBackendRestarts.get(backendId);
      this.pendingBackendRestarts.set(backendId, {
        reason: prev ? `${prev.reason}; ${reason}` : reason,
        immediate: prev?.immediate ?? false,
      });
      logInfo(`[AgentMode] deferred ${backendId} backend restart: ${reason}`);
      this.notify();
      return true;
    }
    await this.restartBackendNow(backendId, reason, options?.deferWhileBusy === false);
    return true;
  }

  async noteSpawnConfigChanged(backendId: BackendId, reason: string): Promise<void> {
    if (this.disposed || !this.isBackendEnabled(backendId)) return;
    const inflight = this.starting.get(backendId);
    if (inflight) await inflight.catch(() => undefined);
    if (this.disposed) return;
    if (!this.hasSessionOn(backendId)) {
      await this.restartBackend(backendId, reason);
      return;
    }
    const prev = this.heldConfigChanges.get(backendId);
    this.heldConfigChanges.set(backendId, prev ? `${prev}; ${reason}` : reason);
    logInfo(`[AgentMode] holding ${backendId} backend restart: ${reason}`);
    if (prev === undefined) this.notify();
  }

  hasHeldConfigChange(backendId: BackendId): boolean {
    return this.heldConfigChanges.has(backendId);
  }

  isBackendRestartPending(backendId: BackendId): boolean {
    return this.restartingBackends.has(backendId) || this.pendingBackendRestarts.has(backendId);
  }

  async applyHeldConfigChange(backendId: BackendId): Promise<void> {
    const reason = this.heldConfigChanges.get(backendId);
    if (reason === undefined) return;
    await this.restartBackend(backendId, reason);
  }

  private hasSessionOn(backendId: BackendId): boolean {
    return Array.from(this.sessions.values()).some((s) => s.backendId === backendId);
  }

  async onInstallStateChanged(backendId: BackendId): Promise<void> {
    if (this.disposed || !this.isBackendEnabled(backendId)) return;
    const installState = this.opts.resolveDescriptor(backendId)?.getInstallState(getSettings());
    if (installState?.kind === "checking") return;
    if (installState?.kind !== "ready") {
      await this.restartBackend(backendId, "binary no longer available");
      this.preloader.clearCached(backendId);
      if (!installState || installState.kind === "absent") {
        if (this.preloadStatus.delete(backendId)) this.notify();
      }
      return;
    }
    const refreshed = await this.restartBackend(backendId, "binary path changed");
    if (!refreshed) {
      this.registerPreload(backendId, this.preloader.preload(backendId));
    }
  }

  private refreshWarmProbe(backendId: BackendId, reason: string): boolean {
    if (this.disposed) return false;
    if (!this.isBackendInstalled(backendId)) return false;
    const probe = this.preloader.refresh(backendId);
    if (!probe) return false;
    logInfo(`[AgentMode] refreshing warm ${backendId} probe: ${reason}`);
    this.registerPreload(backendId, probe);
    return true;
  }

  private isBackendInstalled(backendId: BackendId): boolean {
    const descriptor = this.opts.resolveDescriptor(backendId);
    return descriptor?.getInstallState(getSettings())?.kind === "ready";
  }

  getCachedModelCatalog(backendId: BackendId): BackendModelCatalog | null {
    return this.preloader.getCachedModelCatalog(backendId);
  }

  getEffortCatalog(backendId: BackendId): Record<string, EffortOption[]> | null {
    return this.preloader.getEffortCatalog(backendId);
  }

  subscribeModelCache(listener: () => void): () => void {
    return this.preloader.subscribe(listener);
  }

  getModelCacheSignature(backendId: BackendId): string {
    const status = this.getPreloadStatus(backendId);
    const catalog = modelCatalogSignature(this.getCachedModelCatalog(backendId));
    const effort = this.getEffortCatalog(backendId);
    const effortSig = effort
      ? Object.keys(effort)
          .sort()
          .map((id) => `${id}:${effort[id].map((o) => o.value ?? "").join(",")}`)
          .join("|")
      : "";
    return `${status}#${catalog}#${effortSig}`;
  }

  preloadModels(backendId: BackendId): Promise<void> {
    return this.preloader.preload(backendId);
  }

  registerPreload(backendId: BackendId, promise: Promise<void>): void {
    this.preloadStatus.set(backendId, "pending");
    this.notify();
    promise.then(
      () => {
        if (this.disposed || !this.isBackendEnabled(backendId)) return;
        this.preloadStatus.set(backendId, "ready");
        this.notify();
      },
      () => {
        if (this.disposed || !this.isBackendEnabled(backendId)) return;
        this.preloadStatus.set(backendId, "error");
        this.notify();
      }
    );
  }

  isPreloadReady(backendId?: BackendId): boolean {
    const id = backendId ?? getSettings().agentMode?.activeBackend;
    if (!id) return true;
    const status = this.preloadStatus.get(id);
    return status === undefined || status === "ready" || status === "error";
  }

  getPreloadStatus(backendId: BackendId): "pending" | "ready" | "error" | "absent" {
    return this.preloadStatus.get(backendId) ?? "absent";
  }

  async closeSession(id: string, options?: { releaseBackend: boolean }): Promise<void> {
    const session = this.sessions.get(id);
    if (!session) return;
    const closedScope = session.projectId;
    const scopeIdsBefore = this.getSessionIdsForScope(closedScope);
    const closedIdx = scopeIdsBefore.indexOf(id);
    if (options?.releaseBackend) {
      await session.releaseBackendSession();
    } else {
      try {
        await session.cancel();
      } catch (e) {
        logWarn(`[AgentMode] cancel during closeSession failed`, e);
      }
      if (session.getBackendSessionId() && !this.restartingBackends.has(session.backendId)) {
        try {
          await session.releaseBackendSession();
        } catch (e) {
          logWarn(`[AgentMode] releasing the backend session during closeSession failed`, e);
        }
      }
    }
    await this.drainAutoSave(session);
    try {
      await session.dispose();
    } catch (e) {
      logWarn(`[AgentMode] dispose during closeSession failed`, e);
    }
    this.detachAutoSave(id);
    this.opts.scribeMcpServer?.disconnect(id);
    this.sessions.delete(id);
    this.dirtyExtensionSessions.delete(id);
    this.chatUIStates.delete(id);
    this.landingCaptureSignatures.delete(id);
    this.lastSeenProjectContentEpochBySession.delete(id);
    this.detachedFromTabIds.delete(id);
    if (this.lastActiveByScope.get(closedScope) === id) {
      this.lastActiveByScope.delete(closedScope);
    }
    if (this.activeSessionId === id) {
      const scopeIdsAfter = this.getSessionIdsForScope(closedScope);
      const nextId = pickScopeNeighbor(
        scopeIdsAfter,
        closedIdx,
        this.lastActiveByScope.get(closedScope)
      );
      this.activeSessionId = nextId;
      if (nextId) this.lastActiveByScope.set(closedScope, nextId);
    }
    this.notify();
    void this.flushDeferredBackendRestartIfReady(session.backendId);
  }

  setActiveSession(id: string): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (this.activeSessionId === id) return;
    if (session.projectId !== this.activeProjectId) {
      this.setActiveScope(session.projectId);
    }
    this.detachedFromTabIds.delete(id);
    this.activeSessionId = id;
    this.lastActiveByScope.set(session.projectId, id);
    session.clearNeedsAttention();
    this.notify();
  }

  async replaceSessionInPlace(
    oldId: string,
    backendId?: BackendId,
    options: ReplaceSessionOptions = {}
  ): Promise<AgentSession> {
    const replacementKey = this.sessions.get(oldId)?.chatInputId ?? oldId;
    const cursor =
      this.replacementCursorByChatInputId.get(replacementKey) ?? Promise.resolve(oldId);
    const replacement = cursor.then((currentId) =>
      this.replaceSessionInPlaceOnce(currentId, backendId, options)
    );
    const nextCursor = replacement.then(
      (current) => current.internalId,
      () => cursor
    );
    this.replacementCursorByChatInputId.set(replacementKey, nextCursor);
    try {
      return await replacement;
    } finally {
      if (this.replacementCursorByChatInputId.get(replacementKey) === nextCursor) {
        this.replacementCursorByChatInputId.delete(replacementKey);
      }
    }
  }

  private async replaceSessionInPlaceOnce(
    oldId: string,
    backendId?: BackendId,
    options: ReplaceSessionOptions = {}
  ): Promise<AgentSession> {
    const oldIdx = Array.from(this.sessions.keys()).indexOf(oldId);
    const replaced = this.sessions.get(oldId);
    const replacedProjectId = replaced?.projectId ?? this.activeProjectId;
    const chatInputId = options.preserveChatInput ? replaced?.chatInputId : undefined;
    const created = await this.createSession(
      backendId,
      replacedProjectId,
      options.seedSelection,
      chatInputId
    );
    if (oldIdx >= 0) {
      this.moveMapEntry(this.sessions, created.internalId, oldIdx);
      this.moveMapEntry(this.chatUIStates, created.internalId, oldIdx);
      this.notify();
    }
    void this.closeSession(oldId).catch((e) =>
      logWarn(`[AgentMode] closeSession during replaceSessionInPlace failed`, e)
    );
    return created;
  }

  private moveMapEntry<V>(map: Map<string, V>, key: string, targetIdx: number): void {
    if (!map.has(key)) return;
    const entries = Array.from(map.entries());
    const fromIdx = entries.findIndex(([k]) => k === key);
    if (fromIdx === -1 || fromIdx === targetIdx) return;
    const [entry] = entries.splice(fromIdx, 1);
    entries.splice(targetIdx, 0, entry);
    map.clear();
    for (const [k, v] of entries) map.set(k, v);
  }

  renameSession(id: string, label: string | null): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.setLabel(label);
    this.notify();
  }

  getIsStarting(): boolean {
    return this.startingBackendId !== null;
  }

  getStartingBackendId(): BackendId | null {
    return this.startingBackendId;
  }

  getLastError(): string | null {
    return this.lastError;
  }

  getSession(id: string): AgentSession | null {
    return this.sessions.get(id) ?? null;
  }

  getSessionByBackendId(backendSessionId: string): AgentSession | null {
    for (const session of this.sessions.values()) {
      if (session.getBackendSessionId() === backendSessionId) return session;
    }
    return null;
  }

  private findLiveSession(backendId: BackendId, sessionId: string): AgentSession | null {
    for (const session of this.sessions.values()) {
      if (session.backendId !== backendId) continue;
      if (session.getBackendSessionId() !== sessionId) continue;
      if (session.getStatus() === "closed") continue;
      return session;
    }
    return null;
  }

  getChatUIState(id: string): AgentChatUIState | null {
    return this.chatUIStates.get(id) ?? null;
  }

  getActiveSession(): AgentSession | null {
    return this.activeSessionId ? (this.sessions.get(this.activeSessionId) ?? null) : null;
  }

  getActiveChatUIState(): AgentChatUIState | null {
    return this.activeSessionId ? (this.chatUIStates.get(this.activeSessionId) ?? null) : null;
  }

  getSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  getLiveChatInputIds(): readonly string[] {
    const ids = new Set(this.retainedChatInputIds);
    for (const session of this.sessions.values()) ids.add(session.chatInputId);
    return ids.size === 0 ? EMPTY_CHAT_INPUT_IDS : Array.from(ids);
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify(): void {
    this.drafts.prune();
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logError("[AgentMode] manager listener threw", e);
      }
    }
  }

  private async connectScribeMcpServer(
    internalId: string,
    descriptor: BackendDescriptor,
    cwd: string
  ): Promise<ReadonlyArray<AgentMcpServer>> {
    const server = this.opts.scribeMcpServer;
    if (!server) return EMPTY_MCP_SERVERS;
    const shared = descriptor.sharesMcpServersAcrossSessions === true;
    const offer: FeedbackOfferHandler = shared
      ? (draft, callerSessionId) =>
          this.findFolderSession(descriptor.id, cwd, callerSessionId)?.offerFeedback(draft) ??
          "unattributed"
      : (draft) => this.sessions.get(internalId)?.offerFeedback(draft) ?? "turned_off";
    try {
      return [await server.connect(shared ? `${descriptor.id}:${cwd}` : internalId, offer)];
    } catch (err) {
      logWarn("[AgentMode] Scribe MCP server unavailable; continuing without it", err);
      return EMPTY_MCP_SERVERS;
    }
  }

  private findFolderSession(
    backendId: BackendId,
    cwd: string,
    backendSessionId: string | null
  ): AgentSession | undefined {
    if (!backendSessionId) return undefined;
    return Array.from(this.sessions.values()).find(
      (session) =>
        session.backendId === backendId &&
        session.cwd === cwd &&
        session.getBackendSessionId() === backendSessionId
    );
  }

  async shutdown(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.settingsUnsub();
    this.projectRecordsUnsubscriber?.();
    this.projectRecordsUnsubscriber = undefined;
    this.contentTracker.dispose();
    logInfo(
      `[AgentMode] shutdown (pool size=${this.sessions.size}, backends=${this.backends.size})`
    );

    const allSessions = Array.from(this.sessions.values());
    await Promise.allSettled(allSessions.map((s) => this.drainAutoSave(s)));
    for (const id of Array.from(this.sessionState.keys())) {
      this.detachAutoSave(id);
    }

    await Promise.allSettled(
      allSessions.map(async (session) => {
        try {
          await session.cancel();
        } catch (e) {
          logError("[AgentMode] cancel during shutdown failed", e);
        }
        try {
          await session.dispose();
        } catch (e) {
          logError("[AgentMode] dispose during shutdown failed", e);
        }
      })
    );
    this.opts.scribeMcpServer?.dispose();
    this.sessions.clear();
    this.dirtyExtensionSessions.clear();
    this.chatUIStates.clear();
    this.landingCaptureSignatures.clear();
    this.lastSeenProjectContentEpochBySession.clear();
    this.activeSessionId = null;
    this.activeProjectId = GLOBAL_SCOPE;
    this.scopeSeq++;
    this.lastActiveByScope.clear();
    this.detachedFromTabIds.clear();
    this.firstSessionPromiseByScope.clear();

    const allBackends = Array.from(this.backends.values());
    await Promise.allSettled(
      allBackends.map(async (proc) => {
        try {
          await proc.shutdown();
        } catch (e) {
          logError("[AgentMode] backend shutdown failed", e);
        }
      })
    );
    this.backends.clear();
    this.starting.clear();
    this.startingBackendId = null;
    this.listeners.clear();
    this.preloadStatus.clear();
    this.preloader.shutdown();
    await this.opts.sessionIndex?.flush();
  }

  async loadSessionFromHistory(file: TFile): Promise<AgentSession> {
    if (!this.opts.persistenceManager) {
      throw new Error("Agent chat persistence is not configured.");
    }
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const requestId = ++this.latestHistoryLoadRequestId;

    for (const [internalId, state] of this.sessionState.entries()) {
      if (this.getSessionSourcePath(internalId) !== file.path) continue;
      const existing = this.sessions.get(internalId);
      if (existing && existing.getStatus() !== "closed") {
        this.setActiveSession(internalId);
        return existing;
      }
      state.source = undefined;
    }

    const previousActiveId = this.activeSessionId;

    const loaded = await this.opts.persistenceManager.loadFile(file);
    this.resolveDescriptor(loaded.backendId);
    if (!loaded.sessionId) throw new Error("The saved chat has no native session identity.");
    const projectId = loaded.projectId;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice(t("This chat belongs to a project that no longer exists."));
      throw new OrphanedProjectError(projectId);
    }
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);

    let session: AgentSession;
    try {
      const resumed = await this.tryResumeSessionFromHistory(
        loaded.backendId,
        loaded.sessionId,
        projectId
      );
      if (!resumed)
        throw new Error(
          `Could not resume session ${loaded.sessionId} from the ${loaded.backendId} session store.`
        );
      session = resumed;
    } catch (err) {
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw err;
    }

    this.restoreFromNote(session, file, loaded);
    if (loaded.label) session.setLabel(loaded.label);
    if (loaded.sessionId) {
      void this.opts.sessionIndex?.touch(loaded.backendId, loaded.sessionId);
    }
    if (requestId === this.latestHistoryLoadRequestId) {
      this.setActiveSession(session.internalId);
      this.absorbIntoEmptyActiveTab(session, previousActiveId);
      this.notify();
    }
    return session;
  }

  private restoreFromNote(session: AgentSession, file: TFile, loaded: LoadedAgentChat): void {
    const replayedUserTurns = session.store
      .getDisplayMessages()
      .filter((m) => m.sender === USER_SENDER).length;
    const savedUserTurns = loaded.messages.filter(
      (m) => m.isVisible && m.sender === USER_SENDER && !isCompactCommand(m.message)
    ).length;
    if (replayedUserTurns > 0 && replayedUserTurns >= savedUserTurns) {
      session.store.fillMissingTimestamps(loaded.messages);
    } else {
      session.loadDisplayMessages(loaded.messages);
    }
    session.seedSessionUsage(loaded.usage);
    this.getSessionState(session.internalId).source = file;
  }

  private absorbIntoEmptyActiveTab(loaded: AgentSession, previousActiveId: string | null): void {
    if (!previousActiveId || previousActiveId === loaded.internalId) return;
    const previous = this.sessions.get(previousActiveId);
    if (!previous || previous.hasUserVisibleMessages()) return;
    const oldIdx = Array.from(this.sessions.keys()).indexOf(previousActiveId);
    if (oldIdx >= 0) {
      this.moveMapEntry(this.sessions, loaded.internalId, oldIdx);
      this.moveMapEntry(this.chatUIStates, loaded.internalId, oldIdx);
    }
    void this.closeSession(previousActiveId).catch((e) =>
      logWarn(`[AgentMode] closing empty tab during history load failed`, e)
    );
  }

  async loadNativeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<AgentSession> {
    if (this.disposed) {
      throw new Error("AgentSessionManager has been shut down");
    }
    const requestId = ++this.latestHistoryLoadRequestId;
    const existing = this.findLiveSession(backendId, sessionId);
    if (existing) {
      this.setActiveSession(existing.internalId);
      return existing;
    }
    const previousActiveId = this.activeSessionId;
    const { entry, projectId } = await this.readNativeChatEntry(backendId, sessionId);
    const previousActiveProjectId = this.activeProjectId;
    const scopeSeq = this.setActiveScope(projectId);
    let session: AgentSession;
    try {
      session = await this.resumeNativeChat(backendId, sessionId, entry, projectId);
    } catch (err) {
      this.rollbackOptimisticScopeSwitch(previousActiveProjectId, scopeSeq);
      throw err;
    }
    await this.opts.sessionIndex?.touch(backendId, sessionId);
    if (requestId === this.latestHistoryLoadRequestId) {
      this.setActiveSession(session.internalId);
      this.absorbIntoEmptyActiveTab(session, previousActiveId);
      this.notify();
    }
    return session;
  }

  private async readNativeChatEntry(
    backendId: BackendId,
    sessionId: SessionId
  ): Promise<{ entry: AgentSessionIndexEntry | null; projectId: ProjectScopeId }> {
    this.resolveDescriptor(backendId);
    const index = this.opts.sessionIndex;
    const entry = index ? await index.getEntry(backendId, sessionId) : null;
    const snapshot = !entry ? await this.readSessionSnapshot(backendId, sessionId) : null;
    const projectId: ProjectScopeId = entry?.projectId ?? snapshot?.projectId ?? GLOBAL_SCOPE;
    if (projectId !== GLOBAL_SCOPE && !getCachedProjectRecordById(projectId)) {
      new Notice(t("This chat belongs to a project that no longer exists."));
      throw new OrphanedProjectError(projectId);
    }
    return { entry, projectId };
  }

  private async resumeNativeChat(
    backendId: BackendId,
    sessionId: SessionId,
    entry: AgentSessionIndexEntry | null,
    projectId: ProjectScopeId
  ): Promise<AgentSession> {
    const session = await this.tryResumeSessionFromHistory(backendId, sessionId, projectId);
    if (!session) {
      throw new Error(`Could not resume session ${sessionId} from the ${backendId} session store.`);
    }
    if (entry?.title) {
      session.restoreLabel(entry.title, entry.titleSource === "user" ? "user" : "agent");
    }
    return session;
  }

  private async tryResumeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId,
    projectId: ProjectScopeId,
    chatInputId?: string,
    seedSelection?: ModelSelection
  ): Promise<AgentSession | null> {
    this.resolveDescriptor(backendId);
    const existing = this.findLiveSession(backendId, sessionId);
    if (existing) return existing;

    const key = buildNativeChatId(backendId, sessionId);
    const inFlight = this.resumedSessionPromiseById.get(key);
    if (inFlight) return inFlight;

    const resume = this.resumeSessionFromHistory(
      backendId,
      sessionId,
      projectId,
      chatInputId,
      seedSelection
    ).finally(() => {
      if (this.resumedSessionPromiseById.get(key) === resume) {
        this.resumedSessionPromiseById.delete(key);
      }
    });
    this.resumedSessionPromiseById.set(key, resume);
    return resume;
  }

  private async resumeSessionFromHistory(
    backendId: BackendId,
    sessionId: SessionId,
    projectId: ProjectScopeId,
    chatInputId?: string,
    seedSelection?: ModelSelection
  ): Promise<AgentSession | null> {
    await this.ensureScopeInstructions(
      projectId,
      projectId === GLOBAL_SCOPE ? undefined : getCachedProjectRecordById(projectId)
    );
    const cwd = this.resolveSessionCwd(projectId);
    const descriptor = this.resolveDescriptor(backendId);

    const saved = await this.readSessionSnapshot(backendId, sessionId);
    const snapshot = saved?.projectId === projectId ? saved : null;
    seedSelection =
      this.getSeedSelection(backendId, seedSelection ?? snapshot?.selection) ?? undefined;
    if (!seedSelection && descriptor.getEnabledModelEntries) return null;

    this.pendingCreates++;
    this.startingBackendId = backendId;
    this.notify();

    let backend: BackendProcess;
    try {
      backend = await this.ensureBackend(backendId, descriptor);
    } catch (err) {
      this.setLastError(err2String(err));
      this.finishPendingCreate();
      return null;
    }

    if (this.disposed || !this.isBackendEnabled(backendId)) {
      this.finishPendingCreate();
      return null;
    }

    const internalId = uuidv4();
    const mcpServers = await this.connectScribeMcpServer(internalId, descriptor, cwd);
    if (this.disposed || !this.isBackendEnabled(backendId)) {
      this.finishPendingCreate();
      this.opts.scribeMcpServer?.disconnect(internalId);
      return null;
    }
    const session = new AgentSession({
      backend,
      backendSessionId: sessionId,
      beforePrompt: () => this.prepareNextPrompt(internalId),
      internalId,
      chatInputId: chatInputId ?? snapshot?.chatId,
      backendId,
      projectId,
      defaultModelSelection: seedSelection,
      defaultMode: this.getDefaultMode(backendId),
      cwd,
      getDescriptor: () => this.opts.resolveDescriptor(backendId),
      getDisplayName: (id) => this.resolveDescriptor(id).displayName,
      getApp: () => this.app,
      ...(projectId !== GLOBAL_SCOPE
        ? {
            getProjectContextUpdates: () => this.getProjectContextUpdates(internalId, projectId),
            markProjectContextUpdatesDelivered: (epoch: number) =>
              this.markProjectContextUpdatesDelivered(internalId, epoch),
          }
        : {}),
    });

    const openInput = { sessionId, cwd, projectId, mcpServers };
    let resumeResult: LoadSessionOutput | null = null;
    try {
      resumeResult = await backend.loadSession(openInput);
    } catch (err) {
      if (!(err instanceof MethodUnsupportedError)) {
        logWarn(`[AgentMode] loadSession failed for ${sessionId}`, err);
        await session.dispose();
        this.opts.scribeMcpServer?.disconnect(internalId);
        this.finishPendingCreate();
        return null;
      }
    }

    if (!resumeResult) {
      try {
        resumeResult = await backend.resumeSession(openInput);
      } catch (err) {
        if (err instanceof MethodUnsupportedError) {
          logInfo(`[AgentMode] backend ${backendId} does not support session resume`);
        } else {
          logWarn(`[AgentMode] resumeSession failed for ${sessionId}`, err);
        }
        await session.dispose();
        this.opts.scribeMcpServer?.disconnect(internalId);
        this.finishPendingCreate();
        return null;
      }
    }

    if (this.disposed) {
      await session.dispose();
      this.finishPendingCreate();
      return null;
    }

    session.completeResume(resumeResult.state);

    await session.ready;

    if (descriptor.applyInitialSessionConfig) {
      try {
        await descriptor.applyInitialSessionConfig(session, getSettings(), seedSelection);
      } catch (e) {
        logWarn(
          `[AgentMode] applyInitialSessionConfig failed for resumed ${backendId} session; continuing`,
          e
        );
      }
    }
    await replayPersistedMode(session, this.getDefaultMode(backendId));
    if (this.disposed) {
      await session.dispose();
      this.finishPendingCreate();
      return null;
    }
    if (projectId !== GLOBAL_SCOPE) {
      this.lastSeenProjectContentEpochBySession.set(internalId, RESUMED_SESSION_BEHIND_EPOCH);
    }
    if (snapshot) this.restoreSessionSnapshot(session, snapshot);
    this.sessions.set(session.internalId, session);
    this.chatUIStates.set(session.internalId, new AgentChatUIState(session));
    this.detachedFromTabIds.delete(session.internalId);
    this.attachAutoSave(session);
    this.attachAttentionTracking(session);
    this.lastError = null;
    this.finishPendingCreate();
    logInfo(
      `[AgentMode] resumed session (internal=${session.internalId} backend-id=${sessionId} backend=${backendId})`
    );
    return session;
  }

  private attachAutoSave(session: AgentSession): void {
    const persistence = this.opts.persistenceManager;
    const index = this.opts.sessionIndex;
    if (!persistence && !index && !this.opts.sessionSnapshots) return;

    const trigger = () => {
      this.scheduleAutoSave(session);
      this.scheduleIndexTouch(session);
      this.scheduleSessionSnapshot(session);
    };
    const unsubscribe = session.subscribe({
      onMessagesChanged: trigger,
      onStatusChanged: () => this.scheduleSessionSnapshot(session),
      onLabelChanged: trigger,
      onTasksChanged: () => this.scheduleSessionSnapshot(session),
      onModelChanged: () => this.scheduleSessionSnapshot(session),
    });
    this.getSessionState(session.internalId).unsub = unsubscribe;
  }

  private scheduleSessionSnapshot(session: AgentSession): void {
    if (!this.opts.sessionSnapshots) return;
    const state = this.getSessionState(session.internalId);
    if (state.snapshotTimer) window.clearTimeout(state.snapshotTimer);
    state.snapshotTimer = window.setTimeout(() => {
      state.snapshotTimer = undefined;
      void this.flushSessionSnapshot(session).catch(() => {});
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  flushSessionSnapshot(session: AgentSession): Promise<void> {
    const snapshots = this.opts.sessionSnapshots;
    if (!snapshots) return Promise.resolve();
    const state = this.getSessionState(session.internalId);
    window.clearTimeout(state.snapshotTimer);
    state.snapshotTimer = undefined;
    const save = (state.snapshotSaving ?? Promise.resolve())
      .catch(() => {})
      .then(async () => {
        const sessionId = session.getBackendSessionId();
        if (!sessionId || !session.hasUserVisibleMessages()) return;
        await Promise.all(
          session.getTasks().map(async (task) => {
            if (task.kind !== "command" || !task.outputFile) return;
            try {
              const output = await new TaskOutputTail(
                task.outputFile,
                256 * 1024,
                this.opts.taskOutputReader ?? createNodeTaskOutputReader()
              ).poll();
              if (output.text) session.rememberTaskOutput(task.toolCallId, output);
            } catch (error) {
              logWarn("[AgentMode] could not capture task output", error);
            }
          })
        );
        const snapshot: AgentSessionSnapshot = {
          version: 1,
          chatId: session.chatInputId,
          backendId: session.backendId,
          sessionId,
          projectId: session.projectId,
          savedAtMs: Date.now(),
          label: session.getLabel(),
          selection: session.getState()?.model?.current,
          messages: session.store.getDisplayMessages(),
          tasks: [...session.getTaskSnapshots()],
          branch: session.getBranchState(),
        };
        await snapshots.save(snapshot);
        state.snapshotFailureReported = false;
      })
      .catch((error: unknown) => {
        logError("[AgentMode] could not save chat details", error);
        if (!state.snapshotFailureReported) {
          state.snapshotFailureReported = true;
          new Notice(
            t("Failed to save chat details. Recent task records may not survive a restart.")
          );
        }
        throw error;
      });
    state.snapshotSaving = save;
    const finished = () => {
      if (state.snapshotSaving === save) state.snapshotSaving = undefined;
    };
    void save.then(finished, finished);
    return save;
  }

  private async readSessionSnapshot(
    backendId: string,
    sessionId: string
  ): Promise<AgentSessionSnapshot | null> {
    try {
      return (await this.opts.sessionSnapshots?.load(backendId, sessionId)) ?? null;
    } catch (error) {
      logError("[AgentMode] could not load chat details", error);
      new Notice(t("Failed to load saved chat details. The saved record has been preserved."));
      return null;
    }
  }

  private restoreSessionSnapshot(session: AgentSession, snapshot: AgentSessionSnapshot): void {
    const replay = session.store.getDisplayMessages();
    const inheritedCount = snapshot.branch?.inheritedMessageCount ?? 0;
    session.loadDisplayMessages(mergeSnapshotReplay(snapshot.messages, replay, inheritedCount));
    if (snapshot.branch) {
      session.restoreBranchState({
        ...snapshot.branch,
        historyPending: snapshot.branch.historyPending,
      });
    }
    session.restoreTaskSnapshots(snapshot.tasks);
  }

  private scheduleAutoSave(session: AgentSession): void {
    const state = this.getSessionState(session.internalId);
    if (!getSettings().autosaveChat && !state.source) return;
    state.dirty = true;
    if (state.timer) window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => {
      state.timer = undefined;
      this.flushAutoSave(session).catch((e) =>
        logWarn(`[AgentMode] auto-save failed for ${session.internalId}`, e)
      );
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private scheduleIndexTouch(session: AgentSession): void {
    if (!this.opts.sessionIndex) return;
    const state = this.getSessionState(session.internalId);
    if (state.indexTimer) window.clearTimeout(state.indexTimer);
    state.indexTimer = window.setTimeout(() => {
      state.indexTimer = undefined;
      this.flushIndexTouch(session).catch((e) =>
        logWarn(`[AgentMode] session-index update failed for ${session.internalId}`, e)
      );
    }, AUTOSAVE_DEBOUNCE_MS);
  }

  private async flushIndexTouch(session: AgentSession): Promise<void> {
    const index = this.opts.sessionIndex;
    if (!index) return;
    if (!this.sessions.has(session.internalId)) return;
    const sessionId = session.getBackendSessionId();
    if (!sessionId) return;
    const messages = session.store.getDisplayMessages();
    if (messages.length === 0) return;
    const now = Date.now();
    const label = session.getLabel();
    const title = label ?? deriveChatTitleFromMessages(messages);
    const titleSource: "user" | "agent" | undefined = !title
      ? undefined
      : label && session.getLabelSource() === "user"
        ? "user"
        : "agent";
    await index.recordSession({
      backendId: session.backendId,
      sessionId,
      title,
      titleSource,
      createdAtMs: messages[0]?.timestamp?.epoch ?? now,
      lastAccessedAtMs: now,
      projectId: session.projectId === GLOBAL_SCOPE ? undefined : session.projectId,
    });
  }

  saveActiveSession(): Promise<{ path: string } | null> {
    const session = this.getActiveSession();
    return session ? this.saveSessionNow(session) : Promise.resolve(null);
  }

  private async saveSessionNow(session: AgentSession): Promise<{ path: string } | null> {
    const state = this.sessionState.get(session.internalId);
    if (state?.timer) {
      window.clearTimeout(state.timer);
      state.timer = undefined;
    }
    const result = await this.flushAutoSave(session);
    this.scheduleAutoSave(session);
    return result;
  }

  getSessionSourcePath(internalId: string): string {
    const state = this.sessionState.get(internalId);
    return state?.source?.path ?? "";
  }

  private flushAutoSave(session: AgentSession): Promise<{ path: string } | null> {
    const state = this.getSessionState(session.internalId);
    const previous = state.saving;
    const run = previous
      ? previous.then(() => this.writeSession(session))
      : this.writeSession(session);
    state.saving = run.catch(() => {});
    return run;
  }

  private async writeSession(session: AgentSession): Promise<{ path: string } | null> {
    const persistence = this.opts.persistenceManager;
    if (!persistence) return null;
    if (!this.sessions.has(session.internalId)) return null;

    const messages = session.store.getDisplayMessages();
    if (messages.length === 0) return null;

    const label = session.getLabel();
    const sessionId = session.getBackendSessionId();
    const usage = session.getSessionUsage();
    const last = messages[messages.length - 1];
    const signature = `${label ?? ""}-${sessionId ?? ""}-${messages.length}-${last?.message ?? ""}-${usage?.updatedAt ?? ""}`;
    const state = this.getSessionState(session.internalId);
    if (state.signature === signature) {
      state.dirty = false;
      return state.source ?? null;
    }

    const previousSourcePath = this.getSessionSourcePath(session.internalId);
    const result = await persistence.saveSession(messages, session.backendId, {
      label,
      existingPath: this.getSessionSourcePath(session.internalId) || undefined,
      sessionId,
      projectId: session.projectId,
      usage: usage ?? undefined,
      ...(session.getBranchState()
        ? { chatId: session.chatInputId, conversationEpoch: session.getBranchState()!.createdAtMs }
        : {}),
    });
    if (result) {
      state.source = this.app.vault.getAbstractFileByPath(result.path) ?? result;
      state.signature = signature;
      state.dirty = false;
      if (previousSourcePath !== result.path) this.notify();
    }
    return result;
  }

  private async drainAutoSave(session: AgentSession): Promise<void> {
    await this.flushSessionSnapshot(session).catch(() => {});
    const state = this.sessionState.get(session.internalId);
    if (state?.indexTimer) {
      window.clearTimeout(state.indexTimer);
      state.indexTimer = undefined;
      try {
        await this.flushIndexTouch(session);
      } catch (e) {
        logWarn(`[AgentMode] drain session-index update failed for ${session.internalId}`, e);
      }
    }
    await state?.saving;
    if (!state || (!state.timer && !state.dirty)) return;
    if (state.timer) {
      window.clearTimeout(state.timer);
      state.timer = undefined;
    }
    try {
      await this.flushAutoSave(session);
    } catch (e) {
      logWarn(`[AgentMode] drain auto-save failed for ${session.internalId}`, e);
    }
  }

  private detachAutoSave(internalId: string): void {
    const state = this.sessionState.get(internalId);
    if (!state) return;
    this.stopAutoSave(state);
    state.attentionUnsub?.();
    this.sessionState.delete(internalId);
  }

  private stopAutoSave(state: {
    timer?: number;
    indexTimer?: number;
    snapshotTimer?: number;
    unsub?: () => void;
    dirty?: boolean;
  }): void {
    window.clearTimeout(state.timer);
    state.timer = undefined;
    state.dirty = false;
    window.clearTimeout(state.indexTimer);
    state.indexTimer = undefined;
    window.clearTimeout(state.snapshotTimer);
    state.snapshotTimer = undefined;
    state.unsub?.();
    state.unsub = undefined;
  }

  private attachAttentionTracking(session: AgentSession): void {
    let prev = session.getStatus();
    let tasksRunning = hasRunningTask(session);
    const unsubscribe = session.subscribe({
      onMessagesChanged: () => {},
      onTasksChanged: () => {
        this.prepareNextPrompt(session.internalId);
        void this.finishBackendDisableIfReady(session.backendId);
        if (hasRunningTask(session) === tasksRunning) return;
        tasksRunning = !tasksRunning;
        this.notify();
        if (
          !tasksRunning &&
          (session.getStatus() === "idle" || session.getStatus() === "error") &&
          this.detachedFromTabIds.has(session.internalId)
        )
          this.closeIdleHiddenChatsOverCap();
      },
      onDisconnected: () => void this.flushDeferredBackendRestartIfReady(session.backendId),
      onStatusChanged: (next) => {
        this.prepareNextPrompt(session.internalId);
        void this.finishBackendDisableIfReady(session.backendId);
        const wasRunning = prev === "running";
        const isRunning = next === "running";
        prev = next;
        void this.flushDeferredBackendRestartIfReady(session.backendId);
        const wantsUser = wasRunning && ATTENTION_TRIGGER_STATUSES.has(next);
        if (wantsUser) this.signalSessionNeedsAttention(session);
        if (wasRunning !== isRunning) this.notify();
        if (
          (next === "idle" || next === "error") &&
          this.detachedFromTabIds.has(session.internalId)
        )
          this.closeIdleHiddenChatsOverCap();
      },
    });
    this.getSessionState(session.internalId).attentionUnsub = unsubscribe;
  }

  private isSessionFocused(session: AgentSession): boolean {
    if (this.activeSessionId !== session.internalId) return false;
    return this.app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE).some((leaf) => {
      const container = leaf.view.containerEl;
      const doc = container.doc;
      const activeElement = doc.activeElement;
      return doc.hasFocus() && activeElement !== null && container.contains(activeElement);
    });
  }

  private signalSessionNeedsAttention(session: AgentSession): void {
    if (this.activeSessionId !== session.internalId) session.markNeedsAttention();
    if (this.isSessionFocused(session)) return;
    this.playConfiguredNotificationSound();
  }

  private playConfiguredNotificationSound(): void {
    const { notificationSound, notificationSoundId } = getSettings().agentMode;
    if (!notificationSound) return;
    playNotificationSound(notificationSoundId);
  }

  private wireProcessCallbacks(backendId: BackendId, proc: BackendProcess): void {
    proc.setPermissionPrompter(this.opts.permissionPrompter);
    proc.setUnhealthyHandler?.(() => {
      if (this.disposed || this.backends.get(backendId) !== proc) return;
      void this.restartBackend(backendId, "internal service stopped").catch((err) => {
        this.setLastError(err2String(err));
        logError(`[AgentMode] ${backendId} internal service restart failed`, err);
      });
    });
    if (this.opts.askUserQuestionPrompter) {
      proc.setAskUserQuestionPrompter?.(this.opts.askUserQuestionPrompter);
    }
  }

  private async ensureBackend(
    backendId: BackendId,
    descriptor: BackendDescriptor
  ): Promise<BackendProcess> {
    if (!this.isBackendEnabled(backendId)) throw new Error("This agent is disabled.");
    await this.opts.beforeBackendStart?.(backendId);
    if (this.disposed) throw new Error("AgentSessionManager has been shut down");
    if (!this.isBackendEnabled(backendId)) throw new Error("This agent is disabled.");
    const existing = this.backends.get(backendId);
    if (existing && existing.isRunning()) return existing;
    const inflight = this.starting.get(backendId);
    if (inflight) return inflight;
    const startPromise = (async () => {
      if (!this.isPreloadReady(backendId)) {
        await this.preloader.preload(backendId);
      }
      if (!this.isBackendEnabled(backendId)) throw new Error("This agent is disabled.");

      const warm = this.preloader.takeWarm(backendId);
      if (warm) {
        this.wireProcessCallbacks(backendId, warm.proc);
        this.installBackendExitHandler(backendId, warm.proc, descriptor);
        this.backends.set(backendId, warm.proc);
        return warm.proc;
      }

      const installState = descriptor.getInstallState(getSettings());
      if (installState.kind === "incompatible") throw new Error(installState.message);

      const proc = descriptor.createBackendProcess({
        plugin: this.plugin,
        app: this.app,
        clientVersion: this.plugin.manifest.version,
        descriptor,
      });
      if (proc.start) await proc.start();
      if (!this.isBackendEnabled(backendId)) {
        await proc.shutdown();
        throw new Error("This agent is disabled.");
      }
      this.wireProcessCallbacks(backendId, proc);
      this.installBackendExitHandler(backendId, proc, descriptor);
      this.backends.set(backendId, proc);
      return proc;
    })();
    this.starting.set(backendId, startPromise);
    try {
      return await startPromise;
    } finally {
      this.starting.delete(backendId);
    }
  }

  private installBackendExitHandler(
    backendId: BackendId,
    proc: BackendProcess,
    descriptor: BackendDescriptor
  ): void {
    proc.onExit(() => {
      if (this.backends.get(backendId) !== proc) return;
      if (this.backends.get(backendId) === proc) {
        this.backends.delete(backendId);
        this.heldConfigChanges.delete(backendId);
      }
      const dead = Array.from(this.sessions.values()).filter((s) => s.backendId === backendId);
      if (dead.length === 0) return;
      for (const s of dead) {
        this.detachAutoSave(s.internalId);
        this.opts.scribeMcpServer?.disconnect(s.internalId);
        this.sessions.delete(s.internalId);
        this.chatUIStates.delete(s.internalId);
        this.landingCaptureSignatures.delete(s.internalId);
        this.lastSeenProjectContentEpochBySession.delete(s.internalId);
        this.detachedFromTabIds.delete(s.internalId);
        if (this.lastActiveByScope.get(s.projectId) === s.internalId) {
          this.lastActiveByScope.delete(s.projectId);
        }
        s.cancel().catch(() => {});
        s.dispose().catch(() => {});
      }
      if (this.activeSessionId && !this.sessions.has(this.activeSessionId)) {
        let next: AgentSession | undefined;
        for (const s of this.sessions.values()) {
          if (!this.detachedFromTabIds.has(s.internalId)) {
            next = s;
            break;
          }
        }
        this.activeSessionId = next?.internalId ?? null;
        if (next) {
          this.activeProjectId = next.projectId;
          this.scopeSeq++;
        }
      }
      this.setLastError(`${descriptor.displayName} stopped unexpectedly.`);
      this.notify();
    });
  }

  private hasBusySession(backendId: BackendId): boolean {
    return Array.from(this.sessions.values()).some((session) => {
      if (session.backendId !== backendId) return false;
      const status = session.getStatus();
      return (
        status === "starting" ||
        status === "running" ||
        status === "awaiting_permission" ||
        hasRunningSubagent(session)
      );
    });
  }

  private async flushDeferredBackendRestartIfReady(backendId: BackendId): Promise<void> {
    if (!this.isBackendEnabled(backendId)) {
      await this.finishBackendDisableIfReady(backendId);
      return;
    }
    const pending = this.pendingBackendRestarts.get(backendId);
    if (!pending) return;
    if (!pending.immediate && this.hasBusySession(backendId)) return;
    this.pendingBackendRestarts.delete(backendId);
    try {
      await this.restartBackendNow(backendId, pending.reason, pending.immediate);
    } catch (err) {
      this.setLastError(err2String(err));
      logError(`[AgentMode] deferred ${backendId} backend restart failed`, err);
      this.notify();
    }
  }

  private async rebuildReplacedSession(
    backendId: BackendId,
    projectId: ProjectScopeId,
    chatInputId: string | undefined,
    resumableSessionId: SessionId | undefined,
    label: string | null,
    labelSource: "user" | "agent" | null,
    carriedSelection?: ModelSelection
  ): Promise<AgentSession> {
    const seedSelection = carriedSelection
      ? (this.getSeedSelection(backendId, carriedSelection) ?? undefined)
      : undefined;
    if (resumableSessionId) {
      const resumed = await this.tryResumeSessionFromHistory(
        backendId,
        resumableSessionId,
        projectId,
        chatInputId,
        seedSelection
      ).catch((e) => {
        logWarn(`[AgentMode] resume after ${backendId} restart failed`, e);
        return null;
      });
      if (resumed) {
        if (label && !resumed.getLabel()) resumed.restoreLabel(label, labelSource ?? "agent");
        this.setActiveSession(resumed.internalId);
        return resumed;
      }
    }
    return this.createSession(backendId, projectId, seedSelection, chatInputId);
  }

  private async restartBackendNow(
    backendId: BackendId,
    reason: string,
    immediate = false
  ): Promise<void> {
    if (this.restartingBackends.has(backendId)) {
      const prev = this.pendingBackendRestarts.get(backendId);
      this.pendingBackendRestarts.set(backendId, {
        reason: prev ? `${prev.reason}; ${reason}` : reason,
        immediate: (prev?.immediate ?? false) || immediate,
      });
      return;
    }
    const proc = this.backends.get(backendId);
    if (!proc) return;
    this.restartingBackends.add(backendId);
    this.heldConfigChanges.delete(backendId);
    logInfo(`[AgentMode] restarting ${backendId} backend: ${reason}`);
    const retainedChatInputIds: string[] = [];
    try {
      const affected = Array.from(this.sessions.values()).filter((s) => s.backendId === backendId);
      for (const session of affected) await this.drainAutoSave(session);
      const activeSessionId = this.activeSessionId;
      const activeProjectId = this.activeProjectId;
      const replacements = this.isBackendInstalled(backendId)
        ? affected.map((session) => ({
            internalId: session.internalId,
            projectId: session.projectId,
            chatInputId: session.chatInputId,
            resumableSessionId: session.getBackendSessionId() ?? undefined,
            label: session.getLabel(),
            labelSource: session.getLabelSource(),
            seedSelection: session.getState()?.model?.current,
            detached: this.detachedFromTabIds.has(session.internalId),
            recoveryMessages:
              session.getStatus() === "error" ? session.store.getDisplayMessages() : undefined,
            notePath: this.getSessionSourcePath(session.internalId),
          }))
        : [];
      for (const replacement of replacements) {
        retainedChatInputIds.push(replacement.chatInputId);
        this.retainedChatInputIds.add(replacement.chatInputId);
      }
      for (const session of affected) {
        await this.closeSession(session.internalId);
      }
      await proc.shutdown();
      if (this.backends.get(backendId) === proc) {
        this.backends.delete(backendId);
      }
      this.preloader.clearCached(backendId);
      new Notice(`${this.resolveDescriptor(backendId).displayName} refreshed.`);
      if (!this.disposed && this.isBackendInstalled(backendId)) {
        const probe = this.preloader.preload(backendId);
        this.registerPreload(backendId, probe);
        if (replacements.length > 0 && !this.disposed) {
          await probe;
          let selectedId = activeSessionId;
          for (const replacement of replacements) {
            const rebuilt = await this.rebuildReplacedSession(
              backendId,
              replacement.projectId,
              replacement.chatInputId,
              replacement.resumableSessionId,
              replacement.label,
              replacement.labelSource,
              replacement.seedSelection
            );
            const resumed = rebuilt.getBackendSessionId() === replacement.resumableSessionId;
            const note = this.app.vault.getAbstractFileByPath(replacement.notePath);
            if (resumed && note instanceof TFile && this.opts.persistenceManager) {
              const loaded = await this.opts.persistenceManager.loadFile(note).catch((e) => {
                logWarn(`[AgentMode] reloading ${note.path} after ${backendId} restart failed`, e);
                return null;
              });
              if (loaded) this.restoreFromNote(rebuilt, note, loaded);
            }
            if (resumed && replacement.recoveryMessages?.length) {
              rebuilt.loadDisplayMessages(replacement.recoveryMessages);
            }
            if (replacement.detached) this.detachedFromTabIds.add(rebuilt.internalId);
            if (replacement.internalId === activeSessionId) selectedId = rebuilt.internalId;
          }
          if (selectedId) this.setActiveSession(selectedId);
          else {
            this.activeSessionId = null;
            this.activeProjectId = activeProjectId;
          }
        }
      }
    } finally {
      this.restartingBackends.delete(backendId);
      for (const id of retainedChatInputIds) this.retainedChatInputIds.delete(id);
      this.notify();
    }
    const queued = this.pendingBackendRestarts.get(backendId);
    if (queued !== undefined && !this.disposed) {
      this.pendingBackendRestarts.delete(backendId);
      if (!queued.immediate && this.hasBusySession(backendId)) {
        this.pendingBackendRestarts.set(backendId, queued);
        return;
      }
      try {
        await this.restartBackendNow(backendId, queued.reason, queued.immediate);
      } catch (err) {
        this.setLastError(err2String(err));
        logError(`[AgentMode] queued ${backendId} backend restart failed`, err);
        this.notify();
      }
    }
  }
}
