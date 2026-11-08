import type { TFile } from "obsidian";
import {
  buildPromptBlocks,
  buildUserDisplayContent,
  buildUserMessage,
  serializeWebTabContext,
} from "@/agentMode/session/promptEnvelope";
import {
  hydrateDisplayMessage,
  serializeDisplayMessage,
} from "@/agentMode/session/AgentDisplayFacts";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { t } from "@/lib/i18n";
import { formatDateTime } from "@/utils";
import type { MessageContext } from "@/types/message";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  BackendState,
  CurrentPlan,
  PermissionPrompt,
  PlanUsage,
  PromptContent,
  QueuedPrompt,
  SessionUsage,
} from "@/agentMode/session/types";
import { isSubagentRunActive } from "@/agentMode/session/subagentSessions";
import type {
  SubagentMessage,
  SubagentMessageKind,
  SubagentRunSnapshot,
  SubagentSendMode,
  SubagentSessionSnapshot,
} from "@/agentMode/session/subagentTypes";
import { STOP_REASONS } from "@/LLMProviders/modelUsageMetrics";
import { v4 as uuidv4 } from "uuid";

const EMPTY_MESSAGES = Object.freeze([]) as unknown as AgentChatMessage[];
const EMPTY_TASKS = Object.freeze([]) as unknown as AgentTask[];
const EMPTY_PROMPTS = Object.freeze([]) as unknown as QueuedPrompt[];

export const SUBAGENT_RUN_MESSAGE_PREFIX = "subagent-run:";

function runMessageId(runId: string, messageId: string): string {
  return `${SUBAGENT_RUN_MESSAGE_PREFIX}${runId}:${messageId}`;
}

function interjectionLabel(kind: SubagentMessageKind): string {
  return kind === "question" || kind === "blocked"
    ? t("Asking the parent agent")
    : t("Replying to the parent agent");
}

function mailboxEntry(
  message: SubagentMessage,
  resolveNote: (path: string) => TFile | null
): AgentChatMessage | null {
  const base = {
    timestamp: formatDateTime(new Date(message.acceptedAt)),
    isVisible: true,
  };
  if (message.direction === "to_child") {
    if (message.state === "accepted") return null;
    const entry: AgentChatMessage = {
      ...base,
      id: `subagent-in:${message.id}`,
      sender: USER_SENDER,
      message: message.text,
      isErrorMessage: message.state === "withdrawn",
      content: buildUserDisplayContent(message.text, message.payload?.content),
    };
    return message.payload?.context
      ? hydrateDisplayMessage({ ...entry, context: message.payload.context }, resolveNote)
      : entry;
  }
  if (message.kind === "result") return null;
  return {
    ...base,
    id: `subagent-out:${message.id}`,
    sender: AI_SENDER,
    synthetic: true,
    message: `${interjectionLabel(message.kind)}\n\n${message.text}`,
  };
}

export function buildSubagentTranscript(
  snapshot: SubagentSessionSnapshot,
  readRunMessages: (toolCallId: string) => readonly AgentChatMessage[],
  resolveNote: (path: string) => TFile | null = () => null
): AgentChatMessage[] {
  const runs = [...snapshot.runs].sort((a, b) => a.createdAt - b.createdAt);
  const childEntriesByRun = new Map<
    string,
    { message: SubagentMessage; entry: AgentChatMessage }[]
  >();
  const parentEntriesByRun = new Map<
    string,
    { message: SubagentMessage; entry: AgentChatMessage }[]
  >();
  const unanchored: AgentChatMessage[] = [];
  for (const message of snapshot.messages) {
    const entry = mailboxEntry(message, resolveNote);
    if (!entry) continue;
    const run =
      (message.runId && runs.find((candidate) => candidate.id === message.runId)) ||
      runs.find((candidate) => candidate.createdAt >= message.acceptedAt);
    if (!run) {
      unanchored.push(entry);
      continue;
    }
    if (message.direction === "to_child") {
      const entries = childEntriesByRun.get(run.id) ?? [];
      entries.push({ message, entry });
      childEntriesByRun.set(run.id, entries);
    } else {
      const entries = parentEntriesByRun.get(run.id) ?? [];
      entries.push({ message, entry });
      parentEntriesByRun.set(run.id, entries);
    }
  }
  const transcript: AgentChatMessage[] = [];
  for (const run of runs) {
    const childEntries = [...(childEntriesByRun.get(run.id) ?? [])];
    const legacyInputs = childEntries.filter(({ message }) => message.deliverySeq === undefined);
    transcript.push(...legacyInputs.map(({ entry }) => entry));
    const orderedInputs = childEntries
      .filter(({ message }) => message.deliverySeq !== undefined)
      .sort((a, b) => a.message.deliverySeq! - b.message.deliverySeq!);
    const parentEntries = [...(parentEntriesByRun.get(run.id) ?? [])];
    const runMessages = readRunMessages(run.toolCallId);
    if (
      !runMessages.some((message) =>
        message.parts?.some((part) => part.segmentSeq !== undefined || part.seq !== undefined)
      )
    ) {
      // 旧展示记录没有可比较的序号时，沿用原来的位置，不能用时间猜测。https://github.com/ItsDalk-Lane/Scribe/issues/50
      transcript.push(...orderedInputs.splice(0).map(({ entry }) => entry));
    }
    for (const message of runMessages) {
      let start = 0;
      const parts = message.parts ?? [];
      const appendParts = (end: number): void => {
        const slice = parts.slice(start, end);
        if (slice.length === 0) return;
        transcript.push({
          ...message,
          id: `${runMessageId(run.id, message.id)}:${start}`,
          parts: slice,
          turnMetrics: undefined,
          turnStopReason: undefined,
          turnDurationMs: undefined,
          message: slice.map((part) => (part.kind === "text" ? part.text : "")).join(""),
        });
        start = end;
      };
      for (const [index, part] of parts.entries()) {
        const position = part.segmentSeq ?? part.seq;
        // 已投递的补充消息应保留在实际执行位置，而不是挪到任务开头。https://github.com/ItsDalk-Lane/Scribe/issues/50
        while (
          position !== undefined &&
          orderedInputs.length &&
          orderedInputs[0].message.deliverySeq! < position
        ) {
          appendParts(index);
          transcript.push(orderedInputs.shift()!.entry);
        }
        if (part.kind !== "tool_call" || part.vendorToolName !== "send_parent_message") continue;
        const input = part.input as { text?: unknown; kind?: unknown } | null | undefined;
        const match = parentEntries.findIndex(
          ({ message: sent }) => sent.text === input?.text && sent.kind === input?.kind
        );
        if (match < 0) continue;
        // 进度必须出现在发送时的位置，避免最终结果显示在进度之前。https://github.com/ItsDalk-Lane/Scribe/issues/50
        appendParts(index + 1);
        transcript.push(parentEntries.splice(match, 1)[0].entry);
      }
      if (start === 0) transcript.push({ ...message, id: runMessageId(run.id, message.id) });
      else appendParts(parts.length);
    }
    transcript.push(...orderedInputs.map(({ entry }) => entry));
    transcript.push(...parentEntries.map(({ entry }) => entry));
  }
  transcript.push(...unanchored);
  return transcript;
}

