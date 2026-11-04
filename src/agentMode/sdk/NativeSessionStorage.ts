import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { validate as isUuid } from "uuid";
import { createNodeSnapshotStorage } from "@/agentMode/session/nodeFileStorage";
import type { SessionEvent, SessionUpdate } from "@/agentMode/session/types";
import type {
  NativeSessionRecord,
  NativeSessionStorage,
} from "@/agentMode/sdk/NativeBackendProcess";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { isRecord } from "@/utils/obsidianInternals";

const INTERRUPTED =
  "Scribe stopped before this operation finished. Its outcome may be unknown. Check the actual files or tasks before retrying; it was not automatically resumed.";
const EFFORTS = new Set(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
const MODES = new Set(["default", "plan", "auto"]);
const STOP_REASONS = new Set([
  "pending",
  "stop",
  "length",
  "toolUse",
  "error",
  "aborted",
  "deferred",
]);
const TERMINAL_TOOL_STATUSES = new Set(["completed", "failed", "cancelled"]);

function validId(id: string): boolean {
  return id.startsWith("native-") && isUuid(id.slice("native-".length));
}

function validContent(content: unknown, allowed: Set<string>): boolean {
  return (
    Array.isArray(content) &&
    content.every((part: unknown) => {
      if (!isRecord(part) || typeof part.type !== "string" || !allowed.has(part.type)) return false;
      if (part.type === "text") return typeof part.text === "string";
      if (part.type === "thinking") return typeof part.thinking === "string";
      if (part.type === "image")
        return typeof part.data === "string" && typeof part.mimeType === "string";
      return (
        typeof part.id === "string" &&
        typeof part.name === "string" &&
        isRecord(part.arguments) &&
        !Array.isArray(part.arguments)
      );
    })
  );
}

function validMessage(value: unknown): value is AgentMessage {
  if (!isRecord(value) || typeof value.timestamp !== "number" || !Number.isFinite(value.timestamp))
    return false;
  if (value.role === "system" || value.role === "user") {
    return (
      typeof value.content === "string" ||
      validContent(value.content, new Set(value.role === "system" ? ["text"] : ["text", "image"]))
    );
  }
  if (value.role === "assistant") {
    const usage = value.usage;
    return (
      validContent(value.content, new Set(["text", "thinking", "toolCall"])) &&
      typeof value.api === "string" &&
      typeof value.provider === "string" &&
      typeof value.model === "string" &&
      typeof value.stopReason === "string" &&
      STOP_REASONS.has(value.stopReason) &&
      isRecord(usage) &&
      isRecord(usage.cost) &&
      ["input", "output", "cacheRead", "cacheWrite", "totalTokens"].every(
        (key) => typeof usage[key] === "number" && Number.isFinite(usage[key])
      )
    );
  }
  if (value.role === "toolResult") {
    return (
      typeof value.toolCallId === "string" &&
      typeof value.toolName === "string" &&
      typeof value.isError === "boolean" &&
      validContent(value.content, new Set(["text", "image"]))
    );
  }
  return false;
}

function validEvent(value: unknown, sessionId: string): value is SessionEvent {
  return (
    isRecord(value) &&
    value.sessionId === sessionId &&
    isRecord(value.update) &&
    typeof value.update.sessionUpdate === "string"
  );
}

function validRecord(value: unknown, sessionId: string): value is NativeSessionRecord {
  if (!isRecord(value)) return false;
  const path = requireNodeModule<typeof import("node:path")>("path");
  return (
    value.version === 1 &&
    value.backendId === "native" &&
    value.sessionId === sessionId &&
    typeof value.cwd === "string" &&
    path.isAbsolute(value.cwd) &&
    (value.projectId === undefined || typeof value.projectId === "string") &&
    typeof value.modelId === "string" &&
    value.modelId.length > 0 &&
    (value.effort === null || (typeof value.effort === "string" && EFFORTS.has(value.effort))) &&
    typeof value.mode === "string" &&
    MODES.has(value.mode) &&
    typeof value.updatedAt === "number" &&
    Number.isFinite(value.updatedAt) &&
    Array.isArray(value.messages) &&
    value.messages.every(validMessage) &&
    Array.isArray(value.events) &&
    value.events.every((event: unknown) => validEvent(event, sessionId))
  );
}

function recoverInterrupted(record: NativeSessionRecord): NativeSessionRecord {
  const missing = new Map<string, { name: string; timestamp: number }>();
  for (const message of record.messages) {
    if (message.role === "assistant") {
      for (const part of message.content) {
        if (part.type === "toolCall")
          missing.set(part.id, { name: part.name, timestamp: message.timestamp });
      }
    } else if (message.role === "toolResult") {
      missing.delete(message.toolCallId);
    }
  }
  const messages = [...record.messages];
  for (const [toolCallId, call] of missing) {
    messages.push({
      role: "toolResult",
      toolCallId,
      toolName: call.name,
      content: [{ type: "text", text: INTERRUPTED }],
      isError: true,
      timestamp: Math.max(record.updatedAt, call.timestamp),
    });
  }
  const tools = new Map<string, SessionEvent>();
  const tasks = new Map<string, SessionEvent>();
  const turns = new Map<string, SessionEvent>();
  const compactions = new Map<string, SessionEvent>();
  for (const event of record.events) {
    const update = event.update;
    if (update.sessionUpdate === "tool_call" || update.sessionUpdate === "tool_call_update") {
      if (update.status && TERMINAL_TOOL_STATUSES.has(update.status))
        tools.delete(update.toolCallId);
      else tools.set(update.toolCallId, event);
    } else if (update.sessionUpdate === "task_started" && update.taskId) {
      tasks.set(update.taskId, event);
    } else if (update.sessionUpdate === "task_ended") {
      tasks.delete(update.taskId);
    } else if (update.sessionUpdate === "compaction") {
      if (update.status === "in_progress") compactions.set(update.id, event);
      else compactions.delete(update.id);
    } else if (update.sessionUpdate === "turn_started") {
      turns.set(update.turnId, event);
    } else if (update.sessionUpdate === "turn_ended") {
      turns.delete(update.turnId);
    }
  }
  const events = [...record.events];
  function append(update: SessionUpdate, source: SessionEvent): void {
    events.push({
      sessionId: record.sessionId,
      update,
      occurredAt: record.updatedAt,
      ...(source.taskToolCallId ? { taskToolCallId: source.taskToolCallId } : {}),
    });
  }
  for (const [toolCallId, source] of tools)
    append(
      {
        sessionUpdate: "tool_call_update",
        toolCallId,
        status: "failed",
        content: [{ type: "content", content: { type: "text", text: INTERRUPTED } }],
      },
      source
    );
  for (const [taskId, source] of tasks)
    append(
      { sessionUpdate: "task_ended", taskId, status: "stopped", summary: INTERRUPTED },
      source
    );
  for (const [turnId, source] of turns)
    append({ sessionUpdate: "turn_ended", turnId, stopReason: "cancelled" }, source);
  for (const [id, source] of compactions) {
    if (source.update.sessionUpdate === "compaction")
      append(
        {
          sessionUpdate: "compaction",
          id,
          trigger: source.update.trigger,
          status: "cancelled",
          error: INTERRUPTED,
        },
        source
      );
  }
  return { ...record, messages, events };
}

export class NodeNativeSessionStorage implements NativeSessionStorage {
  private readonly storage = createNodeSnapshotStorage();
  private readonly writes = new Map<string, Promise<void>>();
  private readonly unreadable = new Set<string>();

  constructor(private readonly directory: string) {
    const path = requireNodeModule<typeof import("node:path")>("path");
    if (!path.isAbsolute(directory))
      throw new Error("The native session storage directory must be absolute.");
  }

  save(record: NativeSessionRecord): Promise<void> {
    const destination = this.path(record.sessionId);
    if (!validRecord(record, record.sessionId))
      return Promise.reject(new Error("Invalid or unsupported native session record."));
    if (this.unreadable.has(destination))
      return Promise.reject(
        new Error("Preserving an unreadable native session record; it cannot be overwritten.")
      );
    const content = JSON.stringify(record, (_key, value: unknown) =>
      value instanceof Error
        ? { name: value.name, message: value.message, stack: value.stack }
        : value
    );
    return this.enqueue(destination, () => this.storage.write(destination, content));
  }

  async remove(sessionId: string): Promise<void> {
    const destination = this.path(sessionId);
    await this.enqueue(destination, async () => {
      await this.storage.remove(destination);
      this.unreadable.delete(destination);
    });
  }

  async load(sessionId: string): Promise<NativeSessionRecord | null> {
    const destination = this.path(sessionId);
    await this.writes.get(destination)?.catch(() => {});
    try {
      const parsed: unknown = JSON.parse(await this.storage.read(destination));
      if (!validRecord(parsed, sessionId))
        throw new Error("Invalid or unsupported native session record.");
      for (const event of parsed.events) {
        const update = event.update;
        if (
          update.sessionUpdate === "turn_ended" ||
          update.sessionUpdate === "session_disconnected"
        ) {
          const saved = update.error;
          if (isRecord(saved) && typeof saved.message === "string") {
            const error = new Error(saved.message);
            if (typeof saved.name === "string") error.name = saved.name;
            if (typeof saved.stack === "string") error.stack = saved.stack;
            update.error = error;
          }
        }
      }
      this.unreadable.delete(destination);
      return recoverInterrupted(parsed);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      this.unreadable.add(destination);
      throw error;
    }
  }

  async list(): Promise<NativeSessionRecord[]> {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    let names: string[];
    try {
      names = await fs.readdir(this.directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const records: NativeSessionRecord[] = [];
    for (const name of names) {
      const id = name.endsWith(".json") ? name.slice(0, -5) : "";
      if (!validId(id)) continue;
      const record = await this.load(id);
      if (record) records.push(record);
    }
    return records.sort((left, right) => right.updatedAt - left.updatedAt);
  }

  private enqueue(destination: string, operation: () => Promise<void>): Promise<void> {
    const previous = this.writes.get(destination);
    const pending = (async () => {
      if (previous) await previous.catch(() => {});
      await operation();
    })();
    this.writes.set(destination, pending);
    const finished = (): void => {
      if (this.writes.get(destination) === pending) this.writes.delete(destination);
    };
    void pending.then(finished, finished);
    return pending;
  }

  private path(sessionId: string): string {
    if (!validId(sessionId)) throw new Error("Invalid native session identifier.");
    const path = requireNodeModule<typeof import("node:path")>("path");
    return path.join(this.directory, `${sessionId}.json`);
  }
}
