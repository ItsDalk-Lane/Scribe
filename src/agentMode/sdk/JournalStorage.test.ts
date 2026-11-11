import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const nodeFs = jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
import {
  createDurableFile,
  getNodeJournalStorage,
  JournalConfirmationTimeout,
  NodeJournalStorage,
} from "@/agentMode/sdk/JournalStorage";
import { stallConfirmations } from "@/agentMode/sdk/testing/diskConfirmation";

const SESSION = "native-8c4529e7-6551-4f39-81b3-dbf5f8e716dd";
const OTHER = "native-41d51594-f0e0-46b7-b770-a283c9f6405f";

function line(seq: number, payload: unknown = { text: "记录" }): string {
  return (
    JSON.stringify({
      version: 2,
      seq,
      kind: "message",
      occurredAt: 10,
      origin: "observed",
      payload,
    }) + "\n"
  );
}

describe("JournalStorage", () => {
  let directory: string;
  let storage: NodeJournalStorage;
  const file = () => join(directory, `${SESSION}.jsonl`);

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "scribe-journal-"));
    storage = new NodeJournalStorage(directory);
  });

  afterEach(async () => {
    jest.useRealTimers();
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  describe("NodeJournalStorage", () => {
    describe("constructor()", () => {
      it("rejects a relative directory", () => {
        expect(() => new NodeJournalStorage("relative")).toThrow(/absolute/i);
      });
    });

    describe("waitForOperation()", () => {
      it("returns the completed result and removes its deadline", async () => {
        jest.useFakeTimers();
        const expire = jest.fn();
        await expect(storage.waitForOperation(Promise.resolve("保存完成"), expire)).resolves.toBe(
          "保存完成"
        );
        expect(expire).not.toHaveBeenCalled();
        expect(jest.getTimerCount()).toBe(0);
      });

      it("ends a stalled wait at the deadline and identifies its expiration (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        jest.useFakeTimers();
        const expire = jest.fn();
        const outcome = expect(
          storage.waitForOperation(new Promise<never>(() => {}), expire)
        ).rejects.toBeInstanceOf(JournalConfirmationTimeout);
        await jest.advanceTimersByTimeAsync(30_001);
        await outcome;
        expect(expire).toHaveBeenCalledWith(expect.any(JournalConfirmationTimeout));
        expect(jest.getTimerCount()).toBe(0);
      });
    });

    describe("append()", () => {
      it("creates a complete first record and appends without changing the existing bytes", async () => {
        const first = await storage.append(SESSION, "session_created", { title: "原文" });
        const prefix = await readFile(file());
        const second = await storage.append(
          SESSION,
          "message",
          { text: "后续\n消息" },
          { durable: true }
        );
        const bytes = await readFile(file());
        expect(first).toMatchObject({ version: 2, seq: 0, origin: "observed" });
        expect(second.seq).toBe(1);
        expect(bytes.subarray(0, prefix.length)).toEqual(prefix);
        expect(bytes.toString().trim().split("\n")).toHaveLength(2);
        expect(await readdir(directory)).toEqual([`${SESSION}.jsonl`]);
        expect((await new NodeJournalStorage(directory).read(SESSION)).records).toEqual([
          first,
          second,
        ]);
      });

      it("serializes concurrent appends and captures the payload when called", async () => {
        const payload = { text: "保存的文本" };
        const first = storage.append(SESSION, "message", payload);
        payload.text = "未保存的修改";
        const entries = await Promise.all([
          first,
          ...Array.from({ length: 20 }, (_, index) =>
            storage.append(SESSION, "message", { index })
          ),
        ]);
        expect(entries.map((record) => record.seq)).toEqual(
          Array.from({ length: 21 }, (_, index) => index)
        );
        expect((await storage.read(SESSION)).records[0].payload).toEqual({ text: "保存的文本" });
      });

      it("writes only the new record after a thousand-record history has been loaded", async () => {
        await writeFile(file(), Array.from({ length: 1000 }, (_, seq) => line(seq)).join(""));
        await storage.read(SESSION);
        const reads = jest.spyOn(nodeFs, "readFile");
        const append = await storage.append(
          SESSION,
          "message",
          { text: "增量" },
          { durable: true }
        );
        expect(append.seq).toBe(1000);
        expect(reads).not.toHaveBeenCalled();
        reads.mockRestore();
        expect((await readFile(file(), "utf8")).split("\n").filter(Boolean)).toHaveLength(1001);
      });

      it("discards only an incomplete tail before appending the next sequence", async () => {
        await writeFile(file(), line(0) + '{"version":2,"seq":1,"payload":"断');
        await storage.append(SESSION, "message", { text: "继续" }, { durable: true });
        const restored = await storage.read(SESSION);
        expect(restored.writable).toBe(true);
        expect(restored.records.map((record) => record.seq)).toEqual([0, 1]);
        expect((await readFile(file(), "utf8")).startsWith(line(0))).toBe(true);
      });

      it("preserves unknown kinds and fields when later records are appended", async () => {
        const unknown =
          JSON.stringify({
            ...JSON.parse(line(0)),
            kind: "future_feature",
            futureField: { intact: true },
          }) + "\n";
        await writeFile(file(), unknown);
        await storage.append(SESSION, "message", { text: "继续" });
        expect((await readFile(file(), "utf8")).startsWith(unknown)).toBe(true);
        expect((await storage.read(SESSION)).records[0].kind).toBe("future_feature");
      });

      it("keeps a complete malformed record and refuses to guess its sequence", async () => {
        const original = line(0) + "broken complete record\n" + line(2);
        await writeFile(file(), original);
        await expect(storage.append(SESSION, "message", {})).rejects.toThrow(/sequence|writ/i);
        expect(await readFile(file(), "utf8")).toBe(original);
      });

      it("freezes subsequent appends when writing a record fails", async () => {
        await storage.append(SESSION, "message", { text: "保留" });
        const originalOpen = nodeFs.open;
        const spy = jest
          .spyOn(nodeFs, "open")
          .mockImplementation(async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await originalOpen(...args);
            if (args[0] === file())
              jest.spyOn(handle, "write").mockRejectedValueOnce(new Error("Disk write failed"));
            return handle;
          });
        await expect(storage.append(SESSION, "message", {})).rejects.toThrow("Disk write failed");
        spy.mockRestore();
        await expect(storage.append(SESSION, "message", {})).rejects.toThrow(/frozen|fail/i);
        expect((await storage.read(SESSION)).records).toHaveLength(1);
      });

      it("drops a failed usage fact without freezing, cuts its partial bytes, and reuses its sequence (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        await storage.append(SESSION, "message", { text: "保留" });
        const originalOpen = nodeFs.open;
        const spy = jest
          .spyOn(nodeFs, "open")
          .mockImplementation(async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await originalOpen(...args);
            if (args[0] === file()) {
              const writeBytes = handle.write.bind(handle) as (
                buffer: Uint8Array,
                offset: number,
                length: number,
                position: number | null
              ) => Promise<{ bytesWritten: number }>;
              const tornWrite = async (
                buffer: Uint8Array,
                offset: number,
                length: number,
                position: number | null
              ) => {
                await writeBytes(buffer, offset, Math.floor(length / 2), position);
                throw new Error("Disk write failed");
              };
              jest
                .spyOn(handle, "write")
                .mockImplementationOnce(tornWrite as unknown as typeof handle.write);
            }
            return handle;
          });
        await expect(
          storage.append(SESSION, "usage", { totalTokens: 3 }, { discardOnFailure: true })
        ).rejects.toThrow("Disk write failed");
        spy.mockRestore();
        const next = await storage.append(SESSION, "message", { text: "继续" }, { durable: true });
        const restored = await storage.read(SESSION);
        expect(next.seq).toBe(1);
        expect(restored.writable).toBe(true);
        expect(restored.warnings).toEqual([]);
        expect(restored.records.map((record) => [record.seq, record.payload])).toEqual([
          [0, { text: "保留" }],
          [1, { text: "继续" }],
        ]);
      });

      it("times out a stalled usage write, skips expired queued facts, and resumes in sequence after the original write finishes (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        const quick = new NodeJournalStorage(directory, 20);
        await quick.append(SESSION, "message", { text: "保留" });
        let release!: () => void;
        let started!: () => void;
        let finished!: () => void;
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const writing = new Promise<void>((resolve) => {
          started = resolve;
        });
        const completed = new Promise<void>((resolve) => {
          finished = resolve;
        });
        const originalOpen = nodeFs.open;
        let writes = 0;
        jest
          .spyOn(nodeFs, "open")
          .mockImplementation(async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await originalOpen(...args);
            if (args[0] === file()) {
              const write = handle.write.bind(handle);
              jest
                .spyOn(handle, "write")
                .mockImplementation(async (...values: Parameters<typeof handle.write>) => {
                  writes++;
                  started();
                  await held;
                  const result = await write(...values);
                  finished();
                  return result;
                });
            }
            return handle;
          });
        jest.useFakeTimers();
        const usage = quick.append(SESSION, "usage", {}, { discardOnFailure: true });
        const usageResult = expect(usage).rejects.toBeInstanceOf(JournalConfirmationTimeout);
        await writing;
        const queued = quick.append(SESSION, "message", { text: "过期，不能迟到保存" });
        const queuedResult = expect(queued).rejects.toBeInstanceOf(JournalConfirmationTimeout);
        await jest.advanceTimersByTimeAsync(21);
        await Promise.all([usageResult, queuedResult]);
        const blockedResult = expect(
          quick.append(SESSION, "message", { text: "仍在等待" })
        ).rejects.toBeInstanceOf(JournalConfirmationTimeout);
        await jest.advanceTimersByTimeAsync(21);
        await blockedResult;
        expect(writes).toBe(1);
        release();
        await completed;
        jest.useRealTimers();
        jest.restoreAllMocks();
        const next = await quick.append(SESSION, "message", { text: "恢复后" });
        expect(next.seq).toBe(2);
        expect((await quick.read(SESSION)).records.map((entry) => [entry.seq, entry.kind])).toEqual(
          [
            [0, "message"],
            [1, "usage"],
            [2, "message"],
          ]
        );
      });

      it("keeps later records writable while a durable record waits for disk confirmation (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        await storage.append(SESSION, "message", { text: "保留" });
        const stall = stallConfirmations(file());
        const durable = storage.append(SESSION, "message", { text: "确认" }, { durable: true });
        const later = await storage.append(SESSION, "message", { text: "后续" });
        expect(later.seq).toBe(2);
        stall.release();
        expect((await durable).seq).toBe(1);
      });

      it("drops a usage fact that the operating system refuses to write and keeps the journal writable (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        await storage.append(SESSION, "message", { text: "保留" });
        await chmod(file(), 0o444);
        await expect(
          storage.append(SESSION, "usage", { totalTokens: 3 }, { discardOnFailure: true })
        ).rejects.toThrow();
        await chmod(file(), 0o644);
        const next = await storage.append(SESSION, "message", { text: "继续" }, { durable: true });
        const restored = await storage.read(SESSION);
        expect(next.seq).toBe(1);
        expect(restored.warnings).toEqual([]);
        expect(restored.records.map((record) => [record.seq, record.payload])).toEqual([
          [0, { text: "保留" }],
          [1, { text: "继续" }],
        ]);
      });

      it("does not expose a final session file when initial persistence fails", async () => {
        const originalOpen = nodeFs.open;
        jest
          .spyOn(nodeFs, "open")
          .mockImplementation(async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await originalOpen(...args);
            if (String(args[0]).endsWith(".tmp"))
              jest.spyOn(handle, "sync").mockRejectedValueOnce(new Error("Initial sync failed"));
            return handle;
          });
        await expect(storage.append(SESSION, "session_created", {})).rejects.toThrow(
          "Initial sync failed"
        );
        expect(await readdir(directory)).toEqual([]);
      });
    });

    describe("read()", () => {
      it("reads a missing session as an empty writable journal without creating files", async () => {
        expect(await storage.read(SESSION)).toEqual({ records: [], writable: true, warnings: [] });
        expect(await readdir(directory)).toEqual([]);
      });

      it("ignores an incomplete final line while preserving complete records", async () => {
        await writeFile(file(), line(0) + line(1).slice(0, -1));
        const restored = await storage.read(SESSION);
        expect(restored.records.map((record) => record.seq)).toEqual([0]);
        expect(restored.warnings).toHaveLength(1);
        expect(await readFile(file(), "utf8")).toBe(line(0) + line(1).slice(0, -1));
      });

      it("isolates an uninterpretable record with a known sequence while keeping later records readable and appendable", async () => {
        const unrecognizedEnvelope = JSON.stringify({ version: 3, seq: 1, kind: "future" }) + "\n";
        await writeFile(file(), line(0) + unrecognizedEnvelope + line(2));
        const restored = await storage.read(SESSION);
        expect(restored.records.map((record) => record.seq)).toEqual([0, 2]);
        expect(restored.writable).toBe(true);
        expect(restored.warnings).toHaveLength(1);
        expect((await storage.append(SESSION, "message", {})).seq).toBe(3);
        expect(await readFile(file(), "utf8")).toContain(unrecognizedEnvelope);
      });

      it.each([
        [0, 2],
        [0, 0],
        [1, 0],
      ])(
        "detects noncontinuous sequence order %j without renumbering",
        async (...sequence: number[]) => {
          await writeFile(file(), sequence.map((seq) => line(seq)).join(""));
          const restored = await storage.read(SESSION);
          expect(restored.writable).toBe(false);
          expect(restored.records.map((record) => record.seq)).toEqual(sequence);
        }
      );

      it("rejects a path-like session identity before touching storage", async () => {
        await expect(storage.read("../outside")).rejects.toThrow(/identifier/i);
        expect(await readdir(directory)).toEqual([]);
      });
    });

    describe("list()", () => {
      it("lists only new journal identities without opening older JSON histories", async () => {
        await writeFile(file(), line(0));
        await writeFile(join(directory, `${OTHER}.json`), "old unreadable history");
        await writeFile(join(directory, "unrelated.jsonl"), "unrelated");
        expect(await storage.list()).toEqual([SESSION]);
      });

      it("returns an empty list before its directory exists", async () => {
        expect(await new NodeJournalStorage(join(directory, "missing")).list()).toEqual([]);
      });
    });

    describe("flush()", () => {
      it("waits for queued records and makes them readable from another instance", async () => {
        const pending = storage.append(SESSION, "message", { text: "已保存" });
        await storage.flush(SESSION);
        expect((await new NodeJournalStorage(directory).read(SESSION)).records).toEqual([
          await pending,
        ]);
      });

      it("reports a confirmation that runs past its limit without freezing later writes (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        const quick = new NodeJournalStorage(directory, 20);
        await quick.append(SESSION, "message", { text: "保留" });
        const stall = stallConfirmations(file());
        await expect(quick.flush(SESSION)).rejects.toBeInstanceOf(JournalConfirmationTimeout);
        stall.release();
        expect((await quick.append(SESSION, "message", { text: "之后" })).seq).toBe(1);
      });

      it("freezes later writes when synchronization fails", async () => {
        await storage.append(SESSION, "message", {});
        const originalOpen = nodeFs.open;
        const spy = jest
          .spyOn(nodeFs, "open")
          .mockImplementation(async (...args: Parameters<typeof nodeFs.open>) => {
            const handle = await originalOpen(...args);
            if (args[0] === file())
              jest.spyOn(handle, "sync").mockRejectedValueOnce(new Error("Disk sync failed"));
            return handle;
          });
        await expect(storage.flush(SESSION)).rejects.toThrow("Disk sync failed");
        spy.mockRestore();
        await expect(storage.append(SESSION, "message", {})).rejects.toThrow(/frozen|fail/i);
        expect((await storage.read(SESSION)).writable).toBe(false);
      });
    });

    describe("redact()", () => {
      it("clears only selected records while retaining sequence references and unknown bytes (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const parent = await storage.append(SESSION, "message", { text: "主聊天保留" });
        await storage.append(SESSION, "subagent_state", {
          childId: "child-a",
          text: "删除的上下文",
        });
        const unknown =
          JSON.stringify({
            version: 2,
            seq: 2,
            kind: "future_record",
            occurredAt: 12,
            origin: "observed",
            payload: { text: "未知原文" },
            future: true,
          }) + "\n";
        await nodeFs.appendFile(file(), unknown);
        await storage.read(SESSION);
        const pending = storage.append(SESSION, "message", { text: "排队保留" });
        await storage.redact(SESSION, (entry) => entry.kind === "subagent_state");
        await pending;
        const bytes = await readFile(file(), "utf8");
        expect(bytes).not.toContain("删除的上下文");
        expect(bytes).toContain(unknown);
        expect((await storage.read(SESSION)).records).toMatchObject([
          parent,
          { seq: 1, kind: "redacted", payload: {} },
          { seq: 2, kind: "future_record" },
          { seq: 3, payload: { text: "排队保留" } },
        ]);
        expect((await storage.append(SESSION, "message", {})).seq).toBe(4);
        expect(await readdir(directory)).toEqual([`${SESSION}.jsonl`]);
      });

      it("preserves the original when replacing the journal fails (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.append(SESSION, "subagent_state", { text: "原件" });
        const original = await readFile(file(), "utf8");
        jest.spyOn(nodeFs, "rename").mockRejectedValueOnce(new Error("Replace failed"));
        await expect(storage.redact(SESSION, () => true)).rejects.toThrow("Replace failed");
        expect(await readFile(file(), "utf8")).toBe(original);
      });

      it("rejects uncertain sequences without replacing the recovery copy (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const original = line(0) + "broken\n" + line(2);
        await writeFile(file(), original);
        await expect(storage.redact(SESSION, () => true)).rejects.toThrow(/sequence|writ/i);
        expect(await readFile(file(), "utf8")).toBe(original);
      });

      it("keeps external edits made while deletion is preparing and freezes further writes (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.append(SESSION, "subagent_state", { text: "原件" });
        const original = await readFile(file(), "utf8");
        const link = nodeFs.link;
        jest.spyOn(nodeFs, "link").mockImplementationOnce(async (...args) => {
          await link(...args);
          await nodeFs.appendFile(file(), line(1, { text: "外部新内容" }));
        });
        await expect(storage.redact(SESSION, () => true)).rejects.toThrow(/changed/i);
        expect(await readFile(file(), "utf8")).toBe(original + line(1, { text: "外部新内容" }));
        await expect(storage.append(SESSION, "message", {})).rejects.toThrow(/frozen|fail/i);
      });

      it("retains a recoverable original beside the replacement if directory synchronization fails (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.append(SESSION, "subagent_state", { text: "原件" });
        const original = await readFile(file(), "utf8");
        const rename = nodeFs.rename;
        let renamed = false;
        jest.spyOn(nodeFs, "rename").mockImplementationOnce(async (...args) => {
          await rename(...args);
          renamed = true;
        });
        const open = nodeFs.open;
        jest.spyOn(nodeFs, "open").mockImplementation(async (...args) => {
          const handle = await open(...args);
          if (args[0] === directory && renamed)
            jest.spyOn(handle, "sync").mockRejectedValueOnce(new Error("Directory sync failed"));
          return handle;
        });
        await expect(storage.redact(SESSION, () => true)).rejects.toThrow(/Directory sync failed/);
        const backup = (await readdir(directory)).find((name) => name.endsWith(".redact.backup"));
        expect(backup).toBeDefined();
        expect(await readFile(join(directory, backup!), "utf8")).toBe(original);
        await expect(storage.append(SESSION, "message", {})).rejects.toThrow(/frozen|fail/i);
      });

      it("does not create files when the journal is absent or no records belong to the selection (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.redact(SESSION, () => true);
        expect(await readdir(directory)).toEqual([]);
        await storage.append(SESSION, "message", { text: "保留" });
        const original = await readFile(file(), "utf8");
        await storage.redact(SESSION, () => false);
        expect(await readFile(file(), "utf8")).toBe(original);
        expect(await readdir(directory)).toEqual([`${SESSION}.jsonl`]);
      });
    });

    describe("remove()", () => {
      it("waits for pending writes and removes only the explicitly selected journal", async () => {
        const first = storage.append(SESSION, "message", {});
        const second = storage.append(OTHER, "message", {});
        await storage.remove(SESSION);
        await Promise.all([first, second]);
        expect(await storage.list()).toEqual([OTHER]);
        expect((await storage.read(SESSION)).records).toEqual([]);
      });
    });
  });

  describe("getNodeJournalStorage()", () => {
    it("shares a single writer for the same absolute directory", () => {
      expect(getNodeJournalStorage(directory)).toBe(getNodeJournalStorage(join(directory, ".")));
    });
  });

  describe("createDurableFile()", () => {
    it("atomically creates a complete file in a new directory and never replaces existing bytes", async () => {
      const destination = join(directory, "nested", "data", "content");
      expect(await createDurableFile(destination, new Uint8Array([1, 2, 255]))).toBe(true);
      expect(await createDurableFile(destination, new Uint8Array([9]))).toBe(false);
      expect(new Uint8Array(await readFile(destination))).toEqual(new Uint8Array([1, 2, 255]));
      expect(await readdir(join(directory, "nested", "data"))).toEqual(["content"]);
    });

    it("creates the file without looping when Windows mkdir returns a \\\\?\\ prefixed path (https://github.com/ItsDalk-Lane/Scribe/issues/75)", async () => {
      const originalPlatform = process.platform;
      Object.defineProperty(process, "platform", { value: "win32", configurable: true });
      const destination = join(directory, "win", "nested", "content");
      const realMkdir = nodeFs.mkdir.bind(nodeFs);
      const mkdirSpy = jest.spyOn(nodeFs, "mkdir").mockImplementation(async (target, options) => {
        await realMkdir(target, options);
        return `\\\\?\\${String(target)}`;
      });
      try {
        expect(await createDurableFile(destination, new Uint8Array([4, 5]))).toBe(true);
        expect(new Uint8Array(await readFile(destination))).toEqual(new Uint8Array([4, 5]));
      } finally {
        mkdirSpy.mockRestore();
        Object.defineProperty(process, "platform", {
          value: originalPlatform,
          configurable: true,
        });
      }
    });
  });
});