export class SubagentChatBackend implements AgentChatBackend {
  constructor(
    private readonly parent: AgentChatBackend,
    private readonly subagentId: string,
    private readonly resolveNote: (path: string) => TFile | null = () => null
  ) {}

  getSnapshot(): SubagentSessionSnapshot | null {
    return (
      this.parent.getSubagentSessions?.().find((entry) => entry.id === this.subagentId) ?? null
    );
  }

  getActiveRun(): SubagentRunSnapshot | null {
    const active = this.getSnapshot()?.runs.filter((run) => isSubagentRunActive(run.status));
    return active && active.length > 0 ? active[active.length - 1] : null;
  }

  private isArchived(): boolean {
    return this.getSnapshot()?.retention === "archived";
  }

  isRecoveryBlocked(): boolean {
    return !!this.getSnapshot()?.recoveryBlocked;
  }

  async refresh(): Promise<void> {
    await this.parent.refreshSubagentSessions?.();
  }

  async stop(): Promise<void> {
    await this.parent.stopSubagent?.(this.subagentId);
  }

  async confirmRecovery(): Promise<void> {
    await this.parent.confirmSubagentRecovery?.(this.subagentId);
  }

  subscribe(listener: () => void): () => void {
    return this.parent.subscribe(listener);
  }

  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[]
  ): { id: string; turn: Promise<void> } {
    const id = uuidv4();
    const turn = (async () => {
      if (this.isArchived()) throw new Error(t("Unarchive this child session before continuing."));
      if (!this.getSnapshot()) throw new Error(t("This child session no longer exists."));
      const mode: SubagentSendMode = this.getActiveRun() ? "enqueue" : "wake";
      const web = await serializeWebTabContext(context);
      // 子聊天里的纯文字同样是用户输入，不能因没有附件而误走协作引用通道。https://github.com/ItsDalk-Lane/Scribe/issues/52
      const payload = {
        content: buildPromptBlocks(text, context, promptContent, web),
        context: serializeDisplayMessage({
          ...buildUserMessage(id, text, context, promptContent),
          id,
        }).context,
      };
      await this.parent.sendSubagentMessage?.(this.subagentId, text, mode, id, payload);
    })();
    return { id, turn };
  }

  acceptsMidTurnMessages(): boolean {
    return true;
  }

  getQueuedPrompts(): readonly QueuedPrompt[] {
    const snapshot = this.getSnapshot();
    if (!snapshot) return EMPTY_PROMPTS;
    return snapshot.messages
      .filter((message) => message.direction === "to_child" && message.state === "accepted")
      .map((message) => ({
        id: message.id,
        text:
          message.text ||
          (message.payload?.content.some((part) => part.type === "image")
            ? `[${t("Image attachment")}]`
            : ""),
      }));
  }

  getDeliveringPrompts(): readonly QueuedPrompt[] {
    return this.getActiveRun() ? this.getQueuedPrompts() : EMPTY_PROMPTS;
  }

  getHeldPrompts(): readonly QueuedPrompt[] {
    return this.getActiveRun() ? EMPTY_PROMPTS : this.getQueuedPrompts();
  }

  canWithdrawMessages(): boolean {
    return false;
  }

  async withdrawMessage(): Promise<void> {}

  takeWithdrawnPrompts(): readonly QueuedPrompt[] {
    return EMPTY_PROMPTS;
  }

  async sendWaitingNow(): Promise<void> {
    const message = this.getSnapshot()?.messages.find(
      (entry) => entry.direction === "to_child" && entry.state === "accepted"
    );
    if (!message) return;
    if (!this.parent.sendSubagentMessage)
      throw new Error(t("This child session cannot be continued in this chat."));
    await this.parent.sendSubagentMessage(
      this.subagentId,
      message.text,
      "wake",
      message.id,
      message.payload
    );
  }

  async deleteMessage(): Promise<boolean> {
    return false;
  }

  clearMessages(): void {}

  getMessages(): AgentChatMessage[] {
    const snapshot = this.getSnapshot();
    if (!snapshot) return EMPTY_MESSAGES;
    return buildSubagentTranscript(
      snapshot,
      (toolCallId) => this.parent.getTaskMessages(toolCallId),
      this.resolveNote
    ).map((message) => {
      if (message.sender === USER_SENDER) return message;
      const metrics = this.parent.getMessageUsageMetrics?.(message, true);
      const run = snapshot.runs.find((run) =>
        message.id.startsWith(`${SUBAGENT_RUN_MESSAGE_PREFIX}${run.id}:`)
      );
      const inputs = run
        ? snapshot.messages.filter(
            (input) =>
              input.direction === "to_child" &&
              input.runId === run.id &&
              input.state !== "accepted" &&
              input.state !== "withdrawn"
          )
        : [];
      // 只有一轮的原始执行可借用自己的开始结束记录；切片不能继承整段执行的耗时和成功状态。https://github.com/ItsDalk-Lane/Scribe/issues/52
      const completed =
        run &&
        !isSubagentRunActive(run.status) &&
        inputs.length <= 1 &&
        !inputs.some((input) => input.roundId && input.roundId !== run.roundId) &&
        (!metrics?.roundId || metrics.roundId === run.roundId);
      const reported = STOP_REASONS.find((reason) => reason === run?.stopReason);
      const reason = completed
        ? ((reported === "end_turn" && run.status !== "completed" ? undefined : reported) ??
          (run.status === "completed"
            ? "end_turn"
            : run.status === "stopped"
              ? "cancelled"
              : run.status === "interrupted"
                ? "interrupted"
                : "request_error"))
        : undefined;
      const duration =
        completed &&
        run.status !== "interrupted" &&
        run.startedAt !== undefined &&
        run.endedAt !== undefined &&
        run.endedAt >= run.startedAt
          ? run.endedAt - run.startedAt
          : undefined;
      return {
        ...message,
        turnMetrics: metrics,
        turnStopReason: metrics?.roundStopReason ?? reason,
        turnDurationMs: metrics?.roundDurationMs ?? duration,
      };
    });
  }

  getTasks(): readonly AgentTask[] {
    return EMPTY_TASKS;
  }

  getTaskMessages(): readonly AgentChatMessage[] {
    return EMPTY_MESSAGES;
  }

  canStopTasks(): boolean {
    return true;
  }

  async stopTask(): Promise<void> {
    await this.stop();
  }

  async cancel(): Promise<void> {
    await this.stop();
  }

  isStarting(): boolean {
    return false;
  }

  isTurnInFlight(): boolean {
    return false;
  }

  isReplyRunning(): boolean {
    return !!this.getActiveRun();
  }

  getBackendState(): BackendState | null {
    return null;
  }

  canSwitchModel(): boolean | null {
    return false;
  }

  canSwitchEffort(): boolean | null {
    return false;
  }

  canSwitchMode(): boolean | null {
    return false;
  }

  async resolvePlanProposal(): Promise<void> {}

  getCurrentPlan(): CurrentPlan | null {
    return null;
  }

  getCurrentTodoList(): AgentTodoListEntry[] | null {
    return null;
  }

  getSessionUsage(): SessionUsage | null {
    return this.parent.getSubagentUsage?.(this.subagentId) ?? null;
  }

  getPlanUsage(): PlanUsage | null {
    return null;
  }

  hasPendingPlanPermission(): boolean {
    return false;
  }

  getPendingToolPermissions(): PermissionPrompt[] {
    return this.parent
      .getPendingToolPermissions()
      .filter(
        (prompt) =>
          typeof prompt.requester === "object" && prompt.requester.subagentId === this.subagentId
      );
  }

  resolveToolPermission(toolCallId: string, optionId: string): void {
    this.parent.resolveToolPermission(toolCallId, optionId);
  }

  getPendingAskUserQuestions(): AskUserQuestionPrompt[] {
    return [];
  }

  resolveAskUserQuestion(): void {}
}
