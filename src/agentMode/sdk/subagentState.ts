import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { SubagentMessage, SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";
import type { JournalRecord } from "@/agentMode/sdk/JournalStorage";
import { isRecord } from "@/utils/obsidianInternals";

export interface NativeSubagentState {
  version: 1;
  snapshot: SubagentSessionSnapshot;
  context: AgentMessage[];
  contextSeqs?: number[];
  unconfirmedCommandIds?: string[];
  confirmedCommandIds?: string[];
  instructions?: string;
  allowedTools?: string[];
  manualSkills?: string[];
  automaticTaskIds: string[];
  revision: number;
}

export interface SubagentStateProjection {
  subagents: NativeSubagentState[];
  parentMessages: Array<{ seq: number; message: AgentMessage }>;
  writable: boolean;
  warnings: string[];
}

export function projectSubagentState(
  records: readonly JournalRecord[],
  validateMessage: (value: unknown) => value is AgentMessage
): SubagentStateProjection {
  const states = new Map<string, NativeSubagentState>();
  const stateSequences = new Map<string, number>();
  const delivered = new Map<string, number>();
  const parentMessages: SubagentStateProjection["parentMessages"] = [];
  const warnings: string[] = [];
  const stoppedTasks = new Set<string>();
  const header = records.find((record) => record.kind === "session_created")?.payload;
  for (const record of records) {
    const taskPayload = record.payload;
    if (
      record.kind === "subagent_task" &&
      isRecord(taskPayload) &&
      taskPayload.version === 1 &&
      isRecord(taskPayload.task) &&
      typeof taskPayload.task.id === "string" &&
      typeof taskPayload.task.active === "boolean"
    ) {
      if (taskPayload.task.active) stoppedTasks.delete(taskPayload.task.id);
      else stoppedTasks.add(taskPayload.task.id);
    }
    if (record.kind !== "subagent_state" && record.kind !== "subagent_delivery") {
      if (record.kind.startsWith("subagent_") && record.kind !== "subagent_task")
        warnings.push(
          `Subagent fact ${record.seq} has an unsupported kind; its original bytes were preserved.`
        );
      continue;
    }
    const payload = record.payload;
    if (!isRecord(payload) || payload.version !== 1) {
      warnings.push(
        `Subagent fact ${record.seq} has an unsupported format; its original bytes were preserved.`
      );
      continue;
    }
    if (record.kind === "subagent_state") {
      const state = payload.state;
      if (
        !validState(state, validateMessage) ||
        (isRecord(header) &&
          (state.snapshot.parentSessionId !== header.sessionId ||
            state.snapshot.cwd !== header.cwd ||
            state.snapshot.projectId !== header.projectId))
      ) {
        warnings.push(
          `Subagent fact ${record.seq} has invalid context or ownership; its original bytes were preserved.`
        );
        continue;
      }
      const previous = states.get(state.snapshot.id);
      // 旧运行的迟到快照不能覆盖较新的子上下文。https://github.com/ItsDalk-Lane/Scribe/issues/50
      if (previous && previous.revision >= state.revision) continue;
      states.set(state.snapshot.id, {
        ...state,
        context: [...state.context],
        automaticTaskIds: [],
        snapshot: {
          ...state.snapshot,
          messages: state.snapshot.messages.map((message) => ({ ...message })),
          runs: state.snapshot.runs.map((run) => ({ ...run, usage: { ...run.usage } })),
        },
      });
      stateSequences.set(state.snapshot.id, record.seq);
      continue;
    }
    const state =
      typeof payload.subagentId === "string" ? states.get(payload.subagentId) : undefined;
    if (
      !state ||
      !validateMessage(payload.message) ||
      !Array.isArray(payload.messageIds) ||
      !payload.messageIds.every(
        (id: unknown) =>
          typeof id === "string" &&
          state.snapshot.messages.some(
            (message) => message.id === id && message.direction === "to_parent"
          )
      ) ||
      (payload.resultId !== undefined &&
        (typeof payload.resultId !== "string" ||
          !state.snapshot.runs.some((run) => run.resultId === payload.resultId)))
    ) {
      warnings.push(
        `Subagent delivery ${record.seq} cannot be verified; its original bytes were preserved.`
      );
      continue;
    }
    const keys = [
      ...payload.messageIds.map((id: string) => `${state.snapshot.id}:message:${id}`),
      ...(typeof payload.resultId === "string"
        ? [`${state.snapshot.id}:result:${payload.resultId}`]
        : []),
    ];
    if (!keys.length) {
      warnings.push(`Subagent delivery ${record.seq} has no stable message or result identity.`);
      continue;
    }
    if (keys.every((key) => delivered.has(key))) continue;
    if (keys.some((key) => delivered.has(key))) {
      warnings.push(
        `Subagent delivery ${record.seq} overlaps an already delivered input; its original bytes were preserved.`
      );
      continue;
    }
    for (const key of keys) delivered.set(key, record.occurredAt);
    parentMessages.push({ seq: record.seq, message: payload.message });
  }
  for (const state of states.values())
    recoverChildContext(
      state,
      records,
      stateSequences.get(state.snapshot.id)!,
      validateMessage,
      warnings
    );
  const subagents = [...states.values()].map(
    (state): NativeSubagentState => ({
      ...state,
      snapshot: {
        ...state.snapshot,
        messages: state.snapshot.messages.map((message) => {
          // 关闭时接纳保存可能晚于停止事实，未进入上下文的旧指令仍必须撤回。https://github.com/ItsDalk-Lane/Scribe/issues/50
          if (
            message.direction === "to_child" &&
            message.state === "accepted" &&
            stoppedTasks.has(message.taskGenerationId)
          )
            return { ...message, state: "withdrawn" };
          const deliveredAt = delivered.get(`${state.snapshot.id}:message:${message.id}`);
          return deliveredAt !== undefined && message.state !== "withdrawn"
            ? { ...message, state: "delivered", deliveredAt }
            : message;
        }),
        runs: state.snapshot.runs.map((run) => {
          const resultDelivered =
            !!run.resultDelivered ||
            (run.resultId !== undefined &&
              delivered.has(`${state.snapshot.id}:result:${run.resultId}`));
          const terminal = ["completed", "failed", "stopped", "interrupted"].includes(run.status);
          return {
            ...run,
            ...(resultDelivered ? { resultDelivered: true, deliveryBlocked: false } : {}),
            ...(!terminal
              ? {
                  status: "interrupted" as const,
                  stopReason: "interrupted",
                  endedAt: run.endedAt ?? state.snapshot.updatedAt,
                }
              : {}),
          };
        }),
      },
    })
  );
  return { subagents, parentMessages, writable: warnings.length === 0, warnings };
}

function recoverChildContext(
  state: NativeSubagentState,
  records: readonly JournalRecord[],
  after: number,
  validateMessage: (value: unknown) => value is AgentMessage,
  warnings: string[]
): void {
  const runs = new Set(state.snapshot.runs.map((run) => run.id));
  const latestRunId = state.snapshot.runs.at(-1)?.id;
  const owners = new Map(
    records.flatMap((record) =>
      isRecord(record.payload) && typeof record.payload.taskId === "string"
        ? [[record.seq, record.payload.taskId] as const]
        : []
    )
  );
  const commands = new Set<string>();
  const admitted = new Set<string>();
  state.contextSeqs = state.contextSeqs ? [...state.contextSeqs] : state.context.map(() => -1);
  for (const record of records) {
    if (!isRecord(record.payload)) continue;
    const payload = record.payload;
    const owned =
      payload.subagentId === state.snapshot.id ||
      (typeof payload.taskId === "string" && runs.has(payload.taskId)) ||
      (typeof payload.runId === "string" && runs.has(payload.runId));
    if (owned && record.kind === "tool_admitted" && typeof payload.id === "string")
      admitted.add(
        `${typeof payload.taskId === "string" ? payload.taskId : typeof payload.runId === "string" ? payload.runId : latestRunId}:${payload.id}`
      );
    if (owned && record.kind === "task_admitted" && typeof payload.taskId === "string")
      commands.add(payload.taskId);
    if (
      record.kind === "event" &&
      record.origin === "observed" &&
      isRecord(payload.update) &&
      payload.update.sessionUpdate === "task_ended" &&
      typeof payload.update.taskId === "string"
    )
      commands.delete(payload.update.taskId);
    if (!owned || (record.kind !== "protocol_message" && record.kind !== "tool_result")) continue;
    if (!validateMessage(payload.message)) {
      warnings.push(
        `Child protocol fact ${record.seq} is unsupported; its original bytes were preserved.`
      );
      continue;
    }
    if (typeof payload.collaborationMessageId === "string")
      state.snapshot.messages = state.snapshot.messages.map((message) =>
        message.id === payload.collaborationMessageId && message.direction === "to_child"
          ? {
              ...message,
              state: "delivered",
              deliveredAt: record.occurredAt,
              deliverySeq: record.seq,
              runId: typeof payload.taskId === "string" ? payload.taskId : message.runId,
            }
          : message
      );
    if (record.seq <= after) continue;
    // 旧执行的迟到协议事实只保留在旧历史，不能污染新执行的上下文。https://github.com/ItsDalk-Lane/Scribe/issues/50
    if (typeof payload.taskId === "string" && payload.taskId !== latestRunId) continue;
    const message = payload.message;
    if (
      message.role === "toolResult" &&
      state.context.some(
        (existing) => existing.role === "toolResult" && existing.toolCallId === message.toolCallId
      )
    )
      continue;
    state.context.push(message);
    state.contextSeqs.push(record.seq);
  }
  const missing = new Map<string, { name: string; runId: string | undefined }>();
  for (const [index, message] of state.context.entries()) {
    if (message.role === "assistant")
      for (const part of message.content)
        if (part.type === "toolCall")
          missing.set(part.id, {
            name: part.name,
            runId: owners.get(state.contextSeqs[index]) ?? latestRunId,
          });
    if (message.role === "toolResult") missing.delete(message.toolCallId);
  }
  for (const [toolCallId, tool] of missing) {
    const text = admitted.has(`${tool.runId}:${toolCallId}`)
      ? "系统恢复：此操作已经开始，但执行结果未知。请核对实际文件或任务后再决定下一步，系统没有自动重做。"
      : "系统恢复：此操作尚未开始，没有执行变更，系统没有自动重做。";
    state.context.push({
      role: "toolResult",
      toolCallId,
      toolName: tool.name,
      isError: true,
      content: [{ type: "text", text }],
      timestamp: state.snapshot.updatedAt,
    });
    state.contextSeqs.push(-1);
  }
  for (const id of state.confirmedCommandIds ?? []) commands.delete(id);
  state.unconfirmedCommandIds = [...commands];
  if (commands.size)
    state.snapshot.recoveryBlocked = `原后台命令状态需要核对（${[...commands].join("、")}）。系统不会自动重新启动或终止这些命令。`;
}

function stringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string");
}

function finiteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function validState(
  value: unknown,
  validateMessage: (value: unknown) => value is AgentMessage
): value is NativeSubagentState {
  if (
    !isRecord(value) ||
    value.version !== 1 ||
    !Number.isSafeInteger(value.revision) ||
    (value.revision as number) < 0 ||
    !Array.isArray(value.context) ||
    !value.context.every(validateMessage) ||
    (value.contextSeqs !== undefined &&
      (!Array.isArray(value.contextSeqs) ||
        value.contextSeqs.length !== value.context.length ||
        !value.contextSeqs.every(
          (seq: unknown) => Number.isSafeInteger(seq) && (seq as number) >= -1
        ))) ||
    (value.unconfirmedCommandIds !== undefined && !stringList(value.unconfirmedCommandIds)) ||
    (value.confirmedCommandIds !== undefined && !stringList(value.confirmedCommandIds)) ||
    !stringList(value.automaticTaskIds) ||
    (value.instructions !== undefined && typeof value.instructions !== "string") ||
    (value.allowedTools !== undefined && !stringList(value.allowedTools)) ||
    (value.manualSkills !== undefined && !stringList(value.manualSkills)) ||
    !isRecord(value.snapshot)
  )
    return false;
  return isSubagentSnapshot(value.snapshot);
}

