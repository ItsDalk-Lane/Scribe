import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SessionEvent } from "@/agentMode/session/types";
import type {
  NativeSessionRecord,
  NativeSessionStorage,
  NativeSubagentTask,
} from "@/agentMode/sdk/NativeBackendProcess";
import { NodeAttachmentStorage } from "@/agentMode/sdk/AttachmentStorage";
import {
  getNodeJournalStorage,
  NodeJournalStorage,
  type JournalAppendOptions,
  type JournalRecord,
} from "@/agentMode/sdk/JournalStorage";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { isRecord } from "@/utils/obsidianInternals";
import { logWarn } from "@/logger";
import {
  isSubagentMessage,
  isSubagentSnapshot,
  projectSubagentState,
} from "@/agentMode/sdk/subagentState";

const IMAGE_CACHE = new Map<string, string>();
const ADAPTER_QUEUES = new WeakMap<NodeJournalStorage, Map<string, Promise<unknown>>>();
const SUBAGENT_WRITE_ERRORS = new WeakMap<NodeJournalStorage, Map<string, Error>>();
const MAX_IMAGE_CACHE_BYTES = 16 * 1024 * 1024;
let imageCacheBytes = 0;

function serializable(_key: string, value: unknown): unknown {
  return value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack }
    : value;
}

function validSubagentTask(value: unknown): value is NativeSubagentTask {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    value.id.length > 0 &&
    typeof value.active === "boolean" &&
    (value.autoContinue === undefined || typeof value.autoContinue === "boolean") &&
    (value.budgetGrants === undefined ||
      (Array.isArray(value.budgetGrants) &&
        value.budgetGrants.every((id: unknown) => typeof id === "string"))) &&
    Number.isSafeInteger(value.limit) &&
    (value.limit as number) > 0 &&
    Array.isArray(value.requestIds) &&
    value.requestIds.every((id: unknown) => typeof id === "string") &&
    new Set(value.requestIds).size === value.requestIds.length &&
    Array.isArray(value.usage) &&
    value.usage.every(
      (entry: unknown) =>
        isRecord(entry) &&
        typeof entry.requestId === "string" &&
        (value.requestIds as unknown[]).includes(entry.requestId) &&
        isRecord(entry.usage) &&
        ["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every(
          (key) =>
            typeof (entry.usage as Record<string, unknown>)[key] === "number" &&
            Number.isFinite((entry.usage as Record<string, unknown>)[key]) &&
            ((entry.usage as Record<string, unknown>)[key] as number) >= 0
        )
    )
  );
}

function configuration(record: NativeSessionRecord): Record<string, unknown> {
  return {
    version: record.version,
    backendId: record.backendId,
    sessionId: record.sessionId,
    cwd: record.cwd,
    projectId: record.projectId,
    purpose: record.purpose,
    modelId: record.modelId,
    effort: record.effort,
    mode: record.mode,
    modeBeforePlan: record.modeBeforePlan,
    permissions: record.permissions,
  };
}

function validHeader(value: unknown, sessionId: string): value is NativeSessionRecord {
  if (!isRecord(value)) return false;
  const path = requireNodeModule<typeof import("node:path")>("path");
  return (
    value.backendId === "native" &&
    value.sessionId === sessionId &&
    typeof value.cwd === "string" &&
    path.isAbsolute(value.cwd) &&
    typeof value.modelId === "string" &&
    value.modelId.length > 0 &&
    (value.effort === null || typeof value.effort === "string") &&
    ["default", "plan", "auto", "full"].includes(value.mode as string) &&
    (value.modeBeforePlan === undefined ||
      ["default", "plan", "auto", "full"].includes(value.modeBeforePlan as string)) &&
    (value.purpose === undefined || value.purpose === "skill-authoring")
  );
}

function validMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value) || typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp))
    return false;
  if (value.role === "system" || value.role === "user")
    return (
      typeof value.content === "string" ||
      validContent(value.content, value.role === "system" ? ["text"] : ["text", "image"])
    );
  const usage = value.usage;
  if (value.role === "assistant")
    return (
      validContent(value.content, ["text", "thinking", "toolCall"]) &&
      typeof value.api === "string" &&
      typeof value.provider === "string" &&
      typeof value.model === "string" &&
      isRecord(usage) &&
      isRecord(usage.cost) &&
      ["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every(
        (key) => typeof usage[key] === "number"
      ) &&
      ["pending", "stop", "length", "toolUse", "error", "aborted", "deferred"].includes(
        value.stopReason as string
      )
    );
  if (value.role === "toolResult")
    return (
      validContent(value.content, ["text", "image"]) &&
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string" &&
      typeof value.isError === "boolean"
    );
  return false;
}

function validContent(content: unknown, allowed: string[]): boolean {
  return (
    Array.isArray(content) &&
    content.every((part: unknown) => {
      if (!isRecord(part) || typeof part.type !== "string" || !allowed.includes(part.type))
        return false;
      if (part.type === "text") return typeof part.text === "string";
      if (part.type === "thinking") return typeof part.thinking === "string";
      if (part.type === "image")
        return (
          (typeof part.data === "string" || typeof part.attachmentHash === "string") &&
          typeof part.mimeType === "string"
        );
      return (
        typeof part.id === "string" &&
        typeof part.name === "string" &&
        isRecord(part.arguments) &&
        !Array.isArray(part.arguments)
      );
    })
  );
}

function validProgress(value: unknown): boolean {
  return (
    value === undefined ||
    (isRecord(value) &&
      !Array.isArray(value) &&
      ["description", "toolName"].every(
        (key) => value[key] === undefined || typeof value[key] === "string"
      ) &&
      ["toolUses", "durationMs", "totalTokens"].every(
        (key) =>
          value[key] === undefined ||
          (typeof value[key] === "number" && Number.isFinite(value[key]))
      ))
  );
}

function validToolDisplay(value: Record<string, unknown>): boolean {
  return (
    typeof value.toolCallId === "string" &&
    ["title", "kind", "status", "vendorToolName", "mcpServer", "parentToolCallId"].every(
      (key) => value[key] === undefined || typeof value[key] === "string"
    ) &&
    (value.isPlanProposal === undefined || typeof value.isPlanProposal === "boolean") &&
    validProgress(value.progress) &&
    (value.content === undefined ||
      value.content === null ||
      (Array.isArray(value.content) &&
        value.content.every((part: unknown) => {
          if (!isRecord(part)) return false;
          if (part.type === "content")
            return (
              isRecord(part.content) &&
              part.content.type === "text" &&
              typeof part.content.text === "string"
            );
          return (
            part.type === "diff" &&
            typeof part.path === "string" &&
            typeof part.newText === "string" &&
            (part.oldText === undefined ||
              part.oldText === null ||
              typeof part.oldText === "string")
          );
        }))) &&
    (value.locations === undefined ||
      value.locations === null ||
      (Array.isArray(value.locations) &&
        value.locations.every(
          (location: unknown) =>
            isRecord(location) &&
            typeof location.path === "string" &&
            (location.line === undefined ||
              location.line === null ||
              typeof location.line === "number")
        ))) &&
    (value.originalFiles === undefined ||
      (isRecord(value.originalFiles) &&
        !Array.isArray(value.originalFiles) &&
        Object.values(value.originalFiles).every(
          (text) => text === null || typeof text === "string"
        )))
  );
}

