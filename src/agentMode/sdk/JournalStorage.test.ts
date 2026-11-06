import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
const nodeFs = jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");
import {
  createDurableFile,
  getNodeJournalStorage,
  NodeJournalStorage,
} from "@/agentMode/sdk/JournalStorage";

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
    jest.restoreAllMocks();
    await rm(directory, { recursive: true, force: true });
  });

  describe("NodeJournalStorage", () => {
    describe("constructor()", () => {
      it("rejects a relative directory", () => {
        expect(() => new NodeJournalStorage("relative")).toThrow(/absolute/i);
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
  });
});
