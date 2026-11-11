import { getNativeToolPolicy } from "@/agentMode/sdk/nativeToolDefinition";
import type { NativeObservedFileVersion } from "@/agentMode/sdk/nativeFileVersions";
import { ConcurrencyLimiter } from "@/utils/ConcurrencyLimiter";
import {
  projectToolResult,
  readToolResultPage,
  withToolExecution,
  type ToolResultProjectionBudget,
} from "@/utils/toolResultProjection";
import type { InstructionPromptState } from "@/instructions/instructionPolicy";
import { fingerprintRequestContext } from "@/agentMode/session/requestContextFingerprint";
import { readRequestContextPreview } from "@/agentMode/session/requestContextPreview";
import { stripUserMessageWrapper } from "@/agentMode/session/promptEnvelope";
import {
  NativeSubagentController,
  EMPTY_SUBAGENT_USAGE,
  SUBAGENT_STOPPED_MESSAGE,
  subagentModelMessage,
  type SubagentExecutionResult,
} from "@/agentMode/sdk/NativeSubagentController";
import type { NativeSubagentState } from "@/agentMode/sdk/subagentState";
import type {
  SubagentMessage,
  SubagentMessageKind,
  SubagentRunSnapshot,
  SubagentSendInput,
  SubagentDispatchResult,
  SubagentSessionSnapshot,
  SubagentUsage,
  SubagentWaitResult,
} from "@/agentMode/session/subagentTypes";
import type { SubagentLimits } from "@/agentMode/sdk/subagentLimits";
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
  type AgentToolResult,
  type ThinkingLevel,
} from "@earendil-works/pi-agent-core";
import { JournalConfirmationTimeout, type JournalRecord } from "@/agentMode/sdk/JournalStorage";
import type { CompactionProjection } from "@/agentMode/sdk/compactionProjection";
import {
  buildSkillDependencyBlock,
  deliverSkillText,
  type SkillDependencyDeliveryReading,
} from "@/agentMode/sdk/skillCatalog";
import {
  parseCompactionProjection,
  projectCompactedContext,
} from "@/agentMode/sdk/compactionProjection";
import {
  buildRequestContextSnapshot,
  estimateCurrentContextTokens,
  type RequestContextTool,
} from "@/agentMode/sdk/requestContext";
import { reduceToolHistory } from "@/agentMode/sdk/toolHistoryReduction";
import { projectDeliveredSkillPages } from "@/agentMode/sdk/skillDeliveryProjection";
import { recoverConfirmedSkillPages } from "@/agentMode/sdk/skillDeliveryReceipts";
import { generateCompactionSummary } from "@/agentMode/sdk/compactionSummary";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { deriveChatTitleFromMessages } from "@/agentMode/session/chatHistoryMerge";
import { isAgentDisplayFact, projectDisplayFacts } from "@/agentMode/session/AgentDisplayFacts";
import { isRecord } from "@/utils/obsidianInternals";
import { sha256 } from "@/utils/hash";
import { logWarn } from "@/logger";
import type { AssistantMessage, AssistantMessageEvent, UserMessage } from "@earendil-works/pi-ai";
import { getCurrentSystemMessage, getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import {
  estimateContextTokens,
  estimateMessageTokens,
  estimateTextAndImageContentTokens,
} from "@earendil-works/pi-ai/utils/estimate";
import {
  classifyProviderFailure,
  type ProviderRequestFailure,
} from "@/LLMProviders/providerRequestFailure";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { isCompactCommand, COMPACT_COMMAND_NAME } from "@/commands/compactCommand";
import { parseSubagentCommand } from "@/commands/subagentCommand";
import { isBuiltinCommandEnabled } from "@/agentMode/agentCommands/builtinAgentCommands";
import { getSettings } from "@/settings/model";
import { EXCALIDRAW_TOOL_NAMES } from "@/excalidraw/excalidrawTools";
import { SCRIBE_MCP_SERVER_NAME } from "@/agentMode/session/scribeToolDefinitions";
import { resolveToolName } from "@/agentMode/session/toolName";
import type { ToolSearchSelections } from "@/agentMode/sdk/nativeToolSearch";
import type { AgentExtensionRuntimeSnapshot } from "@/agentMode/session/extensionInventory";
import { t } from "@/lib/i18n";
import { v4 as uuidv4 } from "uuid";
import { createAssistantMessage, type ProviderChatModel } from "@/LLMProviders/piChatModel";
import { MethodUnsupportedError } from "@/agentMode/session/errors";
import type {
  AgentQuestionAnswers,
  AgentSessionPurpose,
  AgentToolKind,
  AskUserQuestionPrompt,
  BackendProcess,
  BackendState,
  ScribeMode,
  ModelEntry,
  OpenSessionInput,
  OpenSessionOutput,
  PermissionDecision,
  PermissionPrompt,
  PermissionRequester,
  PromptContent,
  PromptInput,
  ResumeSessionInput,
  SessionEvent,
  AgentDisplayFact,
  SequencedAgentDisplayFact,
  SessionUpdate,
  SessionUsage,
  SessionUpdateHandler,
  StopReason,
  ToolCallContent,
  ToolCallSnapshot,
  TurnEnd,
} from "@/agentMode/session/types";

export interface NativeSessionRecord {
  subagents?: NativeSubagentState[];
  taskGenerations?: NativeSubagentTask[];
  purpose?: AgentSessionPurpose;
  journalRecords?: JournalRecord[];
  writable?: boolean;
  warnings?: string[];
  version: 1;
  backendId: "native";
  sessionId: string;
  cwd: string;
  projectId?: string;
  modelId: string;
  effort: ThinkingLevel | null;
  mode: ScribeMode;
  // 计划批准后恢复进入计划前的模式；完全模式下批准计划须回到完全模式而非 default。
  // https://github.com/ItsDalk-Lane/Scribe/issues/38
  modeBeforePlan?: ScribeMode;
  messages: AgentMessage[];
  events: SessionEvent[];
  updatedAt: number;
  decisions?: Array<{
    kind: "permission" | "question";
    requestId: string;
    requester: PermissionRequester;
    response: PermissionDecision | AgentQuestionAnswers;
    occurredAt: number;
  }>;
  permissions?: Array<{ key: string; allowed: boolean }>;
}

export interface NativeSessionStorage {
  removeSubagent?(sessionId: string, subagentId: string): Promise<void>;
  load(sessionId: string): Promise<NativeSessionRecord | null>;
  save(record: NativeSessionRecord): Promise<void>;
  list(): Promise<NativeSessionRecord[]>;
  remove?(sessionId: string): Promise<void>;
  append?(
    sessionId: string,
    kind: string,
    payload: unknown,
    options?: {
      durable?: boolean;
      origin?: "observed" | "synthetic" | "derived";
      discardOnFailure?: boolean;
    }
  ): Promise<JournalRecord>;
  flush?(sessionId: string): Promise<void>;
}

export interface NativeToolContext {
  observedFileVersions?: Map<string, NativeObservedFileVersion>;
  observeFileVersion?(
    result: AgentToolResult<unknown>,
    path: string,
    version: NativeObservedFileVersion
  ): void;
  readToolResult?(input: {
    toolCallId: string;
    cursor?: string;
    maxCharacters?: number;
  }): Promise<AgentToolResult>;
  projectId?: string;
  transferredSkills?: readonly string[];
  allowedTools?: readonly string[];
  readSubagentResult?(id: string, runId?: string): AgentToolResult;
  assertCanExecute?(tool: string): void;
  subagentId?: string;
  runId?: string;
  sendSubagentMessage?(
    input: Omit<SubagentSendInput, "sessionId">
  ): Promise<SubagentDispatchResult>;
  listSubagentSessions?(): readonly SubagentSessionSnapshot[];
  waitSubagents?(input: {
    subagentIds?: string[];
    after?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<SubagentWaitResult>;
  stopSubagent?(id: string): Promise<void>;
  sendParentMessage?(input: {
    text: string;
    kind: SubagentMessageKind;
    messageId?: string;
  }): Promise<SubagentMessage>;
  purpose?: AgentSessionPurpose;
  sessionId: string;
  cwd: string;
  requester: PermissionRequester;
  // 目录预算按当前模型上下文窗口折算；未知窗口时退化为绝对上限。https://github.com/ItsDalk-Lane/Scribe/issues/40
  contextWindow?: number;
  skillCatalog?: { everPublished(): boolean; markPublished(): void };
  resolveSkillDependencies?: (name: string) => Promise<readonly SkillDependencyDeliveryReading[]>;
  getMode(): ScribeMode;
  emit(update: SessionUpdate): void;
  requestPermission(prompt: PermissionPrompt): Promise<PermissionDecision>;
  askUser(prompt: AskUserQuestionPrompt): Promise<AgentQuestionAnswers>;
  onPlanApproved(): void;
  flush?(): Promise<void>;
  beforeTaskStart?(task: {
    taskId: string;
    toolCallId: string;
    command: string;
    outputFile: string;
  }): Promise<void>;
  subagents?: readonly { id: string; name: string; description: string }[];
  mcpToolSelections: ToolSearchSelections;
  registerTool(tool: AgentTool, autoApproved?: boolean): void;
  executeSubagent?: (
    toolCallId: string,
    input: {
      prompt: string;
      description: string;
      name?: string;
      agent?: string;
      background?: boolean;
      skills?: string[];
      allowedTools?: string[];
    },
    signal?: AbortSignal
  ) => Promise<AgentToolResult>;
}

export interface NativeRuntimeTools {
  tools: AgentTool[];
  autoApproveTools?: ReadonlySet<string>;
  stopTask?(taskId: string): Promise<void>;
  shutdown?(): Promise<void>;
}

export interface NativeBackendProcessOptions {
  getCapabilityRevision?(cwd: string): string;
  reserveSubagentSlot?(signal?: AbortSignal): { ready: Promise<() => void> };
  assertScope?(input: { cwd: string; projectId?: string }): void;
  acquireSubagentSlot?(signal?: AbortSignal): Promise<() => void>;
  getSubagentLimits?(): SubagentLimits;
  getManuallyInvokedSkill?(
    name: string,
    cwd: string
  ): {
    name: string;
    body: string;
    dirPath?: string;
  } | null;
  getRestorableSkill?(
    name: string,
    cwd: string
  ): { name: string; body: string; dirPath?: string } | null;
  getModelInvocableSkill?(
    name: string,
    cwd: string
  ): { name: string; body: string; dirPath?: string } | null;
  // 手动注入与工具投递共用同一依赖就绪解析，注入块由 skillCatalog 构建。
  // https://github.com/ItsDalk-Lane/Scribe/issues/46
  resolveSkillDependencies?: (name: string) => Promise<readonly SkillDependencyDeliveryReading[]>;
  // 手动调用（斜杠/立即使用）计入本地使用台账。https://github.com/ItsDalk-Lane/Scribe/issues/48
  onManualSkillInvoked?: (name: string) => void;
  getSubagents?(): readonly {
    id: string;
    name: string;
    description: string;
    instructions: string;
    enabled: boolean;
  }[];
  getModels(): ModelEntry[];
  getDefaultModelId(): string | undefined;
  createModel(modelId: string): Promise<ProviderChatModel>;
  getSystemPrompt(input: OpenSessionInput): Promise<string | InstructionPromptState>;
  getRequestContext?(input: OpenSessionInput): string;
  createTools(context: NativeToolContext): NativeRuntimeTools;
  storage: NativeSessionStorage;
  attachments?: { put(bytes: Uint8Array): Promise<string>; get(hash: string): Promise<Uint8Array> };
  maxSteps?: number | (() => number | undefined);
  getExtensionRuntime?(
    cwd: string
  ): AgentExtensionRuntimeSnapshot | null | Promise<AgentExtensionRuntimeSnapshot | null>;
  getMcpServerStatus?(): AgentExtensionRuntimeSnapshot["mcpServers"];
  getVaultConfigDir?(): string;
}

interface NativeSessionContext {
  // 并行结果已保存但Pi尚未逐条发布时，保留原件引用以免兼容保存覆盖为裁剪副本。https://github.com/ItsDalk-Lane/Scribe/issues/70
  toolResultCache: Map<string, { scope: string; message: AgentMessage }>;
  observedFileVersions: Map<string, Map<string, NativeObservedFileVersion>>;
  requestContextStates: Map<string, { version: string; refreshRequired: boolean }>;
  independentTask?: Promise<void>;
  deliveredManualSkills: Map<
    string,
    {
      name: string;
      bodyHash: string;
      dirPath?: string;
      instruction: string;
      promptId: string;
      dependencyBlock: string;
    }
  >;
  roundIds: Map<string, string>;
  managedCommands: Map<string, string>;
  releasingTools: Map<NativeRuntimeTools, Promise<void>>;
  pendingChildAdmissions: number;
  cancelEpoch: number;
  exhaustedTaskIds: Set<string>;
  contextUsage?: SessionUsage;
  cumulativeUsage?: {
    cumulativeInputTokens: number;
    cumulativeOutputTokens: number;
    cumulativeCacheReadTokens: number;
    cumulativeCacheWriteTokens: number;
    cumulativeTotalTokens: number;
  };
  startingTask?: Promise<void>;
  executingTaskId?: string;
  subagentController?: NativeSubagentController;
  taskGenerationId: string;
  budgetQueue: Promise<unknown>;
  taskBudgetExhausted: boolean;
  manuallyInvokedSkills: Set<string>;
  collaboration: WeakMap<AgentMessage, SubagentMessage>;
  suppressedCollaboration: WeakSet<AgentMessage>;
  queuedCollaboration: Set<string>;
  record: NativeSessionRecord;
  recordedMessages: WeakSet<AgentMessage>;
  usageVersions: WeakMap<object, string>;
  messageSeqs: WeakMap<AgentMessage, number>;
  toolResultSeqs: Map<string, number>;
  recordedToolResults: Set<string>;
  toolExecutions: Map<
    string,
    {
      id: string;
      name: string;
      taskId?: string;
      admitted: boolean;
      denied?: boolean;
      roundId?: string;
      sourceId?: string;
    }
  >;
  storageError?: Error;
  compactions: CompactionProjection[];
  provider: ProviderChatModel;
  tools: Set<NativeRuntimeTools>;
  mcpToolSelections: Set<string>;
  pending: Map<string, UserMessage>;
  accepting: Map<string, Promise<void>>;
  messageIds: WeakMap<UserMessage, string>;
  manualSkillUsageRecorded: Set<string>;
  accepted: Set<string>;
  acceptedSeqs: Map<string, number>;
  inFlight: Set<string>;
  run?: Promise<void>;
  ending: boolean;
  cancelled: boolean;
  closed: boolean;
  lastAssistant?: AssistantMessage;
  stepLimit: boolean;
  failure?: ProviderRequestFailure;
  runId: string;
  compaction?: AbortController;
  refreshTools: boolean;
  toolsRevision: number;
  catalogEverPublished: boolean;
  runController?: AbortController;
}

export interface NativeSubagentTask {
  budgetGrants?: string[];
  id: string;
  active: boolean;
  autoContinue?: boolean;
  limit: number;
  requestIds: string[];
  usage: Array<{ requestId: string; usage: SubagentUsage }>;
}

interface ChildExecution {
  roundId?: string;
  promptId?: string;
  provider?: ProviderChatModel;
  taskId: string;
  toolCallId: string;
  subagentId: string;
  taskGenerationId: string;
  allowedTools?: string[];
  manualSkills?: string[];
  localPlan: boolean;
  tools?: NativeRuntimeTools;
  resources?: Set<NativeRuntimeTools>;
}

interface NativeSession extends NativeSessionContext {
  agent: Agent;
}

const DENIED: PermissionDecision = Object.freeze({
  outcome: Object.freeze({ outcome: "cancelled" }),
});
const NO_ANSWERS: AgentQuestionAnswers = Object.freeze({});
const EMPTY_SUBAGENT_SESSIONS: readonly SubagentSessionSnapshot[] = Object.freeze([]);
const EMPTY_COLLABORATION_MESSAGES: readonly SubagentMessage[] = Object.freeze([]);
const ALLOWED_BY_MODE: PermissionDecision = Object.freeze({
  outcome: Object.freeze({ outcome: "selected", optionId: "allow_once" }),
});

interface NativeAgentRunState {
  lastRequestFingerprint?: string;
  promptId?: string;
  roundId?: string;
  deliveredPromptIds?: Set<string>;
  taskGenerationId?: string;
  requestUsage?: Map<string, SubagentUsage>;
  steps: number;
  closing: boolean;
  stopReason?: StopReason;
  failure?: ProviderRequestFailure;
}

const STEP_LIMIT_CLOSING_PROMPT =
  "The configured step limit has been reached. Do not call any tools. Read the completed tool results and summarize what was actually completed, what remains unfinished, and how the user can continue. Do not claim unperformed work is complete.";

function failureStopReason(failure: ProviderRequestFailure): StopReason {
  switch (failure.kind) {
    case "quota":
      return "quota_exhausted";
    case "auth":
      return "authentication_error";
    case "context":
      return "context_limit";
    case "cancelled":
      return "cancelled";
    default:
      return "request_error";
  }
}

export const OBSIDIAN_DEFAULT_CONFIG_DIR = [".", "obsidian"].join("");

function isAutoEligibleEdit(
  mode: ScribeMode,
  configDir: string,
  toolCall: ToolCallSnapshot
): boolean {
  if (mode !== "auto" || toolCall.kind !== "edit" || toolCall.isPlanProposal) return false;
  const locations = toolCall.locations ?? [];
  if (!locations.length) return false;
  const normalized = configDir.replace(/^\/+|\/+$/g, "") || OBSIDIAN_DEFAULT_CONFIG_DIR;
  return locations.every(
    (location) =>
      !location.path.startsWith("/") &&
      location.path !== normalized &&
      !location.path.startsWith(`${normalized}/`)
  );
}

function transcriptText(content: string | readonly unknown[]): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => {
      if (part === null || typeof part !== "object" || !("type" in part)) return "";
      const piece = part as { type: string; text?: unknown };
      return piece.type === "text" && typeof piece.text === "string" ? piece.text : "";
    })
    .join("");
}

const CONFIRMATION_STOPPED =
  "The chat save was not confirmed in time, so this step was stopped before it ran. Check the disk, then try again.";

export class NativeBackendProcess implements BackendProcess {
  private sessions = new Map<string, NativeSession>();
  private handlers = new Map<string, SessionUpdateHandler>();
  private exits = new Set<() => void>();
  private running = true;
  private permission?: (prompt: PermissionPrompt) => Promise<PermissionDecision>;
  private question?: (prompt: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>;
  private timestamp = 0;
  private agentRuns = new WeakMap<Agent, NativeAgentRunState>();

  constructor(private readonly options: NativeBackendProcessOptions) {}

  isRunning(): boolean {
    return this.running;
  }

  onExit(listener: () => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  setPermissionPrompter(fn: (prompt: PermissionPrompt) => Promise<PermissionDecision>): void {
    this.permission = fn;
  }

  setAskUserQuestionPrompter(
    fn: (prompt: AskUserQuestionPrompt) => Promise<AgentQuestionAnswers>
  ): void {
    this.question = fn;
  }

  registerSessionHandler(id: string, handler: SessionUpdateHandler): () => void {
    this.handlers.set(id, handler);
    return () => {
      if (this.handlers.get(id) === handler) this.handlers.delete(id);
    };
  }

  async newSession(input: OpenSessionInput): Promise<OpenSessionOutput> {
    if (!this.running) throw new Error("The native agent has shut down.");
    const modelId = input.modelId ?? this.options.getDefaultModelId();
    if (!modelId) throw new Error("Choose a chat model in the existing model settings.");
    const record: NativeSessionRecord = {
      version: 1,
      backendId: "native",
      sessionId: `native-${uuidv4()}`,
      cwd: input.cwd,
      projectId: input.projectId,
      purpose: input.purpose,
      modelId,
      effort: null,
      mode: "default",
      messages: [],
      events: [],
      updatedAt: Date.now(),
      decisions: [],
    };
    const session = await this.createSession(record);
    await this.save(session);
    await this.flush(session);
    return { sessionId: record.sessionId, state: this.state(session), purpose: record.purpose };
  }

  private async createSession(record: NativeSessionRecord): Promise<NativeSession> {
    if (record.purpose !== undefined && record.purpose !== "skill-authoring")
      throw new Error("This chat purpose is not supported.");
    const provider = await this.options.createModel(record.modelId);
    const systemPrompt = await this.options.getSystemPrompt(record);
    if (!this.running) throw new Error("The native agent has shut down.");
    const context: NativeSessionContext = {
      record,
      roundIds: new Map(
        (record.journalRecords ?? []).flatMap((fact) =>
          isRecord(fact.payload) &&
          typeof fact.payload.promptId === "string" &&
          typeof fact.payload.roundId === "string"
            ? [[fact.payload.promptId, fact.payload.roundId] as const]
            : []
        )
      ),
      taskGenerationId: "",
      pendingChildAdmissions: 0,
      cancelEpoch: 0,
      budgetQueue: Promise.resolve(),
      taskBudgetExhausted: false,
      exhaustedTaskIds: new Set(
        (record.taskGenerations ?? [])
          .filter((task) => task.requestIds.length >= task.limit)
          .map((task) => task.id)
      ),
      manuallyInvokedSkills: new Set(),
      deliveredManualSkills: (record.journalRecords ?? []).reduce<
        NativeSessionContext["deliveredManualSkills"]
      >((deliveries, fact) => {
        const value = fact.payload;
        if (
          fact.kind === "skill_delivery_revoked" &&
          isRecord(value) &&
          value.version === 1 &&
          typeof value.name === "string" &&
          value.name.length > 0
        ) {
          deliveries.delete(value.name);
        } else if (
          fact.kind === "skill_delivery" &&
          isRecord(value) &&
          value.version === 1 &&
          typeof value.name === "string" &&
          value.name.length > 0 &&
          typeof value.bodyHash === "string" &&
          /^[a-f0-9]{64}$/.test(value.bodyHash) &&
          typeof value.instruction === "string" &&
          typeof value.dependencyBlock === "string" &&
          value.instruction.length > 0 &&
          typeof value.promptId === "string" &&
          value.promptId.length > 0 &&
          (value.dirPath === undefined || typeof value.dirPath === "string")
        ) {
          deliveries.set(value.name, {
            name: value.name,
            bodyHash: value.bodyHash,
            dirPath: value.dirPath,
            instruction: value.instruction,
            dependencyBlock: value.dependencyBlock,
            promptId: value.promptId,
          });
        } else if (fact.kind === "skill_delivery" || fact.kind === "skill_delivery_revoked") {
          record.writable = false;
          (record.warnings ??= []).push(
            `Fact ${fact.seq} has an unsupported skill delivery record.`
          );
        }
        return deliveries;
      }, new Map()),
      collaboration: new WeakMap(),
      suppressedCollaboration: new WeakSet(),
      queuedCollaboration: new Set(),
      recordedMessages: new WeakSet(record.messages),
      usageVersions: new WeakMap(),
      requestContextStates: new Map(),
      observedFileVersions: new Map(),
      toolResultCache: new Map(),
      messageSeqs: new WeakMap(
        (record.journalRecords ?? []).flatMap((fact) => {
          const message = isRecord(fact.payload) ? fact.payload.message : undefined;
          return (fact.kind === "protocol_message" ||
            fact.kind === "tool_result" ||
            fact.kind === "subagent_delivery") &&
            isRecord(message)
            ? [[message as unknown as AgentMessage, fact.seq] as const]
            : [];
        })
      ),
      toolResultSeqs: new Map(),
      recordedToolResults: new Set(
        record.messages.flatMap((message) =>
          message.role === "toolResult" ? [`main:${message.toolCallId}`] : []
        )
      ),
      toolExecutions: new Map(),
      compactions: (record.journalRecords ?? []).flatMap((entry) => {
        const parsed =
          entry.kind === "compaction" ? parseCompactionProjection(entry.payload) : null;
        return parsed ? [parsed] : [];
      }),
      provider,
      tools: new Set(),
      mcpToolSelections: new Set(),
      managedCommands: new Map(),
      releasingTools: new Map(),
      pending: new Map(),
      accepting: new Map(),
      messageIds: new WeakMap(),
      manualSkillUsageRecorded: new Set(),
      accepted: new Set([
        ...record.events.flatMap((event) =>
          event.update.sessionUpdate === "message_delivered" ? [event.update.promptId] : []
        ),
        ...(record.journalRecords ?? []).flatMap((fact) =>
          fact.kind === "user_accepted" &&
          isRecord(fact.payload) &&
          typeof fact.payload.promptId === "string"
            ? [fact.payload.promptId]
            : []
        ),
      ]),
      acceptedSeqs: new Map(
        (record.journalRecords ?? []).flatMap((fact) =>
          fact.kind === "user_accepted" &&
          isRecord(fact.payload) &&
          typeof fact.payload.promptId === "string"
            ? [[fact.payload.promptId, fact.seq] as const]
            : []
        )
      ),
      inFlight: new Set(),
      cancelled: false,
      ending: false,
      closed: false,
      stepLimit: false,
      runId: "",
      refreshTools: false,
      toolsRevision: 0,
      // 恢复的会话曾运行过轮次即视为发布过目录；空目录语义依赖此状态。https://github.com/ItsDalk-Lane/Scribe/issues/42
      catalogEverPublished: record.messages.length > 0,
    };
    const session: NativeSession = Object.assign(context, {
      agent: this.createAgent(context, systemPrompt),
    });
    for (const state of record.subagents ?? [])
      state.context.forEach((message, index) => {
        const seq = state.contextSeqs?.[index];
        if (seq !== undefined && seq >= 0) session.messageSeqs.set(message, seq);
      });
    if (record.messages.length) session.agent.state.messages = [...record.messages];
    this.sessions.set(record.sessionId, session);
    session.subagentController = this.createSubagentController(session);
    if (record.journalRecords?.length) await this.recoverSession(session);
    return session;
  }

  private createAgent(
    session: NativeSessionContext,
    systemPrompt: string | InstructionPromptState,
    child?: ChildExecution
  ): Agent {
    const run: NativeAgentRunState = { steps: 0, closing: false };
    const toolOwners = new Map<string, string>();
    const emit = (update: SessionUpdate): void => {
      if (update.sessionUpdate === "task_started")
        update = {
          ...update,
          roundId: toolOwners.get(update.toolCallId) ?? child?.roundId,
          ...(child ? { subagentId: child.subagentId, runId: child.taskId } : {}),
        };
      if (
        !child &&
        update.sessionUpdate === "task_started" &&
        update.kind === "command" &&
        update.taskId
      )
        session.managedCommands.set(
          update.taskId,
          run.taskGenerationId ?? session.executingTaskId ?? session.taskGenerationId
        );
      const commandTask =
        !child && update.sessionUpdate === "task_ended"
          ? session.managedCommands.get(update.taskId)
          : undefined;
      if (!child && update.sessionUpdate === "task_ended")
        session.managedCommands.delete(update.taskId);
      this.emit(
        session,
        update.sessionUpdate === "usage_update" && child
          ? { ...update, subagentId: child.subagentId }
          : update,
        child?.toolCallId
      );
      if (commandTask)
        void this.finishIdleTask(session, commandTask).catch((error) =>
          logWarn("[AgentMode] 命令结束状态未保存", {
            parentSessionId: session.record.sessionId,
            taskGenerationId: commandTask,
            errorType: error instanceof Error ? error.name : typeof error,
          })
        );
    };
    const toolViewIds = new Map<string, string>();
    const viewId = (id: string): string => {
      const existing = toolViewIds.get(id);
      if (existing) return existing;
      const promptId = run.promptId ?? session.runId;
      const key = `${child?.taskId ?? promptId}:${id}`;
      toolViewIds.set(id, key);
      const roundId = child?.roundId ?? session.roundIds.get(promptId);
      if (roundId) toolOwners.set(key, roundId);
      return key;
    };
    const requester: PermissionRequester = child
      ? {
          taskId: child.taskId,
          subagentId: child.subagentId,
          runId: child.taskId,
          subagentName: session.subagentController?.state(child.subagentId).snapshot.name,
        }
      : "main";
    let toolsRevision = session.toolsRevision;
    let capabilityRevision = this.options.getCapabilityRevision?.(session.record.cwd) ?? "";
    const getMode = (): ScribeMode =>
      session.record.mode === "plan" || child?.localPlan ? "plan" : session.record.mode;
    const assertCanExecute = (name: string): void => {
      this.assertWritable(session);
      this.options.assertScope?.(session.record);
      if (
        toolsRevision !== session.toolsRevision ||
        capabilityRevision !== (this.options.getCapabilityRevision?.(session.record.cwd) ?? "")
      )
        throw new Error("工具设置已变化，请在下一轮重新确认调用。");
      if (child?.allowedTools && !child.allowedTools.includes(name))
        throw new Error("此子会话的角色限制不允许调用该工具。");
      const registered = agent.state.tools.find((tool) => tool.name === name);
      const kind =
        (registered ? getNativeToolPolicy(registered as AgentTool)?.kind : undefined) ?? "execute";
      if (getMode() === "plan" && (kind === "edit" || kind === "execute"))
        throw new Error("Plan approval is required before changing files or running commands.");
    };
    const actorScope = child?.subagentId ?? "main";
    let observations = session.observedFileVersions.get(actorScope);
    if (!observations)
      session.observedFileVersions.set(
        actorScope,
        (observations = new Map<string, NativeObservedFileVersion>())
      );
    const resultScope = `${session.record.sessionId}:${actorScope}`;
    const fileReads = new WeakMap<
      AgentToolResult<unknown>,
      { path: string; version: NativeObservedFileVersion }
    >();
    const pendingFileReads = new Map<
      string,
      { path: string; version: NativeObservedFileVersion; content: string }
    >();
    const savedResult = (id: string): AgentToolResult | undefined => {
      const cached = session.toolResultCache.get(id);
      if (cached?.scope === actorScope) return cached.message as AgentToolResult;
      const taskIds = child
        ? new Set(
            session
              .subagentController!.state(child.subagentId)
              .snapshot.runs.map((entry) => entry.id)
          )
        : undefined;
      for (const fact of [...(session.record.journalRecords ?? [])].reverse()) {
        if (fact.kind !== "tool_result" && fact.kind !== "subagent_delivery") continue;
        const payload = fact.payload;
        if (!isRecord(payload)) continue;
        if (taskIds ? !taskIds.has(String(payload.taskId)) : payload.taskId !== undefined) continue;
        const message = payload.message;
        if (
          isRecord(message) &&
          message.role === "toolResult" &&
          (message.toolCallId === id ||
            (isRecord(message.details) && message.details.resultReference === id) ||
            id === `legacy:${fingerprintRequestContext(message)}`)
        )
          return message as unknown as AgentToolResult;
      }
      const messages = child
        ? session.subagentController!.state(child.subagentId).context
        : session.record.messages;
      return [...messages]
        .reverse()
        .find(
          (message) =>
            message.role === "toolResult" &&
            (message.toolCallId === id ||
              (isRecord(message.details) && message.details.resultReference === id) ||
              id === `legacy:${fingerprintRequestContext(message)}`)
        ) as AgentToolResult | undefined;
    };
    const toolContext: NativeToolContext = {
      observedFileVersions: observations,
      observeFileVersion: (result, path, version) => fileReads.set(result, { path, version }),
      readToolResult: async ({ toolCallId, cursor, maxCharacters }) => {
        const result = savedResult(toolCallId);
        if (!result)
          throw new Error("The saved tool result is missing or outside this agent's scope.");
        // 技能的旧正文和支持文件必须经过当前技能权限及版本检查，不能通过通用续读重新送达。https://github.com/ItsDalk-Lane/Scribe/issues/71
        if (
          "toolName" in result &&
          result.toolName === "invoke_skill" &&
          isRecord(result.details) &&
          typeof result.details.name === "string"
        )
          throw new Error("Use invoke_skill to read the current authorized skill version.");
        return readToolResultPage(
          result,
          { scope: resultScope, toolCallId },
          cursor,
          maxCharacters
        );
      },
      projectId: session.record.projectId,
      transferredSkills: child?.manualSkills,
      allowedTools: child?.allowedTools,
      assertCanExecute,
      subagentId: child?.subagentId,
      runId: child?.taskId,
      sessionId: session.record.sessionId,
      purpose: session.record.purpose,
      cwd: session.record.cwd,
      requester,
      contextWindow: session.provider.model.contextWindow,
      skillCatalog: {
        everPublished: () => session.catalogEverPublished,
        markPublished: () => {
          session.catalogEverPublished = true;
        },
      },
      resolveSkillDependencies: this.options.resolveSkillDependencies,
      getMode,
      emit,
      requestPermission: async (prompt) => {
        if (child)
          await session.subagentController!.setStatus(
            child.subagentId,
            child.taskId,
            "awaiting_approval"
          );
        const canRemember =
          !prompt.toolCall.isPlanProposal &&
          (prompt.toolCall.kind === "edit" || prompt.toolCall.kind === "execute");
        const key = JSON.stringify([
          child ? { subagentId: child.subagentId } : requester,
          session.record.cwd,
          {
            tool:
              session.toolExecutions.get(prompt.toolCall.toolCallId)?.name ??
              prompt.toolCall.vendorToolName ??
              prompt.toolCall.kind,
            server: prompt.toolCall.mcpServer ?? null,
          },
          prompt.toolCall.kind,
          prompt.toolCall.rawInput,
        ]);
        const saved = canRemember
          ? session.record.permissions?.find((rule) => rule.key === key)
          : undefined;
        const options = canRemember
          ? [
              ...prompt.options,
              {
                optionId: "allow_always",
                name: t("Always allow this action in this chat"),
                kind: "allow_always" as const,
                description: t(
                  "Only this file or exact command, in this folder, chat, and requester."
                ),
              },
              {
                optionId: "reject_always",
                name: t("Always deny this action in this chat"),
                kind: "reject_always" as const,
                description: t(
                  "Only this file or exact command, in this folder, chat, and requester."
                ),
              },
            ]
          : prompt.options;
        // 完全模式有意覆盖已保存的拒绝规则：该模式的契约是放行一切请求，仅计划审批保留人工。
        // https://github.com/ItsDalk-Lane/Scribe/issues/38
        const answer = prompt.signal?.aborted
          ? DENIED
          : session.record.mode === "full" && !prompt.toolCall.isPlanProposal
            ? ALLOWED_BY_MODE
            : saved
              ? {
                  outcome: {
                    outcome: "selected" as const,
                    optionId: saved.allowed ? "allow_once" : "reject_once",
                  },
                }
              : isAutoEligibleEdit(
                    session.record.mode,
                    this.options.getVaultConfigDir?.() ?? OBSIDIAN_DEFAULT_CONFIG_DIR,
                    prompt.toolCall
                  )
                ? ALLOWED_BY_MODE
                : await (this.permission?.({ ...prompt, requester, options }) ??
                    Promise.resolve(DENIED));
        if (!prompt.toolCall.isPlanProposal) {
          const execution = session.toolExecutions.get(prompt.toolCall.toolCallId);
          if (execution) assertCanExecute(execution.name);
        }
        const response = prompt.signal?.aborted ? DENIED : answer;
        const execution = session.toolExecutions.get(prompt.toolCall.toolCallId);
        if (execution)
          execution.denied = !(
            response.outcome.outcome === "selected" &&
            ["allow_once", "allow_always"].includes(response.outcome.optionId)
          );
        if (child)
          await session.subagentController!.setStatus(child.subagentId, child.taskId, "running");
        (session.record.decisions ??= []).push({
          kind: "permission",
          requestId: prompt.toolCall.toolCallId,
          requester,
          response,
          occurredAt: Date.now(),
        });
        if (
          canRemember &&
          response.outcome.outcome === "selected" &&
          (response.outcome.optionId === "allow_always" ||
            response.outcome.optionId === "reject_always")
        ) {
          const allowed = response.outcome.optionId === "allow_always";
          session.record.permissions = [
            ...(session.record.permissions ?? []).filter((rule) => rule.key !== key),
            { key, allowed },
          ];
          if (allowed) await this.admitTool(session, prompt.toolCall.toolCallId);
          await this.persist(
            session,
            "permission",
            { requestId: prompt.toolCall.toolCallId, requester, response },
            true
          );
          return {
            ...response,
            outcome: { outcome: "selected", optionId: allowed ? "allow_once" : "reject_once" },
          };
        }
        if (response.outcome.outcome === "selected" && response.outcome.optionId === "allow_once")
          await this.admitTool(session, prompt.toolCall.toolCallId);
        await this.persist(
          session,
          "permission",
          { requestId: prompt.toolCall.toolCallId, requester, response },
          true
        );
        return response;
      },
      askUser: async (prompt) => {
        if (child)
          await session.subagentController!.setStatus(
            child.subagentId,
            child.taskId,
            "awaiting_input"
          );
        const answer = prompt.signal?.aborted
          ? NO_ANSWERS
          : await (this.question?.(prompt) ?? Promise.resolve(NO_ANSWERS));
        const response = prompt.signal?.aborted ? NO_ANSWERS : answer;
        if (child)
          await session.subagentController!.setStatus(child.subagentId, child.taskId, "running");
        (session.record.decisions ??= []).push({
          kind: "question",
          requestId: prompt.requestId,
          requester,
          response,
          occurredAt: Date.now(),
        });
        await this.persist(
          session,
          "question",
          { requestId: prompt.requestId, requester, response },
          true
        );
        return response;
      },
      flush: () => this.flush(session),
      beforeTaskStart: async (task) => {
        await this.persist(
          session,
          "task_admitted",
          { ...task, ...(child ? { subagentId: child.subagentId, runId: child.taskId } : {}) },
          true
        );
      },
      onPlanApproved: () => {
        if (child) {
          child.localPlan = false;
          return;
        }
        session.record.mode = session.record.modeBeforePlan ?? "default";
        delete session.record.modeBeforePlan;
        emit({ sessionUpdate: "current_mode_update", currentModeId: session.record.mode });
        emit({ sessionUpdate: "state_changed", state: this.state(session) });
      },
      subagents: this.options.getSubagents?.().filter((entry) => entry.enabled),
      executeSubagent: child
        ? undefined
        : (id, input, signal) => this.delegate(session, id, input, signal),
      ...(child
        ? {
            sendParentMessage: (input: {
              text: string;
              kind: SubagentMessageKind;
              messageId?: string;
            }) => session.subagentController!.sendParent(child.subagentId, child.taskId, input),
            waitSubagents: async (input: {
              after?: number;
              timeoutMs?: number;
              signal?: AbortSignal;
            }) => {
              await session.subagentController!.setStatus(
                child.subagentId,
                child.taskId,
                "awaiting_input"
              );
              try {
                return await session.subagentController!.wait({
                  ids: [child.subagentId],
                  ...input,
                  direction: "to_child",
                });
              } finally {
                await session.subagentController!.setStatus(
                  child.subagentId,
                  child.taskId,
                  "running"
                );
              }
            },
          }
        : {
            sendSubagentMessage: (input: Omit<SubagentSendInput, "sessionId">) => {
              // 只有当前用户明确选中的技能才能授予后续子运行。https://github.com/ItsDalk-Lane/Scribe/issues/50
              if (input.skills?.some((name) => !session.manuallyInvokedSkills.has(name)))
                throw new Error("只能转交用户为当前任务明确选择的技能。");
              if (
                input.skills?.some(
                  (name) => !this.options.getManuallyInvokedSkill?.(name, session.record.cwd)
                )
              )
                throw new Error("选中的技能已停用或不可用。");
              return session.subagentController!.send(
                { ...input, sessionId: session.record.sessionId },
                "main"
              );
            },
            listSubagentSessions: () => session.subagentController!.list(),
            readSubagentResult: (id: string, runId?: string): AgentToolResult => {
              const state = session.subagentController!.state(id);
              const run = runId
                ? state.snapshot.runs.find((entry) => entry.id === runId)
                : state.snapshot.runs.at(-1);
              if (!run?.resultId)
                return {
                  content: [{ type: "text", text: "The selected run has no saved final result." }],
                  isError: true,
                  details: undefined,
                };
              if (run.deliveryBlocked)
                return {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        subagentId: id,
                        runId: run.id,
                        resultId: run.resultId,
                        status: "delivery_blocked",
                        reason:
                          "The parent inbox is full. Process its accepted messages before reading this result.",
                      }),
                    },
                  ],
                  details: undefined,
                };
              if (run.resultDelivered)
                return {
                  content: [
                    {
                      type: "text",
                      text: JSON.stringify({
                        subagentId: id,
                        runId: run.id,
                        resultId: run.resultId,
                        status: "already_delivered",
                      }),
                    },
                  ],
                  details: undefined,
                };
              return {
                content: [{ type: "text", text: run.result ?? "" }],
                details: { subagentId: id, runId: run.id, resultId: run.resultId },
                isError: run.status !== "completed",
              };
            },
            waitSubagents: (input: {
              subagentIds?: string[];
              after?: number;
              timeoutMs?: number;
              signal?: AbortSignal;
            }) =>
              session.subagentController!.wait({
                ...input,
                ids: input.subagentIds,
                direction: "to_parent",
              }),
            stopSubagent: (id: string) => session.subagentController!.stop(id),
          }),
      // 选中集合仅存活于会话内存；恢复会话后目录重新可见，模型可再次选取。https://github.com/ItsDalk-Lane/Scribe/issues/65
      mcpToolSelections: {
        names: () => [...session.mcpToolSelections],
        select: (qualifiedName: string) => {
          session.mcpToolSelections.add(qualifiedName);
        },
      },
      registerTool: (tool, autoApproved) => {
        if (!isToolAllowed(tool)) throw new Error("当前用途或子会话角色限制不允许注册该工具。");
        if (agent.state.tools.some((entry) => entry.name === tool.name))
          throw new Error(`Duplicate tool name: ${tool.name}`);
        agent.state.tools = [...agent.state.tools, wrapToolForRun(tool, autoApproved === true)];
      },
    };
    const tools = this.options.createTools(toolContext);
    if (child) {
      child.tools = tools;
      (child.resources ??= new Set()).add(tools);
    }
    session.tools.add(tools);
    const onFailure = (failure: ProviderRequestFailure): void => {
      run.failure = failure;
      if (!run.stopReason || run.stopReason === "end_turn")
        run.stopReason = failureStopReason(failure);
      if (failure.kind === "cancelled") return;
      const taskId = child?.taskGenerationId ?? run.taskGenerationId;
      if ((!child || failure.kind === "quota") && taskId === session.executingTaskId)
        session.failure = failure;
      // 迟到的额度错误只终止来源任务，不能污染另一代正在使用的新账户。https://github.com/ItsDalk-Lane/Scribe/issues/50
      if (child && failure.kind === "quota") {
        const task = session.record.taskGenerations?.find(
          (entry) => entry.id === child.taskGenerationId
        );
        if (task) {
          task.active = false;
          void this.persist(session, "subagent_task", { version: 1, task }, true).catch((error) =>
            logWarn("[AgentMode] 子任务额度停止状态未保存", {
              parentSessionId: session.record.sessionId,
              subagentId: child.subagentId,
              runId: child.taskId,
              taskGenerationId: child.taskGenerationId,
              errorType: error instanceof Error ? error.name : typeof error,
            })
          );
        }
        if (child.taskGenerationId === session.executingTaskId) {
          this.sessions.get(session.record.sessionId)?.agent.abort();
          session.runController?.abort();
        }
        void session.subagentController?.stopGeneration(child.taskGenerationId);
      }
    };
    const childProvider = child?.provider ?? (child ? session.provider : undefined);
    const childEffort = child ? session.record.effort : undefined;
    let requestMessages: AgentMessage[] | undefined;
    let requestVersion = "";
    let requestRuntimeContext = "";
    const contextScope = child?.subagentId ?? "main";
    const previousContextState = session.requestContextStates.get(contextScope);
    let requestContextState = "";
    let lastRespondedContextState = previousContextState?.version ?? "";
    let contextRefreshRequired = previousContextState?.refreshRequired ?? false;
    let requestReserveTokens = 0;
    let assembleRequest = (messages: AgentMessage[]): AgentMessage[] => messages;
    let pendingManualSkill:
      | {
          promptId: string;
          name: string;
          bodyHash: string;
          dirPath?: string;
          instruction: string;
          dependencyBlock: string;
        }
      | undefined;
    let requestSkills: Array<{ name: string; body: string; dirPath?: string }> = [];
    let requestModelSkills: Array<{
      name: string;
      body: string;
      dirPath?: string;
      version: string;
      manual: boolean;
    }> = [];
    const readSlots = new ConcurrencyLimiter(() => ({ maxConcurrent: 8, maxQueued: 256 }));
    let publishedTools = new Map<string, AgentTool>();
    let resultBudget: ToolResultProjectionBudget = { maxTokens: 4000, remainingTokens: 12000 };
    const deliveredResultProjections = new Map<string, string>();
    let projectionRevision = 0;
    const projectResult = (
      result: AgentToolResult,
      toolName: string,
      reference: string,
      budget: ToolResultProjectionBudget
    ): AgentToolResult => {
      const projected = projectToolResult(
        result,
        { scope: resultScope, toolCallId: reference },
        budget
      );
      // 技能沿用原生版本分页与送达凭据；通用预算放不下时整页省略，不能发布无法撤销的半页指令。https://github.com/ItsDalk-Lane/Scribe/issues/70
      if (
        toolName === "invoke_skill" &&
        isRecord(result.details) &&
        typeof result.details.name === "string" &&
        isRecord(projected.details) &&
        isRecord(projected.details.outputProjection) &&
        projected.details.outputProjection.truncated
      ) {
        const notice = [
          {
            type: "text" as const,
            text: `Skill instructions omitted by the output budget. Call invoke_skill ${JSON.stringify({ name: result.details.name, max_characters: 1000 })} in a separate model step to read the current authorized version. This result contains no skill instructions.`,
          },
        ];
        const available =
          budget.remainingTokens + estimateTextAndImageContentTokens(projected.content);
        const noticeFits = estimateTextAndImageContentTokens(notice) <= available;
        budget.remainingTokens =
          available - (noticeFits ? estimateTextAndImageContentTokens(notice) : 0);
        return {
          ...projected,
          content: noticeFits ? notice : [],
          details: {
            ...projected.details,
            skillContentOmitted: true,
            outputProjection: {
              ...projected.details.outputProjection,
              ...(noticeFits ? {} : { noticeOmitted: true }),
            },
          },
        };
      }
      return projected;
    };
    const isToolAllowed = (tool: AgentTool): boolean =>
      (session.record.purpose !== "skill-authoring" ||
        getNativeToolPolicy(tool)?.skillAuthoring === true) &&
      (!child?.allowedTools || child.allowedTools.includes(tool.name));
    const wrapToolForRun = (tool: AgentTool, autoApproved: boolean): AgentTool => {
      const policy = getNativeToolPolicy(tool);
      const wrapped: AgentTool = {
        ...tool,
        executionMode: policy ? tool.executionMode : "sequential",
        execute: async (id, args, signal, onUpdate) => {
          const key = viewId(id);
          let started = false;
          let release: (() => void) | undefined;
          let fileRead: { path: string; version: NativeObservedFileVersion } | undefined;
          let result: AgentToolResult;
          try {
            signal?.throwIfAborted();
            if (publishedTools.get(tool.name) !== wrapped)
              throw new Error(
                "Tool was not published for this model request; discover it and call it in the next model step."
              );
            assertCanExecute(tool.name);
            session.toolExecutions.set(key, {
              id,
              name: tool.name,
              taskId: child?.taskId,
              roundId: toolOwners.get(key),
              sourceId: child?.subagentId ?? "main",
              admitted: false,
            });
            if (!policy && !autoApproved) {
              const decision = await toolContext.requestPermission({
                sessionId: session.record.sessionId,
                requester,
                toolCall: { toolCallId: key, title: tool.name, kind: "execute", rawInput: args },
                options: [
                  { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
                  { optionId: "reject_once", name: "Deny", kind: "reject_once" },
                ],
                signal,
              });
              if (
                decision.outcome.outcome !== "selected" ||
                decision.outcome.optionId !== "allow_once"
              )
                throw new Error("Permission denied.");
            }
            if (
              wrapped.executionMode === "parallel" &&
              policy &&
              ["read", "search", "fetch"].includes(policy.kind)
            )
              release = await readSlots.acquire(signal);
            if (policy?.kind !== "edit" && policy?.kind !== "execute")
              await this.admitTool(session, key);
            // 批准、排队与日志准入都可能让资格失效，真正派发前必须重新检查。https://github.com/ItsDalk-Lane/Scribe/issues/70
            signal?.throwIfAborted();
            assertCanExecute(tool.name);
            started = true;
            result = await tool.execute(key, args, signal, onUpdate);
            if (!signal?.aborted && !result.isError) fileRead = fileReads.get(result);
            if (!isRecord(result.details) || !isRecord(result.details.execution)) {
              const facts = {
                status: result.isError ? ("failed" as const) : ("completed" as const),
                retry:
                  policy && ["read", "search", "fetch"].includes(policy.kind)
                    ? ("safe" as const)
                    : ("verify_before_retry" as const),
              };
              result = !policy
                ? withToolExecution(result, facts)
                : {
                    ...result,
                    details: {
                      ...(isRecord(result.details) ? result.details : {}),
                      execution: facts,
                    },
                  };
            }
          } catch (error) {
            if (session.storageError) throw error;
            const safe = !!policy && ["read", "search", "fetch"].includes(policy.kind);
            // 只有明确拒绝或派发前停止才证明未执行；缺准入记录不能反推外部没有副作用。https://github.com/ItsDalk-Lane/Scribe/issues/70
            const notStarted = !started || session.toolExecutions.get(key)?.denied === true;
            result = withToolExecution(
              {
                content: [
                  { type: "text", text: error instanceof Error ? error.message : String(error) },
                ],
                details: undefined,
                isError: true,
              },
              {
                status: notStarted ? "not_started" : safe ? "failed" : "outcome_unknown",
                retry: notStarted || safe ? "safe" : "verify_before_retry",
              }
            );
          } finally {
            release?.();
          }
          const reference = `${key}:${uuidv4()}`;
          result = {
            ...result,
            details: {
              ...(isRecord(result.details) ? result.details : {}),
              resultReference: reference,
            },
          };
          await this.recordToolResult(
            session,
            id,
            tool.name,
            result,
            result.isError === true,
            child?.taskId
          );
          if (fileRead)
            pendingFileReads.set(reference, {
              ...fileRead,
              content: sha256(JSON.stringify(result.content)),
            });
          return projectResult(result, tool.name, reference, resultBudget);
        },
      };
      return wrapped;
    };
    const wrapTools = (runtimeTools: NativeRuntimeTools): AgentTool[] => {
      const names = new Set<string>();
      return runtimeTools.tools.filter(isToolAllowed).map((tool) => {
        if (names.has(tool.name)) throw new Error(`Duplicate tool name: ${tool.name}`);
        names.add(tool.name);
        return wrapToolForRun(tool, runtimeTools.autoApproveTools?.has(tool.name) === true);
      });
    };
    const refreshCapabilities = (force = false): void => {
      const currentCapabilityRevision =
        this.options.getCapabilityRevision?.(session.record.cwd) ?? "";
      if (
        force ||
        toolsRevision !== session.toolsRevision ||
        capabilityRevision !== currentCapabilityRevision
      ) {
        toolContext.subagents = this.options.getSubagents?.().filter((entry) => entry.enabled);
        const refreshed = this.options.createTools(toolContext);
        session.tools.add(refreshed);
        child?.resources?.add(refreshed);
        agent.state.tools = wrapTools(refreshed);
        toolsRevision = session.toolsRevision;
        capabilityRevision = currentCapabilityRevision;
      }
    };
    const agent: Agent = new Agent({
      initialState: {
        model: childProvider?.model ?? session.provider.model,
        systemPrompt: typeof systemPrompt === "string" ? systemPrompt : systemPrompt.content,
        ...(typeof systemPrompt !== "string"
          ? { messages: [{ role: "system" as const, timestamp: 0, ...systemPrompt }] }
          : {}),
        tools: wrapTools(tools),
        thinkingLevel: session.record.effort ?? "off",
      },
      streamFn: (_model, context, options) => {
        const stream = createAssistantMessageEventStream();
        const provider = childProvider ?? session.provider;
        const manualSelection = pendingManualSkill;
        pendingManualSkill = undefined;
        const execute = async (): Promise<void> => {
          // 只在没有输出的结构化超限失败后补救同一步，已完成的工具从不重跑。https://github.com/ItsDalk-Lane/Scribe/issues/66
          for (let attempt = 0; attempt < 2; attempt++) {
            for (const entry of requestModelSkills) {
              const dependencies = this.options.resolveSkillDependencies
                ? await this.options.resolveSkillDependencies(entry.name)
                : [];
              options?.signal?.throwIfAborted();
              const content = `${buildSkillDependencyBlock(dependencies)}${entry.dirPath ? `Skill directory: ${entry.dirPath}\nResolve supporting files relative to this directory.\n\n` : ""}${entry.body}`;
              if (
                sha256(JSON.stringify([JSON.stringify([entry.name, null]), content])) !==
                entry.version
              )
                throw new Error(
                  `The previously delivered skill dependencies changed: ${entry.name}`
                );
            }
            // 技能可能在压缩或依赖检查期间变化，不能发送已经失效的正文。https://github.com/ItsDalk-Lane/Scribe/issues/68
            for (const skill of requestSkills) {
              const current = this.options.getManuallyInvokedSkill?.(
                skill.name,
                session.record.cwd
              );
              if (!current || current.body !== skill.body || current.dirPath !== skill.dirPath)
                throw new Error(
                  `The explicitly selected skill is unavailable or changed: ${skill.name}`
                );
            }
            for (const entry of requestModelSkills) {
              const current = entry.manual
                ? this.options.getManuallyInvokedSkill?.(entry.name, session.record.cwd)
                : this.options.getModelInvocableSkill?.(entry.name, session.record.cwd);
              if (!current || current.body !== entry.body || current.dirPath !== entry.dirPath)
                throw new Error(
                  `The previously delivered skill is unavailable or changed: ${entry.name}`
                );
            }
            // 其他技能的异步依赖检查期间也可能发生修改，派发前统一再核验。https://github.com/ItsDalk-Lane/Scribe/issues/68
            for (const skill of requestSkills) {
              const current = this.options.getManuallyInvokedSkill?.(
                skill.name,
                session.record.cwd
              );
              if (!current || current.body !== skill.body || current.dirPath !== skill.dirPath)
                throw new Error(
                  `The explicitly selected skill is unavailable or changed: ${skill.name}`
                );
            }
            let failure: ProviderRequestFailure | undefined;
            let visible = false;
            const buffered: AssistantMessageEvent[] = [];
            let terminalError: Extract<AssistantMessageEvent, { type: "error" }> | undefined;
            const source = provider.agentStream(
              { ...context, messages: requestMessages ?? context.messages },
              {
                ...options,
                ...this.requestAccounting(
                  session,
                  child?.taskGenerationId ?? run.taskGenerationId ?? session.taskGenerationId,
                  run,
                  {
                    child,
                    provider,
                    getSegmentSeq: () => segmentSeq,
                    messages: requestMessages ?? context.messages,
                    tools: getCurrentTools(requestMessages ?? context.messages),
                    contextVersion: requestVersion,
                  }
                ),
                onFailure: (value) => {
                  failure = value;
                },
                disableReasoning: (child ? childEffort : session.record.effort) === "off",
              }
            );
            const scope = child?.taskId ?? "main";
            const actualMessages = requestMessages ?? context.messages;
            const pages = projectDeliveredSkillPages(actualMessages, scope);
            for await (const event of source) {
              if (event.type === "error") {
                terminalError = event;
                continue;
              }
              // 只有实际请求收到模型回应，才把原始工具记录标为已交付。https://github.com/ItsDalk-Lane/Scribe/issues/68
              if (event.type !== "start") {
                for (const page of pages) {
                  const facts = session.record.journalRecords ?? [];
                  const reset =
                    facts.findLast(
                      (fact) =>
                        fact.kind === "skill_model_scope_reset" &&
                        isRecord(fact.payload) &&
                        fact.payload.scope === scope
                    )?.seq ?? 0;
                  const revoked = facts.findLast(
                    (fact) =>
                      fact.kind === "skill_model_skill_revoked" &&
                      isRecord(fact.payload) &&
                      fact.payload.scope === scope &&
                      fact.payload.name === page.name
                  )?.payload;
                  const barrier = Math.max(
                    reset,
                    isRecord(revoked) && typeof revoked.throughSeq === "number"
                      ? revoked.throughSeq
                      : 0
                  );
                  const resultSeq = session.messageSeqs.get(actualMessages[page.resultIndex]);
                  const callSeq = session.messageSeqs.get(actualMessages[page.callIndex]);
                  if (resultSeq === undefined || callSeq === undefined)
                    throw new Error(
                      "The delivered skill tool messages cannot be matched to the chat record."
                    );
                  if (resultSeq <= barrier) continue;
                  if (
                    facts.some(
                      (fact) =>
                        fact.kind === "skill_model_delivery" &&
                        isRecord(fact.payload) &&
                        fact.payload.scope === scope &&
                        fact.payload.resultSeq === resultSeq
                    )
                  )
                    continue;
                  await this.persist(
                    session,
                    "skill_model_delivery",
                    {
                      formatVersion: 2,
                      scope,
                      callSeq,
                      resultSeq,
                      ...(child ? { taskId: child.taskId, subagentId: child.subagentId } : {}),
                    },
                    true
                  );
                }
              }
              // 只有模型开始返回内容或正常结束，才能确认这次手动技能选择已送达。https://github.com/ItsDalk-Lane/Scribe/issues/68
              if (
                manualSelection &&
                event.type !== "start" &&
                session.deliveredManualSkills.get(manualSelection.name)?.promptId !==
                  manualSelection.promptId
              ) {
                await this.persist(
                  session,
                  "skill_delivery",
                  { version: 1, ...manualSelection },
                  true
                );
                session.deliveredManualSkills.set(manualSelection.name, manualSelection);
              }
              if (manualSelection && event.type !== "start") {
                session.manuallyInvokedSkills.add(manualSelection.name);
                if (!session.manualSkillUsageRecorded.has(manualSelection.promptId)) {
                  session.manualSkillUsageRecorded.add(manualSelection.promptId);
                  this.options.onManualSkillInvoked?.(manualSelection.name);
                }
              }
              // 只有模型收到未裁剪的原文并正常回应，读取才能成为之后修改的版本证据。https://github.com/ItsDalk-Lane/Scribe/issues/71
              if (event.type === "done" && !options?.signal?.aborted && pendingFileReads.size) {
                for (const message of actualMessages) {
                  if (
                    message.role !== "toolResult" ||
                    message.isError ||
                    !isRecord(message.details) ||
                    typeof message.details.resultReference !== "string"
                  )
                    continue;
                  const read = pendingFileReads.get(message.details.resultReference);
                  if (!read || sha256(JSON.stringify(message.content)) !== read.content) continue;
                  const previous = observations.get(read.path);
                  if (
                    read.version.kind === "text" &&
                    previous?.kind === "text" &&
                    previous.fingerprint === read.version.fingerprint &&
                    (previous.complete ||
                      (previous.readThrough ?? 0) > (read.version.readThrough ?? 0))
                  )
                    continue;
                  observations.set(read.path, read.version);
                }
                pendingFileReads.clear();
              }
              if (
                event.type === "text_delta" ||
                event.type === "thinking_delta" ||
                event.type === "toolcall_start" ||
                event.type === "toolcall_delta"
              )
                visible = true;
              // 首次失败的 start 不能留下未完成助手消息；恢复前只暂存尚无输出的事件。https://github.com/ItsDalk-Lane/Scribe/issues/66
              if (!visible && event.type !== "done") {
                buffered.push(event);
                continue;
              }
              for (const pending of buffered.splice(0)) stream.push(pending);
              stream.push(event);
            }
            const result = await source.result();
            if (result.stopReason !== "error" && result.stopReason !== "aborted") {
              lastRespondedContextState = requestContextState;
              session.requestContextStates.set(contextScope, {
                version: requestContextState,
                refreshRequired: contextRefreshRequired,
              });
            }
            session.usageVersions.set(result, requestVersion);
            if (
              failure?.kind !== "context" ||
              attempt > 0 ||
              visible ||
              options?.signal?.aborted ||
              result.content.length > 0
            ) {
              if (failure) onFailure(failure);
              for (const pending of buffered) stream.push(pending);
              if (terminalError) stream.push(terminalError);
              return;
            }
            const recovered = await this.prepareContext(
              session,
              context.messages,
              provider,
              options?.signal,
              onFailure,
              child?.subagentId,
              run,
              requestReserveTokens,
              true,
              requestVersion
            );
            requestMessages = assembleRequest(recovered);
          }
        };
        void execute().catch((error: unknown) => {
          if (!run.failure)
            onFailure(
              classifyProviderFailure({
                cause: error,
                callerAborted: options?.signal?.aborted === true,
              })
            );
          const message = createAssistantMessage(provider.model);
          message.stopReason = options?.signal?.aborted ? "aborted" : "error";
          message.errorMessage = error instanceof Error ? error.message : String(error);
          stream.push({ type: "error", reason: message.stopReason, error: message });
        });
        return stream;
      },
      sessionId: child?.taskId ?? session.record.sessionId,
      toolExecution: "parallel",
      beforeToolCall: async ({ assistantMessage, toolCall }, signal) => {
        signal?.throwIfAborted();
        if (run.closing) return { block: true, reason: STEP_LIMIT_CLOSING_PROMPT };
        const proposesPlan = assistantMessage.content.some(
          (part) =>
            part.type === "toolCall" &&
            part.name === "propose_plan" &&
            typeof part.arguments.plan === "string" &&
            part.arguments.plan.trim().length > 0
        );
        if (proposesPlan && child) child.localPlan = true;
        if (proposesPlan && !child && session.record.mode !== "plan") {
          session.record.modeBeforePlan = session.record.mode;
          session.record.mode = "plan";
          emit({ sessionUpdate: "current_mode_update", currentModeId: "plan" });
          emit({ sessionUpdate: "state_changed", state: this.state(session) });
        }
        const published = publishedTools.get(toolCall.name);
        const kind = (published ? getNativeToolPolicy(published)?.kind : undefined) ?? "execute";
        if (getMode() === "plan" && (kind === "edit" || kind === "execute"))
          return {
            block: true,
            reason: "Plan approval is required before changing files or running commands.",
          };
      },
      prepareRequest: async ({ context }, signal) => {
        pendingManualSkill = undefined;
        requestSkills = [];
        requestModelSkills = [];
        const currentSystem: AgentMessage = { role: "system", content: "", timestamp: 0 };
        refreshCapabilities();
        await this.flush(session);
        signal?.throwIfAborted();
        this.assertWritable(session);
        for (const message of context.messages) {
          if (!Array.isArray(message.content)) continue;
          if (
            (message.content as { type: string; data?: unknown }[]).some(
              (part) => part.type === "image" && typeof part.data !== "string"
            )
          )
            throw new Error(
              t("An attached image is unavailable. Restore the image before continuing this chat.")
            );
        }
        if (session.failure?.kind === "quota") throw new Error("Provider quota exhausted.");
        const provider = childProvider ?? session.provider;
        let history = [
          currentSystem,
          ...context.messages.filter(
            (message) => message.role !== "system" && !session.suppressedCollaboration.has(message)
          ),
        ];
        // 注入文本在预算检查之后才进入请求：先构建并计入预留，再检查预算，最后按组装结果终检。https://github.com/ItsDalk-Lane/Scribe/issues/57
        let manualSkill:
          | {
              name: string;
              bodyHash: string;
              dirPath?: string;
              instruction: string;
              dependencyBlock: string;
            }
          | undefined;
        if (!child && this.options.getManuallyInvokedSkill) {
          const user = history.findLast((entry) => entry.role === "user");
          if (user?.role === "user") {
            const text =
              typeof user.content === "string"
                ? user.content
                : user.content
                    .flatMap((part) => (part.type === "text" ? [part.text] : []))
                    .join("");
            const name = /^\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/.exec(
              stripUserMessageWrapper(text).trimStart()
            )?.[1];
            const skill = name
              ? this.options.getManuallyInvokedSkill(name, session.record.cwd)
              : null;
            if (skill) {
              requestSkills.push({ ...skill });
              // 手动注入与工具投递共用统一上限、纪律与依赖就绪注入。https://github.com/ItsDalk-Lane/Scribe/issues/41
              // https://github.com/ItsDalk-Lane/Scribe/issues/46
              const dependencyReadings = this.options.resolveSkillDependencies
                ? await this.options.resolveSkillDependencies(skill.name)
                : [];
              // 用户在依赖检查期间停止后，不能继续发送或记录技能使用。https://github.com/ItsDalk-Lane/Scribe/issues/48
              signal?.throwIfAborted();
              // 依赖检查期间技能可能被停用或修改，不能继续发送旧正文。https://github.com/ItsDalk-Lane/Scribe/issues/68
              const current = this.options.getManuallyInvokedSkill(skill.name, session.record.cwd);
              if (!current || current.body !== skill.body || current.dirPath !== skill.dirPath)
                throw new Error(
                  `The explicitly selected skill is unavailable or changed: ${skill.name}`
                );
              const delivered = deliverSkillText(
                `${buildSkillDependencyBlock(dependencyReadings)}${
                  skill.dirPath
                    ? `Skill directory: ${skill.dirPath}\nResolve supporting files relative to this directory.\n\n`
                    : ""
                }${skill.body}`
              );
              // 截断后给出读取入口，让模型从技能正文起点开始续读。https://github.com/ItsDalk-Lane/Scribe/issues/68
              manualSkill = {
                name: skill.name,
                bodyHash: sha256(skill.body),
                dirPath: skill.dirPath,
                dependencyBlock: buildSkillDependencyBlock(dependencyReadings),
                instruction: `The user explicitly selected skill ${skill.name}. Follow its instructions yourself, reuse its bundled scripts and assets instead of rewriting them, and if it does not fit the task, say so briefly and continue with the next best approach.\n${delivered.text}${delivered.truncated ? `\n${JSON.stringify({ tool: "invoke_skill", name: skill.name })}` : ""}`,
              };
            }
          }
        }
        let transferredSkills: string | undefined;
        if (child?.manualSkills?.length && this.options.getManuallyInvokedSkill) {
          const texts: string[] = [];
          for (const name of child.manualSkills) {
            const skill = this.options.getManuallyInvokedSkill(name, session.record.cwd);
            if (!skill) throw new Error(`The explicitly transferred skill is unavailable: ${name}`);
            const dependencyReadings = this.options.resolveSkillDependencies
              ? await this.options.resolveSkillDependencies(name)
              : [];
            // 检查依赖期间停止或关闭技能不能继续向子代理投递。https://github.com/ItsDalk-Lane/Scribe/issues/50
            signal?.throwIfAborted();
            const current = this.options.getManuallyInvokedSkill(name, session.record.cwd);
            if (!current || current.body !== skill.body || current.dirPath !== skill.dirPath)
              throw new Error(`The explicitly transferred skill is unavailable: ${name}`);
            requestSkills.push({ ...skill });
            texts.push(
              `${buildSkillDependencyBlock(dependencyReadings)}${
                skill.dirPath
                  ? `Skill directory: ${skill.dirPath}\nResolve supporting files relative to this directory.\n\n`
                  : ""
              }${skill.body}`
            );
          }
          const delivered = deliverSkillText(
            `Explicitly transferred skills for this delegation only, without additional permissions:\n${texts.join("\n\n")}`
          );
          // 截断后标出可重新读取的技能，避免把组合文本偏移误作续读位置。https://github.com/ItsDalk-Lane/Scribe/issues/68
          transferredSkills =
            delivered.text +
            (delivered.truncated
              ? `\n${JSON.stringify(
                  child.manualSkills.map((name) =>
                    agent.state.tools.some((tool) => tool.name === "invoke_skill")
                      ? { tool: "invoke_skill", name }
                      : { name, continuation: "unavailable" }
                  )
                )}`
              : "");
        }
        const restoredSkills: string[] = [];
        const restoredReadableSkills: string[] = [];
        if (!child && (this.options.getRestorableSkill || this.options.getManuallyInvokedSkill)) {
          for (const delivery of session.deliveredManualSkills.values()) {
            if (delivery.name === manualSkill?.name) continue;
            const current = this.options.getRestorableSkill
              ? this.options.getRestorableSkill(delivery.name, session.record.cwd)
              : this.options.getManuallyInvokedSkill?.(delivery.name, session.record.cwd);
            // 已停用或改变的技能不能在重开后重新成为当前指引。https://github.com/ItsDalk-Lane/Scribe/issues/68
            if (
              !current ||
              sha256(current.body) !== delivery.bodyHash ||
              current.dirPath !== delivery.dirPath
            ) {
              await this.persist(
                session,
                "skill_delivery_revoked",
                { version: 1, name: delivery.name },
                true
              );
              session.deliveredManualSkills.delete(delivery.name);
              continue;
            }
            // 依赖状态变化后不再重复旧就绪结果；检查失败保留原快照并报告。https://github.com/ItsDalk-Lane/Scribe/issues/68
            const dependencies = this.options.resolveSkillDependencies
              ? await this.options.resolveSkillDependencies(delivery.name)
              : [];
            signal?.throwIfAborted();
            if (buildSkillDependencyBlock(dependencies) !== delivery.dependencyBlock)
              throw new Error(
                `The dependencies for skill ${delivery.name} changed; select the skill again.`
              );
            requestSkills.push({ ...current });
            restoredSkills.push(delivery.instruction);
            if (session.manuallyInvokedSkills.has(delivery.name))
              restoredReadableSkills.push(delivery.name);
          }
        }
        // 只有当前任务的明确选择可读取附件，历史快照不重建授权。https://github.com/ItsDalk-Lane/Scribe/issues/68
        if (!child) {
          const names = [...restoredReadableSkills, ...(manualSkill ? [manualSkill.name] : [])];
          if (JSON.stringify(toolContext.transferredSkills ?? []) !== JSON.stringify(names)) {
            toolContext.transferredSkills = names.length ? names : undefined;
            refreshCapabilities(true);
          }
        }
        const restored = restoredSkills.length ? restoredSkills.join("\n\n") : undefined;
        const scope = child?.taskId ?? "main";
        const recovery = recoverConfirmedSkillPages(session.record.journalRecords ?? []);
        if (recovery.invalidReceipts.length)
          throw new Error("The recorded skill deliveries cannot be safely restored.");
        const confirmed = recovery.pages.filter((page) => page.scope === scope);
        const historical = projectDeliveredSkillPages(history, scope);
        const validPages: typeof confirmed = [];
        const invalidMessages = new Set<AgentMessage>();
        const invalidSeqs = new Set<number>();
        const scopeBarrier =
          (session.record.journalRecords ?? []).findLast(
            (fact) =>
              fact.kind === "skill_model_scope_reset" &&
              isRecord(fact.payload) &&
              fact.payload.scope === scope
          )?.seq ?? 0;
        for (const page of historical) {
          const message = history[page.resultIndex];
          const resultSeq = session.messageSeqs.get(message);
          const revoked = (session.record.journalRecords ?? []).findLast(
            (fact) =>
              fact.kind === "skill_model_skill_revoked" &&
              isRecord(fact.payload) &&
              fact.payload.scope === scope &&
              fact.payload.name === page.name
          )?.payload;
          const revokedThrough =
            isRecord(revoked) && typeof revoked.throughSeq === "number" ? revoked.throughSeq : 0;
          const barrier = Math.max(scopeBarrier, revokedThrough);
          if (barrier > 0 && resultSeq === undefined)
            throw new Error("The skill result cannot be matched to the chat record.");
          if (barrier > 0 && (resultSeq === undefined || resultSeq <= barrier)) {
            invalidMessages.add(message);
            if (resultSeq !== undefined) invalidSeqs.add(resultSeq);
          }
        }
        // 独立任务屏障之前的技能不再参与资格和依赖检查。https://github.com/ItsDalk-Lane/Scribe/issues/68
        const currentHistorical = historical.filter(
          (page) => !invalidMessages.has(history[page.resultIndex])
        );
        for (const name of new Set([...confirmed, ...currentHistorical].map((page) => page.name))) {
          const manuallyAllowed =
            child?.manualSkills?.includes(name) ||
            manualSkill?.name === name ||
            session.manuallyInvokedSkills.has(name);
          const modelSkill = this.options.getModelInvocableSkill?.(name, session.record.cwd);
          const skill =
            modelSkill ??
            (manuallyAllowed
              ? this.options.getManuallyInvokedSkill?.(name, session.record.cwd)
              : null);
          const dependencies =
            skill && this.options.resolveSkillDependencies
              ? await this.options.resolveSkillDependencies(name)
              : [];
          signal?.throwIfAborted();
          const content =
            skill &&
            `${buildSkillDependencyBlock(dependencies)}${skill.dirPath ? `Skill directory: ${skill.dirPath}\nResolve supporting files relative to this directory.\n\n` : ""}${skill.body}`;
          const version =
            content === null || content === undefined
              ? undefined
              : sha256(JSON.stringify([JSON.stringify([name, null]), content]));
          if (
            skill &&
            version &&
            [...confirmed, ...currentHistorical].some(
              (page) => page.name === name && page.version === version
            )
          )
            requestModelSkills.push({
              name,
              body: skill.body,
              dirPath: skill.dirPath,
              version,
              manual: !modelSkill,
            });
          const newlyInvalid = currentHistorical.filter(
            (page) =>
              page.name === name &&
              page.version !== version &&
              !invalidMessages.has(history[page.resultIndex])
          );
          const invalidVersions = confirmed.filter(
            (page) => page.name === name && page.version !== version
          );
          const through = [
            ...newlyInvalid.map((page) => session.messageSeqs.get(history[page.resultIndex])),
            ...invalidVersions.map((page) => page.resultSeq),
          ];
          if (through.some((seq) => seq === undefined))
            throw new Error("The skill result cannot be matched to the chat record.");
          for (const page of newlyInvalid) {
            const message = history[page.resultIndex];
            invalidMessages.add(message);
            const seq = session.messageSeqs.get(message);
            if (seq !== undefined) invalidSeqs.add(seq);
          }
          validPages.push(
            ...confirmed.filter((page) => page.name === name && page.version === version)
          );
          if (through.length)
            await this.persist(
              session,
              "skill_model_skill_revoked",
              {
                formatVersion: 1,
                scope,
                name,
                throughSeq: Math.max(...(through as number[])),
                ...(child ? { taskId: child.taskId, subagentId: child.subagentId } : {}),
              },
              true
            );
        }
        // 失效技能的旧工具结果仅在请求投影中替换，原始日志仍可查看。https://github.com/ItsDalk-Lane/Scribe/issues/68
        if (invalidMessages.size)
          history = history.map((message) => {
            if (message.role !== "toolResult" || !invalidMessages.has(message)) return message;
            const replacement: AgentMessage = {
              ...message,
              content: [{ type: "text", text: "Skill content is no longer available." }],
              details: undefined,
            };
            const seq = session.messageSeqs.get(message);
            if (seq !== undefined) session.messageSeqs.set(replacement, seq);
            return replacement;
          });
        const completePages: typeof validPages = [];
        for (const name of new Set(validPages.map((page) => page.name))) {
          const byOffset = new Map(
            validPages.filter((page) => page.name === name).map((page) => [page.offset, page])
          );
          const pages = [...byOffset.values()].sort((a, b) => a.offset - b.offset);
          // 跳过的页面不能被相邻片段掩盖，否则模型会误以为读到完整正文。https://github.com/ItsDalk-Lane/Scribe/issues/68
          if (
            pages[0]?.offset !== 0 ||
            pages.some(
              (page, index) =>
                index > 0 && pages[index - 1].nextCursor !== `${page.offset}:${page.version}`
            )
          )
            throw new Error(`Previously delivered skill ${name} has missing pages; load it again.`);
          const manualInstruction =
            manualSkill?.name === name
              ? manualSkill.instruction
              : restoredSkills.find(
                  (text) => text === session.deliveredManualSkills.get(name)?.instruction
                );
          const first = pages[0];
          const marker = first?.nextCursor
            ? `\n\n[Output truncated]\nContinue with cursor: ${first.nextCursor}`
            : "";
          const firstText =
            marker && first.text.endsWith(marker)
              ? first.text.slice(0, -marker.length)
              : first?.text;
          completePages.push(
            ...pages.filter((page) => {
              if (!manualInstruction || !firstText || !manualInstruction.includes(firstText))
                return true;
              return page.offset > 0 && !!marker;
            })
          );
        }
        const historyBudget = {
          maxTokens: Math.max(
            256,
            Math.min(8000, Math.floor((provider.model.contextWindow || 100000) / 2))
          ),
          remainingTokens: Math.max(
            512,
            Math.min(24000, Math.floor(((provider.model.contextWindow || 100000) * 2) / 3))
          ),
        };
        const projectHistoryResult = (message: AgentMessage): AgentMessage => {
          if (message.role !== "toolResult") return message;
          const reference =
            isRecord(message.details) && typeof message.details.resultReference === "string"
              ? message.details.resultReference
              : isRecord(message.details) &&
                  isRecord(message.details.outputProjection) &&
                  typeof message.details.outputProjection.toolCallId === "string"
                ? message.details.outputProjection.toolCallId
                : `legacy:${fingerprintRequestContext(message)}`;
          const source =
            isRecord(message.details) &&
            isRecord(message.details.outputProjection) &&
            message.details.skillContentOmitted !== true
              ? (savedResult(reference) ?? { ...message, details: message.details })
              : { ...message, details: message.details };
          const projected = projectResult(source, message.toolName, reference, historyBudget);
          const fingerprint = sha256(JSON.stringify(projected.content));
          const previousProjection = deliveredResultProjections.get(reference);
          if (previousProjection !== undefined && previousProjection !== fingerprint)
            projectionRevision++;
          deliveredResultProjections.set(reference, fingerprint);
          // 请求裁剪保留来源序号用于压缩，但快照仍会核对正文并单独保存变体。https://github.com/ItsDalk-Lane/Scribe/issues/70
          if (JSON.stringify(projected.content) === JSON.stringify(message.content)) return message;
          const replacement = {
            ...message,
            content: projected.content,
            details: projected.details,
          };
          const seq = session.messageSeqs.get(message);
          if (seq !== undefined) session.messageSeqs.set(replacement, seq);
          return replacement;
        };
        // 先留出最新一轮工具结果的预算，否则历史大输出会让续读一直返回空正文。https://github.com/ItsDalk-Lane/Scribe/issues/71
        const latestBatchStart =
          history.findLastIndex((message) => message.role === "assistant") + 1;
        const latestBatch = history.slice(latestBatchStart).map(projectHistoryResult);
        history = [...history.slice(0, latestBatchStart).map(projectHistoryResult), ...latestBatch];
        const original = history.filter((message) => message.role !== "system");
        const previous = this.findMatchingCompaction(session, original, child?.subagentId);
        // 旧摘要无法证明已排除失效正文，必须停止而不是重新发送。https://github.com/ItsDalk-Lane/Scribe/issues/68
        if (
          previous &&
          original.some(
            (message, index) =>
              index <= previous.toIndex &&
              !previous.preservedIndices?.includes(index) &&
              message.role === "toolResult" &&
              invalidSeqs.has(session.messageSeqs.get(message) ?? -1)
          )
        )
          throw new Error("A previous summary may contain an unavailable skill; start a new chat.");
        const projectedBefore = projectCompactedContext(original, previous);
        const visibleBefore = new Set(
          projectDeliveredSkillPages(projectedBefore, scope).map((page) =>
            session.messageSeqs.get(projectedBefore[page.resultIndex])
          )
        );
        const missingBefore = completePages.filter((page) => !visibleBefore.has(page.resultSeq));
        const currentPrompt = await raceWithAbortSignal(
          this.options.getSystemPrompt(session.record),
          signal!
        );
        signal?.throwIfAborted();
        // 异步读取规则期间项目可能改了工作位置，不能把新资料与旧位置一起发送。https://github.com/ItsDalk-Lane/Scribe/issues/71
        this.options.assertScope?.(session.record);
        refreshCapabilities();
        const childInstructions = child
          ? session.subagentController!.state(child.subagentId).instructions
          : undefined;
        const mode = getMode();
        requestRuntimeContext = [
          `<runtime_context>\nCurrent execution mode: ${mode}. ${mode === "plan" ? "File changes and command execution require plan approval." : "Tool execution remains subject to current authorization checks."}\n</runtime_context>`,
          this.options.getRequestContext?.(session.record),
          ...history.flatMap((message) =>
            message.role === "toolResult" &&
            isRecord(message.details) &&
            isRecord(message.details.outputProjection) &&
            message.details.outputProjection.noticeOmitted === true
              ? [
                  `Saved tool output omitted by the batch budget: ${JSON.stringify({ tool_call_id: typeof message.details.resultReference === "string" ? message.details.resultReference : message.details.outputProjection.toolCallId, execution: isRecord(message.details.execution) ? message.details.execution : undefined })}. Content is incomplete. ${message.details.skillContentOmitted === true ? `Read the current authorized skill with invoke_skill ${JSON.stringify({ name: message.details.name, max_characters: 1000 })} in a separate step.` : "Continue with read_tool_result using that tool_call_id; do not repeat the original operation."}`,
                ]
              : []
          ),
        ]
          .filter(Boolean)
          .join("\n\n");
        Object.assign(currentSystem, {
          role: "system",
          timestamp: 0,
          ...(typeof currentPrompt === "string" ? {} : currentPrompt),
          content: [
            typeof currentPrompt === "string" ? currentPrompt : currentPrompt.content,
            childInstructions,
            run.closing ? STEP_LIMIT_CLOSING_PROMPT : undefined,
          ]
            .filter(Boolean)
            .join("\n\n"),
        });
        publishedTools = new Map(
          (run.closing ? [] : agent.state.tools).map((tool) => [tool.name, tool])
        );
        const window = provider.model.contextWindow || 100000;
        resultBudget = {
          maxTokens: Math.max(256, Math.min(8000, Math.floor(window / 2))),
          remainingTokens: Math.max(512, Math.min(24000, Math.floor((window * 2) / 3))),
        };
        currentSystem.toolsAdded = [...publishedTools.values()].map(
          ({ name, description, parameters }) => ({ name, description, parameters })
        );
        requestContextState = sha256(JSON.stringify([currentSystem, requestRuntimeContext]));
        contextRefreshRequired ||=
          lastRespondedContextState === ""
            ? history.filter((message) => message.role !== "system").length > 1
            : lastRespondedContextState !== requestContextState;
        const contextUpdate = contextRefreshRequired
          ? [
              "<current_context_update>",
              "Use the complete current runtime state below and the current leading system instructions and tool definitions. Earlier assistant reasoning, plans, tool calls, summaries and replies may reflect outdated sources or withdrawn rules. Revise those assumptions before continuing. Do not carry forward formatting or behavioral requirements from instruction sources that are now empty or absent. This update does not change the user's request or grant tool permissions.",
              `Named instruction sources with no current rules (withdrawn): ${
                Object.entries(currentSystem.sections ?? {})
                  .filter(([, content]) => content === null)
                  .map(([name]) => name)
                  .join(", ") || "none"
              }.`,
              requestRuntimeContext,
              "</current_context_update>",
            ].join("\n")
          : "";
        const injected = [
          requestRuntimeContext,
          contextUpdate,
          manualSkill?.instruction ?? transferredSkills,
          restored,
          ...missingBefore.map((page) => page.text),
        ]
          .filter(Boolean)
          .join("\n\n");
        requestVersion = sha256(
          JSON.stringify([
            currentSystem,
            injected,
            previous?.summary ?? null,
            ["tool_output_budget_v1", historyBudget.maxTokens, projectionRevision],
            provider.model.provider,
            provider.model.id,
            provider.model.api,
            provider.model.contextWindow,
            provider.model.maxTokens,
            child ? childEffort : session.record.effort,
            session.record.cwd,
            session.record.projectId,
          ])
        );
        let reserveTokens = injected
          ? estimateContextTokens([{ role: "user", content: injected, timestamp: 0 }]).tokens
          : 0;
        // 保留的技能正文超出预算时明确停止，不把截短内容当成完整恢复。https://github.com/ItsDalk-Lane/Scribe/issues/68
        if (
          (restored || missingBefore.length > 0) &&
          provider.model.contextWindow > 0 &&
          reserveTokens >= this.contextBudget(provider)
        ) {
          onFailure({ kind: "context" });
          throw new Error("Previously delivered skill instructions exceed the context budget.");
        }
        let messages = await this.prepareContext(
          session,
          history,
          provider,
          signal,
          onFailure,
          child?.subagentId,
          run,
          reserveTokens,
          false,
          requestVersion
        );
        const visibleAfter = new Set(
          projectDeliveredSkillPages(messages, scope).map((page) =>
            session.messageSeqs.get(messages[page.resultIndex])
          )
        );
        if (
          completePages.some(
            (page) => visibleBefore.has(page.resultSeq) && !visibleAfter.has(page.resultSeq)
          )
        ) {
          const all = [
            requestRuntimeContext,
            contextUpdate,
            manualSkill?.instruction ?? transferredSkills,
            restored,
            ...completePages.map((page) => page.text),
          ]
            .filter(Boolean)
            .join("\n\n");
          reserveTokens = estimateContextTokens([
            { role: "user", content: all, timestamp: 0 },
          ]).tokens;
          messages = await this.prepareContext(
            session,
            history,
            provider,
            signal,
            onFailure,
            child?.subagentId,
            run,
            reserveTokens,
            false,
            requestVersion
          );
        }
        signal?.throwIfAborted();
        requestReserveTokens = reserveTokens;
        const skillUser = manualSkill
          ? messages.findLast((entry) => entry.role === "user")
          : undefined;
        const instruction = manualSkill?.instruction;
        assembleRequest = (prepared) => {
          const injectedMessages =
            instruction && skillUser?.role === "user"
              ? prepared.map((entry) =>
                  entry === skillUser
                    ? {
                        ...skillUser,
                        content: [
                          { type: "text" as const, text: instruction },
                          ...(typeof skillUser.content === "string"
                            ? [{ type: "text" as const, text: skillUser.content }]
                            : skillUser.content),
                        ],
                      }
                    : entry
                )
              : prepared;
          const visible = new Set(
            projectDeliveredSkillPages(injectedMessages, scope).map((page) =>
              session.messageSeqs.get(injectedMessages[page.resultIndex])
            )
          );
          const extra = [
            requestRuntimeContext,
            restored,
            transferredSkills,
            ...completePages
              .filter((page) => !visible.has(page.resultSeq))
              .map((page) => page.text),
          ].filter((text): text is string => !!text);
          if (!extra.length) return injectedMessages;
          const injectedContext: AgentMessage = {
            role: "user",
            timestamp: 0,
            content: extra.join("\n\n"),
          };
          const insertAt = 1;
          return [
            ...injectedMessages.slice(0, insertAt),
            injectedContext,
            ...injectedMessages.slice(insertAt),
            ...(contextUpdate
              ? [{ role: "user" as const, timestamp: 0, content: contextUpdate }]
              : []),
          ];
        };
        requestMessages = assembleRequest(messages);
        if (manualSkill && skillUser?.role === "user") {
          const promptId = session.messageIds.get(skillUser);
          if (promptId) pendingManualSkill = { promptId, ...manualSkill };
        }
        // 预算线检查发生在注入之前，组装完成后的最终内容必须自己通过窗口校验。https://github.com/ItsDalk-Lane/Scribe/issues/57
        if (
          provider.model.contextWindow > 0 &&
          estimateCurrentContextTokens(requestMessages, requestVersion, session.usageVersions) >=
            this.contextBudget(provider)
        ) {
          onFailure({ kind: "context" });
          throw new Error("The current request and tool results exceed the model context window.");
        }
        agent.state.messages = agent.state.messages.filter(
          (message) => !session.suppressedCollaboration.has(message)
        );
        return {
          context: {
            ...context,
            messages: history,
            tools: run.closing ? [] : agent.state.tools,
          },
        };
      },
      prepareNextTurnWithContext: ({ context }) => {
        refreshCapabilities();
        if (!run.closing)
          return {
            context: { ...context, tools: agent.state.tools },
            ...(!child
              ? {
                  messages: this.collaborationInputs(
                    session,
                    run.taskGenerationId ?? session.taskGenerationId
                  ),
                }
              : {}),
          };
        return {
          context: { ...context, tools: [] },
          messages: [{ role: "system", content: STEP_LIMIT_CLOSING_PROMPT, timestamp: Date.now() }],
        };
      },
      finishTurn: ({ message }) => {
        if (run.failure || session.failure?.kind === "quota") return { action: "end" };
        if (run.closing) {
          run.stopReason = "max_turn_requests";
          if (!child) session.stepLimit = true;
          return { action: "end" };
        }
        run.steps++;
        const maxSteps =
          typeof this.options.maxSteps === "function"
            ? this.options.maxSteps()
            : this.options.maxSteps;
        if (Number.isSafeInteger(maxSteps) && maxSteps! > 0 && run.steps >= maxSteps!) {
          // 参数被截断时没有可总结的已执行工具，达到限制就停止，不能继续请求来修补残缺参数。https://github.com/ItsDalk-Lane/Scribe/issues/31
          if (
            message.stopReason === "length" &&
            message.content.some((part) => part.type === "toolCall")
          ) {
            run.stopReason = "max_turn_requests";
            if (!child) session.stepLimit = true;
            return { action: "end" };
          }
          if (message.stopReason === "toolUse") {
            run.closing = true;
            agent.clearSteeringQueue();
            return { action: "continue" };
          }
        }
        if (
          !child &&
          this.automaticCollaboration(session, run.taskGenerationId).some((entry) =>
            ["question", "blocked", "result"].includes(entry.kind)
          )
        )
          return { action: "continue" };
      },
    });
    this.agentRuns.set(agent, run);
    let segmentSeq: number | undefined;
    agent.subscribe(async (event) => {
      if (session.closed) return;
      if (event.type === "agent_start") {
        run.taskGenerationId =
          child?.taskGenerationId ?? session.executingTaskId ?? session.taskGenerationId;
        run.steps = 0;
        run.closing = false;
        run.stopReason = undefined;
        run.failure = undefined;
        run.deliveredPromptIds = new Set();
      }
      if (
        child &&
        event.type === "message_start" &&
        event.message.role === "user" &&
        !run.closing
      ) {
        const input = session.collaboration.get(event.message);
        if (input?.sender === "user" && input.roundId) {
          child.roundId = input.roundId;
          child.promptId = input.promptId ?? input.id;
          run.promptId = child.promptId;
          run.roundId = child.roundId;
          run.steps = 0;
          run.deliveredPromptIds?.add(child.promptId);
          await this.emitCommitted(
            session,
            {
              sessionUpdate: "turn_started",
              turnId: child.promptId,
              roundId: child.roundId,
              startedAt: Date.now(),
            },
            child.toolCallId
          );
        }
      }
      if (
        event.type === "message_start" &&
        event.message.role === "user" &&
        session.messageIds.has(event.message) &&
        !run.closing
      ) {
        run.promptId = session.messageIds.get(event.message);
        if (!child && run.promptId) {
          run.deliveredPromptIds?.add(run.promptId);
          if (run.promptId !== session.runId)
            await this.emitCommitted(session, {
              sessionUpdate: "turn_started",
              turnId: run.promptId,
              roundId: session.roundIds.get(run.promptId),
              startedAt: Date.now(),
            });
        }
        run.steps = 0;
      }
      if (event.type === "message_start" && event.message.role === "assistant") {
        const started = await this.emitCommitted(
          session,
          { sessionUpdate: "agent_segment_started" },
          child?.toolCallId
        );
        segmentSeq = started.seq;
      }
      if (child || !session.cancelled)
        this.translate(
          session,
          event,
          emit,
          child !== undefined,
          viewId,
          segmentSeq,
          childProvider ?? session.provider,
          (name) => {
            const tool = publishedTools.get(name);
            return (tool ? getNativeToolPolicy(tool)?.kind : undefined) ?? "other";
          },
          savedResult
        );
      if (event.type === "message_end") {
        const message = event.message;
        const collaboration = session.collaboration.get(message);
        if (collaboration) session.queuedCollaboration.delete(collaboration.id);
        if (child) {
          const existingSeq =
            message.role === "toolResult"
              ? session.toolResultSeqs.get(`${child.taskId}:${message.toolCallId}`)
              : undefined;
          const fact =
            existingSeq === undefined
              ? await this.persist(
                  session,
                  "protocol_message",
                  {
                    message,
                    taskId: child.taskId,
                    subagentId: child.subagentId,
                    ...(collaboration ? { collaborationMessageId: collaboration.id } : {}),
                  },
                  true
                )
              : undefined;
          const seq = fact?.seq ?? existingSeq;
          if (seq !== undefined) session.messageSeqs.set(message, seq);
          await session.subagentController!.recordContext(
            child.subagentId,
            child.taskId,
            agent.state.messages.map((entry) =>
              entry.role === "toolResult" &&
              isRecord(entry.details) &&
              typeof entry.details.resultReference === "string"
                ? (session.toolResultCache.get(entry.details.resultReference)?.message ?? entry)
                : entry
            ),
            collaboration ? [collaboration.id] : [],
            agent.state.messages.map((entry) => session.messageSeqs.get(entry) ?? -1),
            collaboration ? seq : undefined
          );
          session.recordedMessages.add(message);
        } else if (collaboration) {
          const current = session
            .subagentController!.state(collaboration.subagentId)
            .snapshot.messages.find((entry) => entry.id === collaboration.id);
          if (current?.state === "accepted")
            await this.commitCollaboration(session, collaboration, message);
          else session.suppressedCollaboration.add(message);
          session.recordedMessages.add(message);
        }
        if (
          !session.recordedMessages.has(message) &&
          !(
            message.role === "toolResult" &&
            session.recordedToolResults.has(`${child?.taskId ?? "main"}:${message.toolCallId}`)
          )
        ) {
          const fact = await this.persist(
            session,
            "protocol_message",
            {
              message,
              promptId: session.runId,
              ...(message.role === "assistant" && segmentSeq !== undefined ? { segmentSeq } : {}),
              ...(child ? { taskId: child.taskId } : {}),
            },
            true
          );
          if (fact) session.messageSeqs.set(message, fact.seq);
          session.recordedMessages.add(message);
          if (!child) session.record.messages.push(message);
        }
        if (message.role === "assistant" && segmentSeq !== undefined) {
          const blocks = this.finalizedBlocks(message);
          if (blocks.length || (message.stopReason !== "error" && message.stopReason !== "aborted"))
            await this.emitCommitted(
              session,
              {
                sessionUpdate: "agent_segment_finalized",
                segmentSeq,
                blocks,
                finalResponse: message.stopReason === "stop",
              },
              child?.toolCallId
            );
        }
        if (message.role === "toolResult") {
          const seq = session.toolResultSeqs.get(
            `${child?.taskId ?? "main"}:${message.toolCallId}`
          );
          if (seq !== undefined) session.messageSeqs.set(message, seq);
        }
        await this.flush(session);
        if (!this.options.storage.append && !child) await this.saveTranscript(session, agent);
      }
    });
    return agent;
  }

  async prompt(input: PromptInput): Promise<void> {
    const session = this.session(input.sessionId);
    if (session.independentTask) await session.independentTask;
    const accepting = session.accepting.get(input.promptId);
    if (accepting) {
      await accepting;
      return;
    }
    if (session.accepted.has(input.promptId)) return;
    this.assertWritable(session);
    const message = this.userMessage(input.prompt);
    const roundId = uuidv4();
    session.roundIds.set(input.promptId, roundId);
    session.messageIds.set(message, input.promptId);
    session.pending.set(input.promptId, message);
    const accepted = (async () => {
      await this.ensureTask(session);
      session.subagentController!.userInput();
      const fact = await this.persist(
        session,
        "user_accepted",
        { promptId: input.promptId, roundId, message, displayMessage: input.displayMessage },
        true
      );
      if (fact) session.acceptedSeqs.set(input.promptId, fact.seq);
      session.accepted.add(input.promptId);
    })();
    session.accepting.set(input.promptId, accepted);
    try {
      await accepted;
    } catch (error) {
      session.pending.delete(input.promptId);
      throw error;
    } finally {
      session.accepting.delete(input.promptId);
    }
    if (!session.pending.has(input.promptId)) return;
    while (session.run) {
      if (session.ending || session.inFlight.has(input.promptId)) {
        await session.run;
        if (!session.pending.has(input.promptId)) return;
        continue;
      }
      if (!this.agentRuns.get(session.agent)?.closing) session.agent.steer(message);
      return;
    }
    await this.driveQueue(session, { promptId: input.promptId, message });
  }

  private async driveQueue(
    session: NativeSession,
    first: { promptId: string; message: UserMessage }
  ): Promise<void> {
    let current: { promptId: string; message: UserMessage } | undefined = first;
    while (current && !session.closed) {
      const reason = await this.executeTurn(session, current.promptId, current.message);
      // 上一轮仍在收尾时，后来的执行可能已接管队列；不能抢走它的输入或撤回它们。https://github.com/ItsDalk-Lane/Scribe/issues/71
      if (session.run) return;
      // 前置准备失败同样属于自动停止，不能绕过请求层直接续发排队消息。https://github.com/ItsDalk-Lane/Scribe/issues/31
      if (
        reason === "quota_exhausted" ||
        reason === "authentication_error" ||
        reason === "context_limit" ||
        reason === "request_error" ||
        reason === "max_turn_requests"
      ) {
        const ids = [...session.pending.keys()];
        session.pending.clear();
        session.agent.clearAllQueues();
        if (ids.length) this.emit(session, { sessionUpdate: "messages_withdrawn", promptIds: ids });
        break;
      }
      // 待显示的输入可能仍在接纳新任务，必须等任务归属和输入都已保存再开始执行。https://github.com/ItsDalk-Lane/Scribe/issues/71
      const next = [...session.pending.entries()].find(
        ([promptId]) => session.accepted.has(promptId) && !session.inFlight.has(promptId)
      );
      current = next ? { promptId: next[0], message: next[1] } : undefined;
    }
  }

  private async executeTurn(
    session: NativeSession,
    promptId: string,
    message: UserMessage
  ): Promise<StopReason> {
    session.inFlight.add(promptId);
    session.cancelled = false;
    session.ending = false;
    session.runController = new AbortController();
    session.runId = promptId;
    const collaboration = session.collaboration.get(message);
    const originRun = collaboration
      ? session.record.subagents
          ?.flatMap((entry) => entry.snapshot.runs)
          .find((run) => run.id === collaboration.runId)
      : undefined;
    if (originRun?.roundId) session.roundIds.set(promptId, originRun.roundId);
    const agentRun = this.agentRuns.get(session.agent);
    if (agentRun) agentRun.promptId = originRun?.promptId ?? promptId;
    const taskGenerationId =
      session.collaboration.get(message)?.taskGenerationId ?? session.taskGenerationId;
    session.executingTaskId = taskGenerationId;
    session.taskBudgetExhausted = session.exhaustedTaskIds.has(taskGenerationId);
    session.stepLimit = false;
    session.failure = undefined;
    session.lastAssistant = undefined;
    let finish!: () => void;
    const run = new Promise<void>((resolve) => {
      finish = resolve;
    });
    session.run = run;
    let ended: TurnEnd;
    try {
      ended = await this.run(session, message, promptId);
    } catch (failure) {
      if (!session.cancelled) session.failure ??= { kind: "request" };
      ended = {
        turnId: promptId,
        stopReason: session.cancelled ? "cancelled" : "request_error",
        error: failure instanceof Error ? failure : new Error(String(failure)),
      };
    }
    const deliveredPromptIds = [
      ...new Set([promptId, ...(this.agentRuns.get(session.agent)?.deliveredPromptIds ?? [])]),
    ];
    if (session.run === run) {
      session.run = undefined;
      session.runController = undefined;
      session.queuedCollaboration.clear();
    }
    finish();
    try {
      this.emit(session, { sessionUpdate: "busy_changed", busy: false });
      // 插队输入也形成独立回合，不能因共享一次执行而永远停留在进行中。https://github.com/ItsDalk-Lane/Scribe/issues/52
      for (const deliveredId of deliveredPromptIds)
        this.emit(session, {
          sessionUpdate: "turn_ended",
          ...ended,
          turnId: deliveredId,
          taskGenerationId,
          roundId: session.roundIds.get(deliveredId),
        });
      // 保存的写入部分必须在收尾前完成：它也是收尾事件的持久化屏障；确认落盘放到后台。https://github.com/ItsDalk-Lane/Scribe/issues/55
      await this.save(session);
      void this.flush(session).catch((failure) =>
        logWarn("[AgentMode] Chat save confirmation did not finish", {
          parentSessionId: session.record.sessionId,
          errorType: failure instanceof Error ? failure.name : typeof failure,
        })
      );
      session.inFlight.delete(promptId);
      if (ended.stopReason === "end_turn") await this.finishIdleTask(session, taskGenerationId);
      return ended.stopReason;
    } finally {
      if (ended.stopReason === "end_turn" && !session.cancelled && !session.closed) {
        for (const child of session.subagentController!.list())
          for (const accepted of child.messages) {
            const task = session.record.taskGenerations?.find(
              (entry) => entry.id === accepted.taskGenerationId
            );
            if (
              accepted.direction === "to_parent" &&
              accepted.state === "accepted" &&
              ["question", "blocked", "result"].includes(accepted.kind) &&
              task?.active &&
              task.autoContinue !== false
            )
              void this.deliverCollaboration(session, accepted).catch((error) =>
                logWarn("[AgentMode] 子代理消息交付失败", {
                  parentSessionId: session.record.sessionId,
                  subagentId: accepted.subagentId,
                  runId: accepted.runId,
                  messageId: accepted.id,
                  errorType: error instanceof Error ? error.name : typeof error,
                })
              );
          }
      }
    }
  }

  refreshSessionConfiguration(sessionId: string): void {
    const session = this.session(sessionId);
    session.refreshTools = true;
    session.toolsRevision++;
  }

  async getRequestContextPreview(input: { sessionId: string }) {
    const session = this.session(input.sessionId);
    await this.flush(session);
    return readRequestContextPreview(session.record.journalRecords ?? []);
  }

  async getExtensionRuntime(input: {
    sessionId: string;
  }): Promise<AgentExtensionRuntimeSnapshot | null> {
    return this.options.getExtensionRuntime?.(this.session(input.sessionId).record.cwd) ?? null;
  }

  async getMcpServerStatus(params: {
    sessionId: string;
  }): Promise<AgentExtensionRuntimeSnapshot["mcpServers"] | null> {
    void this.session(params.sessionId);
    return this.options.getMcpServerStatus?.() ?? null;
  }

  private async run(
    session: NativeSession,
    message: UserMessage,
    turnId: string
  ): Promise<TurnEnd> {
    this.emit(session, {
      sessionUpdate: "turn_started",
      turnId,
      startedAt: Date.now(),
      roundId: session.roundIds.get(turnId),
    });
    this.emit(session, { sessionUpdate: "busy_changed", busy: true });
    session.pending.delete(turnId);
    this.emit(session, { sessionUpdate: "message_delivered", promptId: turnId });
    let error: Error | undefined;
    try {
      const signal = session.runController!.signal;
      const systemPrompt = await raceWithAbortSignal(
        this.options.getSystemPrompt(session.record),
        signal
      );
      if (session.cancelled) throw new DOMException("Aborted", "AbortError");
      session.provider = await raceWithAbortSignal(
        this.options.createModel(session.record.modelId),
        signal
      );
      if (session.cancelled) throw new DOMException("Aborted", "AbortError");
      session.agent.state.model = session.provider.model;
      if (session.refreshTools || this.options.getSubagents) {
        const messages = session.agent.state.messages;
        session.agent = this.createAgent(session, systemPrompt);
        session.agent.state.messages = messages;
        for (const pending of session.pending.values()) session.agent.steer(pending);
        session.refreshTools = false;
      }
      session.agent.state.messages = session.agent.state.messages.filter(
        (entry) => !(entry.role === "system" && entry.content === STEP_LIMIT_CLOSING_PROMPT)
      );
      const system = getCurrentSystemMessage(session.agent.state.messages);
      session.agent.state.messages = [
        {
          ...(system ?? { role: "system" as const, timestamp: 0 }),
          ...(typeof systemPrompt === "string"
            ? { content: systemPrompt, sections: undefined }
            : systemPrompt),
        },
        ...session.agent.state.messages.filter((message) => message.role !== "system"),
      ];
      const text =
        typeof message.content === "string"
          ? message.content
          : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
      // 用户斜杠委派：命中子代理命令的消息不进入主模型，直接启动后台子代理运行，结果经自动续跑回传主聊天。https://github.com/ItsDalk-Lane/Scribe/issues/54
      const subagentCommand = this.options.getSubagents
        ? parseSubagentCommand(text, this.options.getSubagents())
        : undefined;
      // 会话层与输入层都按同一开关判断；这里兜底防止被禁用的 /compact 走压缩分支。https://github.com/ItsDalk-Lane/Scribe/issues/53
      if (isCompactCommand(text) && isBuiltinCommandEnabled(getSettings(), COMPACT_COMMAND_NAME)) {
        const controller = new AbortController();
        session.compaction = controller;
        await this.compact(session, session.agent.state.messages, {
          trigger: "manual",
          signal: controller.signal,
          provider: session.provider,
          focus: text.trim().slice(`/${COMPACT_COMMAND_NAME}`.length).trim(),
          onFailure: (failure) => {
            session.failure = failure;
          },
        });
        if (session.pending.size > 0 && !session.cancelled) await session.agent.continue();
      } else if (subagentCommand) {
        await this.ensureTask(session);
        await session.subagentController!.create({
          prompt: subagentCommand.prompt,
          name: `${subagentCommand.definition.name}: ${subagentCommand.prompt}`,
          toolCallId: `slash-${turnId}`,
          background: true,
          instructions: subagentCommand.definition.instructions,
        });
      } else {
        session.agent.clearSteeringQueue();
        session.queuedCollaboration.clear();
        const initialCollaboration = session.collaboration.get(message)?.id;
        const collaboration = this.collaborationInputs(
          session,
          session.executingTaskId ?? session.taskGenerationId,
          initialCollaboration
        );
        await session.agent.prompt([message, ...collaboration]);
      }
      if (
        session.lastAssistant?.stopReason === "error" &&
        session.lastAssistant.rawStopReason !== "refusal" &&
        session.lastAssistant.rawStopReason !== "content_filter"
      )
        error = new Error(session.lastAssistant.errorMessage || "The model request failed.");
    } catch (failure) {
      if (!session.cancelled) {
        error = failure instanceof Error ? failure : new Error(String(failure));
        if (!session.failure) {
          const classified = classifyProviderFailure({
            cause: failure,
            callerAborted: session.cancelled,
          });
          if (classified.kind !== "request" && classified.kind !== "cancelled")
            session.failure = classified;
        }
      }
    }
    const reason: StopReason = session.taskBudgetExhausted
      ? "max_task_requests"
      : session.cancelled
        ? "cancelled"
        : session.failure
          ? failureStopReason(session.failure)
          : session.stepLimit
            ? "max_turn_requests"
            : session.lastAssistant?.rawStopReason === "refusal" ||
                session.lastAssistant?.rawStopReason === "content_filter"
              ? "refusal"
              : session.lastAssistant?.stopReason === "length"
                ? "max_tokens"
                : "end_turn";
    session.compaction = undefined;
    session.ending = true;
    await this.save(session);
    return {
      turnId,
      stopReason: session.cancelled ? "cancelled" : reason,
      ...(error && !session.failure && reason === "end_turn"
        ? { error, stopReason: "request_error" as const }
        : {}),
    };
  }

  // 输入预算线：窗口的保守份额扣除已声明的输出预算，再扣除本轮稍后注入内容占用的预留。https://github.com/ItsDalk-Lane/Scribe/issues/57
  private contextBudget(provider: ProviderChatModel, reserveTokens = 0): number {
    return (
      Math.min(
        provider.model.contextWindow * 0.8,
        provider.model.contextWindow - provider.model.maxTokens
      ) - reserveTokens
    );
  }

  // 匹配覆盖当前原始消息序列的最新压缩记录：预算检查的投影与压缩取料共用同一判定。https://github.com/ItsDalk-Lane/Scribe/issues/63
  private findMatchingCompaction(
    session: NativeSessionContext,
    original: AgentMessage[],
    taskId?: string
  ): CompactionProjection | undefined {
    return session.compactions.findLast((record) => {
      if (record.taskId !== taskId || !parseCompactionProjection(record, original.length))
        return false;
      const seqs = (record as CompactionProjection & { sourceSeqs?: number[] }).sourceSeqs;
      return (
        Array.isArray(seqs) &&
        seqs.length === record.toIndex + 1 &&
        seqs.every((seq, index) => seq === session.messageSeqs.get(original[index]))
      );
    });
  }

  private async prepareContext(
    session: NativeSessionContext,
    messages: AgentMessage[],
    provider: ProviderChatModel,
    signal: AbortSignal | undefined,
    onFailure: (failure: ProviderRequestFailure) => void,
    taskId?: string,
    accountingRun?: NativeAgentRunState,
    reserveTokens = 0,
    force = false,
    contextVersion = ""
  ): Promise<AgentMessage[]> {
    const original = messages.filter((message) => message.role !== "system");
    const system = getCurrentSystemMessage(messages);
    const previous = this.findMatchingCompaction(session, original, taskId);
    const projected = [...(system ? [system] : []), ...projectCompactedContext(original, previous)];
    const window = provider.model.contextWindow;
    if (window <= 0 && !force) return projected;
    const budget = this.contextBudget(provider, reserveTokens);
    if (
      !force &&
      estimateCurrentContextTokens(projected, contextVersion, session.usageVersions) < budget
    )
      return projected;
    const reduced = reduceToolHistory(projected);
    if (
      !force &&
      reduced !== projected &&
      reduced.reduce((sum, message) => sum + estimateMessageTokens(message), 0) < budget
    )
      return reduced;
    const userIndex = original.findLastIndex((message) => message.role === "user");
    const assistantIndex = original.findLastIndex((message) => message.role === "assistant");
    const latestAssistant = original[assistantIndex];
    const hasToolBatch =
      latestAssistant?.role === "assistant" &&
      latestAssistant.content.some((part) => part.type === "toolCall");
    const tailIndex = hasToolBatch ? assistantIndex : Math.max(userIndex, assistantIndex);
    let summaryRequestFailed = false;
    try {
      if (!original.slice(0, tailIndex).some((message) => message.role === "assistant"))
        throw new Error("The current request and tool results exceed the model context window.");
      const next = await this.compact(session, messages, {
        trigger: "auto",
        signal,
        provider,
        onFailure: (failure) => {
          summaryRequestFailed = true;
          onFailure(failure);
        },
        range: {
          toIndex: tailIndex - 1,
          preservedIndices: userIndex >= 0 && userIndex < tailIndex ? [userIndex] : [],
        },
        taskId,
        accountingRun,
        reserveTokens,
        reason: force ? "context_recovery" : "budget",
      });
      if (
        window > 0 &&
        estimateCurrentContextTokens(next, contextVersion, session.usageVersions) >= budget
      )
        throw new Error("The compacted context is still too large for this model.");
      return next;
    } catch (error) {
      if (!signal?.aborted && !summaryRequestFailed) onFailure({ kind: "context" });
      throw error;
    }
  }

  private async compact(
    session: NativeSessionContext,
    messages: AgentMessage[],
    options: {
      trigger: "manual" | "auto";
      signal?: AbortSignal;
      provider: ProviderChatModel;
      onFailure?: (failure: ProviderRequestFailure) => void;
      range?: { toIndex: number; preservedIndices: number[] };
      taskId?: string;
      accountingRun?: NativeAgentRunState;
      reserveTokens?: number;
      focus?: string;
      reason?: string;
    }
  ): Promise<AgentMessage[]> {
    const {
      trigger,
      signal,
      provider,
      onFailure,
      taskId,
      accountingRun,
      reserveTokens = 0,
    } = options;
    const original = messages.filter((message) => message.role !== "system");
    const range = options.range ?? { toIndex: original.length - 1, preservedIndices: [] };
    const id = `native-compact-${uuidv4()}`;
    const childRun = taskId
      ? session.subagentController!.state(taskId).snapshot.runs.at(-1)!
      : undefined;
    const scope = childRun ? { subagentId: taskId, runId: childRun.id } : {};
    const emit = (update: SessionUpdate): void => this.emit(session, update, childRun?.toolCallId);
    const previous = this.findMatchingCompaction(session, original, taskId);
    const system = getCurrentSystemMessage(messages);
    const preTokens =
      estimateCurrentContextTokens(
        [...(system ? [system] : []), ...projectCompactedContext(original, previous)],
        "",
        session.usageVersions
      ) + reserveTokens;
    const contextWindow =
      provider.model.contextWindow > 0 ? provider.model.contextWindow : undefined;
    const progress = { id, trigger, ...scope, preTokens, contextWindow, reason: options.reason };
    if (!original.some((message) => message.role === "assistant")) {
      emit({ sessionUpdate: "compaction", ...progress, status: "skipped" });
      return messages;
    }
    emit({ sessionUpdate: "compaction", ...progress, status: "in_progress" });
    let failureReported = false;
    try {
      signal?.throwIfAborted();
      // 手动整理也会向模型发送历史；失效或跨任务的技能正文不能进入摘要。https://github.com/ItsDalk-Lane/Scribe/issues/68
      if (trigger === "manual" && this.options.getModelInvocableSkill) {
        const skillScope = childRun?.id ?? "main";
        const facts = session.record.journalRecords ?? [];
        for (const page of projectDeliveredSkillPages(original, skillScope)) {
          const resultSeq = session.messageSeqs.get(original[page.resultIndex]);
          const reset =
            facts.findLast(
              (fact) =>
                fact.kind === "skill_model_scope_reset" &&
                isRecord(fact.payload) &&
                fact.payload.scope === skillScope
            )?.seq ?? 0;
          const revoked = facts.findLast(
            (fact) =>
              fact.kind === "skill_model_skill_revoked" &&
              isRecord(fact.payload) &&
              fact.payload.scope === skillScope &&
              fact.payload.name === page.name
          )?.payload;
          const barrier = Math.max(
            reset,
            isRecord(revoked) && typeof revoked.throughSeq === "number" ? revoked.throughSeq : 0
          );
          if (barrier > 0 && (resultSeq === undefined || resultSeq <= barrier))
            throw new Error(
              "An unavailable skill cannot be included in a summary; start a new chat."
            );
          const manuallyAllowed =
            childRun && taskId
              ? session.subagentController?.state(taskId).manualSkills?.includes(page.name)
              : session.manuallyInvokedSkills.has(page.name);
          const skill =
            this.options.getModelInvocableSkill(page.name, session.record.cwd) ??
            (manuallyAllowed
              ? this.options.getManuallyInvokedSkill?.(page.name, session.record.cwd)
              : null);
          const dependencies =
            skill && this.options.resolveSkillDependencies
              ? await this.options.resolveSkillDependencies(page.name)
              : [];
          signal?.throwIfAborted();
          const content =
            skill &&
            `${buildSkillDependencyBlock(dependencies)}${skill.dirPath ? `Skill directory: ${skill.dirPath}\nResolve supporting files relative to this directory.\n\n` : ""}${skill.body}`;
          if (
            content === null ||
            content === undefined ||
            sha256(JSON.stringify([JSON.stringify([page.name, null]), content])) !== page.version
          )
            throw new Error(
              "An unavailable skill cannot be included in a summary; start a new chat."
            );
        }
      }
      // 旧区间内保留的原文尚未进入摘要，下次整理也必须取回，除非本次仍原样保留。https://github.com/ItsDalk-Lane/Scribe/issues/63
      const resummarizeFrom = previous ? previous.toIndex + 1 : 0;
      const selected = original.filter(
        (_, index) =>
          (index >= resummarizeFrom || previous?.preservedIndices?.includes(index)) &&
          index <= range.toIndex &&
          !range.preservedIndices.includes(index)
      );
      const emptyProjection = {
        fromIndex: 0,
        ...range,
        summary: " ",
        occurredAt: Math.max(Date.now(), ...messages.map((message) => message.timestamp)) + 1,
      };
      const base = estimateCurrentContextTokens(
        [
          ...(system ? [system] : []),
          ...projectCompactedContext(original, { ...emptyProjection, summary: "." }),
        ],
        "",
        session.usageVersions
      );
      const budget = contextWindow ? this.contextBudget(provider, reserveTokens) : Infinity;
      // 摘要目标扣除真实保留原文并留出增长空间，不能把整个输出上限都交给摘要。https://github.com/ItsDalk-Lane/Scribe/issues/66
      const outputBudget = Math.floor(
        Math.min(
          4096,
          provider.model.maxTokens > 0 ? provider.model.maxTokens : 4096,
          Math.max(budget * 0.75 - base, (budget - base) * 0.5)
        )
      );
      if (outputBudget < 1) throw new Error("The retained context leaves no room for a summary.");
      const result = await generateCompactionSummary({
        messages: selected,
        previousSummary: previous?.summary,
        focus: options.focus,
        signal,
        inputBudget: contextWindow
          ? Math.min(contextWindow * 0.8, contextWindow - outputBudget)
          : 100000,
        outputBudget,
        estimate: (text) =>
          estimateContextTokens([{ role: "user", content: text, timestamp: 0 }]).tokens,
        summarize: async (text, maxTokens) => {
          await this.flush(session);
          const summaryMessages: AgentMessage[] = [
            { role: "user", content: text, timestamp: Date.now() },
          ];
          return provider
            .agentStream(
              { messages: summaryMessages },
              {
                signal,
                maxTokens,
                ...this.requestAccounting(
                  session,
                  childRun?.taskGenerationId ?? session.executingTaskId ?? session.taskGenerationId,
                  accountingRun,
                  {
                    provider,
                    purpose: "compaction",
                    messages: summaryMessages,
                    child:
                      childRun && taskId
                        ? {
                            subagentId: taskId,
                            taskId: childRun.id,
                            roundId: accountingRun?.roundId ?? childRun.roundId,
                            promptId: accountingRun?.promptId ?? childRun.promptId,
                          }
                        : undefined,
                  }
                ),
                onFailure: (failure) => {
                  failureReported = true;
                  if (failure.kind !== "cancelled") onFailure?.(failure);
                },
                disableReasoning: session.record.effort === "off",
                ...(session.record.effort && session.record.effort !== "off"
                  ? { reasoning: session.record.effort }
                  : {}),
              }
            )
            .result();
        },
      });
      const record = {
        ...emptyProjection,
        summary: result.summary,
        model: provider.model.id,
        usage: result.usage,
        fromSeq: session.messageSeqs.get(original[0]),
        toSeq: session.messageSeqs.get(original[range.toIndex]),
        sourceSeqs: original
          .slice(0, range.toIndex + 1)
          .map((message) => session.messageSeqs.get(message)),
        ...(taskId ? { taskId } : {}),
      };
      const compacted = [...(system ? [system] : []), ...projectCompactedContext(original, record)];
      const postTokens =
        estimateCurrentContextTokens(compacted, "", session.usageVersions) + reserveTokens;
      if (contextWindow && postTokens >= this.contextBudget(provider))
        throw new Error("The compacted context is still too large for this model.");
      const completion = {
        ...progress,
        status: "completed" as const,
        summary: record.summary,
        fromIndex: record.fromIndex,
        toIndex: record.toIndex,
        preservedIndices: record.preservedIndices,
        postTokens,
      };
      signal?.throwIfAborted();
      // 已提交摘要就是最终事实；重开不能因展示事件未保存而误报取消。https://github.com/ItsDalk-Lane/Scribe/issues/66
      const fact = await this.persist(
        session,
        "compaction",
        { ...record, completion, taskToolCallId: childRun?.toolCallId },
        true,
        "derived"
      );
      session.compactions.push(record);
      if (!taskId) {
        session.lastAssistant = undefined;
        session.contextUsage = { usedTokens: postTokens, contextWindow, updatedAt: Date.now() };
      }
      emit({ sessionUpdate: "compaction", ...completion, commitSeq: fact?.seq });
      return compacted;
    } catch (error) {
      if (!signal?.aborted && !failureReported) onFailure?.({ kind: "context" });
      emit({
        sessionUpdate: "compaction",
        ...progress,
        status: signal?.aborted ? "cancelled" : "failed",
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  private userMessage(content: PromptContent[]): UserMessage {
    this.timestamp = Math.max(this.timestamp + 1, Date.now());
    return {
      role: "user",
      timestamp: this.timestamp,
      content: content.map((part) =>
        part.type === "resource_link"
          ? { type: "text", text: `${part.name ?? "Resource"}: ${part.uri}` }
          : { ...part }
      ),
    };
  }

  private translate(
    session: NativeSessionContext,
    event: AgentEvent,
    emit: (update: SessionUpdate) => void,
    child: boolean,
    viewId: (id: string) => string,
    segmentSeq?: number,
    provider = session.provider,
    toolKind: (name: string) => AgentToolKind = () => "other",
    savedResult?: (id: string) => AgentToolResult | undefined
  ): void {
    if (
      event.type === "message_start" &&
      event.message.role === "user" &&
      !session.collaboration.has(event.message)
    ) {
      const id = session.messageIds.get(event.message);
      if (id && session.pending.delete(id))
        emit({ sessionUpdate: "message_delivered", promptId: id });
      for (const part of typeof event.message.content === "string"
        ? [{ type: "text" as const, text: event.message.content }]
        : event.message.content) {
        emit({
          sessionUpdate: "user_message_chunk",
          content: part,
          ...(id ? { messageId: id } : {}),
        });
      }
    }
    if (event.type === "message_update") {
      const delta = event.assistantMessageEvent;
      // 思考结束后生成工具参数的等待不能继续计作思考；按真实协议边界冻结原块。https://github.com/ItsDalk-Lane/Scribe/issues/52
      if (
        segmentSeq !== undefined &&
        (delta.type === "thinking_end" ||
          delta.type === "text_start" ||
          delta.type === "toolcall_start")
      )
        emit({
          sessionUpdate: "agent_thought_ended",
          segmentSeq,
          ...(delta.type === "thinking_end" ? { contentIndex: delta.contentIndex } : {}),
        });
      if (delta.type === "text_delta" || delta.type === "thinking_delta") {
        emit({
          sessionUpdate:
            delta.type === "text_delta" ? "agent_message_chunk" : "agent_thought_chunk",
          content: { type: "text", text: delta.delta },
          ...(segmentSeq === undefined ? {} : { segmentSeq, contentIndex: delta.contentIndex }),
        });
      }
    }
    if (event.type === "message_end" && event.message.role === "assistant") {
      if (!child) session.lastAssistant = event.message;
      const usage = event.message.usage;
      const contextUsage: SessionUsage = {
        usedTokens: usage.totalTokens,
        ...(provider.model.contextWindow > 0
          ? { contextWindow: provider.model.contextWindow }
          : {}),
        inputTokens: usage.input,
        outputTokens: usage.output,
        cacheReadTokens: usage.cacheRead,
        cacheWriteTokens: usage.cacheWrite,
        updatedAt: Date.now(),
      };
      if (!child) session.contextUsage = contextUsage;
      emit({
        sessionUpdate: "usage_update",
        usage: { ...contextUsage, ...(!child ? session.cumulativeUsage : {}) },
      });
    }

    if (event.type === "tool_execution_start") {
      const resolvedTool = resolveToolName(event.toolName);
      const mcpServer =
        resolvedTool.mcpServer ??
        (EXCALIDRAW_TOOL_NAMES.has(event.toolName) ? SCRIBE_MCP_SERVER_NAME : undefined);
      emit({
        sessionUpdate: "tool_call",
        toolCallId: viewId(event.toolCallId),
        title: resolvedTool.mcpServer ? resolvedTool.tool : event.toolName,
        kind: toolKind(event.toolName),
        vendorToolName: event.toolName,
        ...(mcpServer ? { mcpServer } : {}),
        rawInput: event.args,
        status: "pending",
        ...(event.toolName === "propose_plan" ? { isPlanProposal: true } : {}),
      });
    }
    if (event.type === "tool_execution_update" || event.type === "tool_execution_end") {
      const raw: unknown =
        event.type === "tool_execution_update" ? event.partialResult : event.result;
      const reference =
        isRecord(raw) && isRecord(raw.details) && typeof raw.details.resultReference === "string"
          ? raw.details.resultReference
          : undefined;
      const result: unknown =
        event.type === "tool_execution_end" && reference ? (savedResult?.(reference) ?? raw) : raw;
      emit({
        sessionUpdate: "tool_call_update",
        toolCallId: viewId(event.toolCallId),
        status:
          event.type === "tool_execution_end"
            ? event.isError
              ? "failed"
              : "completed"
            : "in_progress",
        content: this.toolContent(result),
      });
    }
  }

  private toolContent(result: unknown): ToolCallContent[] {
    if (!isRecord(result)) return [];
    const detail = isRecord(result.details) ? result.details : undefined;
    const original = isRecord(detail?.mcpResult) ? detail.mcpResult : result;
    const content: ToolCallContent[] = Array.isArray(original.content)
      ? original.content.flatMap((part: unknown): ToolCallContent[] =>
          isRecord(part) && typeof part.type === "string"
            ? [{ type: "content", content: { ...part, type: part.type } }]
            : []
        )
      : [];
    if (original.structuredContent !== undefined) {
      content.push({
        type: "content",
        content: {
          type: "json",
          name: "structuredContent",
          text: JSON.stringify(original.structuredContent),
        },
      });
    }
    if (original !== result) {
      const metadata = Object.fromEntries(
        Object.entries(original).filter(
          ([key]) => !["content", "structuredContent", "isError"].includes(key)
        )
      );
      if (Object.keys(metadata).length > 0)
        content.push({
          type: "content",
          content: { type: "json", name: "metadata", text: JSON.stringify(metadata) },
        });
    }
    if ("details" in result && typeof result.details === "object" && result.details !== null) {
      const detail = result.details;
      if (
        "path" in detail &&
        typeof detail.path === "string" &&
        "before" in detail &&
        (detail.before === null || typeof detail.before === "string") &&
        "after" in detail &&
        typeof detail.after === "string"
      )
        content.push({
          type: "diff",
          path: detail.path,
          oldText: detail.before,
          newText: detail.after,
        });
    }
    return content;
  }

  private createSubagentController(session: NativeSession): NativeSubagentController {
    return new NativeSubagentController({
      parentSessionId: session.record.sessionId,
      cwd: session.record.cwd,
      projectId: session.record.projectId,
      restored: session.record.subagents,
      getModelId: () => session.record.modelId,
      getTaskGenerationId: () => session.taskGenerationId,
      getRoundContext: (sender) => {
        const promptId =
          sender !== "user" && session.run
            ? (this.agentRuns.get(session.agent)?.promptId ?? session.runId)
            : undefined;
        return {
          roundId: (promptId ? session.roundIds.get(promptId) : undefined) ?? uuidv4(),
          ...(promptId ? { promptId } : {}),
        };
      },
      isTaskActive: (id) =>
        !session.closed &&
        session.record.taskGenerations?.some(
          (task) => task.id === id && task.active && task.autoContinue !== false
        ) === true,
      acquire: (signal) => this.options.acquireSubagentSlot?.(signal) ?? Promise.resolve(() => {}),
      reserve: this.options.reserveSubagentSlot
        ? (signal) => this.options.reserveSubagentSlot!(signal)
        : undefined,
      save: async (state) => {
        const subagents = [
          ...(session.record.subagents ?? []).filter(
            (entry) => entry.snapshot.id !== state.snapshot.id
          ),
          state,
        ];
        if (this.options.storage.append)
          await this.persist(session, "subagent_state", { version: 1, state }, true);
        else await this.options.storage.save({ ...session.record, subagents });
        session.record.subagents = subagents;
      },
      remove: async (id) => {
        if (!this.options.storage.removeSubagent) throw new Error("当前保存组件不支持删除子会话。");
        await this.options.storage.removeSubagent(session.record.sessionId, id);
        session.requestContextStates.delete(id);
        session.observedFileVersions.delete(id);
        for (const [reference, entry] of session.toolResultCache)
          if (entry.scope === id) session.toolResultCache.delete(reference);
        session.record.subagents = session.record.subagents?.filter(
          (state) => state.snapshot.id !== id
        );
      },
      execute: (state, run, signal, attach) =>
        this.executeSubagentRun(session, state, run, signal, attach),
      changed: (subagents) => {
        for (const snapshot of subagents) {
          const saved = session.record.subagents?.find(
            (state) => state.snapshot.id === snapshot.id
          );
          if (saved) saved.snapshot = snapshot;
        }
        this.emit(session, { sessionUpdate: "subagents_updated", subagents });
      },
      completed: (_state, run) => {
        this.emit(session, {
          sessionUpdate: "task_ended",
          taskId: run.id,
          status:
            run.status === "completed"
              ? "completed"
              : run.status === "stopped"
                ? "stopped"
                : "failed",
          summary: run.result,
          ...(run.stopReason ? { stopReason: run.stopReason as StopReason } : {}),
        });
        const task = session.record.taskGenerations?.find(
          (entry) => entry.id === run.taskGenerationId
        );
        if (
          run.deliveryBlocked &&
          _state.automaticTaskIds.includes(run.taskGenerationId) &&
          task?.active &&
          task.autoContinue !== false
        ) {
          const pending = this.automaticCollaboration(session, run.taskGenerationId)[0];
          if (pending)
            void this.deliverCollaboration(session, pending).catch((error) =>
              logWarn("[AgentMode] 结果待投递邮箱未能接续", {
                parentSessionId: session.record.sessionId,
                subagentId: pending.subagentId,
                runId: run.id,
                messageId: pending.id,
                errorType: error instanceof Error ? error.name : typeof error,
              })
            );
        }
      },
      received: (state, message, automatic) => {
        this.emit(session, {
          sessionUpdate: "subagent_message",
          name: state.snapshot.name,
          message,
        });
        if (automatic && ["question", "blocked", "result"].includes(message.kind))
          void this.deliverCollaboration(session, message).catch((error) =>
            logWarn("[AgentMode] 子代理消息交付失败", {
              parentSessionId: session.record.sessionId,
              subagentId: message.subagentId,
              runId: message.runId,
              messageId: message.id,
              errorType: error instanceof Error ? error.name : typeof error,
            })
          );
      },
    });
  }

  private async executeSubagentRun(
    session: NativeSession,
    state: NativeSubagentState,
    run: SubagentRunSnapshot,
    signal: AbortSignal,
    attach: (receive: (message: SubagentMessage) => void) => void
  ): Promise<SubagentExecutionResult> {
    this.options.assertScope?.(session.record);
    if (
      state.snapshot.cwd !== session.record.cwd ||
      state.snapshot.projectId !== session.record.projectId
    )
      throw new Error("子会话的项目或工作位置已变化，请核对后再继续。");
    if (!this.options.getModels().some((model) => model.baseModelId === state.snapshot.modelId))
      throw new Error("子会话原模型不可用，请恢复模型配置后继续。");
    signal.throwIfAborted();
    const provider = await raceWithAbortSignal(
      this.options.createModel(state.snapshot.modelId),
      signal
    );
    const system = await raceWithAbortSignal(this.options.getSystemPrompt(session.record), signal);
    const child: ChildExecution = {
      roundId: run.roundId,
      promptId: run.promptId,
      taskId: run.id,
      toolCallId: run.toolCallId,
      subagentId: state.snapshot.id,
      taskGenerationId: run.taskGenerationId,
      allowedTools: state.allowedTools,
      manualSkills: state.manualSkills,
      localPlan: false,
      provider,
    };
    const childSystem = {
      ...(typeof system === "string" ? { content: system, sections: {} } : system),
      content: [typeof system === "string" ? system : system.content, state.instructions]
        .filter(Boolean)
        .join("\n\n"),
    };
    const agent = this.createAgent(session, childSystem, child);
    agent.state.messages = [
      {
        role: "system",
        timestamp: 0,
        ...childSystem,
      },
      ...state.context.filter((message) => message.role !== "system"),
    ];
    const pending = session
      .subagentController!.state(state.snapshot.id)
      .snapshot.messages.filter(
        (message) => message.direction === "to_child" && message.state === "accepted"
      );
    const initial = pending.map((message) => {
      const native =
        state.context.length === 0 && message.sender === "main" && message.kind === "instruction"
          ? { role: "user" as const, timestamp: message.acceptedAt, content: message.text }
          : subagentModelMessage(message);
      session.collaboration.set(native, message);
      return native;
    });
    attach((message) => {
      const native = subagentModelMessage(message);
      session.collaboration.set(native, message);
      // 压缩命令等待当前工具轮结束再执行，不能作为普通插话发给模型。https://github.com/ItsDalk-Lane/Scribe/issues/66
      if (
        initial.length ||
        (message.sender === "user" &&
          isCompactCommand(message.text) &&
          isBuiltinCommandEnabled(getSettings(), COMPACT_COMMAND_NAME))
      )
        initial.push(native);
      else agent.steer(native);
    });
    const abort = (): void => agent.abort();
    signal.addEventListener("abort", abort, { once: true });
    this.emit(session, {
      sessionUpdate: "task_started",
      taskId: run.id,
      toolCallId: run.toolCallId,
      subagentId: state.snapshot.id,
      runId: run.id,
      kind: "subagent",
      description: state.snapshot.name,
      prompt: pending.map((message) => message.text).join("\n"),
    });
    const finishChildRounds = async (stopReason: StopReason): Promise<void> => {
      const childRun = this.agentRuns.get(agent);
      for (const promptId of childRun?.deliveredPromptIds ?? []) {
        const input = session
          .subagentController!.state(child.subagentId)
          .snapshot.messages.find((message) => message.id === promptId);
        if (input?.roundId)
          await this.emitCommitted(
            session,
            {
              sessionUpdate: "turn_ended",
              turnId: promptId,
              roundId: input.roundId,
              subagentId: child.subagentId,
              stopReason: signal.aborted ? "cancelled" : stopReason,
            },
            child.toolCallId
          );
      }
      childRun?.deliveredPromptIds?.clear();
    };
    let childRoundStopReason: StopReason = "request_error";
    try {
      signal.throwIfAborted();
      let batch: AgentMessage[] = [];
      let manualOnly = false;
      let hadModelReply = false;
      while (initial.length) {
        const native = initial.shift()!;
        const input = session.collaboration.get(native)!;
        // 子聊天中的用户命令走同一摘要核心，主代理引用的同名文字不取得控制权。https://github.com/ItsDalk-Lane/Scribe/issues/66
        if (
          input.sender !== "user" ||
          !isCompactCommand(input.text) ||
          !isBuiltinCommandEnabled(getSettings(), COMPACT_COMMAND_NAME)
        ) {
          batch.push(native);
          if (!initial.length) {
            await agent.prompt(batch);
            hadModelReply = true;
            batch = [];
            manualOnly = false;
          }
          continue;
        }
        if (batch.length) {
          await agent.prompt(batch);
          hadModelReply = true;
          batch = [];
        }
        // 新压缩回合开始前结束已完成回复，后续请求不能覆盖其真实终态。https://github.com/ItsDalk-Lane/Scribe/issues/66
        const previousRun = this.agentRuns.get(agent)!;
        const previousAssistant = agent.state.messages.findLast(
          (entry) => entry.role === "assistant"
        );
        await finishChildRounds(
          previousRun.stopReason ??
            (previousAssistant?.role === "assistant" && previousAssistant.stopReason === "length"
              ? "max_tokens"
              : "end_turn")
        );
        const accountingRun = this.agentRuns.get(agent)!;
        accountingRun.promptId = input.promptId ?? input.id;
        accountingRun.roundId = input.roundId;
        const started = await this.emitCommitted(
          session,
          {
            sessionUpdate: "turn_started",
            turnId: input.id,
            roundId: input.roundId,
            startedAt: Date.now(),
          },
          child.toolCallId
        );
        let commandStopReason: StopReason = "request_error";
        try {
          await session.subagentController!.recordContext(
            child.subagentId,
            child.taskId,
            [...agent.state.messages],
            [input.id],
            agent.state.messages.map((entry) => session.messageSeqs.get(entry) ?? -1),
            started.seq
          );
          await this.compact(session, agent.state.messages, {
            trigger: "manual",
            signal,
            provider: child.provider ?? session.provider,
            taskId: child.subagentId,
            accountingRun,
            focus: input.text.trim().slice(`/${COMPACT_COMMAND_NAME}`.length).trim(),
            onFailure: (failure) => {
              accountingRun.failure = failure;
              accountingRun.stopReason ??= failureStopReason(failure);
            },
          });
          commandStopReason = "end_turn";
        } finally {
          await this.emitCommitted(
            session,
            {
              sessionUpdate: "turn_ended",
              turnId: input.id,
              roundId: input.roundId,
              subagentId: child.subagentId,
              stopReason: signal.aborted ? "cancelled" : commandStopReason,
            },
            child.toolCallId
          );
        }
        manualOnly = !hadModelReply;
      }
      const message = manualOnly
        ? undefined
        : agent.state.messages.findLast((entry) => entry.role === "assistant");
      const stopReason = this.agentRuns.get(agent)?.stopReason;
      const text = manualOnly
        ? t("Context compacted.")
        : message?.role === "assistant"
          ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
          : "";
      const failed =
        !text.trim() ||
        (stopReason !== undefined && stopReason !== "end_turn") ||
        (message?.role === "assistant" &&
          ["error", "aborted", "length", "toolUse"].includes(message.stopReason));
      childRoundStopReason = signal.aborted
        ? "cancelled"
        : (stopReason ?? (failed ? "request_error" : "end_turn"));
      // 重试及压缩已消耗的请求不能因最终上下文只保留成功回复而漏计。https://github.com/ItsDalk-Lane/Scribe/issues/50
      const actualUsage = this.agentRuns.get(agent)?.requestUsage;
      const usage = actualUsage
        ? [...actualUsage.values()].reduce<SubagentUsage>(
            (total, entry) => ({
              input: total.input + entry.input,
              output: total.output + entry.output,
              cacheRead: total.cacheRead + entry.cacheRead,
              cacheWrite: total.cacheWrite + entry.cacheWrite,
              totalTokens: total.totalTokens + entry.totalTokens,
            }),
            { ...EMPTY_SUBAGENT_USAGE }
          )
        : agent.state.messages.slice(state.context.length).reduce<SubagentUsage>(
            (total, entry) =>
              entry.role === "assistant"
                ? {
                    input: total.input + entry.usage.input,
                    output: total.output + entry.usage.output,
                    cacheRead: total.cacheRead + entry.usage.cacheRead,
                    cacheWrite: total.cacheWrite + entry.usage.cacheWrite,
                    totalTokens: total.totalTokens + entry.usage.totalTokens,
                  }
                : total,
            { ...EMPTY_SUBAGENT_USAGE }
          );
      const summary =
        stopReason === "max_turn_requests"
          ? `The child agent reached its step limit and ended with a summary.\n\n${text}`
          : text.trim()
            ? text
            : // 取消没有生成正文时应显示停止，而不是把底层异常当作子代理回复。https://github.com/ItsDalk-Lane/Scribe/issues/50
              signal.aborted || (message?.role === "assistant" && message.stopReason === "aborted")
              ? t(SUBAGENT_STOPPED_MESSAGE)
              : (message?.role === "assistant" ? message.errorMessage : undefined) ||
                "The child agent did not return a final result.";
      return {
        text: summary,
        status:
          stopReason && stopReason !== "cancelled" && stopReason !== "end_turn"
            ? "failed"
            : signal.aborted || (message?.role === "assistant" && message.stopReason === "aborted")
              ? "stopped"
              : failed
                ? "failed"
                : "completed",
        stopReason,
        usage,
      };
    } finally {
      signal.removeEventListener("abort", abort);
      try {
        // 后台工作收尾失败不能随着最终正文被记为正常完成。https://github.com/ItsDalk-Lane/Scribe/issues/52
        await Promise.all(
          [...(child.resources ?? [])].map((resources) => this.releaseTools(session, resources))
        ).catch((error: unknown) => {
          childRoundStopReason = "request_error";
          throw error;
        });
      } finally {
        // 已投递的新子回合逐一结束；未送达的排队输入不伪造完成轮次。https://github.com/ItsDalk-Lane/Scribe/issues/52
        await finishChildRounds(childRoundStopReason);
      }
    }
  }

  private async deliverCollaboration(
    session: NativeSession,
    message: SubagentMessage
  ): Promise<void> {
    if (session.closed || session.cancelled || session.queuedCollaboration.has(message.id)) return;
    const task = session.record.taskGenerations?.find(
      (entry) => entry.id === message.taskGenerationId
    );
    if (!task?.active || task.autoContinue === false) return;
    if (session.run) return;
    const first = this.automaticCollaboration(session, message.taskGenerationId)[0];
    if (!first) return;
    const native = subagentModelMessage(first);
    session.collaboration.set(native, first);
    session.queuedCollaboration.add(first.id);
    await this.executeTurn(session, `collaboration-${first.id}`, native as UserMessage);
  }

  private automaticCollaboration(
    session: NativeSessionContext,
    taskId: string | undefined
  ): readonly SubagentMessage[] {
    const task = session.record.taskGenerations?.find((entry) => entry.id === taskId);
    if (!taskId || !task?.active || task.autoContinue === false)
      return EMPTY_COLLABORATION_MESSAGES;
    // 停止或归档撤回的接续许可在忙闲两条投递路径中都必须生效。https://github.com/ItsDalk-Lane/Scribe/issues/50
    const messages = session
      .subagentController!.list()
      .filter(
        (state) =>
          state.retention === "retained" &&
          session.subagentController!.state(state.id).automaticTaskIds.includes(taskId)
      )
      .flatMap((state) => state.messages)
      .filter(
        (message) =>
          message.direction === "to_parent" &&
          message.state === "accepted" &&
          message.taskGenerationId === taskId
      )
      .sort((left, right) => left.sequence - right.sequence);
    return messages.length ? messages : EMPTY_COLLABORATION_MESSAGES;
  }

  private collaborationInputs(
    session: NativeSessionContext,
    taskId: string,
    excludeId?: string
  ): AgentMessage[] {
    return this.automaticCollaboration(session, taskId)
      .filter((message) => message.id !== excludeId && !session.queuedCollaboration.has(message.id))
      .map((message) => {
        const native = subagentModelMessage(message);
        session.collaboration.set(native, message);
        session.queuedCollaboration.add(message.id);
        return native;
      });
  }

  private async commitCollaboration(
    session: NativeSessionContext,
    message: SubagentMessage,
    native: AgentMessage
  ): Promise<void> {
    const resultId = message.kind === "result" ? message.id : undefined;
    const fact = await this.persist(
      session,
      "subagent_delivery",
      {
        version: 1,
        subagentId: message.subagentId,
        message: native,
        messageIds: [message.id],
        resultId,
      },
      true
    );
    session.record.messages.push(native);
    if (fact) session.messageSeqs.set(native, fact.seq);
    await session.subagentController!.acknowledgeParent(message.subagentId, [message.id], resultId);
  }

  async listSubagentSessions(input: {
    sessionId: string;
  }): Promise<readonly SubagentSessionSnapshot[]> {
    const session = this.sessions.get(input.sessionId);
    if (session) return session.subagentController!.list();
    const record = await this.options.storage.load(input.sessionId);
    return record?.subagents?.map((state) => state.snapshot) ?? EMPTY_SUBAGENT_SESSIONS;
  }

  async sendSubagentMessage(input: SubagentSendInput): Promise<SubagentDispatchResult> {
    const session = this.session(input.sessionId);
    const epoch = session.cancelEpoch;
    session.pendingChildAdmissions++;
    let taskId = "";
    try {
      await this.ensureTask(session);
      taskId = session.taskGenerationId;
      if (epoch !== session.cancelEpoch)
        throw new DOMException("The parent task was stopped", "AbortError");
      session.cancelled = false;
      return await session.subagentController!.send(input, "user");
    } finally {
      session.pendingChildAdmissions--;
      if (taskId) await this.finishIdleTask(session, taskId);
    }
  }

  private async finishIdleTask(session: NativeSessionContext, id: string): Promise<void> {
    const task = session.record.taskGenerations?.find((entry) => entry.id === id);
    if (
      (session.run && session.executingTaskId === id) ||
      [...session.managedCommands.values()].includes(id) ||
      session.pendingChildAdmissions ||
      !task?.active ||
      session.pending.size ||
      session.subagentController?.hasWork(id)
    )
      return;
    task.active = false;
    await this.persist(session, "subagent_task", { version: 1, task }, true);
  }

  async stopSubagent(input: { sessionId: string; subagentId: string }): Promise<void> {
    await this.session(input.sessionId).subagentController!.stop(input.subagentId);
  }

  async setSubagentArchived(input: {
    sessionId: string;
    subagentId: string;
    archived: boolean;
  }): Promise<void> {
    await this.session(input.sessionId).subagentController!.setArchived(
      input.subagentId,
      input.archived
    );
  }

  async deleteSubagentSession(input: { sessionId: string; subagentId: string }): Promise<void> {
    await this.session(input.sessionId).subagentController!.remove(input.subagentId);
  }

  async confirmSubagentRecovery(input: { sessionId: string; subagentId: string }): Promise<void> {
    await this.session(input.sessionId).subagentController!.confirmRecovery(input.subagentId);
  }

  async waitSubagents(input: {
    sessionId: string;
    subagentIds?: string[];
    after?: number;
    timeoutMs?: number;
    signal?: AbortSignal;
  }): Promise<SubagentWaitResult> {
    return this.session(input.sessionId).subagentController!.wait({
      ...input,
      ids: input.subagentIds,
      direction: "to_parent",
    });
  }

  async startIndependentTask(input: { sessionId: string }): Promise<void> {
    const session = this.session(input.sessionId);
    if (session.independentTask) return session.independentTask;
    if (session.run || session.pending.size || session.accepting.size)
      throw new Error("请等待当前主对话回复结束，再开始独立任务。后台子代理可以继续运行。");
    const operation = (async () => {
      // 显式开始独立任务时，旧技能正文不再作为新任务的执行指引。https://github.com/ItsDalk-Lane/Scribe/issues/68
      for (const name of session.deliveredManualSkills.keys()) {
        await this.persist(session, "skill_delivery_revoked", { version: 1, name }, true);
        session.deliveredManualSkills.delete(name);
      }
      // 独立任务屏障避免旧工具结果被后续请求重新登记。https://github.com/ItsDalk-Lane/Scribe/issues/68
      await this.persist(
        session,
        "skill_model_scope_reset",
        { formatVersion: 1, scope: "main" },
        true
      );
      const current = session.record.taskGenerations?.find(
        (task) => task.id === session.taskGenerationId
      );
      if (current) {
        current.autoContinue = false;
        await this.persist(session, "subagent_task", { version: 1, task: current }, true);
      }
      session.taskGenerationId = "";
    })();
    session.independentTask = operation;
    try {
      await operation;
    } finally {
      session.independentTask = undefined;
    }
  }

  async continueTaskBudget(input: {
    sessionId: string;
    taskGenerationId?: string;
    requestId?: string;
  }): Promise<void> {
    const session = this.session(input.sessionId);
    const id = input.taskGenerationId ?? session.taskGenerationId;
    const requestId = input.requestId ?? uuidv4();
    const operation = session.budgetQueue.then(async () => {
      const task = session.record.taskGenerations?.find((entry) => entry.id === id);
      if (!task) throw new Error("找不到需要增加额度的主任务。");
      if (task.budgetGrants?.includes(requestId)) return;
      const next = {
        ...task,
        limit: task.limit + (this.options.getSubagentLimits?.().maxTaskRequests ?? 100),
        budgetGrants: [...(task.budgetGrants ?? []), requestId],
      };
      await this.persist(session, "subagent_task", { version: 1, task: next }, true);
      task.limit = next.limit;
      task.budgetGrants = next.budgetGrants;
      session.exhaustedTaskIds.delete(id);
      if (session.executingTaskId === id) session.taskBudgetExhausted = false;
    });
    session.budgetQueue = operation.catch(() => {});
    await operation;
  }

  private async ensureTask(session: NativeSessionContext): Promise<void> {
    if (session.startingTask) return session.startingTask;
    if (
      session.record.taskGenerations?.some(
        (task) => task.id === session.taskGenerationId && task.active
      )
    )
      return;
    const task: NativeSubagentTask = {
      id: `task-${uuidv4()}`,
      active: true,
      limit: this.options.getSubagentLimits?.().maxTaskRequests ?? 100,
      requestIds: [],
      usage: [],
    };
    const cancelEpoch = session.cancelEpoch;
    session.startingTask = (async () => {
      await this.persist(session, "subagent_task", { version: 1, task }, true);
      if (cancelEpoch !== session.cancelEpoch) {
        task.active = false;
        await this.persist(session, "subagent_task", { version: 1, task }, true);
      }
      session.record.taskGenerations = [...(session.record.taskGenerations ?? []), task];
      session.taskGenerationId = task.id;
      session.taskBudgetExhausted = false;
      session.manuallyInvokedSkills.clear();
    })();
    try {
      await session.startingTask;
    } finally {
      session.startingTask = undefined;
    }
  }

  private requestAccounting(
    session: NativeSessionContext,
    taskId: string,
    run?: NativeAgentRunState,
    scope: {
      child?: Pick<ChildExecution, "roundId" | "promptId" | "subagentId" | "taskId">;
      provider?: ProviderChatModel;
      purpose?: "chat" | "compaction";
      getSegmentSeq?: () => number | undefined;
      messages?: AgentMessage[];
      tools?: readonly RequestContextTool[];
      contextVersion?: string;
    } = {}
  ): Pick<
    import("@/LLMProviders/piChatModel").AgentStreamOptions,
    "beforeRequest" | "onRequestUsage" | "onCallMetrics"
  > {
    // 请求归属在派发时固定，后台子执行不能随父聊天后续输入改归属。https://github.com/ItsDalk-Lane/Scribe/issues/52
    const promptId = scope.child?.promptId ?? run?.promptId ?? session.runId;
    const roundId = scope.child?.roundId ?? session.roundIds.get(promptId) ?? uuidv4();
    const provider = scope.provider ?? session.provider;
    const subagent = scope.child
      ? session.subagentController?.state(scope.child.subagentId).snapshot
      : undefined;
    const change = (update: (task: NativeSubagentTask) => void): Promise<void> => {
      const operation = session.budgetQueue.then(async () => {
        const task = session.record.taskGenerations?.find((entry) => entry.id === taskId);
        if (!task) throw new Error("主任务预算记录不存在。");
        const next: NativeSubagentTask = JSON.parse(JSON.stringify(task));
        update(next);
        await this.persist(session, "subagent_task", { version: 1, task: next }, true);
        task.requestIds = next.requestIds;
        task.usage = next.usage;
      });
      session.budgetQueue = operation.catch(() => {});
      return operation;
    };
    const snapshot = scope.messages
      ? buildRequestContextSnapshot(
          scope.messages,
          scope.tools ?? [],
          session.messageSeqs,
          new Map(
            (session.record.journalRecords ?? []).flatMap((fact) =>
              fact.kind === "protocol_message" &&
              isRecord(fact.payload) &&
              isRecord(fact.payload.message)
                ? [[fact.seq, fingerprintRequestContext(fact.payload.message)] as const]
                : []
            )
          )
        )
      : undefined;
    const previousRequestFingerprint = run?.lastRequestFingerprint;
    return {
      onCallMetrics: (metrics) => {
        // 用量事实只排队保存，模型调用不等待它。https://github.com/ItsDalk-Lane/Scribe/issues/55
        this.emit(
          session,
          {
            sessionUpdate: "model_call_metrics",
            observation: {
              ...metrics,
              roundId,
              promptId,
              sourceId: scope.child?.subagentId ?? "main",
              sourceName: subagent?.name ?? (scope.child ? scope.child.subagentId : "Main agent"),
              kind: scope.child ? "subagent" : "main",
              purpose: scope.purpose ?? "chat",
              modelId: provider.model.id,
              modelName: provider.model.name,
              modelSourceId: provider.configuredModelId,
              provider: provider.providerDisplayName ?? provider.model.provider,
              taskGenerationId: taskId,
              ...(scope.child
                ? { subagentId: scope.child.subagentId, runId: scope.child.taskId }
                : {}),
              segmentSeq: scope.getSegmentSeq?.(),
            },
          },
          scope.child
            ? subagent?.runs.find((entry) => entry.id === scope.child!.taskId)?.toolCallId
            : undefined
        );
      },
      beforeRequest: async (requestId) => {
        await change((task) => {
          if (!task.active) throw new DOMException("This task was stopped", "AbortError");
          if (task.requestIds.includes(requestId)) return;
          if (task.requestIds.length >= task.limit) {
            session.exhaustedTaskIds.add(taskId);
            if (session.executingTaskId === taskId) session.taskBudgetExhausted = true;
            if (run) run.stopReason = "max_task_requests";
            throw new Error(
              "本次主任务已达到模型调用次数上限。已有进度已保留，请明确继续后再启动。"
            );
          }
          task.requestIds.push(requestId);
        });
        if (snapshot)
          await this.persist(
            session,
            "request_context",
            {
              version: 1,
              requestId,
              roundId,
              promptId,
              taskGenerationId: taskId,
              modelId: provider.model.id,
              provider: provider.model.provider,
              api: provider.model.api,
              cwd: session.record.cwd,
              projectId: session.record.projectId,
              purpose: scope.purpose ?? "chat",
              contextVersion: scope.contextVersion,
              previousRequestFingerprint,
              snapshot,
              ...(scope.child
                ? { subagentId: scope.child.subagentId, taskId: scope.child.taskId }
                : {}),
            },
            true
          );
        // 等待请求记录落盘期间也可能迁移项目，派发前最后一次复核。https://github.com/ItsDalk-Lane/Scribe/issues/71
        this.options.assertScope?.(session.record);
        if (run) {
          run.requestUsage ??= new Map();
          if (snapshot) run.lastRequestFingerprint = snapshot.fingerprint;
        }
      },
      onRequestUsage: async (requestId, usage) => {
        await change((task) => {
          if (!task.usage.some((entry) => entry.requestId === requestId))
            task.usage.push({ requestId, usage });
        });
        if (run) {
          run.requestUsage ??= new Map();
          if (!run.requestUsage.has(requestId)) run.requestUsage.set(requestId, usage);
        }
        const total = (session.record.taskGenerations ?? [])
          .flatMap((task) => task.usage)
          .reduce<SubagentUsage>(
            (sum, entry) => ({
              input: sum.input + entry.usage.input,
              output: sum.output + entry.usage.output,
              cacheRead: sum.cacheRead + entry.usage.cacheRead,
              cacheWrite: sum.cacheWrite + entry.usage.cacheWrite,
              totalTokens: sum.totalTokens + entry.usage.totalTokens,
            }),
            { ...EMPTY_SUBAGENT_USAGE }
          );
        session.cumulativeUsage = {
          cumulativeInputTokens: total.input,
          cumulativeOutputTokens: total.output,
          cumulativeCacheReadTokens: total.cacheRead,
          cumulativeCacheWriteTokens: total.cacheWrite,
          cumulativeTotalTokens: total.totalTokens,
        };
        if (session.contextUsage)
          this.emit(session, {
            sessionUpdate: "usage_update",
            usage: {
              ...session.contextUsage,
              ...session.cumulativeUsage,
              updatedAt: Date.now(),
            },
          });
      },
    };
  }

  private async delegate(
    session: NativeSessionContext,
    toolCallId: string,
    input: {
      prompt: string;
      description: string;
      name?: string;
      agent?: string;
      background?: boolean;
      skills?: string[];
      allowedTools?: string[];
    },
    signal?: AbortSignal
  ): Promise<AgentToolResult> {
    signal?.throwIfAborted();
    await this.ensureTask(session);
    // 接纳前保存期间的取消也必须拒绝后台委派，不能等创建后才失去取消归属。https://github.com/ItsDalk-Lane/Scribe/issues/50
    signal?.throwIfAborted();
    const definition = input.agent
      ? this.options.getSubagents?.().find((entry) => entry.enabled && entry.id === input.agent)
      : undefined;
    if (input.agent && !definition)
      throw new Error("The selected subagent is disabled or unavailable.");
    if (input.skills?.some((name) => !session.manuallyInvokedSkills.has(name)))
      throw new Error("只能转交用户为当前任务明确选择的技能。");
    const created = await session.subagentController!.create({
      prompt: input.prompt,
      name:
        input.name?.trim() ||
        (definition ? `${definition.name}: ${input.description}` : input.description),
      toolCallId,
      background: input.background === true,
      instructions: definition?.instructions,
      allowedTools: input.allowedTools,
      manualSkills: input.skills,
    });
    if (input.background)
      return {
        content: [{ type: "text", text: JSON.stringify(created) }],
        details: {
          subagentId: created.subagentId,
          runId: created.runId ?? "",
          status: created.status,
        },
      };
    const abort = (): void => {
      void session.subagentController!.stop(created.subagentId);
    };
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const run = await session.subagentController!.finished(created.subagentId, created.runId!);
      return {
        content: [
          { type: "text", text: run.result ?? "The child agent did not return a final result." },
        ],
        details: {
          subagentId: created.subagentId,
          runId: run.id,
          taskId: run.id,
          resultId: run.resultId ?? "",
          ...(run.stopReason ? { stopReason: run.stopReason } : {}),
        },
        isError: run.status !== "completed",
      };
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }

  async cancel(input: { sessionId: string; keepUnread?: boolean }): Promise<void> {
    const session = this.session(input.sessionId);
    session.cancelled = true;
    session.runController?.abort();
    session.agent.abort();
    session.compaction?.abort();
    const resources = input.keepUnread ? [] : [...session.tools];
    if (!input.keepUnread) {
      session.cancelEpoch++;
      session.refreshTools = true;
      session.toolsRevision++;
      const ids = [...session.pending.keys()];
      session.pending.clear();
      session.agent.clearAllQueues();
      if (ids.length) this.emit(session, { sessionUpdate: "messages_withdrawn", promptIds: ids });
    }
    const stoppedTasks = input.keepUnread
      ? []
      : (session.record.taskGenerations ?? []).filter((task) => task.active);
    for (const task of stoppedTasks) task.active = false;
    let failure: unknown;
    try {
      for (const task of stoppedTasks) {
        await this.persist(session, "subagent_task", { version: 1, task }, true);
      }
    } catch (error) {
      failure = error;
    }
    const settled = await Promise.allSettled([
      ...(!input.keepUnread ? [session.subagentController!.stopAll()] : []),
      ...resources.map((tools) => this.releaseTools(session, tools)),
      ...(session.run ? [session.run] : []),
    ]);
    failure ??= settled.find(
      (result): result is PromiseRejectedResult => result.status === "rejected"
    )?.reason;
    if (failure)
      throw failure instanceof Error
        ? failure
        : new Error("停止后台工作失败。", { cause: failure });
  }

  private releaseTools(session: NativeSessionContext, tools: NativeRuntimeTools): Promise<void> {
    const pending = session.releasingTools.get(tools);
    if (pending) return pending;
    if (!session.tools.has(tools)) return Promise.resolve();
    const released = (async () => {
      await tools.shutdown?.();
      session.tools.delete(tools);
    })();
    session.releasingTools.set(tools, released);
    void released.finally(() => session.releasingTools.delete(tools)).catch(() => {});
    return released;
  }

  async withdraw(input: { sessionId: string; promptId: string }): Promise<boolean> {
    const session = this.session(input.sessionId);
    if (!session.pending.delete(input.promptId)) return false;
    session.agent.clearSteeringQueue();
    for (const message of session.pending.values()) session.agent.steer(message);
    this.emit(session, { sessionUpdate: "messages_withdrawn", promptIds: [input.promptId] });
    await this.flush(session);
    return true;
  }

  async stopTask(input: { sessionId: string; taskId: string }): Promise<void> {
    const session = this.session(input.sessionId);
    const retained = session
      .subagentController!.list()
      .find((state) => state.runs.some((run) => run.id === input.taskId));
    if (retained) {
      const selected = retained.runs.find((run) => run.id === input.taskId)!;
      if (
        selected.endedAt ||
        ["completed", "failed", "stopped", "interrupted"].includes(selected.status)
      )
        return;
      await session.subagentController!.stop(retained.id);
      return;
    }
    await Promise.all(
      [...session.tools].map(async (tools) => {
        await tools.stopTask?.(input.taskId);
      })
    );
  }

  async closeSession(input: { sessionId: string }): Promise<void> {
    const session = this.session(input.sessionId);
    session.cancelled = true;
    await this.cancel(input);
    await session.subagentController?.close();
    await Promise.all([...session.tools].map((tools) => this.releaseTools(session, tools)));
    if (!session.storageError && session.record.writable !== false) {
      await this.save(session);
      await this.flush(session);
    }
    session.closed = true;
    this.sessions.delete(input.sessionId);
  }

  async deleteSession(input: { sessionId: string }): Promise<void> {
    if (!this.options.storage.remove) throw new Error("Native session deletion is unavailable.");
    if (this.sessions.has(input.sessionId)) await this.closeSession(input);
    await this.options.storage.remove(input.sessionId);
  }

  async setSessionModel(input: { sessionId: string; modelId: string }): Promise<BackendState> {
    const session = this.session(input.sessionId);
    if (!this.options.getModels().some((model) => model.baseModelId === input.modelId))
      throw new Error("The selected model is unavailable.");
    const provider = await this.options.createModel(input.modelId);
    // 运行中的工具轮继续使用原模型完成同一段历史，新模型在下一轮从记录重建生效，避免跨协议状态重放。https://github.com/ItsDalk-Lane/Scribe/issues/60
    if (session.run) {
      session.record.modelId = input.modelId;
      return this.publishState(session);
    }
    session.provider = provider;
    session.record.modelId = input.modelId;
    session.agent.state.model = provider.model;
    return this.publishState(session);
  }

  isSetSessionModelSupported(): boolean {
    return true;
  }

  async setSessionMode(input: { sessionId: string; modeId: string }): Promise<BackendState> {
    const session = this.session(input.sessionId);
    if (
      input.modeId !== "default" &&
      input.modeId !== "plan" &&
      input.modeId !== "auto" &&
      input.modeId !== "full"
    )
      throw new Error("Unknown permission mode.");
    const previous = session.record.mode;
    session.record.mode = input.modeId;
    if (input.modeId === "plan" && previous !== "plan") {
      session.record.modeBeforePlan = previous;
    } else if (input.modeId !== "plan") {
      delete session.record.modeBeforePlan;
    }
    this.emit(session, { sessionUpdate: "current_mode_update", currentModeId: input.modeId });
    return this.publishState(session);
  }

  isSetSessionModeSupported(): boolean {
    return true;
  }

  async setSessionConfigOption(input: {
    sessionId: string;
    configId: string;
    value: string;
  }): Promise<BackendState> {
    const session = this.session(input.sessionId);
    if (input.configId !== "effort") throw new MethodUnsupportedError(input.configId);
    if (input.value === "default") {
      session.record.effort = null;
      session.agent.state.thinkingLevel = "off";
      return this.publishState(session);
    }
    const entry = this.options
      .getModels()
      .find((model) => model.baseModelId === session.record.modelId);
    const valid: readonly string[] = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
    if (
      !valid.includes(input.value) ||
      !entry?.effortOptions.some((option) => option.value === input.value)
    )
      throw new Error("This model does not offer the selected reasoning level.");
    const effort = valid.find((value) => value === input.value);
    if (
      effort === "off" ||
      effort === "minimal" ||
      effort === "low" ||
      effort === "medium" ||
      effort === "high" ||
      effort === "xhigh" ||
      effort === "max"
    ) {
      session.record.effort = effort;
      session.agent.state.thinkingLevel = effort;
    }
    return this.publishState(session);
  }

  isSetSessionConfigOptionSupported(): boolean {
    return true;
  }

  async listSessions(input: { cwd?: string }): Promise<{
    sessions: Array<{
      sessionId: string;
      cwd: string;
      projectId?: string;
      title?: string;
      pinnedAt?: number | null;
      lastSeq?: number;
      hasMessages?: boolean;
      updatedAt: string;
    }>;
  }> {
    const records = await this.options.storage.list();
    return {
      sessions: records
        .filter((record) => !input.cwd || record.cwd === input.cwd)
        .flatMap((record) => {
          const facts = this.displayFacts(record);
          const projection = projectDisplayFacts([], facts, () => null);
          const messages = record.journalRecords
            ? projection.messages
            : record.messages.flatMap((message, index) =>
                message.role === "user"
                  ? [
                      {
                        id: String(index),
                        sender: "user",
                        message: transcriptText(message.content),
                        timestamp: null,
                        isVisible: true,
                      },
                    ]
                  : []
              );
          const hasMessages =
            record.messages.some((message) => message.role !== "system") ||
            facts.some(
              (fact) =>
                fact.payload.kind === "user_message" || fact.payload.kind === "inherited_message"
            );
          return [
            {
              sessionId: record.sessionId,
              cwd: record.cwd,
              projectId: record.projectId,
              title: projection.label ?? deriveChatTitleFromMessages(messages) ?? undefined,
              pinnedAt: projection.pinnedAt,
              hasMessages,
              lastSeq: record.journalRecords?.at(-1)?.seq,
              updatedAt: new Date(record.updatedAt).toISOString(),
            },
          ];
        }),
    };
  }

  async resumeSession(input: ResumeSessionInput): Promise<OpenSessionOutput> {
    const current = this.sessions.get(input.sessionId);
    if (current) {
      if (current.record.cwd !== input.cwd || current.record.projectId !== input.projectId)
        throw new Error("The chat belongs to a different project.");
      return {
        sessionId: input.sessionId,
        state: this.state(current),
        purpose: current.record.purpose,
      };
    }
    const record = await this.options.storage.load(input.sessionId);
    if (
      !record ||
      record.backendId !== "native" ||
      record.cwd !== input.cwd ||
      record.projectId !== input.projectId
    )
      throw new Error("The native chat was not found in this project.");
    const session = await this.createSession(record);
    return {
      sessionId: input.sessionId,
      state: this.state(session),
      purpose: record.purpose,
      historyFormat: 2,
    };
  }

  async loadSession(input: ResumeSessionInput): Promise<OpenSessionOutput> {
    const opened = await this.resumeSession(input);
    const history = new Set([
      // 恢复原始协作顺序和每轮起点，避免重开后消息错位或耗时失真。https://github.com/ItsDalk-Lane/Scribe/issues/50
      "turn_started",
      "subagent_message",
      "message_delivered",
      "agent_segment_started",
      "agent_segment_finalized",
      "user_message_chunk",
      "agent_message_chunk",
      "agent_thought_chunk",
      "agent_thought_ended",
      "tool_call",
      "tool_call_update",
      "plan",
      "compaction",
      "turn_ended",
      "model_call_metrics",
      "tool_execution_started",
      "task_started",
      "task_progress",
      "task_ended",
    ]);
    for (const event of this.session(input.sessionId).record.events) {
      if (
        history.has(event.update.sessionUpdate) ||
        (event.update.sessionUpdate === "usage_update" && event.update.subagentId)
      )
        this.handlers.get(input.sessionId)?.(event);
    }
    const session = this.session(input.sessionId);
    const original = session.agent.state.messages.filter((message) => message.role !== "system");
    const compaction = this.findMatchingCompaction(session, original);
    if (compaction) {
      const system = getCurrentSystemMessage(session.agent.state.messages) ?? {
        role: "system" as const,
        timestamp: 0,
        ...((prompt) => (typeof prompt === "string" ? { content: prompt } : prompt))(
          await this.options.getSystemPrompt(session.record)
        ),
      };
      const usedTokens = estimateCurrentContextTokens(
        [...(system ? [system] : []), ...projectCompactedContext(original, compaction)],
        "",
        session.usageVersions
      );
      session.contextUsage = {
        usedTokens,
        ...(session.provider.model.contextWindow > 0
          ? { contextWindow: session.provider.model.contextWindow }
          : {}),
        updatedAt: Date.now(),
      };
      this.handlers.get(input.sessionId)?.({
        sessionId: input.sessionId,
        update: {
          sessionUpdate: "usage_update",
          usage: { ...session.contextUsage, ...session.cumulativeUsage },
        },
      });
    }
    const warnings = this.session(input.sessionId).record.warnings;
    if (warnings?.length)
      logWarn("[AgentMode] Preserved unreadable chat facts", input.sessionId, warnings);
    return {
      ...opened,
      historyFormat: 2,
      historyReadOnly: this.session(input.sessionId).record.writable === false,
      historyWarnings: [
        ...((this.session(input.sessionId).record.warnings?.length ?? 0) > 0
          ? [
              "Some chat content or attachments could not be loaded. The available history has been preserved.",
            ]
          : []),
        ...(this.session(input.sessionId).record.writable === false
          ? [
              "This chat can be viewed, but its record sequence is damaged and new operations are disabled.",
            ]
          : []),
      ],
    };
  }

  async sessionExistsLocally(input: { sessionId: string; cwd: string }): Promise<boolean> {
    const record =
      this.sessions.get(input.sessionId)?.record ??
      (await this.options.storage.load(input.sessionId));
    return record?.backendId === "native" && record.cwd === input.cwd;
  }

  async shutdown(): Promise<void> {
    if (!this.running) return;
    await Promise.all(
      [...this.sessions.keys()].map((sessionId) => this.closeSession({ sessionId }))
    );
    this.running = false;
    for (const listener of this.exits) listener();
    this.exits.clear();
    this.handlers.clear();
  }

  private session(id: string): NativeSession {
    const session = this.sessions.get(id);
    if (!session || session.closed || !this.running)
      throw new Error("The native chat is not open.");
    return session;
  }

  private state(session: NativeSessionContext): BackendState {
    return {
      model: {
        current: {
          baseModelId: session.record.modelId,
          effort: session.record.effort ?? "default",
        },
        availableModels: this.options.getModels(),
        apply: { kind: "setModel" },
      },
      mode: {
        current: session.record.mode,
        options: [
          { value: "default", label: "Default" },
          { value: "plan", label: "Plan" },
          { value: "auto", label: "Auto" },
          { value: "full", label: "Full" },
        ],
        apply: {
          default: { kind: "setMode", nativeId: "default" },
          plan: { kind: "setMode", nativeId: "plan" },
          auto: { kind: "setMode", nativeId: "auto" },
          full: { kind: "setMode", nativeId: "full" },
        },
      },
    };
  }

  private async publishState(session: NativeSession): Promise<BackendState> {
    const state = this.state(session);
    this.emit(session, { sessionUpdate: "state_changed", state });
    await this.save(session);
    await this.flush(session);
    return state;
  }

  private emit(
    session: NativeSessionContext,
    update: SessionUpdate,
    taskToolCallId?: string,
    origin: "observed" | "synthetic" = "observed"
  ): void {
    void this.emitCommitted(session, update, taskToolCallId, origin).catch((error) =>
      logWarn("[AgentMode] Chat fact could not be saved", {
        parentSessionId: session.record.sessionId,
        taskToolCallId,
        eventType: update.sessionUpdate,
        errorType: error instanceof Error ? error.name : typeof error,
      })
    );
  }

  private async emitCommitted(
    session: NativeSessionContext,
    update: SessionUpdate,
    taskToolCallId?: string,
    origin: "observed" | "synthetic" = "observed"
  ): Promise<SessionEvent> {
    if (update.sessionUpdate === "message_delivered" && session.acceptedSeqs.has(update.promptId))
      update = { ...update, messageSeq: session.acceptedSeqs.get(update.promptId) };
    const event: SessionEvent = {
      sessionId: session.record.sessionId,
      update,
      occurredAt: Date.now(),
      origin,
      ...(taskToolCallId ? { taskToolCallId } : {}),
    };
    if (session.closed) return event;
    session.record.events.push(event);
    const streamed =
      update.sessionUpdate === "agent_message_chunk" ||
      update.sessionUpdate === "agent_thought_chunk" ||
      update.sessionUpdate === "agent_thought_ended";
    // 已接收的正文先展示，磁盘卡住不能堵住阅读；可靠接收与工具准入仍须保存成功。https://github.com/ItsDalk-Lane/Scribe/issues/55
    if (streamed) this.handlers.get(session.record.sessionId)?.(event);
    if (this.options.storage.append) {
      const observational = update.sessionUpdate === "model_call_metrics";
      try {
        const record = await this.persist(session, "event", event, false, origin, observational);
        event.seq = record?.seq;
      } catch (failure) {
        if (
          !this.isConfirmationStopped(failure) ||
          (!streamed &&
            update.sessionUpdate !== "agent_segment_started" &&
            update.sessionUpdate !== "busy_changed" &&
            update.sessionUpdate !== "turn_ended")
        )
          throw failure;
        // 超时展示不编造日志序号，也不承诺保存；后续可靠记录仍会把未确认保存报告为失败。https://github.com/ItsDalk-Lane/Scribe/issues/55
        logWarn("[AgentMode] Displayed chat event was not confirmed as saved", {
          parentSessionId: session.record.sessionId,
          eventType: update.sessionUpdate,
        });
      }
    }
    if (!streamed) this.handlers.get(session.record.sessionId)?.(event);
    return event;
  }

  private finalizedBlocks(
    message: AssistantMessage
  ): Array<{ kind: "text" | "thought"; text: string; contentIndex: number }> {
    return message.content.flatMap(
      (
        part,
        contentIndex
      ): Array<{ kind: "text" | "thought"; text: string; contentIndex: number }> =>
        isRecord(part) && part.type === "text" && typeof part.text === "string"
          ? [{ kind: "text", text: part.text, contentIndex }]
          : isRecord(part) && part.type === "thinking" && typeof part.thinking === "string"
            ? [{ kind: "thought", text: part.thinking, contentIndex }]
            : []
    );
  }

  private async recoverSession(session: NativeSession): Promise<void> {
    const records = session.record.journalRecords ?? [];
    const admitted = new Map<string, string>();
    for (const record of records) {
      if (record.kind !== "tool_admitted") continue;
      if (
        !isRecord(record.payload) ||
        typeof record.payload.id !== "string" ||
        typeof record.payload.toolCallId !== "string"
      )
        continue;
      const payload = record.payload as { id: string; taskId?: string; toolCallId: string };
      admitted.set(`${payload.taskId ?? "main"}:${payload.id}`, payload.toolCallId);
    }
    const missing = new Map<string, string>();
    for (const message of session.record.messages) {
      if (message.role === "assistant")
        for (const part of message.content) {
          if (part.type === "toolCall") missing.set(part.id, part.name);
        }
      if (message.role === "toolResult") missing.delete(message.toolCallId);
    }
    const explanations = new Map<string, string>();
    for (const [id, name] of missing) {
      const started = admitted.has(`main:${id}`);
      const explanation = started
        ? t(
            "System recovery: this operation was admitted, but its outcome is unknown. Files may have changed. Check the actual files or tasks before retrying; it was not automatically resumed."
          )
        : t(
            "System recovery: this operation never started. No changes were made and it was not automatically resumed."
          );
      const message: AgentMessage = {
        role: "toolResult",
        toolCallId: id,
        toolName: name,
        isError: true,
        content: [{ type: "text", text: explanation }],
        timestamp: Date.now(),
      };
      if (session.record.writable !== false) {
        const fact = await this.persist(
          session,
          "tool_result",
          { message, recovery: started ? "outcome_unknown" : "not_started" },
          true,
          "synthetic"
        );
        if (fact) session.messageSeqs.set(message, fact.seq);
      }
      session.recordedMessages.add(message);
      session.record.messages.push(message);
      session.agent.state.messages.push(message);
      session.recordedToolResults.add(`main:${id}`);
      explanations.set(admitted.get(`main:${id}`) ?? id, explanation);
    }
    const tools = new Map<string, SessionEvent>();
    const tasks = new Map<string, SessionEvent>();
    const turns = new Map<string, SessionEvent>();
    const compactions = new Map<string, SessionEvent>();
    for (const event of session.record.events) {
      const update = event.update;
      if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
        if (update.status && ["completed", "failed", "cancelled"].includes(update.status))
          tools.delete(update.toolCallId);
        else tools.set(update.toolCallId, event);
      }
      if (update.sessionUpdate === "task_started" && update.taskId) tasks.set(update.taskId, event);
      if (update.sessionUpdate === "task_ended") tasks.delete(update.taskId);
      if (update.sessionUpdate === "turn_started") turns.set(update.turnId, event);
      if (update.sessionUpdate === "turn_ended") turns.delete(update.turnId);
      if (update.sessionUpdate === "compaction") {
        if (update.status === "in_progress") compactions.set(update.id, event);
        else compactions.delete(update.id);
      }
    }
    const lastProtocol = records.findLast(
      (fact) =>
        (fact.kind === "protocol_message" || fact.kind === "tool_result") &&
        isRecord(fact.payload) &&
        !fact.payload.taskId
    );
    const partialEvents = session.record.events.filter(
      (event) =>
        event.seq !== undefined &&
        event.seq > (lastProtocol?.seq ?? -1) &&
        !event.taskToolCallId &&
        event.update.sessionUpdate === "agent_message_chunk"
    );
    const partialText = partialEvents
      .map((event) =>
        event.update.sessionUpdate === "agent_message_chunk" && event.update.content.type === "text"
          ? event.update.content.text
          : ""
      )
      .join("");
    if (partialText) {
      const message = createAssistantMessage(session.provider.model);
      message.content = [
        {
          type: "text",
          text: `${partialText}\n\n${t("System recovery: this reply was interrupted. It was not automatically resumed.")}`,
        },
      ];
      message.stopReason = "stop";
      if (session.record.writable !== false) {
        const fact = await this.persist(
          session,
          "protocol_message",
          {
            message,
            recovery: "partial_reply",
            sourceSeqs: partialEvents.map((event) => event.seq),
          },
          true,
          "synthetic"
        );
        if (fact) session.messageSeqs.set(message, fact.seq);
      }
      session.recordedMessages.add(message);
      session.record.messages.push(message);
      session.agent.state.messages.push(message);
    }
    const append = async (update: SessionUpdate, source: SessionEvent): Promise<void> => {
      const event: SessionEvent = {
        sessionId: session.record.sessionId,
        update,
        occurredAt: Date.now(),
        origin: "synthetic",
        ...(source.taskToolCallId ? { taskToolCallId: source.taskToolCallId } : {}),
      };
      if (session.record.writable !== false) {
        const fact = await this.persist(session, "event", event, true, "synthetic");
        if (fact) event.seq = fact.seq;
      }
      session.record.events.push(event);
    };
    const finalizedSegments = new Set(
      session.record.events.flatMap((event) =>
        event.update.sessionUpdate === "agent_segment_finalized" ? [event.update.segmentSeq] : []
      )
    );
    const taskOwners = new Map(
      session.record.events.flatMap((event) =>
        event.update.sessionUpdate === "task_started" &&
        event.update.taskId &&
        event.update.toolCallId
          ? [[event.update.taskId, event.update.toolCallId] as const]
          : []
      )
    );
    for (const fact of records) {
      if (
        fact.kind !== "protocol_message" ||
        !isRecord(fact.payload) ||
        !Number.isSafeInteger(fact.payload.segmentSeq) ||
        !isRecord(fact.payload.message) ||
        fact.payload.message.role !== "assistant" ||
        !Array.isArray(fact.payload.message.content)
      )
        continue;
      const segment = fact.payload.segmentSeq as number;
      if (finalizedSegments.has(segment)) continue;
      if (
        !fact.payload.taskId &&
        !session.recordedMessages.has(fact.payload.message as unknown as AgentMessage)
      )
        continue;
      const blocks = this.finalizedBlocks(fact.payload.message as unknown as AssistantMessage);
      if (
        !blocks.length &&
        (fact.payload.message.stopReason === "error" ||
          fact.payload.message.stopReason === "aborted")
      )
        continue;
      const owner =
        typeof fact.payload.taskId === "string" ? taskOwners.get(fact.payload.taskId) : undefined;
      if (typeof fact.payload.taskId === "string" && !owner) continue;
      const source: SessionEvent = {
        sessionId: session.record.sessionId,
        update: { sessionUpdate: "agent_segment_started" },
        ...(owner ? { taskToolCallId: owner } : {}),
      };
      await append(
        { sessionUpdate: "agent_segment_finalized", segmentSeq: segment, blocks },
        source
      );
      finalizedSegments.add(segment);
    }
    const completedResults = new Map<string, AgentMessage & { role: "toolResult" }>();
    for (const fact of records) {
      if (
        fact.origin !== "observed" ||
        (fact.kind !== "tool_result" && fact.kind !== "protocol_message") ||
        !isRecord(fact.payload)
      )
        continue;
      const message = fact.payload.message;
      if (
        !isRecord(message) ||
        message.role !== "toolResult" ||
        typeof message.toolCallId !== "string" ||
        !Array.isArray(message.content)
      )
        continue;
      const scope = typeof fact.payload.taskId === "string" ? fact.payload.taskId : "main";
      const toolCallId =
        admitted.get(`${scope}:${message.toolCallId}`) ??
        `${typeof fact.payload.taskId === "string" ? fact.payload.taskId : typeof fact.payload.promptId === "string" ? fact.payload.promptId : "main"}:${message.toolCallId}`;
      completedResults.set(toolCallId, message as unknown as AgentMessage & { role: "toolResult" });
    }
    for (const [toolCallId, source] of tools) {
      const completed = completedResults.get(toolCallId);
      if (completed) {
        await append(
          {
            sessionUpdate: "tool_call_update",
            toolCallId,
            status: completed.isError ? "failed" : "completed",
            content: this.toolContent(completed),
          },
          source
        );
        continue;
      }
      const started = [...admitted.values()].includes(toolCallId);
      const text =
        explanations.get(toolCallId) ??
        (started
          ? t(
              "System recovery: this operation was admitted, but its outcome is unknown. Files may have changed. Check the actual files or tasks before retrying; it was not automatically resumed."
            )
          : t(
              "System recovery: this operation never started. No changes were made and it was not automatically resumed."
            ));
      await append(
        {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status: "failed",
          content: [{ type: "content", content: { type: "text", text } }],
        },
        source
      );
    }
    const finishedTasks = new Set(
      session.record.events.flatMap((event) =>
        event.update.sessionUpdate === "task_ended" ? [event.update.taskId] : []
      )
    );
    for (const fact of records) {
      if (
        fact.kind !== "task_admitted" ||
        !isRecord(fact.payload) ||
        typeof fact.payload.taskId !== "string" ||
        typeof fact.payload.toolCallId !== "string" ||
        typeof fact.payload.command !== "string"
      )
        continue;
      const taskId = fact.payload.taskId;
      if (finishedTasks.has(taskId) || tasks.has(taskId)) continue;
      const source: SessionEvent = {
        sessionId: session.record.sessionId,
        origin: "synthetic",
        update: {
          sessionUpdate: "task_started",
          taskId,
          toolCallId: fact.payload.toolCallId,
          kind: "command",
          description: fact.payload.command,
          command: fact.payload.command,
        },
      };
      await append(source.update, source);
      tasks.set(taskId, source);
    }
    for (const [taskId, source] of tasks) {
      // 结果已可靠保存但结束通知尚未落盘时，恢复卡片必须引用同一规范结果。https://github.com/ItsDalk-Lane/Scribe/issues/50
      const canonical = session.record.subagents
        ?.flatMap((state) => state.snapshot.runs)
        .find(
          (run) => run.id === taskId && run.endedAt !== undefined && run.resultId !== undefined
        );
      await append(
        {
          sessionUpdate: "task_ended",
          taskId,
          status: canonical
            ? canonical.status === "completed"
              ? "completed"
              : canonical.status === "stopped"
                ? "stopped"
                : "failed"
            : "stopped",
          ...(canonical?.stopReason ? { stopReason: canonical.stopReason as StopReason } : {}),
          summary: canonical
            ? canonical.result
            : t(
                "System recovery: the task outcome is unknown. Check actual files and processes before retrying."
              ),
        },
        source
      );
    }
    for (const [turnId, source] of turns)
      await append({ sessionUpdate: "turn_ended", turnId, stopReason: "interrupted" }, source);
    for (const [id, source] of compactions) {
      if (source.update.sessionUpdate !== "compaction") continue;
      const committed = records.findLast(
        (fact) =>
          fact.kind === "compaction" &&
          isRecord(fact.payload) &&
          isRecord(fact.payload.completion) &&
          fact.payload.completion.id === id
      );
      const completion = isRecord(committed?.payload) ? committed.payload.completion : undefined;
      if (
        committed &&
        isRecord(completion) &&
        completion.status === "completed" &&
        completion.trigger === source.update.trigger &&
        typeof completion.summary === "string" &&
        typeof completion.postTokens === "number"
      ) {
        await append(
          { ...completion, sessionUpdate: "compaction", commitSeq: committed.seq } as SessionUpdate,
          source
        );
      } else {
        await append(
          {
            sessionUpdate: "compaction",
            id,
            trigger: source.update.trigger,
            status: "cancelled",
            error: t(
              "System recovery: this reply was interrupted. It was not automatically resumed."
            ),
          },
          source
        );
      }
    }
  }

  private assertWritable(session: NativeSessionContext): void {
    if (session.storageError) throw session.storageError;
    if (session.record.writable === false)
      throw new Error(
        "This chat contains an uncertain record sequence and cannot accept new operations."
      );
  }

  private isConfirmationStopped(failure: unknown): boolean {
    return (
      failure instanceof JournalConfirmationTimeout ||
      (failure instanceof Error && failure.name === "JournalConfirmationTimeout")
    );
  }

  // 确认超时只是结果未知：用统一文案停止本步，不把会话标记为存储故障。https://github.com/ItsDalk-Lane/Scribe/issues/55
  private confirmationStopped(): Error {
    const stopped = new Error(t(CONFIRMATION_STOPPED));
    stopped.name = "JournalConfirmationTimeout";
    return stopped;
  }

  private async persist(
    session: NativeSessionContext,
    kind: string,
    payload: unknown,
    durable = false,
    origin: "observed" | "synthetic" | "derived" = "observed",
    observational = false
  ): Promise<JournalRecord | undefined> {
    this.assertWritable(session);
    try {
      const record = await this.options.storage.append?.(session.record.sessionId, kind, payload, {
        durable,
        origin,
        discardOnFailure: observational,
      });
      if (
        !this.options.storage.append &&
        kind === "subagent_task" &&
        isRecord(payload) &&
        isRecord(payload.task)
      ) {
        const task = payload.task as unknown as NativeSubagentTask;
        await this.options.storage.save({
          ...session.record,
          taskGenerations: [
            ...(session.record.taskGenerations ?? []).filter((entry) => entry.id !== task.id),
            task,
          ],
        });
      }
      if (record) (session.record.journalRecords ??= []).push(record);
      return record;
    } catch (failure) {
      // 用量事实只是可重算的观察数据：保存失败记一条日志即可，不能终止会话。https://github.com/ItsDalk-Lane/Scribe/issues/55
      if (observational) {
        logWarn("[AgentMode] Usage fact could not be saved", {
          parentSessionId: session.record.sessionId,
          errorType: failure instanceof Error ? failure.name : typeof failure,
        });
        return undefined;
      }
      if (this.isConfirmationStopped(failure)) throw this.confirmationStopped();
      if (!this.options.storage.append) throw failure;
      session.storageError = failure instanceof Error ? failure : new Error(String(failure));
      session.subagentController?.abortExecutors();
      this.sessions.get(session.record.sessionId)?.agent.abort();
      session.runController?.abort();
      throw session.storageError;
    }
  }

  private async flush(session: NativeSessionContext): Promise<void> {
    this.assertWritable(session);
    try {
      await this.options.storage.flush?.(session.record.sessionId);
    } catch (failure) {
      if (this.isConfirmationStopped(failure)) throw this.confirmationStopped();
      session.storageError = failure instanceof Error ? failure : new Error(String(failure));
      throw session.storageError;
    }
    this.assertWritable(session);
  }

  private async admitTool(session: NativeSessionContext, toolCallId: string): Promise<void> {
    const execution = session.toolExecutions.get(toolCallId);
    if (!execution || execution.admitted) return;
    await this.persist(session, "tool_admitted", { toolCallId, ...execution }, true);
    execution.admitted = true;
    if (execution.roundId && execution.sourceId) {
      const taskToolCallId = execution.taskId
        ? session.subagentController
            ?.list()
            .flatMap((entry) => entry.runs)
            .find((run) => run.id === execution.taskId)?.toolCallId
        : undefined;
      await this.emitCommitted(
        session,
        {
          sessionUpdate: "tool_execution_started",
          roundId: execution.roundId,
          sourceId: execution.sourceId,
          toolCallId,
        },
        taskToolCallId
      );
      await this.emitCommitted(
        session,
        { sessionUpdate: "tool_call_update", toolCallId, status: "in_progress" },
        taskToolCallId
      );
    }
  }

  private async recordToolResult(
    session: NativeSessionContext,
    id: string,
    name: string,
    result: AgentToolResult,
    isError: boolean,
    taskId?: string
  ): Promise<void> {
    const message: AgentMessage = {
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      content: result.content,
      details: result.details,
      ...(result.structuredContent === undefined
        ? {}
        : { structuredContent: result.structuredContent }),
      isError,
      timestamp: Date.now(),
    };
    const delegation =
      !taskId &&
      (name === "delegate_task" || name === "read_subagent_result") &&
      isRecord(result.details) &&
      typeof result.details.subagentId === "string" &&
      typeof result.details.resultId === "string"
        ? result.details
        : undefined;
    const resultMessageIds =
      delegation &&
      session
        .subagentController!.state(delegation.subagentId as string)
        .snapshot.messages.some((entry) => entry.id === delegation.resultId)
        ? [delegation.resultId as string]
        : [];
    const fact = await this.persist(
      session,
      delegation ? "subagent_delivery" : "tool_result",
      delegation
        ? {
            version: 1,
            subagentId: delegation.subagentId,
            message,
            messageIds: resultMessageIds,
            resultId: delegation.resultId,
          }
        : { message, promptId: session.runId, ...(taskId ? { taskId } : {}) },
      true
    );
    if (delegation)
      await session.subagentController!.acknowledgeParent(
        delegation.subagentId as string,
        resultMessageIds,
        delegation.resultId as string
      );
    if (fact) {
      session.messageSeqs.set(message, fact.seq);
      session.toolResultSeqs.set(`${taskId ?? "main"}:${id}`, fact.seq);
    }
    session.recordedToolResults.add(`${taskId ?? "main"}:${id}`);
    if (isRecord(result.details) && typeof result.details.resultReference === "string") {
      const scope = taskId
        ? session
            .subagentController!.list()
            .find((entry) => entry.runs.some((run) => run.id === taskId))?.id
        : "main";
      if (scope) session.toolResultCache.set(result.details.resultReference, { scope, message });
    }
    if (!taskId) session.record.messages.push(message);
  }

  async appendDisplayFacts(input: { sessionId: string; facts: AgentDisplayFact[] }): Promise<void> {
    const facts = input.facts.flatMap((fact): AgentDisplayFact[] => {
      if (fact.kind !== "branch" || !fact.messages) return [fact];
      return [
        ...fact.messages.map((source): AgentDisplayFact => {
          const message = { ...source };
          delete message.seq;
          return { kind: "inherited_message", message };
        }),
        { kind: "branch", branch: fact.branch },
      ];
    });
    const session = this.sessions.get(input.sessionId);
    if (session && !session.closed) {
      for (const fact of facts)
        await this.persist(
          session,
          "display",
          fact,
          true,
          fact.kind === "inherited_message" ? "derived" : "observed"
        );
      return;
    }
    const record = await this.options.storage.load(input.sessionId);
    if (!record || record.writable === false || !this.options.storage.append)
      throw new Error("The saved chat cannot accept changes.");
    for (const fact of facts)
      await this.options.storage.append(input.sessionId, "display", fact, {
        durable: true,
        origin: fact.kind === "inherited_message" ? "derived" : "observed",
      });
  }

  async readDisplayFacts(input: { sessionId: string }): Promise<SequencedAgentDisplayFact[]> {
    const session = this.sessions.get(input.sessionId);
    if (session && !session.closed && session.record.writable !== false) await this.flush(session);
    const record = session?.record ?? (await this.options.storage.load(input.sessionId));
    return record ? this.displayFacts(record) : [];
  }

  private displayFacts(session: NativeSessionRecord): SequencedAgentDisplayFact[] {
    return (session.journalRecords ?? []).flatMap((record) => {
      if (record.kind === "display")
        return isAgentDisplayFact(record.payload)
          ? [{ seq: record.seq, origin: record.origin, payload: record.payload }]
          : [];
      if (record.kind === "user_accepted") {
        const raw = record.payload;
        if (
          !isRecord(raw) ||
          typeof raw.promptId !== "string" ||
          !isRecord(raw.message) ||
          !(typeof raw.message.content === "string" || Array.isArray(raw.message.content))
        )
          return [];
        const accepted = raw as unknown as {
          promptId: string;
          message: AgentMessage;
          displayMessage?: import("@/agentMode/session/types").StoredAgentDisplayMessage;
        };
        const message = isAgentDisplayFact({
          kind: "user_message",
          message: accepted.displayMessage,
        })
          ? accepted.displayMessage!
          : {
              id: accepted.promptId,
              sender: "user",
              message: transcriptText(accepted.message.content),
              timestamp: null,
              isVisible: true,
            };
        return [
          {
            seq: record.seq,
            origin: record.origin,
            payload: { kind: "user_message" as const, message },
          },
        ];
      }
      return [];
    });
  }

  private save(session: NativeSession): Promise<void> {
    return this.saveTranscript(session, session.agent);
  }

  private async saveTranscript(session: NativeSessionContext, agent: Agent): Promise<void> {
    if (!this.options.storage.append) {
      const saved = new Map(
        session.record.messages.flatMap((message) =>
          message.role === "toolResult" &&
          isRecord(message.details) &&
          typeof message.details.resultReference === "string"
            ? [[message.details.resultReference, message] as const]
            : []
        )
      );
      session.record.messages = agent.state.messages.map((message) =>
        message.role === "toolResult" &&
        isRecord(message.details) &&
        typeof message.details.resultReference === "string"
          ? (session.toolResultCache.get(message.details.resultReference)?.message ??
            saved.get(message.details.resultReference) ??
            message)
          : message
      );
    }
    session.record.updatedAt = Date.now();
    this.assertWritable(session);
    try {
      // 只写入不确认：确认由调用方决定在队列外等待，写队列不被一次 fsync 拖住。https://github.com/ItsDalk-Lane/Scribe/issues/55
      await this.options.storage.save(session.record);
    } catch (failure) {
      if (this.isConfirmationStopped(failure)) throw this.confirmationStopped();
      if (this.options.storage.append) {
        session.storageError = failure instanceof Error ? failure : new Error(String(failure));
        throw session.storageError;
      }
      throw failure;
    }
  }
}
