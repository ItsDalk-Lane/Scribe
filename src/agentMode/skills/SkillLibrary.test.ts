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
import { parseSkillFile, serializeSkillFile } from "./skillFormat";
import { SkillLibrary, fingerprintFiles } from "./SkillLibrary";
import type { SkillPackage } from "./types";
import { readSkillPackage } from "@/agentMode/skills/skillImport";

const CONTENT = "---\nname: review\ndescription: Review notes\n---\nRead carefully.";
function pkg(kind: "local" | "system" | "builtin" = "local", body = CONTENT): SkillPackage {
  return {
    name: "review",
    source: { kind, origin: "/original/review", version: "1" },
    files: [
      { path: "SKILL.md", data: new TextEncoder().encode(body) },
      { path: "assets/picture.bin", data: new Uint8Array([0, 255, 2]) },
    ],
  };
}
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "scribe-library-test-"));
  const Adapter = FileSystemAdapter as unknown as new (base: string) => FileSystemAdapter;
  const adapter = Object.assign(new Adapter(root), {
    exists: async (path: string) =>
      access(join(root, path)).then(
        () => true,
        () => false
      ),
    stat: async (path: string) =>
      (await import("node:fs/promises")).stat(join(root, path)).then(
        (s) => ({ type: s.isDirectory() ? "folder" : "file" }),
        () => null
      ),
    mkdir: async (path: string) => mkdir(join(root, path)),
    read: async (path: string) => readFile(join(root, path), "utf8"),
    readBinary: async (path: string) => {
      const b = await readFile(join(root, path));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
    },
    write: jest.fn(async (path: string, content: string) => {
      await writeFile(join(root, path), content);
    }),
    writeBinary: async (path: string, data: ArrayBuffer) =>
      writeFile(join(root, path), new Uint8Array(data)),
    remove: async (path: string) => rm(join(root, path)),
    rmdir: async (path: string) => rm(join(root, path), { recursive: true }),
    rename: jest.fn(async (from: string, to: string) => {
      await rename(join(root, from), join(root, to));
    }),
    list: async (path: string) => {
      const entries = await readdir(join(root, path), { withFileTypes: true });
      return {
        files: entries.filter((e) => e.isFile()).map((e) => `${path}/${e.name}`),
        folders: entries.filter((e) => e.isDirectory()).map((e) => `${path}/${e.name}`),
      };
    },
  });
  const vault = { adapter } as unknown as Vault;
  return { root, adapter, vault, library: new SkillLibrary(vault) };
}