function validEvent(value: unknown, sessionId: string): value is SessionEvent {
  if (!isRecord(value) || value.sessionId !== sessionId || !isRecord(value.update)) return false;
  if (
    value.occurredAt !== undefined &&
    (typeof value.occurredAt !== "number" || !Number.isFinite(value.occurredAt))
  )
    return false;
  if (value.taskToolCallId !== undefined && typeof value.taskToolCallId !== "string") return false;
  const update = value.update;
  switch (update.sessionUpdate) {
    case "subagents_updated":
      return Array.isArray(update.subagents) && update.subagents.every(isSubagentSnapshot);
    case "subagent_message":
      return typeof update.name === "string" && isSubagentMessage(update.message);
    case "agent_segment_started":
      return true;
    case "agent_thought_ended":
      return (
        Number.isSafeInteger(update.segmentSeq) &&
        (update.segmentSeq as number) >= 0 &&
        (update.contentIndex === undefined ||
          (Number.isSafeInteger(update.contentIndex) && (update.contentIndex as number) >= 0))
      );
    case "agent_segment_finalized":
      return (
        Number.isSafeInteger(update.segmentSeq) &&
        (update.segmentSeq as number) >= 0 &&
        Array.isArray(update.blocks) &&
        update.blocks.every(
          (block: unknown) =>
            isRecord(block) &&
            (block.kind === "text" || block.kind === "thought") &&
            typeof block.text === "string" &&
            Number.isSafeInteger(block.contentIndex) &&
            (block.contentIndex as number) >= 0
        )
      );
    case "user_message_chunk":
    case "agent_message_chunk":
    case "agent_thought_chunk":
      return (
        (validContent([update.content], ["text", "image"]) ||
          (isRecord(update.content) &&
            update.content.type === "resource_link" &&
            typeof update.content.uri === "string")) &&
        (update.messageId === undefined || typeof update.messageId === "string")
      );
    case "tool_call":
      return typeof update.title === "string" && validToolDisplay(update);
    case "tool_call_update":
      return validToolDisplay(update);
    case "plan":
      return (
        Array.isArray(update.entries) &&
        update.entries.every(
          (entry: unknown) =>
            isRecord(entry) &&
            typeof entry.content === "string" &&
            ["high", "medium", "low"].includes(entry.priority as string) &&
            ["pending", "in_progress", "completed"].includes(entry.status as string)
        )
      );
    case "compaction":
      return (
        typeof update.id === "string" &&
        ["manual", "auto"].includes(update.trigger as string) &&
        ["in_progress", "completed", "failed", "cancelled", "skipped"].includes(
          update.status as string
        ) &&
        ["error", "summary"].every(
          (key) => update[key] === undefined || typeof update[key] === "string"
        ) &&
        ["fromIndex", "toIndex", "preTokens", "postTokens"].every(
          (key) =>
            update[key] === undefined ||
            (typeof update[key] === "number" && Number.isFinite(update[key]))
        )
      );
    case "turn_started":
      return (
        typeof update.turnId === "string" &&
        (update.startedAt === undefined ||
          (typeof update.startedAt === "number" && Number.isFinite(update.startedAt)))
      );
    case "turn_ended":
      return (
        typeof update.turnId === "string" &&
        typeof update.stopReason === "string" &&
        (update.error === undefined ||
          (isRecord(update.error) && typeof update.error.message === "string"))
      );
    case "task_started":
      return (
        typeof update.taskId === "string" &&
        typeof update.toolCallId === "string" &&
        typeof update.description === "string" &&
        ["subagent", "command"].includes(update.kind as string)
      );
    case "task_ended":
      return (
        typeof update.taskId === "string" &&
        ["completed", "failed", "stopped"].includes(update.status as string) &&
        ["summary", "outputFile", "stopReason"].every(
          (key) => update[key] === undefined || typeof update[key] === "string"
        )
      );
    case "task_progress":
      return (
        typeof update.taskId === "string" &&
        validProgress(update.progress) &&
        ["model", "outputFile"].every(
          (key) => update[key] === undefined || typeof update[key] === "string"
        )
      );
    case "message_delivered":
      return typeof update.promptId === "string";
    case "messages_withdrawn":
      return (
        Array.isArray(update.promptIds) &&
        update.promptIds.every((id: unknown) => typeof id === "string")
      );
    case "busy_changed":
      return typeof update.busy === "boolean";
    case "session_disconnected":
      return isRecord(update.error) && typeof update.error.message === "string";
    case "session_info_update":
      return (
        update.title === undefined || update.title === null || typeof update.title === "string"
      );
    case "current_mode_update":
      return typeof update.currentModeId === "string";
    case "config_option_update":
      return Array.isArray(update.configOptions);
    case "state_changed":
      return isRecord(update.state);
    case "usage_update":
      return isRecord(update.usage);
    case "tool_execution_started":
      return (
        typeof update.roundId === "string" &&
        typeof update.sourceId === "string" &&
        typeof update.toolCallId === "string"
      );
    case "model_call_metrics": {
      const observation = update.observation;
      if (!isRecord(observation) || !isRecord(observation.usage)) return false;
      const usage = observation.usage;
      return (
        typeof observation.id === "string" &&
        typeof observation.roundId === "string" &&
        Array.isArray(observation.requestIds) &&
        observation.requestIds.every((id: unknown) => typeof id === "string") &&
        ["sourceId", "sourceName", "modelId", "modelName"].every(
          (key) => typeof observation[key] === "string"
        ) &&
        ["main", "subagent"].includes(observation.kind as string) &&
        ["chat", "compaction"].includes(observation.purpose as string) &&
        ["running", "completed", "failed", "cancelled"].includes(observation.status as string) &&
        [
          "startedAt",
          "firstTokenAt",
          "endedAt",
          "generationMs",
          "generationOutputTokens",
          "thinkingDurationMs",
          "segmentSeq",
        ].every(
          (key) =>
            observation[key] === undefined ||
            (typeof observation[key] === "number" &&
              Number.isFinite(observation[key]) &&
              observation[key] >= 0)
        ) &&
        ["inputTokens", "outputTokens", "totalTokens", "cacheReadTokens", "cacheWriteTokens"].every(
          (key) =>
            usage[key] === undefined ||
            (typeof usage[key] === "number" && Number.isFinite(usage[key]) && usage[key] >= 0)
        )
      );
    }
    case "plan_usage_update":
      return update.planUsage === null || isRecord(update.planUsage);
    default:
      return false;
  }
}

