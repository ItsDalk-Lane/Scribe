import { mkdtemp, mkdir, writeFile, symlink, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemAdapter } from "obsidian";
import { resolveNativeVaultPath, withNativeWriteLock } from "@/agentMode/sdk/nativeVaultPath";

describe("nativeVaultPath", () => {
  describe("resolveNativeVaultPath()", () => {
    let root: string;
    let outside: string;
    let adapter: FileSystemAdapter;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "scribe-native-path-"));
      outside = await mkdtemp(join(tmpdir(), "scribe-native-outside-"));
      await mkdir(join(root, "notes"));
      await writeFile(join(root, "notes", "source.md"), "Marker");
      await symlink(outside, join(root, "outside"));
      adapter = new FileSystemAdapter();
      adapter.getBasePath = () => root;
    });
    afterEach(async () => {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    });

    it("normalizes actual vault paths and safely permits a missing descendant for creation", async () => {
      expect(await resolveNativeVaultPath(adapter, "notes\\source.md")).toBe("notes/source.md");
      expect(await resolveNativeVaultPath(adapter, "new/deep/note.md", true)).toBe(
        "new/deep/note.md"
      );
      await expect(resolveNativeVaultPath(adapter, "missing.md")).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
    it("rejects traversal and existing or missing paths beneath an outside symbolic link", async () => {
      await expect(resolveNativeVaultPath(adapter, "../outside.md", true)).rejects.toThrow(
        "inside the current vault"
      );
      await expect(resolveNativeVaultPath(adapter, "outside/secret.md", true)).rejects.toThrow(
        "including symbolic links"
      );
      await expect(resolveNativeVaultPath(adapter, outside)).rejects.toThrow(
        "inside the current vault"
      );
    });
  });

  describe("withNativeWriteLock()", () => {
    it("serializes one target, allows another target and releases a lock after failure", async () => {
      let release!: () => void;
      const pending = new Promise<void>((resolve) => {
        release = resolve;
      });
      const order: string[] = [];
      const first = withNativeWriteLock("one", async () => {
        order.push("first");
        await pending;
        throw new Error("Failed write");
      });
      const second = withNativeWriteLock("one", async () => {
        order.push("second");
        return "saved";
      });
      await withNativeWriteLock("two", async () => {
        order.push("independent");
      });
      expect(order).toEqual(["first", "independent"]);
      const failed = expect(first).rejects.toThrow("Failed write");
      release();
      await failed;
      expect(await second).toBe("saved");
      expect(order).toEqual(["first", "independent", "second"]);
      expect(await withNativeWriteLock("one", async () => "released")).toBe("released");
    });
  });
});
