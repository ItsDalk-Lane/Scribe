import type { App } from "obsidian";
import { atom, createStore, useAtomValue } from "jotai";
import { ensureFolderExists } from "@/utils";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";
import { sha256 } from "@/utils/hash";

export interface SubagentDefinition {
  id: string;
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
  revision?: string;
}

const DIRECTORY = ".scribe/subagents";
const EMPTY = Object.freeze([]) as readonly SubagentDefinition[];
const state = createStore();
const definitions = atom<readonly SubagentDefinition[]>(EMPTY);

function filePath(id: string): string {
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("子代理标识无效。");
  return `${DIRECTORY}/${id}.json`;
}

function parse(value: unknown): SubagentDefinition {
  if (!value || typeof value !== "object") throw new Error("子代理配置格式无效。");
  const entry = value as SubagentDefinition;
  filePath(entry.id);
  if (
    typeof entry.name !== "string" ||
    !entry.name.trim() ||
    typeof entry.description !== "string" ||
    !entry.description.trim() ||
    typeof entry.instructions !== "string" ||
    !entry.instructions.trim() ||
    typeof entry.enabled !== "boolean"
  )
    throw new Error("请填写子代理名称、用途说明和指令。");
  return {
    id: entry.id,
    name: entry.name.trim(),
    description: entry.description.trim(),
    instructions: entry.instructions,
    enabled: entry.enabled,
  };
}

export class SubagentManager {
  private static instance: SubagentManager | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private disposed = false;
  private constructor(private readonly app: App) {}

  static getInstance(app?: App): SubagentManager {
    if (!this.instance) {
      if (!app) throw new Error("SubagentManager requires app on initialization.");
      this.instance = new SubagentManager(app);
    }
    return this.instance;
  }

  static reset(): void {
    if (this.instance) this.instance.disposed = true;
    this.instance = undefined;
    state.set(definitions, EMPTY);
  }

  refresh(): Promise<readonly SubagentDefinition[]> {
    return this.enqueue(() => this.read());
  }

  private async read(): Promise<readonly SubagentDefinition[]> {
    await assertScribePath(this.app.vault, DIRECTORY);
    const adapter = this.app.vault.adapter;
    const next: SubagentDefinition[] = [];
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
        if (path !== filePath(entry.id)) throw new Error("子代理文件名与标识不一致。");
        next.push({ ...entry, revision: sha256(raw) });
      }
    }
    const snapshot = next.length ? next : EMPTY;
    if (!this.disposed) state.set(definitions, snapshot);
    return snapshot;
  }

  save(definition: SubagentDefinition): Promise<void> {
    return this.enqueue(async () => {
      const entry = parse(definition);
      const path = filePath(entry.id);
      await assertScribePath(this.app.vault, path);
      const adapter = this.app.vault.adapter;
      const original = (await adapter.exists(path)) ? await adapter.read(path) : null;
      if (
        (original !== null && sha256(original) !== definition.revision) ||
        (original === null && definition.revision)
      )
        throw new Error("子代理已被其他操作修改或删除，请刷新后重试。草稿仍保留。");
      await ensureFolderExists(this.app.vault, DIRECTORY);
      if (this.disposed) throw new DOMException("Subagent manager stopped", "AbortError");
      await writeVaultFile(this.app.vault, path, JSON.stringify(entry, null, 2), original);
      await this.read();
    });
  }

  remove(id: string): Promise<void> {
    return this.enqueue(async () => {
      const path = filePath(id);
      await assertScribePath(this.app.vault, path);
      const exists = await this.app.vault.adapter.exists(path);
      if (this.disposed) throw new DOMException("Subagent manager stopped", "AbortError");
      if (exists) await this.app.vault.adapter.remove(path);
      await this.read();
    });
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const job = this.queue.then(() => {
      if (this.disposed) throw new DOMException("Subagent manager stopped", "AbortError");
      return operation();
    });
    this.queue = job.catch(() => {});
    return job;
  }
}

export function getSubagents(): readonly SubagentDefinition[] {
  return state.get(definitions);
}

export function useSubagents(): readonly SubagentDefinition[] {
  return useAtomValue(definitions, { store: state });
}

// 斜杠菜单等非 React 订阅方通过它与运行时委派读取同一份定义。https://github.com/ItsDalk-Lane/Scribe/issues/54
export function subscribeSubagents(listener: () => void): () => void {
  return state.sub(definitions, () => listener());
}