function restoreError(event: SessionEvent): SessionEvent {
  const update = event.update;
  if (update.sessionUpdate === "turn_ended" || update.sessionUpdate === "session_disconnected") {
    const saved = update.error;
    if (isRecord(saved) && typeof saved.message === "string") {
      const error = new Error(saved.message);
      if (typeof saved.name === "string") error.name = saved.name;
      if (typeof saved.stack === "string") error.stack = saved.stack;
      return { ...event, update: { ...update, error } };
    }
  }
  return event;
}

function restoredDecision(
  fact: JournalRecord,
  payload: unknown
): NonNullable<NativeSessionRecord["decisions"]>[number] | null {
  if (
    !isRecord(payload) ||
    typeof payload.requestId !== "string" ||
    !(
      payload.requester === "main" ||
      (isRecord(payload.requester) && typeof payload.requester.taskId === "string")
    ) ||
    !isRecord(payload.response) ||
    Array.isArray(payload.response)
  )
    return null;
  if (fact.kind === "permission") {
    const outcome = payload.response.outcome;
    if (
      !isRecord(outcome) ||
      !(
        outcome.outcome === "cancelled" ||
        (outcome.outcome === "selected" && typeof outcome.optionId === "string")
      )
    )
      return null;
  } else if (
    fact.kind !== "question" ||
    !Object.values(payload.response).every((answer) => typeof answer === "string")
  )
    return null;
  return {
    kind: fact.kind,
    requestId: payload.requestId,
    requester: payload.requester as NonNullable<
      NativeSessionRecord["decisions"]
    >[number]["requester"],
    response: payload.response as unknown as NonNullable<
      NativeSessionRecord["decisions"]
    >[number]["response"],
    occurredAt: fact.occurredAt,
  };
}

export class NodeNativeSessionStorage implements NativeSessionStorage {
  readonly journal: NodeJournalStorage;
  private readonly queues: Map<string, Promise<unknown>>;
  private readonly configurations = new Map<string, string>();
  private readonly subagentWriteErrors: Map<string, Error>;

