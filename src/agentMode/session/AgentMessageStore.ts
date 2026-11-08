import { logInfo } from "@/logger";
import { t } from "@/lib/i18n";
import {
  AgentChatMessage,
  AgentMessagePart,
  AgentDisplayFact,
  AgentSegmentBlock,
  AgentToolCallOutput,
  NewAgentChatMessage,
  StopReason,
  TurnFileChange,
} from "@/agentMode/session/types";
import { FormattedDateTime, MessageContext } from "@/types/message";
import { formatDateTime } from "@/utils";

interface StoredAgentMessage {
  taskGenerationId?: string;
  seq?: number;
  synthetic?: boolean;
  id: string;
  displayText: string;
  sender: string;
  timestamp: FormattedDateTime | null;
  isVisible: boolean;
  isErrorMessage?: boolean;
  errorText?: string;
  parts?: AgentMessagePart[];
  context?: MessageContext;
  content?: unknown[];
  turnStopReason?: StopReason;
  turnDurationMs?: number;
  fileChanges?: TurnFileChange[];
  missingAttachments?: string[];
  version: number;
}

const MAX_COMPARE_JSON_CHARS = 8_000;
const EMPTY_DISPLAY_FACTS = Object.freeze([]) as unknown as AgentDisplayFact[];
const MAX_COMPARE_EDGE_CHARS = 512;
const MAX_COMPARE_TEXT_EDGE_CHARS = 128;

function isOpenPart(part: AgentMessagePart): boolean {
  if (part.kind === "compaction") return part.status === "in_progress";
  return part.kind === "tool_call" && part.status === "pending";
}

function agentPartId(part: AgentMessagePart): string | undefined {
  if (part.kind === "tool_call") return `tool:${part.id}`;
  if (part.kind === "plan") return "plan";
  if (part.kind === "compaction") return `compaction:${part.id}`;
  return undefined;
}

function partsEqual(a: AgentMessagePart, b: AgentMessagePart): boolean {
  if (a === b) return true;
  if (a.kind !== b.kind) return false;
  if (a.synthetic !== b.synthetic || a.seq !== b.seq) return false;

  switch (a.kind) {
    case "text":
      if (b.kind !== "text") return false;
      return a.text === b.text;
    case "thought":
      if (b.kind !== "thought") return false;
      return a.text === b.text && a.startedAtMs === b.startedAtMs && a.durationMs === b.durationMs;
    case "plan":
      if (b.kind !== "plan") return false;
      return planEntriesEqual(a.entries, b.entries);
    case "compaction":
      if (b.kind !== "compaction") return false;
      return (
        a.status === b.status &&
        a.trigger === b.trigger &&
        a.error === b.error &&
        a.preTokens === b.preTokens &&
        a.postTokens === b.postTokens &&
        a.summary === b.summary &&
        a.fromIndex === b.fromIndex &&
        a.toIndex === b.toIndex &&
        a.startedAtMs === b.startedAtMs
      );
    case "tool_call":
      if (b.kind !== "tool_call") return false;
      return (
        a.id === b.id &&
        a.title === b.title &&
        a.toolKind === b.toolKind &&
        a.status === b.status &&
        a.userResponse === b.userResponse &&
        a.vendorToolName === b.vendorToolName &&
        a.parentToolCallId === b.parentToolCallId &&
        toolProgressEqual(a.progress, b.progress) &&
        boundedValueEqual(a.input, b.input) &&
        locationsEqual(a.locations, b.locations) &&
        toolOutputsEqual(a.output, b.output)
      );
  }
}

function toolProgressEqual(
  a: Extract<AgentMessagePart, { kind: "tool_call" }>["progress"],
  b: Extract<AgentMessagePart, { kind: "tool_call" }>["progress"]
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  return (
    a.description === b.description &&
    a.toolName === b.toolName &&
    a.toolUses === b.toolUses &&
    a.durationMs === b.durationMs &&
    a.totalTokens === b.totalTokens
  );
}

