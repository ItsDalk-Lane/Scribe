import {
  access,
  mkdtemp,
  mkdir,
  writeFile,
  symlink,
  rm,
  readFile,
  readdir,
  chmod,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { FileSystemAdapter } from "obsidian";
import {
  resolveNativeVaultPath,
  getNativeVaultIdentity,
  readNativeVaultTarget,
  withNativeWriteLock,
  writeNativeVaultTarget,
} from "@/agentMode/sdk/nativeVaultPath";

describe("nativeVaultPath", () => {
  describe("resolveNativeVaultPath", () => {
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
    it("rejects a dangling end symlink instead of treating it as a missing in-vault file", async () => {
      await symlink(join(outside, "not-created-yet.md"), join(root, "looks-safe.md"));
      await expect(resolveNativeVaultPath(adapter, "looks-safe.md", true)).rejects.toThrow(
        /dangling symbolic link/i
      );
      await expect(access(join(outside, "not-created-yet.md"))).rejects.toMatchObject({
        code: "ENOENT",
      });
    });
    it("rejects a missing path beneath a dangling symlinked parent directory", async () => {
      await symlink(join(outside, "missing-dir"), join(root, "linked-dir"));
      await expect(resolveNativeVaultPath(adapter, "linked-dir/new.md", true)).rejects.toThrow(
        /dangling symbolic link/i
      );
      await expect(access(join(outside, "missing-dir"))).rejects.toMatchObject({ code: "ENOENT" });
    });
    it("resolves an in-vault symlink target that actually exists", async () => {
      await symlink(join(root, "notes", "source.md"), join(root, "alias.md"));
      expect(await resolveNativeVaultPath(adapter, "alias.md")).toBe("notes/source.md");
    });
  });

  describe("getNativeVaultIdentity()", () => {
    it("资料库根目录别名共享同一真实资源锁 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const root = await mkdtemp(join(tmpdir(), "scribe-native-root-"));
      let release!: () => void;
      try {
        await mkdir(join(root, "vault"));
        await symlink(join(root, "vault"), join(root, "alias"));
        const real = new FileSystemAdapter();
        real.getBasePath = () => join(root, "vault");
        const alias = new FileSystemAdapter();
        alias.getBasePath = () => join(root, "alias");
        expect(getNativeVaultIdentity(alias)).toBe(getNativeVaultIdentity(real));
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const first = withNativeWriteLock(`${getNativeVaultIdentity(real)}/same.md`, () => held);
        const write = jest.fn(async () => undefined);
        const second = withNativeWriteLock(`${getNativeVaultIdentity(alias)}/same.md`, write);
        await withNativeWriteLock("independent-root-test", async () => undefined);
        expect(write).not.toHaveBeenCalled();
        release();
        await Promise.all([first, second]);
        expect(write).toHaveBeenCalledTimes(1);
      } finally {
        release?.();
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("withNativeWriteLock", () => {
    it("取消排队写入立即返回，后继仍等待当前持锁者 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = withNativeWriteLock("cancelled-queue", () => held);
      const controller = new AbortController();
      const skipped = jest.fn(async () => undefined);
      const cancelled = withNativeWriteLock("cancelled-queue", skipped, controller.signal);
      const rejected = expect(cancelled).rejects.toThrow();
      controller.abort();
      try {
        await rejected;
        expect(skipped).not.toHaveBeenCalled();
        const third = jest.fn(async () => undefined);
        const following = withNativeWriteLock("cancelled-queue", third);
        await withNativeWriteLock("independent-queue", async () => undefined);
        expect(third).not.toHaveBeenCalled();
        release();
        await Promise.all([first, following]);
        expect(third).toHaveBeenCalledTimes(1);
      } finally {
        release();
      }
    });

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
  describe("readNativeVaultTarget()", () => {
    it("最终读取规范目标，拒绝已替换的链接和库外路径 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const root = await mkdtemp(join(tmpdir(), "scribe-native-final-"));
      try {
        await writeFile(join(root, "note.md"), "current");
        expect(readNativeVaultTarget(root, "note.md")).toBe("current");
        await writeFile(join(root, "bom.md"), "\uFEFFcurrent");
        expect(readNativeVaultTarget(root, "bom.md")).toBe("\uFEFFcurrent");
        expect(readNativeVaultTarget(root, "missing.md")).toBeNull();
        await symlink(join(root, "note.md"), join(root, "alias.md"));
        expect(() => readNativeVaultTarget(root, "alias.md")).toThrow(/symbolic link/i);
        expect(() => readNativeVaultTarget(root, "../outside.md")).toThrow(/vault/i);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });

    it("rejects directories as text write targets https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const root = await mkdtemp(join(tmpdir(), "scribe-native-final-"));
      try {
        await mkdir(join(root, "folder"));
        expect(() => readNativeVaultTarget(root, "folder")).toThrow(/regular file/i);
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    });
  });

  describe("writeNativeVaultTarget", () => {
    let root: string;
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "scribe-native-write-"));
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      await rm(root, { recursive: true, force: true });
    });
    it("安全创建和替换文本，过期版本保留现有原件和库内暂存 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await writeNativeVaultTarget(root, "note.md", "A", null);
      await writeNativeVaultTarget(root, "note.md", "B", "A");
      await expect(writeNativeVaultTarget(root, "note.md", "C", "A")).rejects.toThrow(/changed/i);
      expect(await readFile(join(root, "note.md"), "utf8")).toBe("B");
      const stages = await readdir(join(root, ".scribe/write-staging"));
      expect(stages).toHaveLength(1);
      expect(await readFile(join(root, ".scribe/write-staging", stages[0]), "utf8")).toBe("C");
    });
    it("替换现有文件保留常规权限位 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await writeFile(join(root, "note.md"), "before");
      await chmod(join(root, "note.md"), 0o640);
      await writeNativeVaultTarget(root, "note.md", "after", "before");
      expect((await stat(join(root, "note.md"))).mode & 0o777).toBe(0o640);
    });

    it("暂存写入失败不截断原件，也不退回裸覆盖 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      await writeFile(join(root, "note.md"), "original");
      const fs = jest.requireActual<typeof import("node:fs")>("node:fs");
      jest.spyOn(fs, "writeFileSync").mockImplementationOnce(() => {
        throw new Error("ENOSPC");
      });
      await expect(
        writeNativeVaultTarget(root, "note.md", "replacement", "original")
      ).rejects.toThrow("ENOSPC");
      expect(await readFile(join(root, "note.md"), "utf8")).toBe("original");
      expect(await readdir(join(root, ".scribe/write-staging"))).toHaveLength(1);
    });
  });
});
