import { t } from "@/lib/i18n";
import { ensureFolderExists } from "@/utils";
import { sha256 } from "@/utils/hash";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";
import { atom, createStore, useAtomValue } from "jotai";
import type { App } from "obsidian";
import { AGENT_BUILTIN_COMMANDS } from "./builtinAgentCommands";

export interface AgentCommandDefinition {
  id: string;
  name: string;
  description: string;
  content: string;
  enabled: boolean;
  revision?: string;
}

export const AGENT_COMMANDS_DIRECTORY = ".scribe/agent-commands";
const DIRECTORY = AGENT_COMMANDS_DIRECTORY;
const EMPTY = Object.freeze([]) as readonly AgentCommandDefinition[];
const state = createStore();
const definitions = atom<readonly AgentCommandDefinition[]>(EMPTY);

function filePath(id: string): string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id))
    throw new Error(t("Agent command identifier is invalid."));
  return `${DIRECTORY}/${id}.json`;
}

function comparableName(name: string): string {
  return name.trim().toLowerCase();
}

function parse(value: unknown): AgentCommandDefinition {
  if (!value || typeof value !== "object")
    throw new Error(t("Agent command file format is invalid."));
  const entry = value as Record<string, unknown>;
  if (typeof entry.id !== "string") throw new Error(t("Agent command identifier is invalid."));
  filePath(entry.id);
  const description = entry.description === undefined ? "" : entry.description;
  if (
    typeof entry.name !== "string" ||
    !entry.name.trim() ||
    typeof entry.content !== "string" ||
    !entry.content.trim() ||
    typeof description !== "string" ||
    typeof entry.enabled !== "boolean"
  )
    throw new Error(t("Agent command file format is invalid."));
  return {
    id: entry.id,
    name: entry.name.trim(),
    description: description.trim(),
    content: entry.content,
    enabled: entry.enabled,
  };
}

export class AgentCommandManager {
  private static instance: AgentCommandManager | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private constructor(private readonly app: App) {}

  static getInstance(app?: App): AgentCommandManager {
    if (!this.instance) {
      if (!app) throw new Error("AgentCommandManager requires app on initialization.");
      this.instance = new AgentCommandManager(app);
    }
    return this.instance;
  }

  static reset(): void {
    if (this.instance) this.instance.disposed = true;
    this.instance = undefined;
    state.set(definitions, EMPTY);
  }

  refresh(): Promise<readonly AgentCommandDefinition[]> {
    return this.enqueue(() => this.read());
  }

  save(definition: AgentCommandDefinition): Promise<void> {
    return this.enqueue(async () => {
      const entry = parse(definition);
      const path = filePath(entry.id);
      const name = comparableName(entry.name);
      if (AGENT_BUILTIN_COMMANDS.some((builtin) => comparableName(builtin) === name))
        throw new Error(t("This name is reserved by a built-in command."));
      await assertScribePath(this.app.vault, path);
      const existing = await this.read();
      if (existing.some((other) => other.id !== entry.id && comparableName(other.name) === name))
        throw new Error(t("Another Agent command already uses this name."));
      const adapter = this.app.vault.adapter;
      const original = (await adapter.exists(path)) ? await adapter.read(path) : null;
      if (
        (original !== null && sha256(original) !== definition.revision) ||
        (original === null && definition.revision)
      )
        throw new Error(
          t("This command changed outside Scribe. Refresh and try again; your draft is kept.")
        );
      await ensureFolderExists(this.app.vault, DIRECTORY);
      if (this.disposed) throw new DOMException("Agent command manager stopped", "AbortError");
      await writeVaultFile(this.app.vault, path, JSON.stringify(entry, null, 2), original);
      await this.read();
    });
  }

  remove(entry: Pick<AgentCommandDefinition, "id" | "revision">): Promise<void> {
    return this.enqueue(async () => {
      const path = filePath(entry.id);
      await assertScribePath(this.app.vault, path);
      const adapter = this.app.vault.adapter;
      const original = (await adapter.exists(path)) ? await adapter.read(path) : null;
      if (original !== null && sha256(original) !== entry.revision)
        throw new Error(t("This command changed outside Scribe. Refresh before deleting it."));
      if (this.disposed) throw new DOMException("Agent command manager stopped", "AbortError");
      if (original !== null) await adapter.remove(path);
      await this.read();
    });
  }

  private async read(): Promise<readonly AgentCommandDefinition[]> {
    await assertScribePath(this.app.vault, DIRECTORY);
    const adapter = this.app.vault.adapter;
    const next: AgentCommandDefinition[] = [];
    if (await adapter.exists(DIRECTORY)) {
      const { files } = await adapter.list(DIRECTORY);
      for (const path of files.sort()) {
        if (
          !path.startsWith(`${DIRECTORY}/`) ||
          !/^[a-zA-Z0-9_-]+\.json$/.test(path.slice(DIRECTORY.length + 1))
        )
          continue;
        await assertScribePath(this.app.vault, path);
        const raw = await adapter.read(path);
        const entry = parse(JSON.parse(raw));
        if (path !== filePath(entry.id))
          throw new Error(t("Agent command file name does not match its identifier."));
        next.push({ ...entry, revision: sha256(raw) });
      }
    }
    const snapshot = next.length ? next : EMPTY;
    if (!this.disposed) state.set(definitions, snapshot);
    return snapshot;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const job = this.queue.then(() => {
      if (this.disposed) throw new DOMException("Agent command manager stopped", "AbortError");
      return operation();
    });
    this.queue = job.catch(() => {});
    return job;
  }
}

export function getAgentCommands(): readonly AgentCommandDefinition[] {
  return state.get(definitions);
}

export function subscribeAgentCommands(listener: () => void): () => void {
  return state.sub(definitions, listener);
}

export function useAgentCommands(): readonly AgentCommandDefinition[] {
  return useAtomValue(definitions, { store: state });
}