function planEntriesEqual(
  a: Extract<AgentMessagePart, { kind: "plan" }>["entries"],
  b: Extract<AgentMessagePart, { kind: "plan" }>["entries"]
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  return a.every(
    (entry, index) =>
      entry.content === b[index].content &&
      entry.priority === b[index].priority &&
      entry.status === b[index].status
  );
}

function locationsEqual(
  a: Extract<AgentMessagePart, { kind: "tool_call" }>["locations"],
  b: Extract<AgentMessagePart, { kind: "tool_call" }>["locations"]
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;
  return a.every((loc, index) => loc.path === b[index].path && loc.line === b[index].line);
}

function toolOutputsEqual(
  a: AgentToolCallOutput[] | undefined,
  b: AgentToolCallOutput[] | undefined
): boolean {
  if (a === b) return true;
  if (!a || !b) return a === b;
  if (a.length !== b.length) return false;

  return a.every((output, index) => {
    const other = b[index];
    if (output.type !== other.type) return false;
    if (output.type === "diff" && other.type === "diff") {
      return (
        output.path === other.path &&
        output.oldText === other.oldText &&
        output.newText === other.newText
      );
    }
    if (output.type === "text" && other.type === "text") {
      return textFingerprint(output.text) === textFingerprint(other.text);
    }
    return false;
  });
}

function boundedValueEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  return valueFingerprint(a) === valueFingerprint(b);
}

function valueFingerprint(value: unknown): string {
  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    json = String(value);
  }
  if (json.length <= MAX_COMPARE_JSON_CHARS) return json;
  return `${json.length}:${json.slice(0, MAX_COMPARE_EDGE_CHARS)}:${json.slice(
    -MAX_COMPARE_EDGE_CHARS
  )}`;
}

function textFingerprint(text: string): string {
  if (text.length <= MAX_COMPARE_TEXT_EDGE_CHARS * 2) return text;
  return `${text.length}:${text.slice(0, MAX_COMPARE_TEXT_EDGE_CHARS)}:${text.slice(
    -MAX_COMPARE_TEXT_EDGE_CHARS
  )}`;
}

export class AgentMessageStore {
  private messages: StoredAgentMessage[] = [];
  private displayCache = new Map<string, { version: number; view: AgentChatMessage }>();
  private lastDisplay: AgentChatMessage[] | null = null;
  private displayFacts: AgentDisplayFact[] = [];
  private recordedTime: number | undefined;
  private segments = new Map<number, { messageId: string; startIndex: number }>();

  withRecordedTime<T>(occurredAt: number | undefined, operation: () => T): T {
    const previous = this.recordedTime;
    this.recordedTime = occurredAt ?? previous;
    try {
      return operation();
    } finally {
      this.recordedTime = previous;
    }
  }

  private currentTime(): number {
    return this.recordedTime ?? Date.now();
  }

  private generateId(): string {
    return `msg-${this.currentTime()}-${Math.random().toString(36).substring(2, 11)}`;
  }

  private touch(msg: StoredAgentMessage): void {
    msg.version += 1;
    this.lastDisplay = null;
  }

  private finishTrailingThought(msg: StoredAgentMessage): boolean {
    const last = msg.parts?.[msg.parts.length - 1];
    if (
      !last ||
      last.kind !== "thought" ||
      last.startedAtMs === undefined ||
      (last.durationMs !== undefined && msg.turnStopReason === undefined)
    ) {
      return false;
    }
    const durationMs = Math.max(last.durationMs ?? 0, this.currentTime() - last.startedAtMs);
    if (last.durationMs === durationMs) return false;
    msg.parts = msg.parts!.map((part) => (part === last ? { ...last, durationMs } : part));
    return true;
  }

  addMessage(message: NewAgentChatMessage): string {
    const id = message.id || this.generateId();
    const timestamp =
      message.timestamp === null
        ? null
        : message.timestamp || formatDateTime(new Date(this.currentTime()));
    this.messages.push({
      seq: message.seq,
      synthetic: message.synthetic,
      id,
      displayText: message.message,
      sender: message.sender,
      timestamp,
      context: message.context,
      missingAttachments: message.missingAttachments,
      isVisible: message.isVisible !== false,
      isErrorMessage: message.isErrorMessage,
      errorText: message.errorText,
      content: message.content,
      parts: message.parts,
      turnStopReason: message.turnStopReason,
      taskGenerationId: message.taskGenerationId,
      turnDurationMs: message.turnDurationMs,
      version: 0,
    });
    this.lastDisplay = null;
    return id;
  }

