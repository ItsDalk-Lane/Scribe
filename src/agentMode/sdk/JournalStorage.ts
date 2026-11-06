import { validate as isUuid, v4 as uuidv4 } from "uuid";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { isRecord } from "@/utils/obsidianInternals";

export type JournalOrigin = "observed" | "synthetic" | "derived";

export interface JournalRecord {
  version: 2;
  seq: number;
  kind: string;
  occurredAt: number;
  origin: JournalOrigin;
  payload: unknown;
}

export interface JournalReadResult {
  records: JournalRecord[];
  writable: boolean;
  warnings: string[];
}

export interface JournalAppendOptions {
  durable?: boolean;
  origin?: JournalOrigin;
}

interface JournalState {
  exists: boolean;
  nextSeq: number;
  completeBytes: number;
  totalBytes: number;
  writable: boolean;
  failure?: Error;
}

interface JournalScan extends JournalReadResult {
  state: JournalState;
}

const SHARED_JOURNALS = new Map<string, NodeJournalStorage>();

function validSessionId(sessionId: string): boolean {
  return sessionId.startsWith("native-") && isUuid(sessionId.slice(7));
}

function jsonValue(_key: string, value: unknown): unknown {
  return value instanceof Error
    ? { name: value.name, message: value.message, stack: value.stack }
    : value;
}

