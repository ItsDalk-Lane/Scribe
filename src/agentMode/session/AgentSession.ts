import type { SubagentMessagePayload } from "@/agentMode/session/subagentTypes";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { logInfo, logWarn } from "@/logger";
import { t } from "@/lib/i18n";
import { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import { GLOBAL_SCOPE, type ProjectScopeId } from "@/agentMode/session/scope";
import {
  AgentChatMessage,
  AgentMcpServer,
  AgentMessagePart,
  AgentDisplayFact,
  AgentToolKind,
  AgentQuestionAnswers,
  AgentSessionPurpose,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  BackendDescriptor,
  BackendId,
  BackendProcess,
  BackendState,
  ScribeMode,
  CurrentPlan,
  EnabledModelEntry,
  ModelSelection,
  PermissionDecision,
  PermissionPrompt,
  PermissionRequester,
  PlanDecisionAction,
  PromptContent,
  QueuedPrompt,
  SessionEvent,
  SessionId,
  PlanUsage,
  SessionUsage,
  StopReason,
  AgentToolStatus,
  TaskEndStatus,
  TaskStart,
  ToolCallDelta,
  ToolCallSnapshot,
  TurnDiff,
  TurnFileChange,
} from "@/agentMode/session/types";
import { MessageContext } from "@/types/message";
import { err2String, formatDateTime } from "@/utils";
import { Notice, TFile, type App, type DataAdapter } from "obsidian";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import {
  diffTargetPaths,
  editTargetPaths,
  isCapturableVaultPath,
  toVaultTargetPath,
  type EditTargetSource,
} from "@/agentMode/session/editTargets";
import {
  buildTurnFileChange,
  filePatchesByVaultPath,
  revertFilePatch,
  type FileCaptures,
} from "@/agentMode/session/turnFileChanges";
import { TurnTracker, type TurnOutcome, type TurnSend } from "@/agentMode/session/TurnTracker";
import { getVaultBase } from "@/utils/vaultPath";
import { deriveChatTitleFromMessages } from "@/agentMode/session/chatHistoryMerge";
import { isCompactCommand, COMPACT_COMMAND_NAME } from "@/commands/compactCommand";
import { isBuiltinCommandEnabled } from "@/agentMode/agentCommands/builtinAgentCommands";
import {
  buildConversationHistoryBlock,
  buildBranchHistoryContent,
  CONVERSATION_HISTORY_MAX_CHARS,
} from "@/agentMode/session/conversationHistory";
import { v4 as uuidv4 } from "uuid";
import { getSettings } from "@/settings/model";
import { isAgentBackendEnabled } from "@/settings/agentEnablement";
import {
  EMPTY_ENABLED_MODELS,
  ENABLED_MODEL_WAIT_MS,
  noEnabledModelError,
  pickEnabledModel,
} from "@/agentMode/session/enabledModelSelection";
import {
  buildPromptBlocks,
  buildUserMessage,
  extractText,
  OUTPUT_LIMIT_CONTINUATION_PROMPT,
  serializeWebTabContext,
} from "@/agentMode/session/promptEnvelope";
import {
  findToolCallPart,
  mergeToolCallUpdate,
  planToPart,
  toolCallToPart,
  tryReadExitPlanModeCall,
  upsertCompactionPart,
} from "@/agentMode/session/messageParts";
import { SessionHistoryReplay } from "@/agentMode/session/SessionHistoryReplay";
import { InteractiveRequests } from "@/agentMode/session/InteractiveRequests";
import { UsageTracker } from "@/agentMode/session/UsageTracker";
import { replayPersistedMode } from "@/agentMode/session/replayPersistedMode";
import type { SavedAgentTask } from "@/agentMode/session/AgentSessionSnapshots";
import type { TaskOutputSnapshot } from "@/agentMode/session/taskOutputTail";
import type {
  SubagentDispatchResult,
  SubagentMessage,
  SubagentRunStatus,
  SubagentSendMode,
  SubagentSessionSnapshot,
} from "@/agentMode/session/subagentTypes";
import {
  EMPTY_SUBAGENT_SESSIONS,
  hasManagedSubagentWork,
  isSubagentRunActive,
} from "@/agentMode/session/subagentSessions";
import {
  projectDisplayFacts,
  serializeDisplayMessage,
} from "@/agentMode/session/AgentDisplayFacts";

export const DEFAULT_TITLE_PREFIX = "New session";
const EMPTY_TASKS: readonly AgentTask[] = Object.freeze([]);
const EMPTY_MESSAGES: readonly AgentChatMessage[] = Object.freeze([]);
const EMPTY_TASK_SNAPSHOTS: readonly SavedAgentTask[] = Object.freeze([]);
const EMPTY_TOOL_CALL_IDS: ReadonlySet<string> = new Set();
const MAX_RETAINED_TASKS = 20;
const LAUNCH_CARD_STATUS: Record<TaskEndStatus, AgentToolStatus> = {
  completed: "completed",
  failed: "failed",
  stopped: "cancelled",
};
const UNSTARTED_TASK_END: Partial<Record<AgentToolStatus, TaskEndStatus>> = {
  completed: "completed",
  failed: "failed",
  cancelled: "stopped",
};

export interface AgentBranchState {
  sourceChatId: string;
  sourceMessageId: string;
  historyPending: boolean;
  inheritedMessageCount?: number;
  createdAtMs?: number;
}

export interface AgentTask extends TaskStart {
  subagentStatus?: SubagentRunStatus;
  stopReason?: StopReason;
  status: "running" | TaskEndStatus;
  model?: string;
  outputFile?: string;
  summary?: string;
  savedOutput?: TaskOutputSnapshot;
  interrupted?: boolean;
}

function isTaskLifecycleUpdate(update: SessionEvent["update"]): boolean {
  return (
    update.sessionUpdate === "task_started" ||
    update.sessionUpdate === "task_progress" ||
    update.sessionUpdate === "task_ended"
  );
}

function toolCallTarget(call: ToolCallSnapshot | ToolCallDelta): EditTargetSource {
  return {
    locations: call.locations,
    input: call.rawInput,
    diffPaths: diffTargetPaths(call.content),
  };
}

async function readVaultText(adapter: DataAdapter, path: string): Promise<string | null> {
  try {
    return await adapter.read(path);
  } catch {
    return null;
  }
}

export type AgentSessionStatus =
  | "starting"
  | "idle"
  | "running"
  | "awaiting_permission"
  | "error"
  | "closed";

export const ATTENTION_TRIGGER_STATUSES: ReadonlySet<AgentSessionStatus> = new Set([
  "idle",
  "error",
  "awaiting_permission",
]);

export interface AgentSessionListener {
  onMessagesChanged(): void;
  onStatusChanged(status: AgentSessionStatus): void;
  onModelChanged?(): void;
  onLabelChanged?(): void;
  onCurrentPlanChanged?(): void;
  onCurrentTodoListChanged?(): void;
  onNeedsAttentionChanged?(needsAttention: boolean): void;
  onTasksChanged?(): void;
  onQueuedPromptsChanged?(): void;
  onDisconnected?(): void;
}

export interface ProjectContextUpdates {
  epoch: number;
  block: string;
}

export interface ProjectContextUpdatesHooks {
  getProjectContextUpdates?: () => ProjectContextUpdates | null;
  markProjectContextUpdatesDelivered?: (epoch: number) => void;
}

export interface AgentSessionStartOptions extends ProjectContextUpdatesHooks {
  purpose?: AgentSessionPurpose;
  beforePrompt?: () => void;
  backend: BackendProcess;
  cwd: string;
  internalId: string;
  chatInputId?: string;
  backendId: BackendId;
  projectId?: ProjectScopeId;
  defaultModelSelection?: ModelSelection;
  defaultMode?: ScribeMode | null;
  getDescriptor?: () => BackendDescriptor | undefined;
  getDisplayName?: (backendId: BackendId) => string;
  getApp?: () => App;
  getProjectContextBlock?: () => string;
  mcpServers?: ReadonlyArray<AgentMcpServer>;
}

export interface AgentSessionStateOptions extends ProjectContextUpdatesHooks {
  purpose?: AgentSessionPurpose;
  beforePrompt?: () => void;
  backend: BackendProcess;
  backendSessionId: SessionId;
  internalId: string;
  chatInputId?: string;
  backendId: BackendId;
  projectId?: ProjectScopeId;
  defaultModelSelection?: ModelSelection;
  defaultMode?: ScribeMode | null;
  cwd?: string | null;
  getDescriptor?: () => BackendDescriptor | undefined;
  getDisplayName?: (backendId: BackendId) => string;
  getApp?: () => App;
}

export class AgentSession {
  readonly store = new AgentMessageStore();
  readonly internalId: string;
  private inputIdentity: string;
  readonly backendId: BackendId;
  readonly planFeedbackDelivery: "permission" | "next_turn";
  readonly projectId: ProjectScopeId;
  purpose?: AgentSessionPurpose;
  readonly ready: Promise<void>;
  private backendSessionId: SessionId | null = null;
  private backend: BackendProcess;
  private displayFactWrite: Promise<void> = Promise.resolve();
  private savedDisplayLabel: string | null | undefined;
  private savedDisplayBranch: AgentBranchState | null | undefined;
  private savedTaskOutputs = new Map<string, TaskOutputSnapshot>();
  private historyReadOnly = false;
  private backendSuspended = false;
  private readonly beforePrompt: (() => void) | undefined;
  readonly cwd: string | null;
  private readonly getProjectContextBlockFn: (() => string) | null;
  private firstPromptSent = false;
  private lastSentWebTabBlock: string | null = null;
  private readonly getDescriptor: (() => BackendDescriptor | undefined) | null;
  private readonly getDisplayName: ((backendId: BackendId) => string) | null;
  private readonly getApp: (() => App) | null;
  private readonly getProjectContextUpdatesFn: (() => ProjectContextUpdates | null) | null;
  private readonly markProjectContextUpdatesDeliveredFn: ((epoch: number) => void) | null;
  private cachedStatus: AgentSessionStatus = "starting";
  private cachedReplyRunning = false;
  private startupFailed = false;
  private startupSettled = false;
  private agentBusy = false;
  private branchState: AgentBranchState | null = null;
  private resendSavedHistory = false;
  private readonly turns: TurnTracker;
  private readonly taskFiles = new Map<string, FileCaptures>();
  private readonly tasks = new Map<string, AgentTask>();
  private taskList: readonly AgentTask[] = EMPTY_TASKS;
  private subagentSessions: readonly SubagentSessionSnapshot[] = EMPTY_SUBAGENT_SESSIONS;
  private subagentRevision = 0;
  private readonly taskContent = new Map<string, AgentMessageStore>();
  private listeners = new Set<AgentSessionListener>();
  private unregisterSessionHandler: (() => void) | null = null;
  private currentState: BackendState | null = null;
  private label: string | null = null;
  private labelSource: "user" | "agent" | null = null;
  private disposed = false;
  private resumeSelection: ModelSelection | undefined;
  private resumeMode: ScribeMode | null | undefined;
  private settleReady: () => void = () => {};
  private readonly historyReplay = new SessionHistoryReplay({
    store: this.store,
    scheduleNotifyMessages: () => this.scheduleNotifyMessages(),
    applyTodoList: (entries) => this.requests.applyTodoList(entries),
  });
  private readonly requests: InteractiveRequests;
  private readonly usageTracker: UsageTracker;

  private needsAttention = false;
  private notifyScheduled = false;
  private notifyHandle: ReturnType<typeof setTimeout> | number | null = null;

  constructor(opts: AgentSessionStateOptions | AgentSessionStartOptions) {
    this.beforePrompt = opts.beforePrompt;
    this.backend = opts.backend;
    this.internalId = opts.internalId;
    this.inputIdentity = opts.chatInputId ?? uuidv4();
    this.backendId = opts.backendId;
    this.turns = new TurnTracker({
      store: this.store,
      backendId: this.backendId,
      prompt: (input) => {
        if (this.isOnModelNotEnabled()) {
          return Promise.reject(noEnabledModelError(this.displayNameFor(this.backendId)));
        }
        const queued = this.turns.getQueuedPrompts().find((item) => item.id === input.promptId);
        const message =
          this.store.getMessage(input.promptId) ??
          (queued
            ? buildUserMessage(queued.id, queued.text, queued.context, queued.promptContent)
            : undefined);
        return this.backend.prompt({
          sessionId: this.backendSessionId!,
          ...input,
          ...(message && this.backend.appendDisplayFacts
            ? { displayMessage: serializeDisplayMessage({ ...message, id: input.promptId }) }
            : {}),
        });
      },
      notifyMessages: () => this.notifyMessages(),
      notifyQueuedPrompts: () => this.notifyQueuedPromptsChanged(),
      promptsWithdrawn: (prompts) => {
        if (prompts.some((p) => (p.context?.webTabs?.length ?? 0) > 0)) {
          this.lastSentWebTabBlock = null;
        }
      },
      notifyStatus: () => this.recomputeStatusIfChanged(),
      runningTaskToolCallIds: () =>
        new Set(
          [...this.tasks.values()]
            .filter((task) => task.status === "running" && task.taskId !== undefined)
            .map((task) => task.toolCallId)
        ),
      endLaunches: (status) => this.endLaunchesOfEndedTurn(status),
      captureFileChanges: (files, messageId, turnDiff) =>
        this.finalizeFileChanges(files, this.store, messageId, turnDiff),
      onTurnCompleted: () => void this.pollSessionTitle(),
    });
    this.planFeedbackDelivery = opts.getDescriptor?.()?.planFeedbackDelivery ?? "permission";
    this.projectId = opts.projectId ?? GLOBAL_SCOPE;
    this.purpose = opts.purpose;
    this.cwd = opts.cwd ?? null;
    this.getDescriptor = opts.getDescriptor ?? null;
    this.getDisplayName = opts.getDisplayName ?? null;
    this.getApp = opts.getApp ?? null;
    this.getProjectContextUpdatesFn = opts.getProjectContextUpdates ?? null;
    this.markProjectContextUpdatesDeliveredFn = opts.markProjectContextUpdatesDelivered ?? null;
    this.getProjectContextBlockFn =
      "getProjectContextBlock" in opts ? (opts.getProjectContextBlock ?? null) : null;
    this.requests = new InteractiveRequests({
      store: this.store,
      internalId: this.internalId,
      getReplyId: () => this.turns.getReplyId(),
      hasLeftPlanMode: () => this.hasLeftPlanMode(),
      recomputeStatus: () => this.recomputeStatusIfChanged(),
      notifyMessages: () => this.notifyMessages(),
      notifyPlanChanged: () => this.notifyCurrentPlanChanged(),
      notifyTodoListChanged: () => this.notifyCurrentTodoListChanged(),
    });
    this.usageTracker = new UsageTracker({
      getModelId: () => this.currentState?.model?.current.baseModelId,
      notifyMessages: () => this.notifyMessages(),
    });
    if ("backendSessionId" in opts) {
      this.backendSessionId = opts.backendSessionId;
      this.resumeSelection = opts.defaultModelSelection;
      this.resumeMode = opts.defaultMode;
      this.historyReplay.start();
      this.unregisterSessionHandler = this.backend.registerSessionHandler(
        opts.backendSessionId,
        (event) => this.handleSessionEvent(event)
      );
      this.ready = new Promise<void>((resolve) => {
        this.settleReady = resolve;
      });
    } else {
      this.currentState = null;
      this.ready = this.initialize(opts);
    }
  }

  completeResume(state: BackendState | null, purpose?: AgentSessionPurpose): void {
    this.purpose = purpose;
    this.historyReplay.end();
    this.usageTracker.completeReplay();
    this.refreshMessageMetrics();
    const lastMessage = this.store.getDisplayMessages().at(-1);
    this.turns.restoreLastTurnFailure(
      lastMessage?.sender !== USER_SENDER && lastMessage?.isErrorMessage === true
    );
    this.currentState = state;
    const settle = () => {
      this.startupSettled = true;
      this.recomputeStatusIfChanged();
      this.settleReady();
      void this.refreshSubagentSessions().catch((error) =>
        logWarn("[AgentMode] child session list unavailable", error)
      );
    };
    const selection = this.resumeSelection ?? state?.model?.current;
    if (!selection || !state) return settle();
    void this.applyStartupSelection(selection, this.resumeMode)
      .catch((e) => logWarn(`[AgentMode] resumed ${this.backendId} session kept its model`, e))
      .finally(settle);
  }

  static start(opts: AgentSessionStartOptions): AgentSession {
    return new AgentSession(opts);
  }

  async getExtensionRuntime(): Promise<
    import("./extensionInventory").AgentExtensionRuntimeSnapshot | null
  > {
    if (!this.backendSessionId || !this.backend.getExtensionRuntime) return null;
    return this.backend.getExtensionRuntime({ sessionId: this.backendSessionId });
  }

  getBackendSessionId(): SessionId | null {
    return this.backendSessionId;
  }

  private async initialize(opts: AgentSessionStartOptions): Promise<void> {
    const { backend, cwd, defaultModelSelection } = opts;
    try {
      const resp = await backend.newSession({
        cwd,
        ...(opts.purpose ? { purpose: opts.purpose } : {}),
        ...(defaultModelSelection ? { modelId: defaultModelSelection.baseModelId } : {}),
        projectId: this.projectId,
        mcpServers: opts.mcpServers,
      });
      if (this.disposed) return;
      const modelLog = resp.state.model
        ? `model=${resp.state.model.current.baseModelId} (available: ${resp.state.model.availableModels
            .map((m) => m.baseModelId)
            .join(", ")})`
        : "agent did not report model state";
      logInfo(`[AgentMode] session ${resp.sessionId} ${modelLog}`);
      this.backendSessionId = resp.sessionId;
      this.currentState = resp.state;
      this.unregisterSessionHandler = this.backend.registerSessionHandler(resp.sessionId, (event) =>
        this.handleSessionEvent(event)
      );
      if (this.disposed) {
        this.unregisterSessionHandler();
        this.unregisterSessionHandler = null;
        return;
      }
      this.recomputeStatusIfChanged();
      this.notifyModelChanged();

      const selection = defaultModelSelection ?? resp.state.model?.current;
      if (selection) await this.applyStartupSelection(selection, opts.defaultMode);
      await this.refreshSubagentSessions();
      this.startupSettled = true;
      this.recomputeStatusIfChanged();
    } catch (err) {
      if (this.disposed) return;
      logWarn(`[AgentMode] session/new failed for ${this.internalId}`, err);
      this.startupFailed = true;
      this.recomputeStatusIfChanged();
      throw err instanceof Error ? err : new Error(err2String(err));
    }
  }

  getState(): BackendState | null {
    return this.currentState;
  }

  async setModel(modelId: string): Promise<void> {
    if (this.getStatus() === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionModel({
      sessionId: this.backendSessionId,
      modelId,
    });
    this.usageTracker.dropUsageWindowOnModelChange(next);
    this.currentState = next;
    this.notifyModelChanged();
  }

  async applyModelWireId(wireId: string): Promise<void> {
    const apply = this.currentState?.model?.apply;
    if (apply?.kind === "setConfigOption") {
      await this.setConfigOption(apply.configId, wireId);
      return;
    }
    await this.setModel(wireId);
  }

  private async applyStartupSelection(
    selection: ModelSelection,
    mode: ScribeMode | null = null
  ): Promise<void> {
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return;
    if (this.runsOnlyEnabledModels()) {
      await this.settleOnEnabledModel(descriptor, selection, mode);
      return;
    }
    try {
      await descriptor.applySelection(this, selection);
    } catch (e) {
      logWarn(
        `[AgentMode] could not apply startup selection ${selection.baseModelId}; keeping the agent's model`,
        e
      );
    }
  }

  private async settleOnEnabledModel(
    descriptor: BackendDescriptor,
    seed: ModelSelection,
    mode: ScribeMode | null
  ): Promise<void> {
    const enabled = this.enabledModels();
    const pick = () => pickEnabledModel(enabled, this.currentState?.model, seed);
    await this.waitForState(
      () => pick().settled && (!mode || this.currentState?.mode?.apply[mode] !== undefined)
    );
    if (this.disposed) return;
    const { target } = pick();
    if (!target) throw noEnabledModelError(descriptor.displayName);
    await descriptor.applySelection(this, target);
    await replayPersistedMode(this, mode);
  }

  private waitForState(isReady: () => boolean): Promise<void> {
    if (isReady()) return Promise.resolve();
    return new Promise((resolve) => {
      const unsubscribe = this.subscribe({
        onMessagesChanged: () => {},
        onStatusChanged: (status) => {
          if (status === "closed") finish();
        },
        onModelChanged: () => {
          if (isReady()) finish();
        },
      });
      const timer = window.setTimeout(() => finish(), ENABLED_MODEL_WAIT_MS);
      const finish = (): void => {
        window.clearTimeout(timer);
        unsubscribe();
        resolve();
      };
    });
  }

  private isOnModelNotEnabled(): boolean {
    const current = this.currentState?.model?.current.baseModelId;
    return (
      (this.runsOnlyEnabledModels() ||
        this.getDescriptor?.()?.getEnabledModelEntries !== undefined) &&
      !this.enabledModels().some((entry) => entry.baseModelId === current)
    );
  }

  private runsOnlyEnabledModels(): boolean {
    return this.getDescriptor?.()?.usesConfiguredModels === true;
  }

  private enabledModels(): readonly EnabledModelEntry[] {
    return this.getDescriptor?.()?.getEnabledModelEntries?.(getSettings()) ?? EMPTY_ENABLED_MODELS;
  }

  async setConfigOption(configId: string, value: string): Promise<void> {
    if (this.getStatus() === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionConfigOption({
      sessionId: this.backendSessionId,
      configId,
      value,
    });
    this.usageTracker.dropUsageWindowOnModelChange(next);
    this.currentState = next;
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  async setMode(modeId: string): Promise<void> {
    if (this.getStatus() === "closed") throw new Error("Session is closed");
    if (!this.backendSessionId) throw new Error("Session is still starting");
    const next = await this.backend.setSessionMode({
      sessionId: this.backendSessionId,
      modeId,
    });
    this.currentState = next;
    this.notifyModelChanged();
    this.clearCurrentPlanIfModeLeft();
  }

  canSwitchModel(): boolean | null {
    if (this.getStatus() === "starting") return false;
    return this.currentState?.model?.apply.kind === "setConfigOption"
      ? this.backend.isSetSessionConfigOptionSupported()
      : this.backend.isSetSessionModelSupported();
  }

  canSwitchEffort(): boolean | null {
    if (this.getStatus() === "starting") return false;
    const descriptor = this.getDescriptor?.();
    if (!descriptor) return null;
    if (descriptor.wire.effortConfigFor) return this.backend.isSetSessionConfigOptionSupported();
    return this.currentState?.model?.apply.kind === "setConfigOption"
      ? this.backend.isSetSessionConfigOptionSupported()
      : this.backend.isSetSessionModelSupported();
  }

  canSwitchMode(): boolean | null {
    if (this.getStatus() === "starting") return false;
    const mode = this.currentState?.mode;
    if (!mode) return null;
    const sample = mode.options[0];
    if (!sample) return null;
    const spec = mode.apply[sample.value];
    if (!spec) return null;
    const steps = spec.kind === "sequence" ? spec.steps : [spec];
    const capabilities = steps.map((step) =>
      step.kind === "setConfigOption"
        ? this.backend.isSetSessionConfigOptionSupported()
        : this.backend.isSetSessionModeSupported()
    );
    if (capabilities.includes(false)) return false;
    if (capabilities.includes(null)) return null;
    return true;
  }

  getStatus(): AgentSessionStatus {
    if (this.disposed) return "closed";
    if (this.startupFailed) return "error";
    if (this.backendSessionId === null || !this.startupSettled) return "starting";
    const working = this.turns.isMainTurnRunning() || this.agentBusy;
    if (working && this.requests.hasPending()) {
      return "awaiting_permission";
    }
    if (working) return "running";
    if (this.turns.hasLastTurnFailed()) return "error";
    return "idle";
  }

  getNeedsAttention(): boolean {
    return this.needsAttention;
  }

  markNeedsAttention(): void {
    if (this.needsAttention) return;
    this.needsAttention = true;
    this.notifyNeedsAttentionChanged();
  }

  clearNeedsAttention(): void {
    if (!this.needsAttention) return;
    this.needsAttention = false;
    this.notifyNeedsAttentionChanged();
  }

  private notifyNeedsAttentionChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onNeedsAttentionChanged?.(this.needsAttention);
      } catch (e) {
        logWarn(`[AgentMode] needs-attention listener threw`, e);
      }
    }
  }

  hasUserVisibleMessages(): boolean {
    return this.store.getDisplayMessages().length > 0;
  }

  loadDisplayMessages(messages: AgentChatMessage[]): void {
    this.store.loadMessages(messages);
    const lastMessage = messages.at(-1);
    this.turns.restoreLastTurnFailure(
      lastMessage?.sender !== USER_SENDER && lastMessage?.isErrorMessage === true
    );
    this.recomputeStatusIfChanged();
    this.notifyMessages();
  }

  supportsDisplayFacts(): boolean {
    return (
      this.backend.appendDisplayFacts !== undefined && this.backend.readDisplayFacts !== undefined
    );
  }

  get chatInputId(): string {
    return this.inputIdentity;
  }

  setHistoryReadOnly(readOnly: boolean): void {
    this.historyReadOnly = readOnly;
  }

  persistDisplayFacts(additional: AgentDisplayFact[] = []): Promise<void> {
    if (!this.backend.appendDisplayFacts || !this.backendSessionId || this.historyReadOnly)
      return Promise.resolve();
    const sessionId = this.backendSessionId;
    const save = this.displayFactWrite
      .catch(() => {})
      .then(async () => {
        const facts = [...this.store.takeDisplayFacts(), ...additional];
        const label = this.getLabel();
        if (this.savedDisplayLabel !== label)
          facts.push({ kind: "session_metadata", chatId: this.chatInputId, label });
        if (this.savedDisplayBranch !== this.branchState)
          facts.push({ kind: "branch", branch: this.branchState });
        for (const task of this.getTasks()) {
          if (task.savedOutput && this.savedTaskOutputs.get(task.toolCallId) !== task.savedOutput)
            facts.push({ kind: "task", task, messages: [] });
        }
        if (!facts.length) return;
        try {
          await this.backend.appendDisplayFacts!({ sessionId, facts });
        } catch (error) {
          this.store.restoreDisplayFacts(facts);
          throw error;
        }
        this.savedDisplayLabel = label;
        this.savedDisplayBranch = this.branchState;
        for (const task of this.getTasks())
          if (task.savedOutput) this.savedTaskOutputs.set(task.toolCallId, task.savedOutput);
      });
    this.displayFactWrite = save;
    return save;
  }

  async restorePersistedDisplayFacts(): Promise<void> {
    if (!this.backend.readDisplayFacts || !this.backendSessionId) return;
    const facts = await this.backend.readDisplayFacts({ sessionId: this.backendSessionId });
    const projection = projectDisplayFacts(this.store.getDisplayMessages(), facts, (path) => {
      const file = this.getApp?.()?.vault.getAbstractFileByPath(path);
      return file instanceof TFile ? file : null;
    });
    this.loadDisplayMessages(projection.messages);
    if (projection.chatId) this.inputIdentity = projection.chatId;
    if (projection.warnings.length) {
      logWarn(
        "[AgentMode] Uninterpreted display records were preserved",
        projection.warnings.length
      );
      new Notice(t(projection.warnings[0]));
    }
    if (projection.branch !== undefined) this.restoreBranchState(projection.branch);
    if (projection.label !== undefined) this.setLabel(projection.label);
    for (const entry of projection.tasks) {
      if (entry.task.savedOutput)
        this.rememberTaskOutput(entry.task.toolCallId, entry.task.savedOutput);
    }
    this.savedDisplayLabel = this.getLabel();
    this.savedDisplayBranch = this.branchState;
    this.store.takeDisplayFacts();
  }

  getBranchState(): AgentBranchState | null {
    return this.branchState ? { ...this.branchState } : null;
  }

  restoreBranchState(state: AgentBranchState | null): void {
    this.branchState = state ? { ...state } : null;
  }

  resendSavedHistoryOnNextTurn(): void {
    this.resendSavedHistory = true;
  }

  getLabel(): string | null {
    return this.label;
  }

  getLabelSource(): "user" | "agent" | null {
    return this.labelSource;
  }

  setLabel(label: string | null): void {
    const next = label?.trim() ? label.trim() : null;
    if (next === this.label) return;
    this.label = next;
    this.labelSource = next ? "user" : null;
    this.notifyLabelChanged();
  }

  restoreLabel(label: string, source: "user" | "agent"): void {
    if (source === "user") this.setLabel(label);
    else this.applyAgentLabel(label);
  }

  private backendSummarizesTitle(): boolean {
    return this.getDescriptor?.()?.summarizesSessionTitle ?? true;
  }

  private applyAgentLabel(label: string | null | undefined): void {
    if (this.labelSource === "user") return;
    const next = label?.trim() ? label.trim() : null;
    if (next === this.label) return;
    this.label = next;
    this.labelSource = next ? "agent" : null;
    this.notifyLabelChanged();
  }

  private notifyLabelChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onLabelChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] label listener threw`, e);
      }
    }
  }

  subscribe(listener: AgentSessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  sendPrompt(
    displayText: string,
    context?: MessageContext,
    promptContent?: PromptContent[]
  ): { userMessageId: string; turn: Promise<StopReason> } {
    if (this.historyReadOnly)
      throw new Error(
        t(
          "This chat is read-only because its history needs repair. Your saved records have been preserved."
        )
      );
    if (!isAgentBackendEnabled(getSettings(), this.backendId) || this.backendSuspended) {
      throw new Error("This agent is unavailable. Check its model configuration in Models.");
    }
    // 关闭内置命令开关后，/compact 按普通文字发送，不再触发压缩或清空上下文。https://github.com/ItsDalk-Lane/Scribe/issues/53
    const sendsCompact =
      isCompactCommand(displayText) && isBuiltinCommandEnabled(getSettings(), COMPACT_COMMAND_NAME);
    if (sendsCompact) {
      displayText = displayText.trim();
      context = undefined;
      promptContent = undefined;
    }
    const status = this.getStatus();
    if (status === "starting") {
      throw new Error("Session is still starting");
    }
    if (status === "closed") {
      throw new Error("Session is closed");
    }
    this.beforePrompt?.();
    const busy =
      status === "running" ||
      status === "awaiting_permission" ||
      this.turns.getQueuedPrompts().length > 0;
    if (busy) {
      if (!this.acceptsMidTurnPrompts() || sendsCompact) {
        throw new Error("Session already has a turn in flight");
      }
      return this.queuePrompt(displayText, context, promptContent);
    }

    const promptId = uuidv4();
    const userMessageId = this.store.addMessage(
      buildUserMessage(promptId, displayText, context, promptContent)
    );
    this.turns.openReply();

    if (this.label === null && !this.backendSummarizesTitle()) {
      this.applyAgentLabel(deriveChatTitleFromMessages(this.store.getDisplayMessages()));
    }

    const send = this.turns.startSend();
    const turn = this.runTurn(
      displayText,
      userMessageId,
      context,
      promptContent,
      sendsCompact,
      send
    );
    return { userMessageId, turn };
  }

  acceptsMidTurnPrompts(): boolean {
    return this.getDescriptor?.()?.midTurnDelivery === true;
  }

  getQueuedPrompts(): readonly QueuedPrompt[] {
    return this.turns.getQueuedPrompts();
  }

  canWithdrawPrompts(): boolean {
    return this.getDescriptor?.()?.withdraw === true;
  }

  takeWithdrawnPrompts(): readonly QueuedPrompt[] {
    return this.turns.takeWithdrawnPrompts();
  }

  withdrawPrompt(promptId: string): Promise<void> {
    return this.turns.withdrawQueued(promptId, () =>
      this.backend.withdraw?.({ sessionId: this.backendSessionId!, promptId })
    );
  }

  canStopTasks(): boolean {
    return this.getDescriptor?.()?.stopTask === true;
  }

  async stopTask(taskId: string): Promise<void> {
    await this.backend.stopTask?.({ sessionId: this.backendSessionId!, taskId });
  }

  getSubagentSessions(): readonly SubagentSessionSnapshot[] {
    return this.subagentSessions;
  }

  async startIndependentTask(): Promise<void> {
    if (this.historyReadOnly || !this.backendSessionId || !this.backend.startIndependentTask)
      throw new MethodUnsupportedError("startIndependentTask");
    await this.backend.startIndependentTask({ sessionId: this.backendSessionId });
  }

  async continueTaskBudget(taskGenerationId?: string, requestId?: string): Promise<void> {
    if (this.historyReadOnly || !this.backendSessionId || !this.backend.continueTaskBudget)
      throw new MethodUnsupportedError("continueTaskBudget");
    await this.backend.continueTaskBudget({
      sessionId: this.backendSessionId,
      taskGenerationId,
      requestId,
    });
  }

  async confirmSubagentRecovery(subagentId: string): Promise<void> {
    if (this.historyReadOnly || !this.backendSessionId || !this.backend.confirmSubagentRecovery)
      throw new MethodUnsupportedError("confirmSubagentRecovery");
    await this.backend.confirmSubagentRecovery({ sessionId: this.backendSessionId, subagentId });
    await this.refreshSubagentSessions();
  }

  hasManagedSubagentWork(): boolean {
    return hasManagedSubagentWork(this.subagentSessions);
  }

  async refreshSubagentSessions(): Promise<void> {
    if (!this.backendSessionId || !this.backend.listSubagentSessions) return;
    const revision = this.subagentRevision;
    const sessions = await this.backend.listSubagentSessions({ sessionId: this.backendSessionId });
    // 查询期间的新事件优先，避免旧列表覆盖已经收到的新执行。https://github.com/ItsDalk-Lane/Scribe/issues/50
    if (!this.disposed && revision === this.subagentRevision) this.applySubagentSessions(sessions);
  }

  async sendSubagentMessage(
    subagentId: string,
    text: string,
    mode: SubagentSendMode,
    messageId = uuidv4(),
    payload?: SubagentMessagePayload
  ): Promise<SubagentDispatchResult> {
    if (this.historyReadOnly || !this.backendSessionId || !this.backend.sendSubagentMessage)
      throw new Error(t("This child session cannot be continued in this chat."));
    const result = await this.backend.sendSubagentMessage({
      sessionId: this.backendSessionId,
      subagentId,
      text,
      mode,
      messageId,
      ...(payload ? { payload } : {}),
    });
    await this.refreshSubagentSessions().catch((error) =>
      logWarn("[AgentMode] child session list unavailable", error)
    );
    return result;
  }

  async stopSubagent(subagentId: string): Promise<void> {
    if (!this.backendSessionId || !this.backend.stopSubagent)
      throw new MethodUnsupportedError("stopSubagent");
    await this.backend.stopSubagent({ sessionId: this.backendSessionId, subagentId });
    await this.refreshSubagentSessions();
  }

  async setSubagentArchived(subagentId: string, archived: boolean): Promise<void> {
    if (this.historyReadOnly || !this.backendSessionId || !this.backend.setSubagentArchived)
      throw new MethodUnsupportedError("setSubagentArchived");
    await this.backend.setSubagentArchived({
      sessionId: this.backendSessionId,
      subagentId,
      archived,
    });
    await this.refreshSubagentSessions();
  }

  async deleteSubagentSession(subagentId: string): Promise<void> {
    if (this.historyReadOnly || !this.backendSessionId || !this.backend.deleteSubagentSession)
      throw new MethodUnsupportedError("deleteSubagentSession");
    await this.backend.deleteSubagentSession({ sessionId: this.backendSessionId, subagentId });
    await this.refreshSubagentSessions();
  }

  private applySubagentSessions(sessions: readonly SubagentSessionSnapshot[]): void {
    this.subagentRevision++;
    this.subagentSessions = sessions.length
      ? Object.freeze([...sessions])
      : EMPTY_SUBAGENT_SESSIONS;
    for (const session of sessions) {
      for (const run of session.runs) this.usageTracker.applyChildRun(session.id, run);
      const rounds = new Set(session.runs.flatMap((run) => (run.roundId ? [run.roundId] : [])));
      for (const roundId of rounds) {
        const runs = session.runs.filter((run) => run.roundId === roundId);
        if (runs.every((run) => !isSubagentRunActive(run.status))) {
          this.usageTracker.markChildRoundEnded(session.id, roundId);
          if (runs.every((run) => !run.promptId)) this.usageTracker.markMetricsRoundEnded(roundId);
        }
      }
    }
    for (const session of sessions)
      for (const message of session.messages) this.showSubagentMessage(message, session.name);
    for (const session of sessions)
      for (const run of session.runs) {
        const task = this.tasks.get(run.toolCallId);
        if (task)
          this.tasks.set(run.toolCallId, {
            ...task,
            subagentId: session.id,
            runId: run.id,
            subagentStatus: run.status,
          });
      }
    this.publishTasks();
  }

  private showSubagentMessage(message: SubagentMessage, name: string): void {
    const id = `subagent-message:${message.id}`;
    // 协作内容保留真实来源，重开和重复通知不能生成第二份展示。https://github.com/ItsDalk-Lane/Scribe/issues/50
    if (message.direction !== "to_parent" || this.store.getMessage(id)) return;
    this.store.addMessage({
      id,
      sender: AI_SENDER,
      synthetic: true,
      isVisible: true,
      timestamp: formatDateTime(new Date(message.acceptedAt)),
      message: `${t("Subagent")} · ${name} · ${t(message.kind)}${message.runId ? ` · ${message.runId}` : ""}\n\n${message.text}`,
    });
    this.scheduleNotifyMessages();
  }

  private queuePrompt(
    text: string,
    context: MessageContext | undefined,
    promptContent: PromptContent[] | undefined
  ): { userMessageId: string; turn: Promise<StopReason> } {
    const prompt: QueuedPrompt = { id: uuidv4(), text, context, promptContent };
    const turn = this.turns.queue(prompt, async () => {
      const webTabBlock =
        (context?.webTabs?.length ?? 0) > 0 ? await serializeWebTabContext(context) : "";
      return () => {
        const blocks = buildPromptBlocks(
          text,
          context,
          promptContent,
          webTabBlock === this.lastSentWebTabBlock ? "" : webTabBlock,
          null,
          null,
          null
        );
        if (webTabBlock) this.lastSentWebTabBlock = webTabBlock;
        return blocks;
      };
    });
    return { userMessageId: prompt.id, turn };
  }

  private notifyQueuedPromptsChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onQueuedPromptsChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] queued prompts listener threw`, e);
      }
    }
  }

  private async runTurn(
    displayText: string,
    userMessageId: string,
    context: MessageContext | undefined,
    promptContent: PromptContent[] | undefined,
    sendsCompact: boolean,
    send: TurnSend
  ): Promise<StopReason> {
    const outcome = await this.runPrompt(
      displayText,
      userMessageId,
      context,
      promptContent,
      sendsCompact,
      send
    );
    if (outcome.error !== undefined) throw outcome.error;
    return outcome.stopReason;
  }

  private async runPrompt(
    displayText: string,
    userMessageId: string,
    context: MessageContext | undefined,
    promptContent: PromptContent[] | undefined,
    sendsCompact: boolean,
    { signal, pushed: onPushed }: TurnSend
  ): Promise<TurnOutcome> {
    try {
      const stoppedTurnEnded = this.turns.whenStoppedTurnEnds(signal);
      if (stoppedTurnEnded) await stoppedTurnEnded;

      const hasWebTabs = (context?.webTabs?.length ?? 0) > 0;
      const webTabBlock = hasWebTabs ? await serializeWebTabContext(context) : "";
      if (signal.aborted || this.disposed) return { stopReason: "cancelled" };
      if (this.isOnModelNotEnabled()) {
        return this.turns.refuse(
          `This chat's model is unavailable for ${this.displayNameFor(this.backendId)}. Pick a configured model to continue.`
        );
      }
      const isFirstTurn = !this.firstPromptSent && !sendsCompact;
      const projectContextBlock = isFirstTurn ? (this.getProjectContextBlockFn?.() ?? null) : null;
      const projectContextUpdates = sendsCompact
        ? null
        : (this.getProjectContextUpdatesFn?.() ?? null);
      const projectContextUpdatesBlock = projectContextUpdates?.block ?? null;

      const sendsBranchHistory = this.branchState?.historyPending === true && !sendsCompact;
      const branchHistory = sendsBranchHistory
        ? buildBranchHistoryContent(this.priorDisplayMessages(userMessageId))
        : undefined;
      const sendsSavedHistory = this.resendSavedHistory && !sendsCompact && !sendsBranchHistory;
      const historyBlock = sendsSavedHistory
        ? buildConversationHistoryBlock(
            this.priorDisplayMessages(userMessageId),
            CONVERSATION_HISTORY_MAX_CHARS
          )
        : null;
      const leadingContextBlock = sendsCompact ? null : historyBlock;
      const webTabPromptBlock = webTabBlock === this.lastSentWebTabBlock ? "" : webTabBlock;
      const promptBlocks = buildPromptBlocks(
        displayText,
        context,
        promptContent,
        webTabPromptBlock,
        projectContextBlock,
        leadingContextBlock,
        projectContextUpdatesBlock,
        branchHistory
      );

      const outcome = await this.turns.submit(
        { promptId: userMessageId, prompt: promptBlocks },
        true,
        onPushed
      );
      if (outcome.error !== undefined) return outcome;
      if (sendsBranchHistory && outcome.stopReason !== "cancelled" && this.branchState) {
        this.branchState = { ...this.branchState, historyPending: false };
        this.resendSavedHistory = false;
        this.notifyMessages();
      }
      if (sendsSavedHistory && outcome.stopReason !== "cancelled") {
        this.resendSavedHistory = false;
      }
      if (isFirstTurn) this.firstPromptSent = true;
      if (webTabBlock) this.lastSentWebTabBlock = webTabBlock;
      if (projectContextUpdates) {
        this.markProjectContextUpdatesDeliveredFn?.(projectContextUpdates.epoch);
      }
      if (outcome.stopReason === "max_tokens" && !signal.aborted) {
        return await this.turns.submit(
          {
            promptId: uuidv4(),
            prompt: [{ type: "text", text: OUTPUT_LIMIT_CONTINUATION_PROMPT }],
          },
          false
        );
      }
      return outcome;
    } catch (err) {
      this.turns.failReply(err);
      throw err;
    } finally {
      onPushed();
      this.turns.endSend(signal);
    }
  }

  private priorDisplayMessages(userMessageId: string): readonly AgentChatMessage[] {
    const messages = this.store.getDisplayMessages();
    return messages.slice(
      0,
      messages.findIndex((message) => message.id === userMessageId)
    );
  }

  private displayNameFor(backendId: BackendId): string {
    return this.getDisplayName?.(backendId) ?? backendId;
  }

  async cancel(options: { keepUnread?: boolean } = {}): Promise<void> {
    const status = this.getStatus();
    // 主模型闲置时仍要停止所属后台执行，不能只看主回复的状态。https://github.com/ItsDalk-Lane/Scribe/issues/50
    if (
      status !== "running" &&
      status !== "awaiting_permission" &&
      !this.hasManagedSubagentWork() &&
      ![...this.tasks.values()].some((task) => task.kind === "command" && task.status === "running")
    )
      return;
    if (!this.backendSessionId) return;
    const keepUnread = options.keepUnread === true;
    this.turns.stop(!keepUnread && this.canWithdrawPrompts());
    this.requests.rejectToolRequestsFrom("main");
    this.requests.withdrawQuestions();
    await this.backend
      .cancel({ sessionId: this.backendSessionId, ...(keepUnread ? { keepUnread } : {}) })
      .catch((e: unknown) => {
        logWarn(`[AgentMode] cancel notification failed`, e);
        // 停止保存失败必须让界面显示，不能让仍在运行的后台工作看似已停止。https://github.com/ItsDalk-Lane/Scribe/issues/50
        throw e;
      });
  }

  isReplyRunning(): boolean {
    return this.turns.isMainTurnRunning();
  }

  async releaseBackendSession(): Promise<void> {
    const backendSessionId = this.backendSessionId;
    if (!backendSessionId || !this.backend.closeSession) {
      throw new Error("This agent does not support closing individual sessions.");
    }
    try {
      await this.backend.closeSession({ sessionId: backendSessionId });
    } catch (error) {
      if (error instanceof MethodUnsupportedError) {
        throw new Error("This agent does not support closing individual sessions.");
      }
      throw error;
    }
  }

  isBackendSuspended(): boolean {
    return this.backendSuspended;
  }

  suspendBackend(): void {
    this.backendSuspended = true;
    this.unregisterSessionHandler?.();
    this.unregisterSessionHandler = null;
  }

  async resumeBackend(
    backend: BackendProcess,
    selection?: ModelSelection,
    mcpServers?: ReadonlyArray<AgentMcpServer>
  ): Promise<void> {
    if (!this.backendSuspended || !this.backendSessionId || this.disposed) return;
    const cwd = this.cwd ?? (this.getApp ? getVaultBase(this.getApp()) : null);
    if (!cwd) throw new Error("The chat folder is unavailable.");
    const mode = this.currentState?.mode?.current ?? null;
    const opened = await backend.resumeSession({
      sessionId: this.backendSessionId,
      cwd,
      projectId: this.projectId,
      mcpServers,
    });
    if (this.disposed || !isAgentBackendEnabled(getSettings(), this.backendId)) return;
    this.backend = backend;
    this.backendSessionId = opened.sessionId;
    this.currentState = opened.state;
    this.unregisterSessionHandler = backend.registerSessionHandler(opened.sessionId, (event) =>
      this.handleSessionEvent(event)
    );
    if (selection) await this.getDescriptor?.()?.applySelection(this, selection);
    await replayPersistedMode(this, mode);
    this.backendSuspended = false;
    await this.refreshSubagentSessions();
    this.notifyModelChanged();
    this.recomputeStatusIfChanged();
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    this.unregisterSessionHandler?.();
    this.unregisterSessionHandler = null;
    this.requests.dispose();
    this.turns.dispose();
    this.recomputeStatusIfChanged();
    this.cancelScheduledNotify();
    this.listeners.clear();
  }

  handlePlanProposalPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    return this.requests.handlePlanProposalPermission(request);
  }

  resolvePlanProposalPermission(toolCallId: string, allow: boolean, denyMessage?: string): void {
    this.requests.resolvePlanProposalPermission(toolCallId, allow, denyMessage);
  }

  getCurrentPlan(): CurrentPlan | null {
    return this.requests.getCurrentPlan();
  }

  getCurrentTodoList(): AgentTodoListEntry[] | null {
    return this.requests.getCurrentTodoList();
  }

  getTasks(): readonly AgentTask[] {
    return this.taskList;
  }

  getTaskSnapshots(): readonly SavedAgentTask[] {
    if (this.taskList.length === 0) return EMPTY_TASK_SNAPSHOTS;
    return this.taskList.map((task) => ({
      task,
      messages: [...this.getTaskMessages(task.toolCallId)],
    }));
  }

  rememberTaskOutput(toolCallId: string, output: TaskOutputSnapshot): void {
    const task = this.tasks.get(toolCallId);
    if (
      !task ||
      (task.savedOutput?.text === output.text && task.savedOutput.truncated === output.truncated)
    )
      return;
    this.tasks.set(toolCallId, { ...task, savedOutput: output });
    this.publishTasks();
  }

  restoreTaskSnapshots(entries: readonly SavedAgentTask[]): void {
    for (const entry of entries) {
      const { task, messages } = entry;
      if (this.tasks.has(task.toolCallId)) continue;
      const restored: AgentTask =
        task.status === "running" ? { ...task, status: "stopped", interrupted: true } : task;
      this.tasks.set(task.toolCallId, restored);
      if (messages.length > 0) {
        const content = new AgentMessageStore();
        content.loadMessages(messages);
        if (restored.interrupted) {
          for (const message of content.getDisplayMessages())
            content.stopToolCalls(message.id, EMPTY_TOOL_CALL_IDS);
        }
        this.taskContent.set(task.toolCallId, content);
      }
      if (restored.interrupted)
        this.updateLaunchCard({ toolCallId: task.toolCallId, status: "cancelled" });
    }
    if (entries.length > 0) this.publishTasks();
  }

  getTaskMessages(toolCallId: string): readonly AgentChatMessage[] {
    return this.taskContent.get(toolCallId)?.getDisplayMessages() ?? EMPTY_MESSAGES;
  }

  getSubagentUsage(subagentId: string): SessionUsage | null {
    return this.usageTracker.getSubagentUsage(subagentId);
  }

  getSessionUsage(): SessionUsage | null {
    return this.usageTracker.getSessionUsage();
  }

  getPlanUsage(): PlanUsage | null {
    return this.usageTracker.getPlanUsage();
  }

  seedSessionUsage(usage: SessionUsage | undefined): void {
    this.usageTracker.seedSessionUsage(usage);
  }

  finalizePlanDecision(
    proposalId: string,
    decision?: PlanDecisionAction,
    feedbackText?: string
  ): boolean {
    return this.requests.finalizePlanDecision(proposalId, decision, feedbackText);
  }

  clearCurrentPlanIfModeLeft(): void {
    this.requests.clearCurrentPlanIfModeLeft();
  }

  hasPendingPlanPermission(): boolean {
    return this.requests.hasPendingPlanPermission();
  }

  handleToolPermission(request: PermissionPrompt): Promise<PermissionDecision> {
    const files = this.filesOf(request.requester ?? "main");
    if (files) this.observeToolCall(files, request.toolCall.kind, toolCallTarget(request.toolCall));
    return this.requests.handleToolPermission(request);
  }

  resolveToolPermission(toolCallId: string, optionId: string): void {
    this.requests.resolveToolPermission(toolCallId, optionId);
  }

  getPendingToolPermissions(): PermissionPrompt[] {
    return this.requests.getPendingToolPermissions();
  }

  handleAskUserQuestion(request: AskUserQuestionPrompt): Promise<AgentQuestionAnswers> {
    return this.requests.handleAskUserQuestion(request);
  }

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void {
    this.requests.resolveAskUserQuestion(requestId, answers);
  }

  getPendingAskUserQuestions(): AskUserQuestionPrompt[] {
    return this.requests.getPendingAskUserQuestions();
  }

  private handleSessionEvent(event: SessionEvent): void {
    this.store.withRecordedTime(event.occurredAt, () => this.applySessionEvent(event));
    this.refreshMessageMetrics();
  }

  private applySessionEvent(event: SessionEvent): void {
    const update = event.update;
    if (update.sessionUpdate === "turn_started") {
      const task = event.taskToolCallId ? this.tasks.get(event.taskToolCallId) : undefined;
      this.usageTracker.markMetricsRoundStarted(
        update.roundId,
        update.turnId,
        task?.subagentId
          ? {
              subagentId: task.subagentId,
              runId: task.runId,
              startedAt: update.startedAt ?? event.occurredAt,
            }
          : undefined
      );
    }
    if (update.sessionUpdate === "tool_execution_started") {
      this.usageTracker.recordToolExecution(update.roundId, update.sourceId, update.toolCallId);
      this.refreshMessageMetrics();
      return;
    }
    if (update.sessionUpdate === "model_call_metrics") {
      this.usageTracker.applyModelCall(update.observation);
      this.refreshMessageMetrics();
      return;
    }
    if (update.sessionUpdate === "turn_ended") {
      this.usageTracker.markMetricsRoundEnded(update.roundId);
      if (update.subagentId && update.roundId)
        this.usageTracker.markChildRoundEnded(
          update.subagentId,
          update.roundId,
          event.occurredAt,
          update.stopReason
        );
      this.refreshMessageMetrics();
    }
    if (
      update.sessionUpdate === "agent_segment_finalized" &&
      update.finalResponse &&
      event.origin !== "synthetic"
    ) {
      this.usageTracker.markFinalSegment(update.segmentSeq);
      this.refreshMessageMetrics();
    }
    if (update.sessionUpdate === "subagents_updated") {
      this.applySubagentSessions(update.subagents);
      return;
    }
    if (update.sessionUpdate === "subagent_message") {
      this.showSubagentMessage(update.message, update.name);
      return;
    }
    if (event.taskToolCallId !== undefined && !isTaskLifecycleUpdate(update)) {
      this.applyTaskContent(event.taskToolCallId, event);
      return;
    }
    if (update.sessionUpdate === "user_message_chunk" && !this.historyReplay.isOpen()) return;
    if (this.historyReplay.append(update, event.occurredAt, event.seq, event.origin)) {
      return;
    }
    switch (update.sessionUpdate) {
      case "message_delivered":
        this.turns.deliverPrompt(update.promptId, event.occurredAt);
        if (event.seq !== undefined) {
          const replyId = `assistant:${update.promptId}`;
          this.store.identifyMessage(replyId, replyId, event.seq, event.occurredAt);
          this.scheduleNotifyMessages();
        }
        if (update.messageSeq !== undefined) {
          this.store.identifyMessage(update.promptId, update.promptId, update.messageSeq);
          this.scheduleNotifyMessages();
        }
        return;
      case "messages_withdrawn":
        this.turns.withdrawPrompts(update.promptIds);
        return;
      case "session_disconnected":
        this.handleDisconnect(update.error);
        return;
      case "task_started":
        if (
          update.taskId === undefined &&
          event.taskToolCallId === undefined &&
          this.turns.isStopping()
        ) {
          return;
        }
        this.applyTaskUpdate(update);
        return;
      case "task_progress":
      case "task_ended":
        this.applyTaskUpdate(update);
        return;
      case "turn_started":
        this.turns.startTurn(update.turnId, update.startedAt, event.seq);
        return;
      case "turn_ended":
        this.turns.endTurn(update, event.occurredAt);
        return;
      case "busy_changed":
        this.agentBusy = update.busy;
        this.recomputeStatusIfChanged();
        return;
    }
    const toolOwnerMessageId =
      update.sessionUpdate === "tool_call_update"
        ? this.store.findMessageIdWithToolCall(update.toolCallId)
        : undefined;
    const toolOwnerStopReason = toolOwnerMessageId
      ? this.store.getMessage(toolOwnerMessageId)?.turnStopReason
      : undefined;
    const isPriorToolUpdate =
      toolOwnerMessageId !== undefined &&
      toolOwnerStopReason !== undefined &&
      toolOwnerStopReason !== "cancelled";
    const segmentOwnerMessageId =
      update.sessionUpdate === "agent_segment_finalized"
        ? this.store.findMessageIdWithSegment(update.segmentSeq)
        : undefined;

    if (this.turns.isStopping()) {
      switch (update.sessionUpdate) {
        case "agent_segment_started":
          return;
        case "agent_segment_finalized":
          if (!segmentOwnerMessageId) return;
          break;
        case "agent_message_chunk":
        case "agent_thought_chunk":
          this.turns.dropStoppedContent(update.messageId);
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
        case "tool_call":
        case "plan":
        case "compaction":
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
        case "tool_call_update":
          if (isPriorToolUpdate) break;
          logWarn(
            `[AgentMode] dropping ${update.sessionUpdate} from cancelled turn ${this.internalId}`
          );
          return;
      }
    }

    if (update.sessionUpdate === "plan") this.requests.applyTodoList(update.entries);

    if (update.sessionUpdate === "session_info_update") {
      if (update.title !== undefined && this.backendSummarizesTitle()) {
        this.applyAgentLabel(update.title);
      }
      return;
    }
    if (update.sessionUpdate === "state_changed") {
      this.usageTracker.dropUsageWindowOnModelChange(update.state);
      this.currentState = update.state;
      this.notifyModelChanged();
      this.clearCurrentPlanIfModeLeft();
      return;
    }
    if (update.sessionUpdate === "current_mode_update") {
      return;
    }
    if (update.sessionUpdate === "config_option_update") {
      return;
    }
    if (update.sessionUpdate === "usage_update") {
      this.usageTracker.applyUsageUpdate(update.usage);
      return;
    }
    if (update.sessionUpdate === "plan_usage_update") {
      this.usageTracker.applyPlanUsage(update.planUsage);
      return;
    }

    if (update.sessionUpdate === "agent_thought_ended") {
      const target = this.store.findMessageIdWithSegment(update.segmentSeq);
      if (target && this.store.finishAgentThought(target, update.segmentSeq, update.contentIndex))
        this.scheduleNotifyMessages();
      return;
    }

    if (
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk"
    ) {
      const text = extractText(update.content);
      if (!text) return;
      const target = this.turns.resolveContentTarget(update.messageId);
      if (!target) {
        logWarn(`[AgentMode] dropping ${update.sessionUpdate} — no target for ${this.internalId}`);
        return;
      }
      const appended =
        update.sessionUpdate === "agent_message_chunk"
          ? this.store.appendAgentText(
              target,
              text,
              event.seq,
              event.origin === "synthetic",
              update.segmentSeq,
              update.contentIndex
            )
          : this.store.appendAgentThought(
              target,
              text,
              event.seq,
              event.origin === "synthetic",
              update.segmentSeq,
              update.contentIndex
            );
      if (appended) {
        this.turns.extendSettledTurn(target, event.occurredAt);
        this.scheduleNotifyMessages();
      }
      return;
    }

    const targetMessageId =
      segmentOwnerMessageId ??
      this.turns.resolveToolTarget(isPriorToolUpdate ? toolOwnerMessageId : undefined);
    if (!targetMessageId) {
      logWarn(`[AgentMode] dropping session/update — no placeholder for ${this.internalId}`);
      return;
    }
    const eventPart = (part: AgentMessagePart): AgentMessagePart => ({
      ...part,
      ...(part.seq === undefined && event.seq !== undefined ? { seq: event.seq } : {}),
      ...(event.origin === "synthetic" ? { synthetic: true } : {}),
    });

    switch (update.sessionUpdate) {
      case "agent_segment_started":
        if (event.seq !== undefined) this.store.startAgentSegment(targetMessageId, event.seq);
        return;
      case "agent_segment_finalized":
        if (
          this.store.finalizeAgentSegment(
            targetMessageId,
            update.segmentSeq,
            update.blocks,
            event.seq,
            event.origin === "synthetic"
          )
        )
          this.scheduleNotifyMessages();
        return;
      case "tool_call": {
        this.observeToolCall(this.turns.getTurnFiles(), update.kind, toolCallTarget(update));
        const exitPlan = tryReadExitPlanModeCall({
          kind: update.kind,
          rawInput: update.rawInput,
          isPlanProposal: update.isPlanProposal,
        });
        if (exitPlan) {
          this.requests.publishGatedPlan(update.toolCallId, exitPlan);
          if (this.store.upsertAgentPart(targetMessageId, eventPart(toolCallToPart(update)))) {
            this.scheduleNotifyMessages();
          }
          return;
        }
        if (this.store.upsertAgentPart(targetMessageId, eventPart(toolCallToPart(update)))) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "tool_call_update": {
        const existing = this.findToolCallPart(targetMessageId, update.toolCallId);
        const merged = mergeToolCallUpdate(existing, this.withEndedTaskStatus(update));
        if (!isPriorToolUpdate) this.observeToolResult(this.turns.getTurnFiles(), merged, update);
        if (merged.kind === "tool_call") {
          const exitPlan = tryReadExitPlanModeCall({
            kind: update.kind ?? merged.toolKind,
            rawInput: merged.input,
            isPlanProposal: update.isPlanProposal,
          });
          if (exitPlan) {
            this.requests.publishGatedPlan(merged.id, exitPlan);
          }
        }
        if (this.store.upsertAgentPart(targetMessageId, eventPart(merged))) {
          this.scheduleNotifyMessages();
        }
        this.endUnstartedTasks();
        return;
      }
      case "plan": {
        if (this.store.upsertAgentPart(targetMessageId, planToPart(update))) {
          this.scheduleNotifyMessages();
        }
        return;
      }
      case "compaction": {
        const upserted = upsertCompactionPart(this.store, targetMessageId, update);
        const metered = this.usageTracker.applyCompactedUsage(update);
        if (upserted || metered) this.scheduleNotifyMessages();
        return;
      }
      default:
        logInfo(
          `[AgentMode] ignoring session/update kind=${(update as { sessionUpdate: string }).sessionUpdate}`
        );
        return;
    }
  }

  private handleDisconnect(error: Error): void {
    for (const task of this.tasks.values()) {
      if (task.taskId === undefined && task.status === "running") this.endTask(task, "stopped");
    }
    this.agentBusy = false;
    this.turns.disconnect(error);
    for (const l of this.listeners) {
      try {
        l.onDisconnected?.();
      } catch (e) {
        logWarn(`[AgentMode] disconnect listener threw`, e);
      }
    }
  }

  private applyTaskUpdate(
    update: Extract<
      SessionEvent["update"],
      { sessionUpdate: "task_started" | "task_progress" | "task_ended" }
    >
  ): void {
    if (update.sessionUpdate === "task_started") return this.startTask(update);
    const task = this.taskWithId(update.taskId);
    if (!task) return;
    if (update.sessionUpdate === "task_progress") {
      if (update.progress) {
        this.updateLaunchCard({ toolCallId: task.toolCallId, progress: update.progress });
      }
      const model = update.model ?? task.model;
      const outputFile = update.outputFile ?? task.outputFile;
      if (model === task.model && outputFile === task.outputFile) return;
      this.tasks.set(task.toolCallId, { ...task, model, outputFile });
      return this.publishTasks();
    }
    this.endTask(task, update.status, update.summary, update.outputFile, update.stopReason);
  }

  private startTask(start: TaskStart): void {
    const existing = this.tasks.get(start.toolCallId);
    if (existing?.taskId !== undefined) return;
    if (start.taskId === undefined && existing && existing.status !== "running") return;
    this.tasks.set(start.toolCallId, {
      ...existing,
      toolCallId: start.toolCallId,
      kind: start.kind,
      taskId: start.taskId ?? existing?.taskId,
      // 开始事实已携带稳定归属；重开不能依赖尚未加载的子会话目录补齐身份。https://github.com/ItsDalk-Lane/Scribe/issues/52
      subagentId: start.subagentId ?? existing?.subagentId,
      runId: start.runId ?? existing?.runId,
      roundId: start.roundId ?? existing?.roundId,
      description: start.description || existing?.description || "",
      prompt: start.prompt ?? existing?.prompt,
      subagentType: start.subagentType ?? existing?.subagentType,
      command: start.command ?? existing?.command,
      status: "running",
    });
    this.publishTasks();
  }

  private taskWithId(taskId: string): AgentTask | undefined {
    for (const task of this.tasks.values()) if (task.taskId === taskId) return task;
    return undefined;
  }

  private pruneEndedTasks(): void {
    let excess = this.tasks.size - MAX_RETAINED_TASKS;
    if (excess <= 0) return;
    for (const [toolCallId, task] of this.tasks) {
      if (excess <= 0) return;
      if (task.status === "running") continue;
      this.tasks.delete(toolCallId);
      this.taskContent.delete(toolCallId);
      this.taskFiles.delete(toolCallId);
      excess--;
    }
  }

  private endUnstartedTasks(): void {
    for (const task of this.tasks.values()) {
      if (task.taskId !== undefined || task.status !== "running") continue;
      const card = this.findLaunchCard(task.toolCallId)?.card;
      const status = card?.kind === "tool_call" ? UNSTARTED_TASK_END[card.status] : undefined;
      if (status) this.endTask(task, status);
    }
  }

  private endLaunchesOfEndedTurn(status: TaskEndStatus): void {
    for (const task of this.tasks.values()) {
      if (task.taskId !== undefined || task.status !== "running") continue;
      if (this.store.findMessageIdWithToolCall(task.toolCallId)) this.endTask(task, status);
    }
  }

  private findLaunchCard(
    toolCallId: string
  ): { store: AgentMessageStore; messageId: string; card?: AgentMessagePart } | undefined {
    for (const store of [this.store, ...this.taskContent.values()]) {
      const messageId = store.findMessageIdWithToolCall(toolCallId);
      if (!messageId) continue;
      const card = store
        .getMessage(messageId)
        ?.parts?.find((part) => part.kind === "tool_call" && part.id === toolCallId);
      return { store, messageId, card };
    }
    return undefined;
  }

  private endTask(
    task: AgentTask,
    status: TaskEndStatus,
    summary?: string,
    outputFile?: string,
    stopReason?: StopReason
  ): void {
    this.tasks.set(task.toolCallId, {
      ...task,
      status,
      summary,
      stopReason,
      outputFile: outputFile ?? task.outputFile,
    });
    this.updateLaunchCard({ toolCallId: task.toolCallId, status: LAUNCH_CARD_STATUS[status] });
    if (task.taskId !== undefined) this.requests.rejectToolRequestsFrom({ taskId: task.taskId });
    const content = this.taskContent.get(task.toolCallId);
    const contentId = content?.getDisplayMessages()[0]?.id;
    if (contentId) content?.stopToolCalls(contentId, EMPTY_TOOL_CALL_IDS);
    this.endUnstartedTasks();
    void this.finalizeTaskFileChanges(task.toolCallId);
    this.pruneEndedTasks();
    this.publishTasks();
  }

  private async finalizeTaskFileChanges(toolCallId: string): Promise<void> {
    const files = this.taskFiles.get(toolCallId);
    this.taskFiles.delete(toolCallId);
    const store = this.taskContent.get(toolCallId);
    const messageId = store?.getDisplayMessages()[0]?.id;
    if (!files || !store || !messageId) return;
    try {
      if (await this.finalizeFileChanges(files, store, messageId)) this.notifyTasks();
    } catch (err) {
      logWarn(`[AgentMode] could not capture a task's file changes`, err);
    }
  }

  private withEndedTaskStatus<T extends { toolCallId: string }>(
    update: T
  ): T | (T & { status: AgentToolStatus }) {
    const taskStatus = this.tasks.get(update.toolCallId)?.status;
    return taskStatus && taskStatus !== "running"
      ? { ...update, status: LAUNCH_CARD_STATUS[taskStatus] }
      : update;
  }

  private updateLaunchCard(delta: ToolCallDelta): void {
    const launch = this.findLaunchCard(delta.toolCallId);
    if (!launch) return;
    const { store, messageId, card } = launch;
    if (store.upsertAgentPart(messageId, mergeToolCallUpdate(card, delta))) {
      if (store === this.store) this.scheduleNotifyMessages();
    }
  }

  private applyTaskContent(toolCallId: string, event: SessionEvent): void {
    const update = event.update;
    let store = this.taskContent.get(toolCallId);
    if (!store) {
      store = new AgentMessageStore();
      this.taskContent.set(toolCallId, store);
    }
    const content = store;
    content.withRecordedTime(event.occurredAt, () => {
      const messageId =
        store.getDisplayMessages()[0]?.id ??
        store.addMessage({
          message: "",
          sender: AI_SENDER,
          timestamp: formatDateTime(new Date(event.occurredAt ?? Date.now())),
          isVisible: true,
          parts: [],
        });
      let changed: boolean;
      switch (update.sessionUpdate) {
        case "agent_segment_started":
          if (event.seq !== undefined) content.startAgentSegment(messageId, event.seq);
          return;
        case "agent_thought_ended":
          changed = content.finishAgentThought(messageId, update.segmentSeq, update.contentIndex);
          break;
        case "agent_segment_finalized":
          changed = content.finalizeAgentSegment(
            messageId,
            update.segmentSeq,
            update.blocks,
            event.seq,
            event.origin === "synthetic"
          );
          break;
        case "agent_message_chunk":
          changed = content.appendAgentText(
            messageId,
            extractText(update.content),
            event.seq,
            event.origin === "synthetic",
            update.segmentSeq,
            update.contentIndex
          );
          break;
        case "agent_thought_chunk":
          changed = content.appendAgentThought(
            messageId,
            extractText(update.content),
            event.seq,
            event.origin === "synthetic",
            update.segmentSeq,
            update.contentIndex
          );
          break;
        case "tool_call":
          this.observeToolCall(this.filesOfTask(toolCallId), update.kind, toolCallTarget(update));
          changed = store.upsertAgentPart(messageId, {
            ...toolCallToPart(update),
            ...(event.seq === undefined ? {} : { seq: event.seq }),
          });
          break;
        case "tool_call_update": {
          const existing = store
            .getMessage(messageId)
            ?.parts?.find((part) => part.kind === "tool_call" && part.id === update.toolCallId);
          const cutShort =
            existing?.kind === "tool_call" &&
            existing.status === "cancelled" &&
            update.status === "failed";
          const merged = mergeToolCallUpdate(
            existing,
            cutShort ? { ...update, status: "cancelled" } : this.withEndedTaskStatus(update)
          );
          this.observeToolResult(this.filesOfTask(toolCallId), merged, update);
          changed = store.upsertAgentPart(messageId, merged);
          this.endUnstartedTasks();
          break;
        }
        default:
          return;
      }
      if (changed) this.notifyTasks();
    });
  }

  private publishTasks(): void {
    this.taskList = this.tasks.size === 0 ? EMPTY_TASKS : Object.freeze([...this.tasks.values()]);
    this.refreshMessageMetrics();
    this.notifyTasks();
  }

  getMessageUsageMetrics(
    message: AgentChatMessage,
    child = false
  ): AgentChatMessage["turnMetrics"] {
    const recorded = this.usageTracker.getMetricsForMessage(message, child);
    if (!recorded) return undefined;
    const metrics = { ...recorded };
    // 子聊天完成与否只由自身任务决定；同轮兄弟仍运行时，主聊天继续保持活动。https://github.com/ItsDalk-Lane/Scribe/issues/52
    const runs = this.subagentSessions
      .filter((session) => !child || session.id === metrics.subagentId)
      .flatMap((session) => session.runs.filter((run) => run.roundId === metrics.roundId));
    metrics.hasActiveWork =
      metrics.hasActiveWork ||
      metrics.activeRounds! > 0 ||
      runs.some((run) =>
        ["queued", "running", "awaiting_approval", "awaiting_input", "stopping"].includes(
          run.status
        )
      ) ||
      [...this.tasks.values()].some(
        (task) =>
          task.status === "running" &&
          ((task.roundId === metrics.roundId &&
            (!child || task.subagentId === metrics.subagentId)) ||
            runs.some((run) => task.toolCallId === run.toolCallId))
      );
    return metrics;
  }

  private refreshMessageMetrics(): void {
    for (const [store, child] of [
      [this.store, false] as const,
      ...[...this.taskContent.values()].map((store) => [store, true] as const),
    ]) {
      for (const message of store.getDisplayMessages()) {
        if (message.sender !== AI_SENDER) continue;
        const metrics = this.getMessageUsageMetrics(message, child);
        if (!metrics) continue;
        store.setTurnMetrics(message.id, metrics);
      }
    }
    this.scheduleNotifyMessages();
  }

  private notifyTasks(): void {
    for (const l of this.listeners) {
      try {
        l.onTasksChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] tasks listener threw`, e);
      }
    }
  }

  private filesOf(requester: PermissionRequester): FileCaptures | undefined {
    if (requester === "main") return this.turns.getTurnFiles();
    const toolCallId = this.taskWithId(requester.taskId)?.toolCallId;
    return toolCallId === undefined ? undefined : this.filesOfTask(toolCallId);
  }

  private filesOfTask(toolCallId: string): FileCaptures {
    let files = this.taskFiles.get(toolCallId);
    if (!files) {
      files = new Map();
      this.taskFiles.set(toolCallId, files);
    }
    return files;
  }

  private observeToolResult(
    files: FileCaptures,
    part: AgentMessagePart,
    update: ToolCallDelta
  ): void {
    if (part.kind !== "tool_call") return;
    this.observeToolCall(
      files,
      part.toolKind,
      { locations: part.locations, input: part.input, diffPaths: diffTargetPaths(part.output) },
      update.originalFiles
    );
  }

  private observeToolCall(
    files: FileCaptures,
    kind: AgentToolKind | undefined,
    target: EditTargetSource,
    originalFiles?: Readonly<Record<string, string | null>>
  ): void {
    const changes = kind === "edit" || kind === "delete";
    if (!changes && kind !== "read") return;
    const app = this.getApp?.();
    const adapter = app?.vault?.adapter;
    if (!app || !adapter) return;
    const vaultBase = getVaultBase(app);
    const originals = new Map(
      Object.entries(originalFiles ?? {}).map(([path, text]) => [
        toVaultTargetPath(path, vaultBase),
        text,
      ])
    );
    for (const path of editTargetPaths(target, vaultBase)) {
      if (!isCapturableVaultPath(path)) continue;
      let capture = files.get(path);
      if (!capture) {
        capture = { edited: false, snapshot: readVaultText(adapter, path) };
        files.set(path, capture);
      }
      if (!changes) continue;
      capture.edited = true;
      if (capture.writeTimeBefore === undefined) capture.writeTimeBefore = originals.get(path);
    }
  }

  private async finalizeFileChanges(
    files: FileCaptures,
    store: AgentMessageStore,
    messageId: string,
    turnDiff?: TurnDiff
  ): Promise<boolean> {
    const edited = [...files].filter(([, capture]) => capture.edited);
    const app = this.getApp?.();
    const adapter = app?.vault?.adapter;
    if (edited.length === 0 || !app || !adapter) return false;
    const turnPatches = turnDiff ? filePatchesByVaultPath(turnDiff, getVaultBase(app)) : undefined;
    const changes = (
      await Promise.all(
        edited.map(async ([path, capture]) => {
          const after = await readVaultText(adapter, path);
          const patch = turnPatches?.get(path);
          if (capture.writeTimeBefore === undefined && patch) {
            capture.writeTimeBefore = revertFilePatch(patch, after);
          }
          const before =
            capture.writeTimeBefore === undefined
              ? await capture.snapshot
              : capture.writeTimeBefore;
          return buildTurnFileChange(path, before, after);
        })
      )
    ).filter((change): change is TurnFileChange => change !== null);
    return changes.length > 0 && store.setFileChanges(messageId, changes);
  }

  private findToolCallPart(messageId: string, toolCallId: string): AgentMessagePart | undefined {
    return findToolCallPart(this.store, messageId, toolCallId);
  }

  private hasLeftPlanMode(): boolean {
    if (!this.getDescriptor?.()?.getModeMapping) return false;
    return this.currentState?.mode?.current !== "plan";
  }

  private recomputeStatusIfChanged(): void {
    const next = this.getStatus();
    const replyRunning = this.isReplyRunning();
    if (next === this.cachedStatus && replyRunning === this.cachedReplyRunning) return;
    this.cachedStatus = next;
    this.cachedReplyRunning = replyRunning;
    for (const l of this.listeners) {
      try {
        l.onStatusChanged(next);
      } catch (e) {
        logWarn(`[AgentMode] status listener threw`, e);
      }
    }
  }

  private notifyMessages(): void {
    this.cancelScheduledNotify();
    for (const l of this.listeners) {
      try {
        l.onMessagesChanged();
      } catch (e) {
        logWarn(`[AgentMode] messages listener threw`, e);
      }
    }
  }

  private scheduleNotifyMessages(): void {
    if (this.notifyScheduled) return;
    this.notifyScheduled = true;
    const fire = (): void => {
      this.notifyHandle = null;
      this.notifyScheduled = false;
      this.notifyMessages();
    };
    if (typeof requestAnimationFrame !== "undefined") {
      this.notifyHandle = window.requestAnimationFrame(fire);
    } else {
      this.notifyHandle = window.setTimeout(fire, 16);
    }
  }

  private cancelScheduledNotify(): void {
    if (!this.notifyScheduled) return;
    this.notifyScheduled = false;
    if (this.notifyHandle !== null) {
      if (typeof cancelAnimationFrame !== "undefined" && typeof this.notifyHandle === "number") {
        cancelAnimationFrame(this.notifyHandle);
      } else {
        window.clearTimeout(this.notifyHandle as ReturnType<typeof setTimeout>);
      }
      this.notifyHandle = null;
    }
  }

  private async pollSessionTitle(): Promise<void> {
    if (this.labelSource === "user") return;
    if (!this.backendSummarizesTitle()) return;
    try {
      const resp = await this.backend.listSessions(this.cwd ? { cwd: this.cwd } : {});
      const entry = resp.sessions.find((s) => s.sessionId === this.backendSessionId);
      const title = entry?.title?.trim();
      if (!title) return;
      if (title.startsWith(DEFAULT_TITLE_PREFIX)) return;
      this.applyAgentLabel(title);
    } catch (err) {
      if (err instanceof MethodUnsupportedError) return;
      logWarn(`[AgentMode] session/list title poll failed for ${this.internalId}`, err);
    }
  }

  private notifyModelChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onModelChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] model listener threw`, e);
      }
    }
  }

  private notifyCurrentTodoListChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onCurrentTodoListChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] todo-list listener threw`, e);
      }
    }
  }

  private notifyCurrentPlanChanged(): void {
    for (const l of this.listeners) {
      try {
        l.onCurrentPlanChanged?.();
      } catch (e) {
        logWarn(`[AgentMode] plan listener threw`, e);
      }
    }
  }
}