  markTurnComplete(
    id: string,
    stopReason: StopReason,
    durationMs?: number,
    taskGenerationId?: string
  ): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (msg.turnStopReason !== undefined) return false;
    this.finishTrailingThought(msg);
    msg.turnStopReason = stopReason;
    msg.taskGenerationId = taskGenerationId;
    if (durationMs !== undefined) msg.turnDurationMs = Math.max(0, durationMs);
    this.touch(msg);
    return true;
  }

  extendTurnDuration(id: string, durationMs: number): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg || msg.turnDurationMs === undefined) return false;
    const nextDurationMs = Math.max(0, durationMs);
    if (nextDurationMs <= msg.turnDurationMs) return false;
    msg.turnDurationMs = nextDurationMs;
    this.touch(msg);
    return true;
  }

  fillMissingTimestamps(saved: readonly AgentChatMessage[]): void {
    const visible = this.messages.filter((m) => m.isVisible);
    for (let i = 0; i < visible.length && i < saved.length; i++) {
      const msg = visible[i];
      if (msg.sender !== saved[i].sender) return;
      const timestamp = saved[i].timestamp;
      if (msg.timestamp || !timestamp) continue;
      msg.timestamp = timestamp;
      this.touch(msg);
    }
  }

  setFileChanges(id: string, changes: TurnFileChange[]): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.fileChanges = changes;
    this.displayFacts.push({
      kind: "message_metadata",
      messageId: id,
      metadata: { fileChanges: changes },
    });
    this.touch(msg);
    return true;
  }

  appendDisplayText(id: string, chunk: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    msg.displayText += chunk;
    this.touch(msg);
    return true;
  }

  appendAgentText(
    id: string,
    text: string,
    seq?: number,
    synthetic?: boolean,
    segmentSeq?: number,
    contentIndex?: number
  ): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (segmentSeq !== undefined && contentIndex !== undefined)
      return this.appendSegmentBlock(msg, "text", text, segmentSeq, contentIndex, seq, synthetic);
    msg.displayText += text;
    if (!msg.parts) msg.parts = [];
    this.finishTrailingThought(msg);
    const last = msg.parts[msg.parts.length - 1];
    if (last && last.kind === "text") {
      msg.parts = msg.parts.map((part) =>
        part === last ? { ...last, text: last.text + text } : part
      );
    } else {
      msg.parts = [
        ...msg.parts,
        {
          kind: "text",
          text,
          ...(seq === undefined ? {} : { seq }),
          ...(synthetic ? { synthetic } : {}),
        },
      ];
    }
    this.touch(msg);
    return true;
  }

  appendAgentThought(
    id: string,
    text: string,
    seq?: number,
    synthetic?: boolean,
    segmentSeq?: number,
    contentIndex?: number
  ): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (segmentSeq !== undefined && contentIndex !== undefined)
      return this.appendSegmentBlock(
        msg,
        "thought",
        text,
        segmentSeq,
        contentIndex,
        seq,
        synthetic
      );
    if (!msg.parts) msg.parts = [];
    const last = msg.parts[msg.parts.length - 1];
    if (
      last &&
      last.kind === "thought" &&
      (last.durationMs === undefined || msg.turnStopReason !== undefined)
    ) {
      msg.parts = msg.parts.map((part) =>
        part === last
          ? {
              ...last,
              text: last.text + text,
              ...(msg.turnStopReason !== undefined && last.startedAtMs !== undefined
                ? { durationMs: Math.max(0, this.currentTime() - last.startedAtMs) }
                : {}),
            }
          : part
      );
    } else {
      const startedAtMs = this.currentTime();
      msg.parts = [
        ...msg.parts,
        {
          kind: "thought",
          text,
          startedAtMs,
          ...(seq === undefined ? {} : { seq }),
          ...(synthetic ? { synthetic } : {}),
          ...(msg.turnStopReason !== undefined ? { durationMs: 0 } : {}),
        },
      ];
    }
    this.touch(msg);
    return true;
  }

  upsertAgentPart(id: string, part: AgentMessagePart): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (!msg.parts) msg.parts = [];
    const partId = agentPartId(part);
    if (partId !== undefined) {
      const idx = msg.parts.findIndex((p) => agentPartId(p) === partId);
      if (idx !== -1) {
        const finishedThought = part.kind === "plan" && this.finishTrailingThought(msg);
        if (partsEqual(msg.parts[idx], part)) {
          if (finishedThought) this.touch(msg);
          return finishedThought;
        }
        msg.parts = msg.parts.map((previous, index) => (index === idx ? part : previous));
        this.touch(msg);
        return true;
      }
    }
    this.finishTrailingThought(msg);
    msg.parts = [...msg.parts, part];
    this.touch(msg);
    return true;
  }

  settleOpenParts(id: string, status: "cancelled" | "failed" = "cancelled"): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg?.parts?.some(isOpenPart)) return false;
    msg.parts = msg.parts.map((p) =>
      !isOpenPart(p)
        ? p
        : p.kind === "compaction"
          ? { ...p, status }
          : { ...p, status: "failed" as const }
    );
    this.touch(msg);
    return true;
  }

  stopToolCalls(id: string, keepToolCallIds: ReadonlySet<string>): boolean {
    const msg = this.messages.find((m) => m.id === id);
    const stops = (p: AgentMessagePart): boolean =>
      p.kind === "tool_call" &&
      (p.status === "pending" || p.status === "in_progress") &&
      !keepToolCallIds.has(p.id);
    if (!msg?.parts?.some(stops)) return false;
    msg.parts = msg.parts.map((p) => (stops(p) ? { ...p, status: "cancelled" as const } : p));
    this.touch(msg);
    return true;
  }

  findMessageIdWithToolCall(toolCallId: string): string | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const msg = this.messages[i];
      if (msg.parts?.some((p) => p.kind === "tool_call" && p.id === toolCallId)) return msg.id;
    }
    return undefined;
  }

  markMessageError(id: string, errorText: string, durationMs?: number): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    this.finishTrailingThought(msg);
    msg.isErrorMessage = true;
    if (durationMs !== undefined) msg.turnDurationMs = Math.max(0, durationMs);
    const suffix = msg.displayText.length > 0 ? "\n\n" : "";
    msg.errorText = `**${t("Error:")}** ${errorText}`;
    msg.displayText += `${suffix}${msg.errorText}`;
    this.touch(msg);
    return true;
  }

  hasAssistantActivity(id: string): boolean {
    const msg = this.messages.find((m) => m.id === id);
    if (!msg) return false;
    if (msg.displayText.trim().length > 0) return true;
    return (msg.parts ?? []).some((part) => {
      if (part.kind === "text" || part.kind === "thought") {
        return part.text.trim().length > 0;
      }
      return true;
    });
  }

  deleteMessage(id: string): boolean {
    const idx = this.messages.findIndex((m) => m.id === id);
    if (idx === -1) return false;
    this.messages.splice(idx, 1);
    this.displayFacts.push({ kind: "message_deleted", messageId: id });
    this.displayCache.delete(id);
    this.lastDisplay = null;
    return true;
  }

  clear(): void {
    if (this.messages.length > 0) this.displayFacts.push({ kind: "messages_cleared" });
    this.messages = [];
    this.segments.clear();
    this.displayCache.clear();
    this.lastDisplay = null;
  }

  truncateAfterMessageId(messageId: string): void {
    const idx = this.messages.findIndex((m) => m.id === messageId);
    if (idx !== -1) {
      for (const dropped of this.messages.slice(idx + 1)) {
        this.displayCache.delete(dropped.id);
      }
      this.messages = this.messages.slice(0, idx + 1);
      this.lastDisplay = null;
    }
  }

  getDisplayMessages(): AgentChatMessage[] {
    if (this.lastDisplay !== null) return this.lastDisplay;
    const display = this.messages.filter((m) => m.isVisible).map((m) => this.adaptCached(m));
    this.lastDisplay = display;
    return display;
  }

  getMessage(id: string): AgentChatMessage | undefined {
    const msg = this.messages.find((m) => m.id === id);
    return msg ? this.adaptCached(msg) : undefined;
  }

  private adaptCached(m: StoredAgentMessage): AgentChatMessage {
    const cached = this.displayCache.get(m.id);
    if (cached && cached.version === m.version) return cached.view;
    const view = this.toAgentChatMessage(m);
    this.displayCache.set(m.id, { version: m.version, view });
    return view;
  }

  loadMessages(messages: AgentChatMessage[]): void {
    this.clear();
    this.displayFacts = [];
    for (const msg of messages) {
      this.messages.push({
        seq: msg.seq,
        synthetic: msg.synthetic,
        id: msg.id || this.generateId(),
        displayText: msg.message,
        sender: msg.sender,
        timestamp: msg.timestamp,
        context: msg.context,
        missingAttachments: msg.missingAttachments,
        fileChanges: msg.fileChanges,
        isVisible: msg.isVisible !== false,
        isErrorMessage: msg.isErrorMessage,
        errorText: msg.errorText,
        content: msg.content,
        parts: msg.parts,
        turnStopReason: msg.turnStopReason,
        taskGenerationId: msg.taskGenerationId,
        turnDurationMs: msg.turnDurationMs,
        version: 0,
      });
    }
    logInfo(`[AgentMessageStore] Loaded ${messages.length} messages`);
  }

  private toAgentChatMessage(m: StoredAgentMessage): AgentChatMessage {
    return {
      ...(m.seq === undefined ? {} : { seq: m.seq }),
      ...(m.synthetic ? { synthetic: true } : {}),
      id: m.id,
      message: m.displayText,
      sender: m.sender,
      timestamp: m.timestamp,
      isVisible: m.isVisible,
      context: m.context,
      missingAttachments: m.missingAttachments,
      isErrorMessage: m.isErrorMessage,
      errorText: m.errorText,
      content: m.content,
      parts: m.parts,
      turnStopReason: m.turnStopReason,
      ...(m.taskGenerationId ? { taskGenerationId: m.taskGenerationId } : {}),
      turnDurationMs: m.turnDurationMs,
      fileChanges: m.fileChanges,
    };
  }

  takeDisplayFacts(): AgentDisplayFact[] {
    if (!this.displayFacts.length) return EMPTY_DISPLAY_FACTS;
    const facts = this.displayFacts;
    this.displayFacts = [];
    return facts;
  }

  restoreDisplayFacts(facts: AgentDisplayFact[]): void {
    this.displayFacts = [...facts, ...this.displayFacts];
  }

  identifyMessage(id: string, nextId: string, seq?: number, occurredAt?: number): void {
    const message = this.messages.find((item) => item.id === id);
    if (!message) return;
    this.displayCache.delete(id);
    message.id = nextId;
    if (id !== nextId)
      for (const segment of this.segments.values())
        if (segment.messageId === id) segment.messageId = nextId;
    if (seq !== undefined) message.seq = seq;
    if (occurredAt !== undefined) message.timestamp = formatDateTime(new Date(occurredAt));
    this.touch(message);
  }

  startAgentSegment(id: string, segmentSeq: number): void {
    const message = this.messages.find((item) => item.id === id);
    if (message && !this.segments.has(segmentSeq))
      this.segments.set(segmentSeq, { messageId: id, startIndex: message.parts?.length ?? 0 });
  }

  findMessageIdWithSegment(segmentSeq: number): string | undefined {
    return this.segments.get(segmentSeq)?.messageId;
  }

  private appendSegmentBlock(
    message: StoredAgentMessage,
    kind: "text" | "thought",
    text: string,
    segmentSeq: number,
    contentIndex: number,
    seq?: number,
    synthetic?: boolean
  ): boolean {
    this.startAgentSegment(message.id, segmentSeq);
    const start = this.segments.get(segmentSeq)!.startIndex;
    const existing = message.parts?.find(
      (part, index) =>
        index >= start &&
        part.segmentSeq === segmentSeq &&
        part.contentIndex === contentIndex &&
        part.kind === kind
    );
    if (!existing || kind === "text") this.finishTrailingThought(message);
    const parts = message.parts ?? [];
    if (existing && (existing.kind === "text" || existing.kind === "thought")) {
      const replacement = {
        ...existing,
        text: existing.text + text,
        ...(existing.kind === "thought" &&
        message.turnStopReason !== undefined &&
        existing.startedAtMs !== undefined
          ? { durationMs: Math.max(0, this.currentTime() - existing.startedAtMs) }
          : {}),
      };
      message.parts = parts.map((part) => (part === existing ? replacement : part));
    } else {
      const part: AgentMessagePart = {
        kind,
        text,
        segmentSeq,
        contentIndex,
        ...(seq === undefined ? {} : { seq }),
        ...(synthetic ? { synthetic } : {}),
        ...(kind === "thought"
          ? {
              startedAtMs: this.currentTime(),
              ...(message.turnStopReason === undefined ? {} : { durationMs: 0 }),
            }
          : {}),
      };
      const nextIndex = parts.findIndex(
        (candidate, index) =>
          index >= start &&
          candidate.segmentSeq === segmentSeq &&
          candidate.contentIndex !== undefined &&
          candidate.contentIndex > contentIndex
      );
      const insertion = nextIndex < 0 ? parts.length : nextIndex;
      message.parts = [...parts.slice(0, insertion), part, ...parts.slice(insertion)];
    }
    this.syncSegmentText(message);
    this.touch(message);
    return true;
  }

  finalizeAgentSegment(
    id: string,
    segmentSeq: number,
    blocks: AgentSegmentBlock[],
    finalSeq?: number,
    synthetic?: boolean
  ): boolean {
    const message = this.messages.find((item) => item.id === id);
    if (!message) return false;
    this.startAgentSegment(id, segmentSeq);
    const start = this.segments.get(segmentSeq)!.startIndex;
    const thoughtFinished = this.finishTrailingThought(message);
    const parts = message.parts ?? [];
    const belongs = (part: AgentMessagePart, index: number) =>
      index >= start &&
      part.segmentSeq === segmentSeq &&
      (part.kind === "text" || part.kind === "thought");
    const originals = parts.filter(belongs);
    const confirmed: AgentMessagePart[] = blocks.map((block) => {
      const existing = originals.find(
        (part) => part.contentIndex === block.contentIndex && part.kind === block.kind
      );
      if (existing && (existing.kind === "text" || existing.kind === "thought"))
        return existing.text === block.text ? existing : { ...existing, text: block.text };
      return {
        ...block,
        segmentSeq,
        ...(finalSeq === undefined ? {} : { seq: finalSeq }),
        ...(synthetic ? { synthetic } : {}),
      };
    });
    const preserved = parts.filter((part, index) => !belongs(part, index));
    const next = [...preserved.slice(0, start), ...confirmed, ...preserved.slice(start)];
    if (
      !thoughtFinished &&
      next.length === parts.length &&
      next.every((part, index) => part === parts[index])
    )
      return false;
    message.parts = next;
    const delta = confirmed.length - originals.length;
    for (const [otherSeq, segment] of this.segments) {
      if (
        segment.messageId === id &&
        (segment.startIndex > start || (segment.startIndex === start && otherSeq > segmentSeq))
      )
        segment.startIndex += delta;
    }
    this.syncSegmentText(message);
    this.touch(message);
    return true;
  }

  private syncSegmentText(message: StoredAgentMessage): void {
    const text = (message.parts ?? [])
      .flatMap((part) => (part.kind === "text" ? [part.text] : []))
      .join("");
    message.displayText = message.errorText
      ? `${text}${text ? "\n\n" : ""}${message.errorText}`
      : text;
  }
}