  constructor(
    directoryOrJournal: string | NodeJournalStorage,
    private readonly attachments?: NodeAttachmentStorage
  ) {
    this.journal =
      typeof directoryOrJournal === "string"
        ? getNodeJournalStorage(directoryOrJournal)
        : directoryOrJournal;
    this.queues = ADAPTER_QUEUES.get(this.journal) ?? new Map();
    ADAPTER_QUEUES.set(this.journal, this.queues);
    this.subagentWriteErrors = SUBAGENT_WRITE_ERRORS.get(this.journal) ?? new Map();
    SUBAGENT_WRITE_ERRORS.set(this.journal, this.subagentWriteErrors);
  }

  async append(
    sessionId: string,
    kind: string,
    payload: unknown,
    options: JournalAppendOptions = {}
  ): Promise<JournalRecord> {
    const captured: unknown = JSON.parse(JSON.stringify(payload, serializable));
    const written = this.enqueue(sessionId, async () => {
      const blocked = this.subagentWriteErrors.get(sessionId);
      if (blocked) throw blocked;
      const stored = await this.appendEncoded(sessionId, kind, captured, options);
      return { ...stored, payload: captured };
    });
    if (!options.durable) return written;
    const record = await written;
    // 确认在存储队列外等待，同一聊天的后续事实不被一次 fsync 拖住。https://github.com/ItsDalk-Lane/Scribe/issues/55
    await this.journal.flush(sessionId);
    return record;
  }

  async flush(sessionId: string): Promise<void> {
    return this.enqueue(sessionId, () => this.journal.flush(sessionId));
  }

  async save(record: NativeSessionRecord): Promise<void> {
    const header = configuration(record);
    if (!validHeader(header, record.sessionId)) throw new Error("Invalid native session metadata.");
    const encoded = JSON.stringify(header);
    return this.enqueue(record.sessionId, async () => {
      const blocked = this.subagentWriteErrors.get(record.sessionId);
      if (blocked) throw blocked;
      let previous = this.configurations.get(record.sessionId);
      if (previous === undefined) {
        const existing = await this.journal.read(record.sessionId);
        if (
          existing.records.length ||
          existing.warnings.some((warning) => !warning.includes("incomplete final"))
        ) {
          const created = existing.records.find((fact) => fact.kind === "session_created");
          if (!created || !validHeader(created.payload, record.sessionId))
            throw new Error("Preserving a journal without usable native session metadata.");
          previous = JSON.stringify(configuration(created.payload));
        } else {
          if (!existing.writable) throw new Error("The native journal is not writable.");
          await this.appendEncoded(
            record.sessionId,
            "session_created",
            { ...header, updatedAt: record.updatedAt, decisions: record.decisions },
            {}
          );
          for (const message of record.messages)
            await this.appendEncoded(record.sessionId, "protocol_message", { message }, {});
          for (const event of record.events)
            await this.appendEncoded(record.sessionId, "event", event, {});
          await this.journal.flush(record.sessionId);
          this.configurations.set(record.sessionId, encoded);
          return;
        }
      }
      if (previous !== encoded)
        await this.appendEncoded(
          record.sessionId,
          "session_config",
          { ...header, updatedAt: record.updatedAt },
          {}
        );
      this.configurations.set(record.sessionId, encoded);
    });
  }

