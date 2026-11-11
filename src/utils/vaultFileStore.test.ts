import { FileSystemAdapter, type Vault } from "obsidian";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";

function memoryVault() {
  const files = new Map<string, string>();
  const adapter = {
    exists: async (path: string) => files.has(path),
    read: async (path: string) => files.get(path)!,
    write: jest.fn(async (path: string, content: string) => {
      files.set(path, content);
    }),
    rename: jest.fn(async (from: string, to: string) => {
      if (files.has(to)) throw new Error("Destination file already exists");
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    remove: jest.fn(async (path: string) => {
      files.delete(path);
    }),
  };
  return { files, adapter, vault: { adapter } as unknown as Vault };
}

describe("vaultFileStore", () => {
  describe("assertScribePath()", () => {
    it("accepts plugin files and rejects other directories and parent traversal", async () => {
      const { vault } = memoryVault();
      await expect(assertScribePath(vault, ".scribe/secrets/test.json")).resolves.toBeUndefined();
      await expect(assertScribePath(vault, "other/test.json")).rejects.toThrow();
      await expect(assertScribePath(vault, ".scribe/../other.json")).rejects.toThrow();
    });
    it("rejects a hidden root or child folder that is a symbolic link", async () => {
      const root = await mkdtemp(join(tmpdir(), "scribe-store-"));
      const outside = await mkdtemp(join(tmpdir(), "scribe-outside-"));
      const Adapter = FileSystemAdapter as unknown as new (base: string) => FileSystemAdapter;
      const vault = { adapter: new Adapter(root) } as unknown as Vault;
      try {
        await symlink(outside, join(root, ".scribe"), "dir");
        await expect(assertScribePath(vault, ".scribe/secrets/test.json")).rejects.toThrow(
          "快捷链接"
        );
        await rm(join(root, ".scribe"));
        await mkdir(join(root, ".scribe"));
        await symlink(outside, join(root, ".scribe", "secrets"), "dir");
        await expect(assertScribePath(vault, ".scribe/secrets/test.json")).rejects.toThrow(
          "快捷链接"
        );
      } finally {
        await rm(root, { recursive: true, force: true });
        await rm(outside, { recursive: true, force: true });
      }
    });
  });
  describe("writeVaultFile()", () => {
    it("creates an unindexed plugin file and leaves no staging file", async () => {
      const { vault, files } = memoryVault();
      await writeVaultFile(vault, ".scribe/test.json", "new", null);
      expect([...files]).toEqual([[".scribe/test.json", "new"]]);
    });
    it("atomically creates and replaces desktop files when the Obsidian adapter refuses overwrite", async () => {
      const root = await mkdtemp(join(tmpdir(), "scribe-store-"));
      const Adapter = FileSystemAdapter as unknown as new (base: string) => FileSystemAdapter;
      const adapter = Object.assign(new Adapter(root), {
        exists: async (path: string) =>
          access(join(root, path)).then(
            () => true,
            () => false
          ),
        read: async (path: string) => readFile(join(root, path), "utf8"),
        write: async (path: string, contents: string) => writeFile(join(root, path), contents),
        remove: async (path: string) => rm(join(root, path)),
        rename: jest.fn(async (from: string, to: string) => {
          if (await adapter.exists(to)) throw new Error("Destination file already exists");
          await rename(join(root, from), join(root, to));
        }),
      });
      const vault = { adapter } as unknown as Vault;
      try {
        await mkdir(join(root, ".scribe"));
        await writeVaultFile(vault, ".scribe/test.json", "original", null);
        await writeVaultFile(vault, ".scribe/test.json", "updated", "original");
        expect(await readFile(join(root, ".scribe/test.json"), "utf8")).toBe("updated");
        await writeVaultFile(vault, ".scribe/test.json", "latest");
        expect(await readFile(join(root, ".scribe/test.json"), "utf8")).toBe("latest");
        expect(await readdir(join(root, ".scribe"))).toEqual(["test.json"]);
        expect(adapter.rename).not.toHaveBeenCalled();
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
    it("preserves non-filesystem originals and removes staging when overwrite is unsupported", async () => {
      const { vault, files } = memoryVault();
      files.set(".scribe/test.json", "original");
      await expect(writeVaultFile(vault, ".scribe/test.json", "new", "original")).rejects.toThrow(
        "Destination file already exists"
      );
      expect([...files]).toEqual([[".scribe/test.json", "original"]]);
    });
    it("rejects creating over an existing file", async () => {
      const { vault, files } = memoryVault();
      files.set(".scribe/test.json", "original");
      await expect(writeVaultFile(vault, ".scribe/test.json", "new", null)).rejects.toThrow();
      expect(files.get(".scribe/test.json")).toBe("original");
    });
    it("preserves the previous file when staging fails", async () => {
      const { vault, files, adapter } = memoryVault();
      files.set(".scribe/test.json", "original");
      adapter.write.mockRejectedValueOnce(new Error("disk full"));
      await expect(writeVaultFile(vault, ".scribe/test.json", "new", "original")).rejects.toThrow(
        "disk full"
      );
      expect([...files]).toEqual([[".scribe/test.json", "original"]]);
    });
    it("refuses to replace a file changed by another writer", async () => {
      const { vault, files } = memoryVault();
      files.set(".scribe/test.json", "external edit");
      await expect(writeVaultFile(vault, ".scribe/test.json", "new", "original")).rejects.toThrow();
      expect(files.get(".scribe/test.json")).toBe("external edit");
    });
  });
});
