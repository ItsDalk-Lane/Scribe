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
  // 观察性事实写失败只丢弃这一条，不冻结整个日志。https://github.com/ItsDalk-Lane/Scribe/issues/55
  discardOnFailure?: boolean;
}

// 排队、写入或确认超过时限都属于结果未知，原写入仍独占队列，不能另开并发写入。https://github.com/ItsDalk-Lane/Scribe/issues/55
export class JournalConfirmationTimeout extends Error {
  constructor(readonly limitMs: number) {
    super(`Journal operation did not finish within ${limitMs} ms.`);
    this.name = "JournalConfirmationTimeout";
  }
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
  const process = requireNodeModule<typeof import("node:process")>("process");
  const directory = path.dirname(destination);
  const created = await fs.mkdir(directory, { recursive: true });
  // On Windows mkdir returns an extended-length "\\?\" path that never matches the
  // target string, and syncDirectory is a no-op there, so only POSIX runs the fsync loop.
  // https://github.com/ItsDalk-Lane/Scribe/issues/75
  if (created && process.platform !== "win32") {
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

  constructor(
    directory: string,
    private readonly confirmLimitMs = 30_000
  ) {
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
    const written = this.enqueue(sessionId, async () => {
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
          } finally {
            await handle.close();
          }
        }
        state.nextSeq++;
        state.completeBytes += bytes.byteLength;
        state.totalBytes = state.completeBytes;
        return record;
      } catch (error) {
        const failure = error instanceof Error ? error : new Error(String(error));
        // 残留字节不会被当作记录：下次追加前先截回这里记下的完整位置，序号也不前进。https://github.com/ItsDalk-Lane/Scribe/issues/55
        if (options.discardOnFailure && state.exists) {
          state.totalBytes = state.completeBytes + bytes.byteLength;
          throw failure;
        }
        state.failure = failure;
        throw failure;
      }
    });
    // 确认落盘在写队列外等待：后续事实的写入不必排在一次 fsync 后面。https://github.com/ItsDalk-Lane/Scribe/issues/55
    if (!options.durable) return written;
    return written.then(async (record) => {
      await this.confirmWrites(sessionId, destination);
      return record;
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

  async redact(
    sessionId: string,
    select: (record: JournalRecord) => boolean,
    replace?: (record: JournalRecord) => Pick<JournalRecord, "kind" | "payload">
  ): Promise<void> {
    const destination = this.path(sessionId);
    return this.enqueue(sessionId, async () => {
      const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
      let original: Uint8Array;
      try {
        original = new Uint8Array(await fs.readFile(destination));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
        throw error;
      }
      const scan = await this.scan(sessionId, original);
      this.assertWritable(this.states.get(sessionId) ?? scan.state);
      this.assertWritable(scan.state);
      const selected = new Set(scan.records.filter(select).map((record) => record.seq));
      if (!selected.size) return;
      const parts: Uint8Array[] = [];
      let start = 0;
      for (let end = 0; end < scan.state.completeBytes; end++) {
        if (original[end] !== 10) continue;
        const line = original.subarray(start, end + 1);
        const parsed: JournalRecord = JSON.parse(new TextDecoder().decode(line));
        const replacement = selected.has(parsed.seq)
          ? (replace?.(parsed) ?? { kind: "redacted", payload: {} })
          : undefined;
        parts.push(
          selected.has(parsed.seq)
            ? new TextEncoder().encode(
                JSON.stringify({
                  version: 2,
                  seq: parsed.seq,
                  kind: replacement!.kind,
                  occurredAt: parsed.occurredAt,
                  origin: parsed.origin,
                  payload: replacement!.payload,
                }) + "\n"
              )
            : line
        );
        start = end + 1;
      }
      parts.push(original.subarray(start));
      const replacement = new Uint8Array(parts.reduce((size, part) => size + part.byteLength, 0));
      let offset = 0;
      for (const part of parts) {
        replacement.set(part, offset);
        offset += part.byteLength;
      }
      const suffix = uuidv4();
      const temporary = `${destination}.${suffix}.redact.tmp`;
      const backup = `${destination}.${suffix}.redact.backup`;
      let replaced = false;
      let backedUp = false;
      try {
        const handle = await fs.open(temporary, "wx", 0o600);
        try {
          await handle.writeFile(replacement);
          await handle.sync();
        } finally {
          await handle.close();
        }
        await fs.link(destination, backup);
        backedUp = true;
        const current = new Uint8Array(await fs.readFile(destination));
        if (
          current.byteLength !== original.byteLength ||
          current.some((byte, index) => byte !== original[index])
        )
          throw new Error(
            "The journal changed while deleting a subagent; its new contents were preserved."
          );
        await syncDirectory(this.directory);
        await fs.rename(temporary, destination);
        replaced = true;
        await syncDirectory(this.directory);
        await fs.rm(backup);
        backedUp = false;
        this.states.set(sessionId, (await this.scan(sessionId, replacement)).state);
      } catch (error) {
        // 删除失败后冻结追加，原件或同目录备份必须保留供恢复。https://github.com/ItsDalk-Lane/Scribe/issues/50
        scan.state.failure = error instanceof Error ? error : new Error(String(error));
        this.states.set(sessionId, scan.state);
        if (!replaced) {
          await fs.rm(temporary, { force: true }).catch(() => {});
          if (backedUp) await fs.rm(backup, { force: true }).catch(() => {});
        }
        throw scan.state.failure;
      }
    });
  }

  async flush(sessionId: string): Promise<void> {
    const destination = this.path(sessionId);
    // 排空只等排进来的写入；确认同步在队列外执行，不拖住后面的写入。https://github.com/ItsDalk-Lane/Scribe/issues/55
    const exists = await this.enqueue(sessionId, async () => {
      const state = await this.state(sessionId);
      this.assertWritable(state);
      return state.exists;
    });
    if (!exists) return;
    await this.confirmWrites(sessionId, destination);
  }

  private async confirmWrites(sessionId: string, destination: string): Promise<void> {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    const outcome = fs
      .open(destination, "r+")
      .then(async (handle) => {
        try {
          await handle.sync();
        } finally {
          await handle.close();
        }
      })
      .then(
        () => ({ ok: true as const }),
        (error: unknown) => ({ ok: false as const, error: error as Error })
      );
    // 超时后才浮出的同步失败仍然冻结：磁盘恢复前不能继续追加。https://github.com/ItsDalk-Lane/Scribe/issues/55
    void outcome.then((result) => {
      if (!result.ok)
        void this.state(sessionId)
          .then((state) => {
            state.failure ??= result.error;
          })
          .catch(() => {});
    });
    const result = await this.waitForOperation(outcome, () => {});
    if (!result.ok) {
      const state = await this.state(sessionId);
      state.failure ??= result.error;
      throw result.error;
    }
  }

  private async state(sessionId: string): Promise<JournalState> {
    const cached = this.states.get(sessionId);
    if (cached) return cached;
    const { state } = await this.scan(sessionId);
    this.states.set(sessionId, state);
    return state;
  }

  private async scan(sessionId: string, source?: Uint8Array): Promise<JournalScan> {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    let bytes: Uint8Array;
    try {
      bytes = source ?? new Uint8Array(await fs.readFile(this.path(sessionId)));
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
    let expired = false;
    const pending = (async () => {
      if (previous) await previous.catch(() => {});
      // 未开始的过期请求不能在磁盘恢复后迟到写入；已开始的请求则必须等真实结束才能放行队列。https://github.com/ItsDalk-Lane/Scribe/issues/55
      if (expired) throw new JournalConfirmationTimeout(this.confirmLimitMs);
      return operation();
    })();
    this.queues.set(sessionId, pending);
    const finished = (): void => {
      if (this.queues.get(sessionId) === pending) this.queues.delete(sessionId);
    };
    void pending.then(finished, finished);
    return this.waitForOperation(pending, () => {
      expired = true;
    });
  }

  async waitForOperation<T>(
    operation: Promise<T>,
    expire: (failure: JournalConfirmationTimeout) => void
  ): Promise<T> {
    let timer: number | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_, reject) => {
          timer = window.setTimeout(() => {
            const failure = new JournalConfirmationTimeout(this.confirmLimitMs);
            expire(failure);
            reject(failure);
          }, this.confirmLimitMs);
        }),
      ]);
    } finally {
      window.clearTimeout(timer);
    }
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