  async load(sessionId: string): Promise<NativeSessionRecord | null> {
    return this.enqueue(sessionId, async () => {
      const loaded = await this.journal.read(sessionId);
      const warnings = [...loaded.warnings];
      const facts: JournalRecord[] = [];
      const taskGenerations = new Map<string, NativeSubagentTask>();
      let tasksWritable = true;
      let record: NativeSessionRecord | null = null;
      for (const fact of loaded.records) {
        let payload = await this.hydrate(fact.payload, warnings);
        if (fact.kind === "event" && isRecord(payload))
          payload = { ...payload, seq: fact.seq, origin: fact.origin };
        facts.push({ ...fact, payload });
        if (fact.kind === "session_created") {
          if (!record && validHeader(payload, sessionId))
            record = {
              ...payload,
              messages: [],
              events: [],
              updatedAt:
                typeof payload.updatedAt === "number" ? payload.updatedAt : fact.occurredAt,
            };
          else warnings.push(`Fact ${fact.seq} has unusable or duplicate session metadata.`);
          continue;
        }
        if (!record) continue;
        record.updatedAt = Math.max(record.updatedAt, fact.occurredAt);
        if (fact.kind === "subagent_task") {
          if (!isRecord(payload) || payload.version !== 1 || !validSubagentTask(payload.task)) {
            warnings.push(
              `Subagent task ${fact.seq} has an unsupported format; its original bytes were preserved.`
            );
            tasksWritable = false;
          } else {
            const task = payload.task;
            taskGenerations.set(task.id, {
              ...task,
              active: false,
              requestIds: [...task.requestIds],
              usage: [...new Map(task.usage.map((entry) => [entry.requestId, entry])).values()],
            });
          }
          continue;
        }
        if (fact.kind === "session_config") {
          if (isRecord(payload) && validHeader({ ...record, ...payload }, sessionId))
            Object.assign(record, payload, { messages: record.messages, events: record.events });
          else warnings.push(`Fact ${fact.seq} has an unsupported configuration update.`);
        } else if (fact.kind === "protocol_message" || fact.kind === "tool_result") {
          const message = isRecord(payload) && "message" in payload ? payload.message : payload;
          if (isRecord(payload) && typeof payload.taskId === "string") continue;
          if (validMessage(message)) record.messages.push(message);
          else if (fact.kind === "protocol_message")
            warnings.push(`Fact ${fact.seq} has an unsupported protocol message.`);
        } else if (fact.kind === "event") {
          if (validEvent(payload, sessionId)) record.events.push(restoreError(payload));
          else warnings.push(`Fact ${fact.seq} has an unsupported session event.`);
        } else if (fact.kind === "permission" || fact.kind === "question") {
          const decision = restoredDecision(fact, payload);
          if (decision) (record.decisions ??= []).push(decision);
          else warnings.push(`Fact ${fact.seq} has an unsupported interactive decision.`);
        }
      }
      if (!record) return null;
      const projection = projectSubagentState(facts, validMessage);
      warnings.push(...projection.warnings);
      if (!projection.writable || !tasksWritable)
        this.subagentWriteErrors.set(
          sessionId,
          new Error(
            "The subagent record format is unsupported or damaged; further writes are disabled."
          )
        );
      else this.subagentWriteErrors.delete(sessionId);
      const messageSequences = new Map<AgentMessage, number>();
      for (const fact of facts) {
        if (
          (fact.kind === "protocol_message" || fact.kind === "tool_result") &&
          isRecord(fact.payload) &&
          validMessage(fact.payload.message)
        )
          messageSequences.set(fact.payload.message, fact.seq);
      }
      for (const delivered of projection.parentMessages) {
        record.messages.push(delivered.message);
        messageSequences.set(delivered.message, delivered.seq);
      }
      record.messages.sort(
        (left, right) => (messageSequences.get(left) ?? 0) - (messageSequences.get(right) ?? 0)
      );
      this.configurations.set(sessionId, JSON.stringify(configuration(record)));
      return {
        ...record,
        subagents: projection.subagents,
        taskGenerations: [...taskGenerations.values()],
        journalRecords: facts,
        writable: loaded.writable && projection.writable && tasksWritable,
        warnings,
      };
    });
  }

