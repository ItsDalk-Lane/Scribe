import type { AgentMessageStore } from "@/agentMode/session/AgentMessageStore";
import {
  findToolCallPart,
  mergeToolCallUpdate,
  planToPart,
  toolCallToPart,
  upsertCompactionPart,
} from "@/agentMode/session/messageParts";
import {
  extractText,
  OUTPUT_LIMIT_CONTINUATION_PROMPT,
  stripUserMessageWrapper,
} from "@/agentMode/session/promptEnvelope";
import type { AgentPlanEntry, CompactionSnapshot, SessionEvent } from "@/agentMode/session/types";
import { formatPromptFailure } from "@/agentMode/session/promptFailure";
import { AI_SENDER, USER_SENDER } from "@/constants";
import { formatDateTime, type FormattedDateTime } from "@/utils";

export interface SessionHistoryReplayDeps {
  store: AgentMessageStore;
  scheduleNotifyMessages(): void;
  applyTodoList(entries: AgentPlanEntry[]): void;
}

export class SessionHistoryReplay {
  private open = false;
  private user: { wireId: string | undefined; raw: string; occurredAt?: number } | null = null;
  private aiId: string | null = null;
  private turnStartedAt: number | undefined;
  private promptId: string | undefined;
  private seq: number | undefined;
  private synthetic = false;
  private deliveredSequences = new Map<string, { seq?: number; occurredAt?: number }>();

  constructor(private readonly deps: SessionHistoryReplayDeps) {}

  start(): void {
    this.open = true;
  }

  isOpen(): boolean {
    return this.open;
  }

  append(
    update: SessionEvent["update"],
    occurredAt: number | undefined,
    seq?: number,
    origin?: SessionEvent["origin"]
  ): boolean {
    this.seq = seq;
    this.synthetic = origin === "synthetic";
    return this.deps.store.withRecordedTime(occurredAt, () => {
      if (!this.open || !this.appendFrame(update, occurredAt)) return false;
      this.extendTurn(occurredAt);
      return true;
    });
  }

  private appendFrame(update: SessionEvent["update"], occurredAt: number | undefined): boolean {
    switch (update.sessionUpdate) {
      case "agent_segment_started":
        if (this.seq !== undefined)
          this.deps.store.startAgentSegment(this.aiBubbleId(occurredAt), this.seq);
        return true;
      case "agent_thought_ended": {
        const id = this.deps.store.findMessageIdWithSegment(update.segmentSeq);
        if (id && this.deps.store.finishAgentThought(id, update.segmentSeq, update.contentIndex))
          this.deps.scheduleNotifyMessages();
        return true;
      }
      case "agent_segment_finalized": {
        const id =
          this.deps.store.findMessageIdWithSegment(update.segmentSeq) ??
          this.aiBubbleId(occurredAt);
        if (
          this.deps.store.finalizeAgentSegment(
            id,
            update.segmentSeq,
            update.blocks,
            this.seq,
            this.synthetic
          )
        )
          this.deps.scheduleNotifyMessages();
        return true;
      }
      case "message_delivered":
        this.deliveredSequences.set(update.promptId, { seq: this.seq, occurredAt });
        return true;
      case "turn_started":
        this.promptId = update.turnId;
        this.turnStartedAt = update.startedAt ?? occurredAt;
        return true;
      case "user_message_chunk": {
        const text = extractText(update.content);
        const current = this.user;
        if (current && update.messageId !== undefined && current.wireId === update.messageId) {
          current.raw += text;
          return true;
        }
        if (!text.trim()) return true;
        const deliveredAt =
          update.messageId === undefined
            ? undefined
            : this.deliveredSequences.get(update.messageId)?.occurredAt;
        this.flushUser();
        this.closeTurn(deliveredAt);
        this.user = { wireId: update.messageId, raw: text, occurredAt };
        this.promptId = update.messageId ?? this.promptId;
        this.turnStartedAt = deliveredAt ?? occurredAt;
        return true;
      }
      case "turn_ended": {
        this.flushUser();
        const elapsed =
          this.turnStartedAt !== undefined && occurredAt !== undefined
            ? Math.max(0, occurredAt - this.turnStartedAt)
            : undefined;
        if (update.error !== undefined && update.stopReason !== "cancelled") {
          if (
            this.deps.store.markMessageError(
              this.aiBubbleId(occurredAt),
              formatPromptFailure(update.error),
              elapsed
            )
          )
            this.deps.scheduleNotifyMessages();
        }
        // 后台记录可能是唯一恢复来源，未产生正文的停止也必须恢复其可见原因。https://github.com/ItsDalk-Lane/Scribe/issues/31
        if (
          (update.stopReason !== "end_turn" || this.aiId !== null) &&
          this.deps.store.markTurnComplete(
            this.aiBubbleId(occurredAt),
            update.stopReason,
            elapsed,
            update.taskGenerationId
          )
        ) {
          this.deps.scheduleNotifyMessages();
        }
        this.closeTurn();
        this.turnStartedAt = occurredAt;
        return true;
      }
      case "agent_message_chunk":
      case "agent_thought_chunk": {
        const text = extractText(update.content);
        if (!text) return true;
        const id = this.aiBubbleId(occurredAt);
        const appended =
          update.sessionUpdate === "agent_message_chunk"
            ? this.deps.store.appendAgentText(
                id,
                text,
                this.seq,
                this.synthetic,
                update.segmentSeq,
                update.contentIndex
              )
            : this.deps.store.appendAgentThought(
                id,
                text,
                this.seq,
                this.synthetic,
                update.segmentSeq,
                update.contentIndex
              );
        if (appended) this.deps.scheduleNotifyMessages();
        return true;
      }
      case "tool_call":
        if (
          this.deps.store.upsertAgentPart(this.aiBubbleId(occurredAt), {
            ...toolCallToPart(update),
            ...(this.seq === undefined ? {} : { seq: this.seq }),
            ...(this.synthetic ? { synthetic: true } : {}),
          })
        ) {
          this.deps.scheduleNotifyMessages();
        }
        return true;
      case "tool_call_update": {
        const id =
          this.deps.store.findMessageIdWithToolCall(update.toolCallId) ??
          this.aiBubbleId(occurredAt);
        const merged = mergeToolCallUpdate(
          findToolCallPart(this.deps.store, id, update.toolCallId),
          update
        );
        if (this.synthetic) merged.synthetic = true;
        if (this.deps.store.upsertAgentPart(id, merged)) this.deps.scheduleNotifyMessages();
        return true;
      }
      case "plan":
        if (this.deps.store.upsertAgentPart(this.aiBubbleId(occurredAt), planToPart(update))) {
          this.deps.scheduleNotifyMessages();
        }
        this.deps.applyTodoList(update.entries);
        return true;
      case "compaction": {
        const settled: CompactionSnapshot =
          update.status === "in_progress" ? { ...update, status: "cancelled" } : update;
        if (upsertCompactionPart(this.deps.store, this.aiBubbleId(occurredAt), settled)) {
          this.deps.scheduleNotifyMessages();
        }
        return true;
      }
      default:
        return false;
    }
  }