describe("SkillLibrary", () => {
  const roots: string[] = [];
  const setup = async () => {
    const f = await fixture();
    roots.push(f.root);
    return f;
  };
  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });
  describe("SkillLibrary", () => {
    describe("listFiles()", () => {
      it("lists complete nested file paths without decoding or loading their contents", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const readText = jest.spyOn(f.adapter, "read");
        const readBinary = jest.spyOn(f.adapter, "readBinary");
        expect((await f.library.listFiles("review")).sort()).toEqual([
          "SKILL.md",
          "assets/picture.bin",
        ]);
        expect(readText).not.toHaveBeenCalled();
        expect(readBinary).not.toHaveBeenCalled();
        await expect(f.library.listFiles("../outside")).rejects.toThrow();
      });
    });
    describe("install()", () => {
      it("preserves unknown numeric source text through folder import and the final library write", async () => {
        const f = await setup();
        const source = join(f.root, "source", "Precise_Review");
        await mkdir(source, { recursive: true });
        const raw =
          "---\nname: Precise_Review\ndescription: Preserve numeric metadata\nprecision: 9007199254740993123456789\nfraction: 0.123456789012345678901234567890123456789\nmetadata:\n  nested-precision: 9007199254740993999999999\n  nested-fraction: 9.87654321098765432109876543210987654321\n---\nRead carefully.\n";
        await writeFile(join(source, "SKILL.md"), raw);
        await f.library.install(await readSkillPackage(source, "local"));
        const stored = await f.adapter.read(".scribe/skills/precise-review/SKILL.md");
        expect(stored).toContain("precision: 9007199254740993123456789\n");
        expect(stored).toContain("fraction: 0.123456789012345678901234567890123456789\n");
        expect(stored).toContain("nested-precision: 9007199254740993999999999\n");
        expect(stored).toContain("nested-fraction: 9.87654321098765432109876543210987654321\n");
        expect(parseSkillFile(stored, "precise-review").frontmatter.enabledAgents).toEqual([
          "native",
        ]);
        expect(Array.from(await readFile(join(source, "SKILL.md")))).toEqual(
          Array.from(new TextEncoder().encode(raw))
        );
      });
      it("installs a full package, remembers its source and enables it", async () => {
        const f = await setup();
        await f.library.install(pkg());
        expect(await f.adapter.readBinary(".scribe/skills/review/assets/picture.bin")).toEqual(
          new Uint8Array([0, 255, 2]).buffer
        );
        expect(
          parseSkillFile(await f.adapter.read(".scribe/skills/review/SKILL.md"), "review")
            .frontmatter.enabledAgents
        ).toEqual(["native"]);
        const reopened = new SkillLibrary(f.vault);
        await reopened.load();
        expect(reopened.entry("review")).toMatchObject({
          source: { kind: "local" },
          state: "installed",
        });
      });
      it("rejects cross-source replacement and case-insensitive folder collisions", async () => {
        const f = await setup();
        await f.library.install(pkg());
        await expect(f.library.install(pkg("system"), { replace: true })).rejects.toThrow(
          "another source"
        );
        await expect(
          f.library.install(
            { ...pkg(), source: { kind: "local", origin: "/different/source" } },
            { replace: true }
          )
        ).rejects.toThrow("another source");
        await expect(f.library.install({ ...pkg(), name: "Review" })).rejects.toThrow();
        await f.adapter.mkdir(".scribe/skills/occupied");
        const renamed = {
          ...pkg(),
          name: "occupied",
          files: [
            {
              path: "SKILL.md",
              data: new TextEncoder().encode(CONTENT.replace("name: review", "name: occupied")),
            },
          ],
        };
        await expect(f.library.install(renamed)).rejects.toThrow("Confirm");
      });
      it("restores the original complete package when registry persistence fails", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const original = await f.adapter.read(".scribe/skills/review/SKILL.md");
        f.adapter.write.mockImplementation(async (path: string, content: string) => {
          if (path.includes(".registry.json.")) throw new Error("disk full");
          await writeFile(join(f.root, path), content);
        });
        await expect(
          f.library.install(pkg("local", CONTENT.replace("carefully", "differently")), {
            replace: true,
          })
        ).rejects.toThrow("disk full");
        expect(await f.adapter.read(".scribe/skills/review/SKILL.md")).toBe(original);
        expect(await readdir(join(f.root, ".scribe/skills/.operations"))).toEqual([]);
      });
      it("rejects stale editor content without changing either package", async () => {
        const f = await setup();
        await f.library.install(pkg());
        await expect(
          f.library.install(pkg(), { replace: true, expectedContent: "outdated" })
        ).rejects.toThrow("changed outside");
        expect(await f.adapter.read(".scribe/skills/review/SKILL.md")).toContain("Read carefully");
      });
      it("rejects unsafe members and aborted imports before installing", async () => {
        const f = await setup();
        await expect(
          f.library.install({
            ...pkg(),
            files: [...pkg().files, { path: "../escape", data: new Uint8Array() }],
          })
        ).rejects.toThrow("unsafe");
        const controller = new AbortController();
        controller.abort();
        await expect(f.library.install(pkg(), { signal: controller.signal })).rejects.toThrow();
        expect(await f.adapter.exists(".scribe/skills/review")).toBe(false);
      });
      it.each(["journal", "backup", "target"])(
        "cancels after %s and restores the complete original package",
        async (phase) => {
          const f = await setup();
          await f.library.install(pkg());
          const original = await f.adapter.read(".scribe/skills/review/SKILL.md");
          const controller = new AbortController();
          const originalWrite = f.adapter.write.getMockImplementation()!;
          const originalRename = f.adapter.rename.getMockImplementation()!;
          f.adapter.write.mockImplementation(async (path, content) => {
            await originalWrite(path, content);
            if (phase === "journal" && path.includes("/operation.json.")) controller.abort();
          });
          f.adapter.rename.mockImplementation(async (from, to) => {
            await originalRename(from, to);
            if (
              (phase === "backup" && to.endsWith("/backup")) ||
              (phase === "target" && from.endsWith("/stage"))
            )
              controller.abort();
          });
          await expect(
            f.library.install(pkg("local", CONTENT + " changed"), {
              replace: true,
              signal: controller.signal,
            })
          ).rejects.toThrow();
          expect(await f.adapter.read(".scribe/skills/review/SKILL.md")).toBe(original);
          expect(await readdir(join(f.root, ".scribe/skills/.operations"))).toEqual([]);
        }
      );
      it.each(["damaged", "missing"])(
        "reimports a valid same-source package as disabled when the previous description is %s",
        async (condition) => {
          const f = await setup();
          await f.library.install(pkg());
          if (condition === "missing") await f.adapter.remove(".scribe/skills/review/SKILL.md");
          else await f.adapter.write(".scribe/skills/review/SKILL.md", "damaged metadata");
          await f.library.install(pkg("local", CONTENT + " repaired"), { replace: true });
          const parsed = parseSkillFile(
            await f.adapter.read(".scribe/skills/review/SKILL.md"),
            "review"
          );
          expect(parsed.frontmatter.enabledAgents).toEqual([]);
          expect(parsed.body).toContain("repaired");
          expect(f.library.entry("review")?.source).toMatchObject({
            kind: "local",
            origin: "/original/review",
          });
        }
      );
      it("explicitly restores a damaged builtin package as enabled", async () => {
        const f = await setup();
        await f.library.install(pkg("builtin"));
        await f.adapter.write(".scribe/skills/review/SKILL.md", "damaged metadata");
        await f.library.install(pkg("builtin"), { replace: true, preserveEnabled: false });
        expect(
          parseSkillFile(await f.adapter.read(".scribe/skills/review/SKILL.md"), "review")
            .frontmatter.enabledAgents
        ).toEqual(["native"]);
      });
      it("preserves the imported baseline when saving a local edit", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const baseline = f.library.entry("review")!.baseline;
        await f.library.install(pkg("local", CONTENT + " edited"), {
          replace: true,
          updateBaseline: false,
        });
        expect(f.library.entry("review")!.baseline).toBe(baseline);
        expect(await f.library.fingerprint("review")).not.toBe(baseline);
      });
      it("renames the complete skill while retaining its stable identity and imported baseline", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const original = f.library.entry("review")!;
        const renamed = {
          ...pkg(),
          name: "renamed",
          files: pkg().files.map((file) =>
            file.path === "SKILL.md"
              ? {
                  ...file,
                  data: new TextEncoder().encode(CONTENT.replace("name: review", "name: renamed")),
                }
              : file
          ),
        };
        await f.library.install(renamed, {
          replace: true,
          previousName: "review",
          updateBaseline: false,
        });
        expect(f.library.entry("renamed")).toMatchObject({
          id: original.id,
          baseline: original.baseline,
        });
        expect(await f.adapter.exists(".scribe/skills/review")).toBe(false);
        expect(await f.adapter.readBinary(".scribe/skills/renamed/assets/picture.bin")).toEqual(
          new Uint8Array([0, 255, 2]).buffer
        );
      });
      it("restores the old name and its complete files when renaming cannot commit", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const originalWrite = f.adapter.write.getMockImplementation()!;
        f.adapter.write.mockImplementation(async (path, content) => {
          if (path.includes(".registry.json.")) throw new Error("disk full");
          await originalWrite(path, content);
        });
        const renamed = {
          ...pkg(),
          name: "renamed",
          files: pkg().files.map((file) =>
            file.path === "SKILL.md"
              ? {
                  ...file,
                  data: new TextEncoder().encode(CONTENT.replace("name: review", "name: renamed")),
                }
              : file
          ),
        };
        await expect(
          f.library.install(renamed, { replace: true, previousName: "review" })
        ).rejects.toThrow("disk full");
        expect(await f.adapter.exists(".scribe/skills/renamed")).toBe(false);
        expect(await f.adapter.readBinary(".scribe/skills/review/assets/picture.bin")).toEqual(
          new Uint8Array([0, 255, 2]).buffer
        );
        expect(f.library.entry("review")).toBeDefined();
      });
      it("compares the original registry bytes when recovering a failed update", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const registry = ".scribe/skills/.registry.json";
        const formatted = JSON.stringify(JSON.parse(await f.adapter.read(registry)), null, 2);
        await f.adapter.write(registry, formatted);
        const originalWrite = f.adapter.write.getMockImplementation()!;
        f.adapter.write.mockImplementation(async (path, content) => {
          if (path.includes(".registry.json.")) throw new Error("disk full");
          await originalWrite(path, content);
        });
        await expect(
          f.library.install(pkg("local", CONTENT + " new"), { replace: true })
        ).rejects.toThrow("disk full");
        expect(await f.adapter.read(registry)).toBe(formatted);
        expect(await readdir(join(f.root, ".scribe/skills/.operations"))).toEqual([]);
      });
      it("preserves both packages when rollback fails and restores the original on reopening", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const original = await f.adapter.read(".scribe/skills/review/SKILL.md");
        const originalWrite = f.adapter.write.getMockImplementation()!;
        const originalRename = f.adapter.rename.getMockImplementation()!;
        f.adapter.write.mockImplementation(async (path, content) => {
          if (path.includes(".registry.json.")) throw new Error("disk full");
          await originalWrite(path, content);
        });
        f.adapter.rename.mockImplementation(async (from, to) => {
          if (to.endsWith("/stage")) throw new Error("rollback blocked");
          await originalRename(from, to);
        });
        await expect(
          f.library.install(pkg("local", CONTENT + " new"), { replace: true })
        ).rejects.toThrow("rollback blocked");
        const operation = (await readdir(join(f.root, ".scribe/skills/.operations")))[0];
        expect(
          await f.adapter.read(`.scribe/skills/.operations/${operation}/backup/SKILL.md`)
        ).toBe(original);
        expect(await f.adapter.read(".scribe/skills/review/SKILL.md")).toContain("new");
        f.adapter.write.mockImplementation(originalWrite);
        f.adapter.rename.mockImplementation(originalRename);
        await new SkillLibrary(f.vault).load();
        expect(await f.adapter.read(".scribe/skills/review/SKILL.md")).toBe(original);
        expect(await readdir(join(f.root, ".scribe/skills/.operations"))).toEqual([]);
      });
      it("keeps a committed installation when cleanup fails and finishes cleanup on reopening", async () => {
        const f = await setup();
        const removeSpy = jest
          .spyOn(f.adapter, "rmdir")
          .mockRejectedValue(new Error("cleanup denied"));
        await expect(f.library.install(pkg())).resolves.toBeUndefined();
        expect(await f.adapter.exists(".scribe/skills/review/SKILL.md")).toBe(true);
        removeSpy.mockRestore();
        const reopened = new SkillLibrary(f.vault);
        await reopened.load();
        expect(reopened.entry("review")?.state).toBe("installed");
        expect(await readdir(join(f.root, ".scribe/skills/.operations"))).toEqual([]);
      });
      it("does not replace an unregistered local folder with an imported source", async () => {
        const f = await setup();
        await mkdir(join(f.root, ".scribe/skills/review"), { recursive: true });
        await f.adapter.write(".scribe/skills/review/SKILL.md", CONTENT);
        await expect(f.library.install(pkg("system"), { replace: true })).rejects.toThrow(
          "another source"
        );
        expect(await f.adapter.read(".scribe/skills/review/SKILL.md")).toBe(CONTENT);
      });
    });
    describe("remove()", () => {
      it("remembers builtin uninstallation across reopening while removing all files", async () => {
        const f = await setup();
        await f.library.install(pkg("builtin"));
        await f.library.remove("review");
        const reopened = new SkillLibrary(f.vault);
        await reopened.load();
        expect(reopened.entry("review")?.state).toBe("uninstalled");
        expect(await f.adapter.exists(".scribe/skills/review")).toBe(false);
      });
      it("restores all files and installed state if uninstallation cannot commit", async () => {
        const f = await setup();
        await f.library.install(pkg("builtin"));
        const originalWrite = f.adapter.write.getMockImplementation()!;
        f.adapter.write.mockImplementation(async (path, content) => {
          if (path.includes(".registry.json.")) throw new Error("disk full");
          await originalWrite(path, content);
        });
        await expect(f.library.remove("review")).rejects.toThrow("disk full");
        expect(f.library.entry("review")?.state).toBe("installed");
        expect(await f.adapter.readBinary(".scribe/skills/review/assets/picture.bin")).toEqual(
          new Uint8Array([0, 255, 2]).buffer
        );
        expect(await readdir(join(f.root, ".scribe/skills/.operations"))).toEqual([]);
      });
    });
    describe("load()", () => {
      it.each(["origin", "displayPath", "version"])(
        "rejects a corrupted source %s while retaining the registry and skill files",
        async (field) => {
          const f = await setup();
          await f.library.install(pkg());
          const corrupted = JSON.stringify({
            version: 1,
            entries: f.library.entries().map((entry) => ({
              ...entry,
              source: { ...entry.source, [field]: { damaged: true } },
            })),
          });
          await f.adapter.write(".scribe/skills/.registry.json", corrupted);
          await expect(f.library.load()).rejects.toThrow("source records are damaged");
          expect(await f.adapter.read(".scribe/skills/.registry.json")).toBe(corrupted);
          expect(await f.adapter.exists(".scribe/skills/review/SKILL.md")).toBe(true);
        }
      );
      it("retains damaged source records and refuses to silently recreate them", async () => {
        const f = await setup();
        await f.library.install(pkg());
        await f.adapter.write(".scribe/skills/.registry.json", "bad");
        await expect(f.library.load()).rejects.toThrow();
        expect(await f.adapter.read(".scribe/skills/.registry.json")).toBe("bad");
        expect(await f.adapter.exists(".scribe/skills/review/SKILL.md")).toBe(true);
      });
      it("retains folders without a verifiable operation journal", async () => {
        const f = await setup();
        await mkdir(join(f.root, ".scribe/skills/.operations/foreign"), { recursive: true });
        await f.adapter.write(".scribe/skills/.operations/foreign/notes.txt", "preserve me");
        await expect(f.library.load()).rejects.toThrow();
        expect(await f.adapter.read(".scribe/skills/.operations/foreign/notes.txt")).toBe(
          "preserve me"
        );
      });
      it("retains an externally edited target and its original backup during recovery", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const originalWrite = f.adapter.write.getMockImplementation()!;
        f.adapter.write.mockImplementation(async (path, content) => {
          if (path.includes(".registry.json.")) {
            const target = ".scribe/skills/review/SKILL.md";
            await originalWrite(target, (await f.adapter.read(target)) + " user edit");
            throw new Error("disk full");
          }
          await originalWrite(path, content);
        });
        await expect(
          f.library.install(pkg("local", CONTENT + " imported"), { replace: true })
        ).rejects.toThrow("Both copies");
        f.adapter.write.mockImplementation(originalWrite);
        await expect(new SkillLibrary(f.vault).load()).rejects.toThrow("Both copies");
        expect(await f.adapter.read(".scribe/skills/review/SKILL.md")).toContain("user edit");
        const operation = (await readdir(join(f.root, ".scribe/skills/.operations")))[0];
        expect(
          await f.adapter.read(`.scribe/skills/.operations/${operation}/backup/SKILL.md`)
        ).toContain("Read carefully");
      });
      it("treats an external enablement-only edit as a recovery conflict", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const originalWrite = f.adapter.write.getMockImplementation()!;
        f.adapter.write.mockImplementation(async (path, content) => {
          if (path.includes(".registry.json.")) {
            const target = ".scribe/skills/review/SKILL.md";
            const parsed = parseSkillFile(await f.adapter.read(target), "review");
            await originalWrite(target, serializeSkillFile(parsed, { enabledAgents: [] }));
            throw new Error("disk full");
          }
          await originalWrite(path, content);
        });
        await expect(
          f.library.install(pkg("local", CONTENT + " imported"), { replace: true })
        ).rejects.toThrow("Both copies");
        f.adapter.write.mockImplementation(originalWrite);
        await expect(new SkillLibrary(f.vault).load()).rejects.toThrow("Both copies");
        expect(
          parseSkillFile(await f.adapter.read(".scribe/skills/review/SKILL.md"), "review")
            .frontmatter.enabledAgents
        ).toEqual([]);
      });
      it("refuses to read a recovery journal replaced with a symbolic link", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const originalWrite = f.adapter.write.getMockImplementation()!;
        const originalRename = f.adapter.rename.getMockImplementation()!;
        f.adapter.write.mockImplementation(async (path, content) => {
          if (path.includes(".registry.json.")) throw new Error("disk full");
          await originalWrite(path, content);
        });
        f.adapter.rename.mockImplementation(async (from, to) => {
          if (to.endsWith("/stage")) throw new Error("rollback blocked");
          await originalRename(from, to);
        });
        await expect(
          f.library.install(pkg("local", CONTENT + " new"), { replace: true })
        ).rejects.toThrow();
        f.adapter.write.mockImplementation(originalWrite);
        f.adapter.rename.mockImplementation(originalRename);
        const operation = (await readdir(join(f.root, ".scribe/skills/.operations")))[0];
        const journal = `.scribe/skills/.operations/${operation}/operation.json`;
        const saved = await f.adapter.read(journal);
        const outside = join(f.root, "outside-record.json");
        await writeFile(outside, saved);
        await rm(join(f.root, journal));
        await symlink(outside, join(f.root, journal));
        await expect(new SkillLibrary(f.vault).load()).rejects.toThrow("快捷链接");
        expect(await readFile(outside, "utf8")).toBe(saved);
        expect(await f.adapter.read(".scribe/skills/review/SKILL.md")).toContain("new");
        expect(
          await f.adapter.exists(`.scribe/skills/.operations/${operation}/backup/SKILL.md`)
        ).toBe(true);
      });
    });
    describe("readFiles()", () => {
      it("reads every support file and rejects an unsafe folder", async () => {
        const f = await setup();
        await f.library.install(pkg());
        expect((await f.library.readFiles("review")).map((file) => file.path).sort()).toEqual([
          "SKILL.md",
          "assets/picture.bin",
        ]);
        await expect(f.library.readFiles("../escape")).rejects.toThrow();
      });
      it("does not read adapter results outside the requested skill tree", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const spy = jest
          .spyOn(f.adapter, "list")
          .mockResolvedValue({ files: [".scribe/private.txt"], folders: [] });
        await expect(f.library.readFiles("review")).rejects.toThrow("unsafe child");
        spy.mockRestore();
      });
      it("loads lowercase description names through the text adapter", async () => {
        const f = await setup();
        await f.library.install(pkg());
        await f.adapter.rename(".scribe/skills/review/SKILL.md", ".scribe/skills/review/skill.md");
        const files = await f.library.readFiles("review");
        expect(files.find((file) => file.path === "skill.md")).toBeDefined();
        const lowercase = files.find((file) => file.path === "skill.md")!;
        const parsed = parseSkillFile(new TextDecoder().decode(lowercase.data), "review");
        const disabled = files.map((file) =>
          file === lowercase
            ? {
                ...file,
                data: new TextEncoder().encode(serializeSkillFile(parsed, { enabledAgents: [] })),
              }
            : file
        );
        expect(fingerprintFiles(files, "review")).toBe(fingerprintFiles(disabled, "review"));
      });
    });
    describe("fingerprint()", () => {
      it("detects support file changes after reopening", async () => {
        const f = await setup();
        await f.library.install(pkg());
        const before = await f.library.fingerprint("review");
        await f.adapter.writeBinary(
          ".scribe/skills/review/assets/picture.bin",
          new Uint8Array([1]).buffer
        );
        expect(await f.library.fingerprint("review")).not.toBe(before);
      });
    });
    describe("occupiedNames()", () => {
      it("includes malformed folders while excluding internal transaction folders", async () => {
        const f = await setup();
        await f.library.install(pkg());
        await f.adapter.mkdir(".scribe/skills/Broken");
        expect((await f.library.occupiedNames()).sort()).toEqual(["Broken", "review"]);
      });
    });
    describe("entries()", () => {
      it("returns the registry entries loaded from disk", async () => {
        const f = await setup();
        await f.library.install(pkg());
        expect(f.library.entries()).toHaveLength(1);
        expect(f.library.entries()[0].name).toBe("review");
      });
    });
    describe("entry()", () => {
      it("looks up stored skills without case sensitivity", async () => {
        const f = await setup();
        await f.library.install(pkg());
        expect(f.library.entry("REVIEW")?.name).toBe("review");
        expect(f.library.entry("missing")).toBeUndefined();
      });
    });
  });
  describe("fingerprintFiles()", () => {
    it("keeps fingerprints independent of the system locale's file ordering", () => {
      const compare = jest.spyOn(String.prototype, "localeCompare").mockReturnValue(1);
      try {
        const first = fingerprintFiles(pkg().files, "review");
        compare.mockReturnValue(-1);
        expect(fingerprintFiles(pkg().files, "review")).toBe(first);
      } finally {
        compare.mockRestore();
      }
    });
    it("ignores enablement changes but detects content changes", () => {
      const a = pkg();
      const b = pkg(
        "local",
        CONTENT.replace("---\nRead", "metadata:\n  scribe-enabled-agents: native\n---\nRead")
      );
      expect(fingerprintFiles(a.files, a.name)).toBe(fingerprintFiles(b.files, b.name));
      expect(fingerprintFiles(a.files, a.name)).not.toBe(
        fingerprintFiles(pkg("local", CONTENT + " changed").files, "review")
      );
    });
  });
});