export function isSubagentSnapshot(snapshot: unknown): snapshot is SubagentSessionSnapshot {
  if (!isRecord(snapshot)) return false;
  return (
    ["id", "parentSessionId", "name", "modelId", "cwd"].every(
      (key) => typeof snapshot[key] === "string" && snapshot[key].length > 0
    ) &&
    (snapshot.projectId === undefined || typeof snapshot.projectId === "string") &&
    ["retained", "archived"].includes(snapshot.retention as string) &&
    finiteNumber(snapshot.createdAt) &&
    finiteNumber(snapshot.updatedAt) &&
    (snapshot.recoveryBlocked === undefined || typeof snapshot.recoveryBlocked === "string") &&
    Array.isArray(snapshot.runs) &&
    snapshot.runs.every(
      (run: unknown) =>
        isRecord(run) &&
        ["id", "taskGenerationId", "toolCallId"].every((key) => typeof run[key] === "string") &&
        [
          "queued",
          "running",
          "awaiting_approval",
          "awaiting_input",
          "stopping",
          "completed",
          "failed",
          "interrupted",
          "stopped",
        ].includes(run.status as string) &&
        finiteNumber(run.createdAt) &&
        ["startedAt", "endedAt"].every((key) => run[key] === undefined || finiteNumber(run[key])) &&
        ["resultId", "result", "stopReason"].every(
          (key) => run[key] === undefined || typeof run[key] === "string"
        ) &&
        (run.resultDelivered === undefined || typeof run.resultDelivered === "boolean") &&
        (run.deliveryBlocked === undefined || typeof run.deliveryBlocked === "boolean") &&
        isRecord(run.usage) &&
        ["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every((key) =>
          finiteNumber((run.usage as Record<string, unknown>)[key])
        )
    ) &&
    Array.isArray(snapshot.messages) &&
    snapshot.messages.every(
      (message: unknown) => isSubagentMessage(message) && message.subagentId === snapshot.id
    )
  );
}