async function syncDirectory(directory: string): Promise<void> {
  const runtime = requireNodeModule<typeof import("node:process")>("process");
  if (runtime.platform === "win32") return;
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const handle = await fs.open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

export async function createDurableFile(
  destination: string,
  content: Uint8Array
): Promise<boolean> {
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const directory = path.dirname(destination);
  const created = await fs.mkdir(directory, { recursive: true });
  if (created) {
    let current = directory;
    for (;;) {
      await syncDirectory(path.dirname(current));
      if (current === created) break;
      current = path.dirname(current);
    }
  }
  const temporary = `${destination}.${uuidv4()}.tmp`;
  try {
    const handle = await fs.open(temporary, "wx", 0o600);
    try {
      await handle.writeFile(content);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await fs.link(temporary, destination);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") return false;
      throw error;
    }
    await syncDirectory(directory);
    return true;
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

export class NodeJournalStorage {
  readonly directory: string;
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly states = new Map<string, JournalState>();

  constructor(directory: string) {
    const path = requireNodeModule<typeof import("node:path")>("path");
    if (!path.isAbsolute(directory)) throw new Error("The journal directory must be absolute.");
    this.directory = path.resolve(directory);
  }

  async append(
    sessionId: string,
    kind: string,
    payload: unknown,
    options: JournalAppendOptions = {}
  ): Promise<JournalRecord> {
    const destination = this.path(sessionId);
    if (!kind) throw new Error("A journal fact kind is required.");
    const encodedPayload = JSON.stringify(payload, jsonValue);
    if (encodedPayload === undefined) throw new Error("A journal payload must be JSON data.");
    const captured: unknown = JSON.parse(encodedPayload);
    return this.enqueue(sessionId, async () => {
      const state = await this.state(sessionId);
      this.assertWritable(state);
      const record: JournalRecord = {
        version: 2,
        seq: state.nextSeq,
        kind,
        occurredAt: Date.now(),
        origin: options.origin ?? "observed",
        payload: captured,
      };
      const bytes = new TextEncoder().encode(JSON.stringify(record) + "\n");
      try {
        if (!state.exists) {
          if (!(await createDurableFile(destination, bytes)))
            throw new Error("A journal appeared while its first fact was being created.");
          state.exists = true;
        } else {
          const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
          const { constants } = requireNodeModule<typeof import("node:fs")>("fs");
          const handle = await fs.open(destination, constants.O_WRONLY | constants.O_APPEND);
          try {
            if (state.totalBytes !== state.completeBytes) {
              await handle.truncate(state.completeBytes);
              await handle.sync();
            }
            let offset = 0;
            while (offset < bytes.byteLength) {
              const { bytesWritten } = await handle.write(
                bytes,
                offset,
                bytes.byteLength - offset,
                null
              );
              if (!bytesWritten) throw new Error("The journal write made no progress.");
              offset += bytesWritten;
            }
            if (options.durable) await handle.sync();
          } finally {
            await handle.close();
          }
        }
        state.nextSeq++;
        state.completeBytes += bytes.byteLength;
        state.totalBytes = state.completeBytes;
        return record;
      } catch (error) {
        state.failure = error instanceof Error ? error : new Error(String(error));
        throw state.failure;
      }
    });
  }

  async read(sessionId: string): Promise<JournalReadResult> {
    this.path(sessionId);
    return this.enqueue(sessionId, async () => {
      const scan = await this.scan(sessionId);
      const failure = this.states.get(sessionId)?.failure;
      if (failure) {
        scan.writable = false;
        scan.warnings.push(`Journal writes are frozen: ${failure.message}`);
        scan.state.failure = failure;
      }
      this.states.set(sessionId, scan.state);
      return { records: scan.records, writable: scan.writable, warnings: scan.warnings };
    });
  }

  async list(): Promise<string[]> {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    try {
      const names = await fs.readdir(this.directory);
      return names
        .flatMap((name) => {
          const sessionId = name.endsWith(".jsonl") ? name.slice(0, -6) : "";
          return validSessionId(sessionId) ? [sessionId] : [];
        })
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  async remove(sessionId: string): Promise<void> {
    const destination = this.path(sessionId);
    return this.enqueue(sessionId, async () => {
      const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
      await fs.rm(destination, { force: true });
      this.states.delete(sessionId);
    });
  }

  async flush(sessionId: string): Promise<void> {
    const destination = this.path(sessionId);
    return this.enqueue(sessionId, async () => {
      const state = await this.state(sessionId);
      this.assertWritable(state);
      if (!state.exists) return;
      const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
      try {
        const handle = await fs.open(destination, "r+");
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      } catch (error) {
        state.failure = error instanceof Error ? error : new Error(String(error));
        throw state.failure;
      }
    });
  }

  private async state(sessionId: string): Promise<JournalState> {
    const cached = this.states.get(sessionId);
    if (cached) return cached;
    const { state } = await this.scan(sessionId);
    this.states.set(sessionId, state);
    return state;
  }

  private async scan(sessionId: string): Promise<JournalScan> {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fs.readFile(this.path(sessionId)));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      return {
        records: [],
        writable: true,
        warnings: [],
        state: { exists: false, nextSeq: 0, completeBytes: 0, totalBytes: 0, writable: true },
      };
    }
    const completeBytes = bytes.lastIndexOf(10) + 1;
    const warnings: string[] = [];
    const records: JournalRecord[] = [];
    let nextSeq = 0;
    let writable = true;
    const lines = new TextDecoder().decode(bytes.subarray(0, completeBytes)).split("\n");
    lines.pop();
    for (let index = 0; index < lines.length; index++) {
      let value: unknown;
      try {
        value = JSON.parse(lines[index]);
      } catch {
        warnings.push(`Journal line ${index + 1} is malformed; its bytes were preserved.`);
        writable = false;
        continue;
      }
      if (!isRecord(value) || !Number.isSafeInteger(value.seq) || (value.seq as number) < 0) {
        warnings.push(
          `Journal line ${index + 1} has no usable sequence; its bytes were preserved.`
        );
        writable = false;
        continue;
      }
      if (value.seq !== nextSeq) {
        warnings.push(
          `Journal line ${index + 1} has a sequence gap, duplicate, or reordered fact.`
        );
        writable = false;
      }
      nextSeq = Math.max(nextSeq, (value.seq as number) + 1);
      if (
        value.version !== 2 ||
        typeof value.kind !== "string" ||
        !value.kind ||
        typeof value.occurredAt !== "number" ||
        !Number.isFinite(value.occurredAt) ||
        !["observed", "synthetic", "derived"].includes(value.origin as string) ||
        !("payload" in value)
      ) {
        warnings.push(
          `Journal line ${index + 1} has an unsupported envelope; its bytes were preserved.`
        );
        continue;
      }
      records.push(value as unknown as JournalRecord);
    }
    if (completeBytes !== bytes.byteLength)
      warnings.push(
        "The incomplete final journal record was ignored; it may be discarded before the next append."
      );
    return {
      records,
      writable,
      warnings,
      state: { exists: true, nextSeq, completeBytes, totalBytes: bytes.byteLength, writable },
    };
  }

  private assertWritable(state: JournalState): void {
    if (state.failure)
      throw new Error(`Journal writes are frozen after a failure: ${state.failure.message}`);
    if (!state.writable)
      throw new Error("The journal sequence is uncertain; further writes are disabled.");
  }

  private enqueue<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(sessionId);
    const pending = (async () => {
      if (previous) await previous.catch(() => {});
      return operation();
    })();
    this.queues.set(sessionId, pending);
    const finished = (): void => {
      if (this.queues.get(sessionId) === pending) this.queues.delete(sessionId);
    };
    void pending.then(finished, finished);
    return pending;
  }

  private path(sessionId: string): string {
    if (!validSessionId(sessionId)) throw new Error("Invalid native session identifier.");
    const path = requireNodeModule<typeof import("node:path")>("path");
    return path.join(this.directory, `${sessionId}.jsonl`);
  }
}

export function getNodeJournalStorage(directory: string): NodeJournalStorage {
  const path = requireNodeModule<typeof import("node:path")>("path");
  if (!path.isAbsolute(directory)) throw new Error("The journal directory must be absolute.");
  const resolved = path.resolve(directory);
  let storage = SHARED_JOURNALS.get(resolved);
  if (!storage) {
    storage = new NodeJournalStorage(resolved);
    SHARED_JOURNALS.set(resolved, storage);
  }
  return storage;
}
