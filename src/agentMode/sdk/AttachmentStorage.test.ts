import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { NodeAttachmentStorage } from "@/agentMode/sdk/AttachmentStorage";

describe("AttachmentStorage", () => {
  describe("NodeAttachmentStorage", () => {
    let directory: string;
    let storage: NodeAttachmentStorage;
    const bytes = new Uint8Array([0, 255, 12, 42, 128]);

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "scribe-attachments-"));
      storage = new NodeAttachmentStorage(directory);
    });

    afterEach(async () => {
      await rm(directory, { recursive: true, force: true });
    });

    describe("constructor()", () => {
      it("requires an absolute directory", () => {
        expect(() => new NodeAttachmentStorage("relative")).toThrow(/absolute/i);
      });
    });

    describe("put()", () => {
      it("stores exact raw bytes under their SHA256 fingerprint", async () => {
        const fingerprint = await storage.put(bytes);
        expect(fingerprint).toBe(createHash("sha256").update(bytes).digest("hex"));
        expect(new Uint8Array(await readFile(join(directory, fingerprint)))).toEqual(bytes);
        expect(await readdir(directory)).toEqual([fingerprint]);
      });

      it("deduplicates simultaneous stores of the same content", async () => {
        const fingerprints = await Promise.all([
          storage.put(bytes),
          storage.put(bytes),
          new NodeAttachmentStorage(directory).put(bytes),
        ]);
        expect(new Set(fingerprints).size).toBe(1);
        expect(await readdir(directory)).toEqual([fingerprints[0]]);
      });

      it("keeps distinct binary contents under separate fingerprints", async () => {
        const first = await storage.put(bytes);
        const second = await storage.put(new Uint8Array([0, 255, 12]));
        expect(first).not.toBe(second);
        expect(await readdir(directory)).toHaveLength(2);
      });

      it("preserves a corrupt existing attachment instead of overwriting it", async () => {
        const fingerprint = createHash("sha256").update(bytes).digest("hex");
        await writeFile(join(directory, fingerprint), "corrupted");
        await expect(storage.put(bytes)).rejects.toThrow(/fingerprint|corrupt/i);
        expect(await readFile(join(directory, fingerprint), "utf8")).toBe("corrupted");
      });
    });

    describe("get()", () => {
      it("retrieves exact attachment content from a fresh instance", async () => {
        const fingerprint = await storage.put(bytes);
        expect(await new NodeAttachmentStorage(directory).get(fingerprint)).toEqual(bytes);
      });

      it("rejects a path-like fingerprint", async () => {
        await expect(storage.get("../outside")).rejects.toThrow(/fingerprint/i);
      });

      it("reports missing content without creating a replacement", async () => {
        await expect(storage.get("a".repeat(64))).rejects.toThrow();
        expect(await readdir(directory)).toEqual([]);
      });
    });
  });
});
