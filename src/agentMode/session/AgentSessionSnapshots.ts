import type { AgentSessionIndexStorage } from "@/agentMode/session/AgentSessionIndex";
import type { AgentBranchState, AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentChatMessage, ModelSelection } from "@/agentMode/session/types";
import type { TFile } from "obsidian";
import type { MessageContext } from "@/types/message";
import { v5 as uuidv5 } from "uuid";

interface StoredMessage extends Omit<AgentChatMessage, "context"> {
  context?: Omit<MessageContext, "notes"> & { notes: string[] };
}

interface StoredSnapshot extends Omit<AgentSessionSnapshot, "messages" | "tasks"> {
  messages: StoredMessage[];
  tasks: { task: AgentTask; messages: StoredMessage[] }[];
}

export interface SavedAgentTask {
  task: AgentTask;
  messages: AgentChatMessage[];
}

export interface AgentSessionSnapshot {
  version: 1;
  chatId: string;
  backendId: string;
  sessionId: string;
  projectId: string;
  savedAtMs: number;
  label: string | null;
  selection?: ModelSelection;
  messages: AgentChatMessage[];
  tasks: SavedAgentTask[];
  branch: AgentBranchState | null;
  aliases?: string[];
  currentSessionId?: string;
}

export interface AgentSnapshotStorage extends AgentSessionIndexStorage {
  remove(path: string): Promise<void>;
}

export class AgentSessionSnapshots {
  private readonly writes = new Map<string, Promise<void>>();
  private readonly unreadable = new Set<string>();
  constructor(
    private readonly storage: AgentSnapshotStorage,
    private readonly directory: string,
    private readonly resolveNote: (path: string) => TFile | null
  ) {}

  save(snapshot: AgentSessionSnapshot): Promise<void> {
    const path = this.path(snapshot.backendId, snapshot.sessionId);
    if (this.unreadable.has(path))
      return Promise.reject(
        new Error("Chat snapshot could not be read; preserving the existing file.")
      );
    const normalize = (message: AgentChatMessage): StoredMessage => ({
      ...message,
      context: message.context
        ? { ...message.context, notes: message.context.notes.map((note) => note.path) }
        : undefined,
    });
    const stored: StoredSnapshot = {
      ...snapshot,
      messages: snapshot.messages.map(normalize),
      tasks: snapshot.tasks.map((entry) => ({
        task: entry.task,
        messages: entry.messages.map(normalize),
      })),
    };
    const content = JSON.stringify(stored);
    return this.enqueue(path, () => this.storage.write(path, content));
  }

  async load(backendId: string, sessionId: string): Promise<AgentSessionSnapshot | null> {
    const path = this.path(backendId, sessionId);
    await this.writes.get(path)?.catch(() => {});
    if (!(await this.storage.exists(path))) return null;
    try {
      const stored = JSON.parse(await this.storage.read(path)) as StoredSnapshot;
      if (
        stored.version !== 1 ||
        stored.backendId !== backendId ||
        stored.sessionId !== sessionId ||
        typeof stored.chatId !== "string" ||
        typeof stored.projectId !== "string" ||
        (stored.currentSessionId !== undefined && typeof stored.currentSessionId !== "string") ||
        (stored.aliases !== undefined &&
          (!Array.isArray(stored.aliases) ||
            stored.aliases.some((id) => typeof id !== "string"))) ||
        !Array.isArray(stored.messages) ||
        !Array.isArray(stored.tasks)
      ) {
        throw new Error("Invalid or unsupported chat snapshot");
      }
      const hydrate = (message: StoredMessage): AgentChatMessage => {
        if (
          typeof message.id !== "string" ||
          typeof message.message !== "string" ||
          typeof message.sender !== "string"
        ) {
          throw new Error("Invalid saved chat message");
        }
        if (!message.context) return message as AgentChatMessage;
        if (
          !Array.isArray(message.context.notes) ||
          message.context.notes.some((note) => typeof note !== "string")
        ) {
          throw new Error("Invalid saved chat attachments");
        }
        const notes: TFile[] = [];
        const missing = new Set<string>();
        for (const notePath of new Set([
          ...message.context.notes,
          ...(message.missingAttachments ?? []),
        ])) {
          const note = this.resolveNote(notePath);
          if (note) notes.push(note);
          else missing.add(notePath);
        }
        return {
          ...message,
          context: { ...message.context, notes },
          missingAttachments: missing.size > 0 ? [...missing] : undefined,
        };
      };
      const result: AgentSessionSnapshot = {
        ...stored,
        messages: stored.messages.map(hydrate),
        tasks: stored.tasks.map((entry) => {
          if (
            !entry.task ||
            typeof entry.task.toolCallId !== "string" ||
            !["command", "subagent"].includes(entry.task.kind) ||
            !["running", "completed", "failed", "stopped"].includes(entry.task.status) ||
            !Array.isArray(entry.messages)
          ) {
            throw new Error("Invalid saved task");
          }
          return { task: entry.task, messages: entry.messages.map(hydrate) };
        }),
      };
      this.unreadable.delete(path);
      return result;
    } catch (error) {
      this.unreadable.add(path);
      throw error;
    }
  }

  remove(backendId: string, sessionId: string): Promise<void> {
    const path = this.path(backendId, sessionId);
    return this.enqueue(path, async () => {
      await this.storage.remove(path);
      this.unreadable.delete(path);
    });
  }

  private path(backendId: string, sessionId: string): string {
    return `${this.directory}/${uuidv5(`${backendId}\n${sessionId}`, uuidv5.URL)}.json`;
  }

  private enqueue(path: string, write: () => Promise<void>): Promise<void> {
    const pending = (this.writes.get(path) ?? Promise.resolve()).catch(() => {}).then(write);
    this.writes.set(path, pending);
    const finished = () => {
      if (this.writes.get(path) === pending) this.writes.delete(path);
    };
    void pending.then(finished, finished);
    return pending;
  }
}