  private flushUser(): void {
    const pending = this.user;
    this.user = null;
    if (!pending) return;
    if (stripUserMessageWrapper(pending.raw).trim() === OUTPUT_LIMIT_CONTINUATION_PROMPT) return;
    this.deps.store.addMessage({
      ...(pending.wireId === undefined ? {} : { id: pending.wireId }),
      message: stripUserMessageWrapper(pending.raw),
      sender: USER_SENDER,
      timestamp: historyTimestamp(pending.occurredAt),
      isVisible: true,
    });
    this.deps.scheduleNotifyMessages();
  }

  private aiBubbleId(occurredAt: number | undefined): string {
    if (this.aiId) return this.aiId;
    this.flushUser();
    const startedAt = this.turnStartedAt;
    const delivery =
      this.promptId === undefined ? undefined : this.deliveredSequences.get(this.promptId);
    this.aiId = this.deps.store.addMessage({
      ...(this.promptId === undefined ? {} : { id: `assistant:${this.promptId}` }),
      ...(delivery?.seq === undefined ? {} : { seq: delivery.seq }),
      message: "",
      sender: AI_SENDER,
      timestamp: historyTimestamp(delivery?.occurredAt ?? occurredAt),
      isVisible: true,
      parts: [],
      turnDurationMs:
        startedAt === undefined || occurredAt === undefined
          ? undefined
          : Math.max(0, occurredAt - startedAt),
    });
    return this.aiId;
  }

  private extendTurn(occurredAt: number | undefined): void {
    const startedAt = this.turnStartedAt;
    if (!this.aiId || startedAt === undefined || occurredAt === undefined) return;
    if (this.deps.store.extendTurnDuration(this.aiId, occurredAt - startedAt)) {
      this.deps.scheduleNotifyMessages();
    }
  }

  end(): void {
    this.flushUser();
    this.open = false;
    this.closeTurn();
    this.turnStartedAt = undefined;
  }

  private closeTurn(endedAt?: number): void {
    if (this.aiId && endedAt !== undefined && this.turnStartedAt !== undefined) {
      this.deps.store.withRecordedTime(endedAt, () =>
        this.deps.store.markTurnComplete(this.aiId!, "end_turn", endedAt - this.turnStartedAt!)
      );
    }
    if (this.aiId && this.deps.store.settleOpenParts(this.aiId)) {
      this.deps.scheduleNotifyMessages();
    }
    this.aiId = null;
    this.promptId = undefined;
  }
}

function historyTimestamp(occurredAt: number | undefined): FormattedDateTime | null {
  return occurredAt === undefined ? null : formatDateTime(new Date(occurredAt));
}