export function isSubagentMessage(message: unknown): message is SubagentMessage {
  return (
    isRecord(message) &&
    ["id", "subagentId", "taskGenerationId", "text"].every(
      (key) => typeof message[key] === "string"
    ) &&
    (message.runId === undefined || typeof message.runId === "string") &&
    Number.isSafeInteger(message.sequence) &&
    (message.sequence as number) >= 0 &&
    ["to_parent", "to_child"].includes(message.direction as string) &&
    ["main", "user", "subagent"].includes(message.sender as string) &&
    ["instruction", "progress", "discovery", "question", "blocked", "result"].includes(
      message.kind as string
    ) &&
    ["accepted", "delivered", "withdrawn", "replied"].includes(message.state as string) &&
    finiteNumber(message.acceptedAt) &&
    (message.deliveredAt === undefined || finiteNumber(message.deliveredAt)) &&
    (message.deliverySeq === undefined ||
      (Number.isSafeInteger(message.deliverySeq) && (message.deliverySeq as number) >= 0)) &&
    (message.replyTo === undefined || typeof message.replyTo === "string") &&
    (message.payload === undefined ||
      (isRecord(message.payload) &&
        Array.isArray(message.payload.content) &&
        message.payload.content.every(
          (part: unknown) =>
            isRecord(part) &&
            ((part.type === "text" && typeof part.text === "string") ||
              (part.type === "resource_link" && typeof part.uri === "string") ||
              (part.type === "image" &&
                typeof part.mimeType === "string" &&
                (typeof part.data === "string" || typeof part.attachmentHash === "string")))
        ) &&
        (message.payload.context === undefined ||
          (isRecord(message.payload.context) &&
            Array.isArray(message.payload.context.notes) &&
            message.payload.context.notes.every((note: unknown) => typeof note === "string")))))
  );
}