  async list(): Promise<NativeSessionRecord[]> {
    const records: NativeSessionRecord[] = [];
    for (const sessionId of await this.journal.list()) {
      try {
        const record = await this.load(sessionId);
        if (record) records.push(record);
      } catch (error) {
        logWarn(
          "A native chat could not be loaded; other chats remain available.",
          sessionId,
          error
        );
      }
    }
    return records.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async remove(sessionId: string): Promise<void> {
    return this.enqueue(sessionId, async () => {
      await this.journal.remove(sessionId);
      this.configurations.delete(sessionId);
      this.subagentWriteErrors.delete(sessionId);
    });
  }

  async removeSubagent(sessionId: string, subagentId: string): Promise<void> {
    return this.enqueue(sessionId, async () => {
      const blocked = this.subagentWriteErrors.get(sessionId);
      if (blocked) throw blocked;
      const loaded = await this.journal.read(sessionId);
      const projection = projectSubagentState(loaded.records, validMessage);
      if (!loaded.writable || !projection.writable)
        throw new Error(
          "The subagent record cannot be safely deleted while its format is uncertain."
        );
      const child = projection.subagents.find((entry) => entry.snapshot.id === subagentId);
      if (!child) return;
      const runIds = new Set(child.snapshot.runs.map((run) => run.id));
      const calls = new Set(child.snapshot.runs.map((run) => run.toolCallId));
      const deliveredSequences = new Set(projection.parentMessages.map((entry) => entry.seq));
      const ownedKinds = new Set([
        "subagent_state",
        "subagent_delivery",
        "protocol_message",
        "tool_result",
        "tool_admitted",
        "task_admitted",
        "permission",
        "question",
        "event",
        "compaction",
        "skill_model_delivery",
        "request_context",
        "skill_model_scope_reset",
        "skill_model_skill_revoked",
      ]);
      await this.journal.redact(
        sessionId,
        (record) => {
          if (!ownedKinds.has(record.kind) || !isRecord(record.payload)) return false;
          const payload = record.payload;
          if (record.kind === "subagent_state")
            return (
              isRecord(payload.state) &&
              isRecord(payload.state.snapshot) &&
              payload.state.snapshot.id === subagentId
            );
          if (
            payload.subagentId === subagentId ||
            (typeof payload.taskId === "string" && runIds.has(payload.taskId)) ||
            (typeof payload.runId === "string" && runIds.has(payload.runId))
          )
            return true;
          if (
            isRecord(payload.requester) &&
            ((typeof payload.requester.taskId === "string" &&
              runIds.has(payload.requester.taskId)) ||
              payload.requester.subagentId === subagentId)
          )
            return true;
          if (record.kind === "event")
            return (
              (typeof payload.taskToolCallId === "string" && calls.has(payload.taskToolCallId)) ||
              (isRecord(payload.update) &&
                typeof payload.update.taskId === "string" &&
                runIds.has(payload.update.taskId))
            );
          return false;
        },
        (record) =>
          record.kind === "subagent_delivery" &&
          deliveredSequences.has(record.seq) &&
          isRecord(record.payload) &&
          validMessage(record.payload.message)
            ? { kind: "protocol_message", payload: { message: record.payload.message } }
            : { kind: "redacted", payload: {} }
      );
    });
  }

  private async appendEncoded(
    sessionId: string,
    kind: string,
    payload: unknown,
    options: JournalAppendOptions
  ): Promise<JournalRecord> {
    // 落盘确认统一由调用点在写队列外用 journal.flush 执行，写入本身不等待。https://github.com/ItsDalk-Lane/Scribe/issues/55
    return this.journal.append(sessionId, kind, await this.dehydrate(payload), {
      ...options,
      durable: false,
    });
  }

  private async dehydrate(value: unknown): Promise<unknown> {
    if (value instanceof Error) return serializable("", value);
    if (Array.isArray(value)) return Promise.all(value.map((item) => this.dehydrate(item)));
    if (!isRecord(value)) return value;
    if (value.type === "image" && typeof value.data === "string") {
      if (!this.attachments)
        throw new Error("Attachment storage is required before saving an image.");
      const { Buffer } = requireNodeModule<typeof import("node:buffer")>("buffer");
      const { data, ...reference } = value;
      const attachmentHash = await this.attachments.put(
        new Uint8Array(Buffer.from(data, "base64"))
      );
      return { ...reference, attachmentHash };
    }
    if (
      value.type === "image_url" &&
      isRecord(value.image_url) &&
      typeof value.image_url.url === "string"
    ) {
      const match = /^data:([^;,]+);base64,([\s\S]*)$/.exec(value.image_url.url);
      if (match) {
        if (!this.attachments)
          throw new Error("Attachment storage is required before saving an image.");
        const { Buffer } = requireNodeModule<typeof import("node:buffer")>("buffer");
        const attachmentHash = await this.attachments.put(
          new Uint8Array(Buffer.from(match[2], "base64"))
        );
        return {
          ...value,
          image_url: {
            ...value.image_url,
            url: `scribe-attachment:${attachmentHash}`,
            mimeType: match[1],
          },
        };
      }
    }
    const pairs = await Promise.all(
      Object.entries(value).map(async ([key, item]) => [key, await this.dehydrate(item)] as const)
    );
    return Object.fromEntries(pairs);
  }

  private async hydrate(value: unknown, warnings: string[]): Promise<unknown> {
    if (Array.isArray(value)) return Promise.all(value.map((item) => this.hydrate(item, warnings)));
    if (!isRecord(value)) return value;
    if (value.type === "image" && typeof value.attachmentHash === "string") {
      const data = await this.imageData(value.attachmentHash, warnings);
      return data === undefined ? value : { ...value, data };
    }
    if (
      value.type === "image_url" &&
      isRecord(value.image_url) &&
      typeof value.image_url.url === "string" &&
      value.image_url.url.startsWith("scribe-attachment:")
    ) {
      const data = await this.imageData(
        value.image_url.url.slice("scribe-attachment:".length),
        warnings
      );
      return data === undefined
        ? value
        : {
            ...value,
            image_url: {
              ...value.image_url,
              url: `data:${typeof value.image_url.mimeType === "string" ? value.image_url.mimeType : "application/octet-stream"};base64,${data}`,
            },
          };
    }
    const pairs = await Promise.all(
      Object.entries(value).map(
        async ([key, item]) => [key, await this.hydrate(item, warnings)] as const
      )
    );
    return Object.fromEntries(pairs);
  }

  private async imageData(hash: string, warnings: string[]): Promise<string | undefined> {
    const cached = IMAGE_CACHE.get(hash);
    if (cached !== undefined) return cached;
    try {
      if (!this.attachments) throw new Error("Attachment storage is unavailable.");
      const bytes = await this.attachments.get(hash);
      const { Buffer } = requireNodeModule<typeof import("node:buffer")>("buffer");
      const data = Buffer.from(bytes).toString("base64");
      if (data.length <= MAX_IMAGE_CACHE_BYTES) {
        while (IMAGE_CACHE.size >= 64 || imageCacheBytes + data.length > MAX_IMAGE_CACHE_BYTES) {
          const oldest = IMAGE_CACHE.keys().next().value as string | undefined;
          if (oldest === undefined) break;
          imageCacheBytes -= IMAGE_CACHE.get(oldest)!.length;
          IMAGE_CACHE.delete(oldest);
        }
        IMAGE_CACHE.set(hash, data);
        imageCacheBytes += data.length;
      }
      return data;
    } catch (error) {
      warnings.push(
        `Attachment ${hash} could not be loaded: ${error instanceof Error ? error.message : String(error)}`
      );
      return undefined;
    }
  }

  private enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId);
    let expired: Error | undefined;
    const pending = (async () => {
      if (previous) await previous.catch(() => {});
      // 排队本身也计入期限，过期事实不能在磁盘恢复后迟到执行。https://github.com/ItsDalk-Lane/Scribe/issues/55
      if (expired) throw expired;
      return operation();
    })();
    this.queues.set(sessionId, pending);
    const finished = (): void => {
      if (this.queues.get(sessionId) === pending) this.queues.delete(sessionId);
    };
    void pending.then(finished, finished);
    return this.journal.waitForOperation(pending, (failure) => {
      expired = failure;
    });
  }
}
