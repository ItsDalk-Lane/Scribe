import type { TFile } from "obsidian";
import type {
  AgentChatMessage,
  AgentDisplayFact,
  AgentMessagePart,
  SequencedAgentDisplayFact,
  StoredAgentDisplayMessage,
} from "@/agentMode/session/types";
import type { AgentBranchState } from "@/agentMode/session/AgentSession";
import type { SavedAgentTask } from "@/agentMode/session/AgentSessionSnapshots";
import { isRecord } from "@/utils/obsidianInternals";

function isDisplayMessage(value: unknown): value is StoredAgentDisplayMessage {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    typeof value.sender !== "string" ||
    typeof value.message !== "string"
  )
    return false;
  if (
    value.context !== undefined &&
    (!isRecord(value.context) ||
      !Array.isArray(value.context.notes) ||
      value.context.notes.some((note) => typeof note !== "string"))
  )
    return false;
  return value.parts === undefined || Array.isArray(value.parts);
}

function isDisplayPart(value: unknown): value is AgentMessagePart {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "text":
    case "thought":
      return typeof value.text === "string";
    case "tool_call":
      return (
        typeof value.id === "string" &&
        typeof value.title === "string" &&
        typeof value.status === "string" &&
        (value.output === undefined ||
          (Array.isArray(value.output) &&
            value.output.every(
              (output) =>
                isRecord(output) &&
                ((output.type === "text" && typeof output.text === "string") ||
                  (output.type === "diff" &&
                    typeof output.path === "string" &&
                    typeof output.newText === "string"))
            )))
      );
    case "plan":
      return (
        Array.isArray(value.entries) &&
        value.entries.every(
          (entry) =>
            isRecord(entry) && typeof entry.content === "string" && typeof entry.status === "string"
        )
      );
    case "compaction":
      return (
        typeof value.id === "string" &&
        typeof value.status === "string" &&
        (value.trigger === "manual" || value.trigger === "auto")
      );
    default:
      return false;
  }
}

export function isAgentDisplayFact(value: unknown): value is AgentDisplayFact {
  if (!isRecord(value)) return false;
  switch (value.kind) {
    case "pin":
      return (
        value.pinnedAt === null ||
        (typeof value.pinnedAt === "number" &&
          Number.isFinite(value.pinnedAt) &&
          value.pinnedAt > 0)
      );
    case "inherited_message":
    case "user_message":
      return isDisplayMessage(value.message);
    case "message_metadata":
      return (
        typeof value.messageId === "string" &&
        isRecord(value.metadata) &&
        (value.metadata.fileChanges === undefined || Array.isArray(value.metadata.fileChanges))
      );
    case "message_deleted":
      return typeof value.messageId === "string";
    case "messages_cleared":
      return true;
    case "branch":
      return (
        (value.branch === null ||
          (isRecord(value.branch) &&
            typeof value.branch.sourceChatId === "string" &&
            typeof value.branch.sourceMessageId === "string")) &&
        (value.messages === undefined ||
          (Array.isArray(value.messages) && value.messages.every(isDisplayMessage)))
      );
    case "task":
      return (
        isRecord(value.task) &&
        typeof value.task.toolCallId === "string" &&
        Array.isArray(value.messages) &&
        value.messages.every(isDisplayMessage)
      );
    case "session_metadata":
      return (
        typeof value.chatId === "string" &&
        (value.label === null || typeof value.label === "string")
      );
    default:
      return false;
  }
}

export function serializeDisplayMessage(message: AgentChatMessage): StoredAgentDisplayMessage {
  return {
    ...message,
    context: message.context
      ? { ...message.context, notes: message.context.notes.map((note) => note.path) }
      : undefined,
  };
}

export function hydrateDisplayMessage(
  message: StoredAgentDisplayMessage,
  resolveNote: (path: string) => TFile | null
): AgentChatMessage {
  if (message.parts) message = { ...message, parts: message.parts.filter(isDisplayPart) };
  if (!message.context) return message as AgentChatMessage;
  const notes: TFile[] = [];
  const missing = new Set(message.missingAttachments ?? []);
  for (const path of message.context.notes) {
    const note = resolveNote(path);
    if (note) {
      notes.push(note);
      missing.delete(path);
    } else missing.add(path);
  }
  return {
    ...message,
    context: { ...message.context, notes },
    missingAttachments: missing.size ? [...missing] : undefined,
  };
}

export interface DisplayFactProjection {
  messages: AgentChatMessage[];
  branch?: AgentBranchState | null;
  tasks: SavedAgentTask[];
  chatId?: string;
  label?: string | null;
  warnings: string[];
  pinnedAt?: number | null;
}

export function projectDisplayFacts(
  messages: readonly AgentChatMessage[],
  facts: readonly SequencedAgentDisplayFact[],
  resolveNote: (path: string) => TFile | null
): DisplayFactProjection {
  const result: DisplayFactProjection = { messages: [...messages], tasks: [], warnings: [] };
  const tasks = new Map<string, SavedAgentTask>();
  for (const record of facts) {
    if (!isAgentDisplayFact(record.payload)) {
      result.warnings.push(
        "A chat display record could not be interpreted. The saved record was preserved."
      );
      continue;
    }
    const fact: AgentDisplayFact = record.payload;
    switch (fact.kind) {
      case "pin":
        result.pinnedAt = fact.pinnedAt;
        break;
      case "inherited_message":
      case "user_message": {
        const message = hydrateDisplayMessage(fact.message, resolveNote);
        const index = result.messages.findIndex((item) => item.id === message.id);
        const identified = { ...message, seq: record.seq };
        if (index >= 0) result.messages[index] = identified;
        else {
          const next = result.messages.findIndex(
            (item) => item.seq !== undefined && item.seq > record.seq
          );
          result.messages.splice(next < 0 ? result.messages.length : next, 0, identified);
        }
        break;
      }
      case "message_metadata":
        result.messages = result.messages.map((message) =>
          message.id === fact.messageId ? { ...message, ...fact.metadata } : message
        );
        break;
      case "message_deleted":
        result.messages = result.messages.filter((message) => message.id !== fact.messageId);
        break;
      case "messages_cleared":
        result.messages = result.messages.filter(
          (message) => message.seq !== undefined && message.seq > record.seq
        );
        break;
      case "branch":
        result.branch = fact.branch;
        if (fact.messages) {
          const inherited = fact.messages.map((message) =>
            hydrateDisplayMessage(message, resolveNote)
          );
          const ids = new Set(inherited.map((message) => message.id));
          result.messages = [
            ...inherited,
            ...result.messages.filter((message) => !ids.has(message.id)),
          ];
        }
        break;
      case "task":
        tasks.set(fact.task.toolCallId, {
          task: fact.task,
          messages: fact.messages.map((message) => hydrateDisplayMessage(message, resolveNote)),
        });
        break;
      case "session_metadata":
        result.chatId = fact.chatId;
        result.label = fact.label;
        break;
    }
  }
  result.tasks = [...tasks.values()];
  return result;
}
