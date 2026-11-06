import {
  mkdtemp,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate as nodeSetImmediate } from "node:timers";
import {
  normalizeSkillImportName,
  prepareSkillImportDescription,
  readSkillPackage,
  SKILL_IMPORT_MAX_FILES,
} from "@/agentMode/skills/skillImport";

const fs = jest.requireActual<typeof import("node:fs")>("node:fs");

const content = (name: string) =>
  `---\nname: ${name}\ndescription: A reusable workflow\nmetadata:\n  custom: preserve-me\n---\nFull body\n`;

function zip(entries: { path: string; data?: string; mode?: number; size?: number }[]): Uint8Array {
  const local: Buffer[] = [];
  const directory: Buffer[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = Buffer.from(entry.path);
    const data = Buffer.from(entry.data ?? "");
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt32LE(data.length, 18);
    header.writeUInt32LE(entry.size ?? data.length, 22);
    header.writeUInt16LE(name.length, 26);
    local.push(header, name, data);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50);
    central.writeUInt16LE(0x0314, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(entry.size ?? data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(((entry.mode ?? 0o100644) * 65536) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    directory.push(central, name);
    offset += header.length + name.length + data.length;
  }
  const central = Buffer.concat(directory.map((part) => new Uint8Array(part)));
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(central.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(
    Buffer.concat([...local, central, end].map((part) => new Uint8Array(part)))
  );
}

describe("skillImport", () => {
  let root: string;
  beforeAll(() => {
    Object.defineProperty(window, "setImmediate", {
      value: nodeSetImmediate,
      configurable: true,
    });
  });
  afterAll(() => {
    Reflect.deleteProperty(window, "setImmediate");
  });
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), "scribe-import-")));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  describe("normalizeSkillImportName()", () => {
    it("normalizes names to lowercase hyphens and the existing 64-character limit", () => {
      expect(normalizeSkillImportName("  My_Skill! ")).toBe("my-skill");
      expect(normalizeSkillImportName("a".repeat(80))).toHaveLength(64);
      expect(() => normalizeSkillImportName("中文")).toThrow();
    });
  });

  describe("prepareSkillImportDescription()", () => {
    it("preserves metadata and validates the name against the normalized folder", () => {
      const prepared = prepareSkillImportDescription(content("My_Skill"), "My_Skill");
      expect(prepared).toMatchObject({
        name: "my-skill",
        description: "A reusable workflow",
        renamedFrom: "My_Skill",
      });
      expect(prepared.content).toContain("custom: preserve-me");
      expect(() => prepareSkillImportDescription(content("different"), "folder")).toThrow();
      expect(() => prepareSkillImportDescription("no metadata")).toThrow();
      expect(() => prepareSkillImportDescription("---\nname: []\n---\nbody")).toThrow();
      expect(() =>
        prepareSkillImportDescription(
          content("valid").replace("A reusable workflow", "x".repeat(1025))
        )
      ).toThrow();
    });
  });

  describe("readSkillPackage()", () => {
    it.each(["folder", "zip"])(
      "preserves unknown integer and decimal source text when reading a %s",
      async (kind) => {
        const raw =
          "---\nname: Review_Prose\ndescription: A precise workflow\nprecision: 9007199254740993123456789\nfraction: 0.123456789012345678901234567890123456789\nmetadata:\n  nested-integer: 9007199254740993999999999\n  nested-fraction: 9.87654321098765432109876543210987654321\n---\nFull body\n";
        const source = kind === "folder" ? join(root, "Review_Prose") : join(root, "precise.zip");
        let original: Uint8Array;
        if (kind === "folder") {
          await mkdir(source);
          original = new TextEncoder().encode(raw);
          await writeFile(join(source, "SKILL.md"), original);
        } else {
          original = zip([{ path: "Review_Prose/SKILL.md", data: raw }]);
          await writeFile(source, original);
        }
        const imported = await readSkillPackage(source, "local");
        const description = imported.files.find((file) => file.path === "SKILL.md")!;
        expect(new TextDecoder().decode(description.data)).toBe(
          raw.replace("name: Review_Prose", "name: review-prose")
        );
        expect(
          Array.from(await readFile(kind === "folder" ? join(source, "SKILL.md") : source))
        ).toEqual(Array.from(original));
      }
    );

    it("reads a complete folder and normalizes only its imported copy", async () => {
      const skill = join(root, "My_Skill");
      await mkdir(join(skill, "references"), { recursive: true });
      await writeFile(join(skill, "skill.md"), content("My_Skill"));
      await writeFile(join(skill, "references", "guide.bin"), new Uint8Array([0, 255, 7]));
      const result = await readSkillPackage(skill, "local");
      expect(result.name).toBe("my-skill");
      expect(result.source).toEqual({ kind: "local", origin: skill, displayPath: skill });
      expect(result.files.map((file) => file.path)).toEqual(["SKILL.md", "references/guide.bin"]);
      expect(Buffer.from(result.files[0].data).toString()).toContain("name: my-skill");
      expect(Buffer.from(result.files[0].data).toString()).toContain("custom: preserve-me");
      expect(Array.from(result.files[1].data)).toEqual([0, 255, 7]);
      expect(await readFile(join(skill, "skill.md"), "utf8")).toBe(content("My_Skill"));
      expect(await readdir(root)).toEqual(["My_Skill"]);
    });

    // 扁平单文件技能展开为标准目录束入库。https://github.com/ItsDalk-Lane/Scribe/issues/45
    it("expands a compliant single Markdown file into a standard skill package", async () => {
      const file = join(root, "Flat_Skill.md");
      const original = "---\nname: flat-skill\ndescription: One-file skill\n---\nBody text\n";
      await writeFile(file, original);
      const result = await readSkillPackage(file, "local");
      expect(result.name).toBe("flat-skill");
      expect(result.files.map((entry) => entry.path)).toEqual(["SKILL.md"]);
      expect(new TextDecoder().decode(result.files[0].data)).toContain("name: flat-skill");
      expect(await readFile(file, "utf8")).toBe(original);
    });

    it("derives the flat-file skill name from the file name and reports the rename", async () => {
      const file = join(root, "Note Tidier.md");
      await writeFile(file, content("note-tidier"));
      const result = await readSkillPackage(file, "local");
      expect(result.name).toBe("note-tidier");
    });

    it("rejects a flat file whose declared name does not match its file name", async () => {
      const file = join(root, "other-name.md");
      await writeFile(file, content("flat-skill"));
      await expect(readSkillPackage(file, "local")).rejects.toThrow(/does not match its folder/);
    });

    // 修复链路：确认后安装修复副本，原始文件不变。https://github.com/ItsDalk-Lane/Scribe/issues/44
    it("repairs a colon-description import in the staged copy while keeping the source untouched", async () => {
      const skill = join(root, "colon-skill");
      const original =
        "---\nname: colon-skill\ndescription: Use ffmpeg: converts media\n---\nBody\n";
      await mkdir(skill);
      await writeFile(join(skill, "SKILL.md"), original);
      const result = await readSkillPackage(skill, "local");
      expect(result.repair).toEqual([
        {
          before: "description: Use ffmpeg: converts media",
          after: 'description: "Use ffmpeg: converts media"',
        },
      ]);
      expect(new TextDecoder().decode(result.files[0].data)).toContain(
        'description: "Use ffmpeg: converts media"'
      );
      expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe(original);
    });

    it("keeps an unrepairable skill rejected with its original error", async () => {
      const skill = join(root, "broken-skill");
      await mkdir(skill);
      await writeFile(join(skill, "SKILL.md"), "---\nname: Broken Name\ndescription: Works\n---\n");
      await expect(readSkillPackage(skill, "local")).rejects.toThrow(/Could not import/);
    });

    it("locates exactly one direct nested skill folder", async () => {
      await mkdir(join(root, "review-prose"));
      await writeFile(join(root, "review-prose", "SKILL.md"), content("review-prose"));
      expect((await readSkillPackage(root, "system")).name).toBe("review-prose");
    });

    it("reads an archive with one skill folder and preserves support files", async () => {
      const archive = join(root, "shared.zip");
      await writeFile(
        archive,
        zip([
          { path: "review-prose/skill.md", data: content("review-prose") },
          { path: "review-prose/LICENSE", data: "permission" },
        ])
      );
      const result = await readSkillPackage(archive, "local");
      expect(result.name).toBe("review-prose");
      expect(result.files.map((file) => file.path)).toEqual(["SKILL.md", "LICENSE"]);
      expect(result.source.origin).toBe(archive);
      expect(await readdir(root)).toEqual(["shared.zip"]);
    });

    it("uses the declared name for a ZIP with SKILL.md at its root", async () => {
      const archive = join(root, "download.zip");
      await writeFile(archive, zip([{ path: "SKILL.md", data: content("review-prose") }]));
      expect((await readSkillPackage(archive, "local")).name).toBe("review-prose");
    });

    it("rejects a ZIP where a file is also another member's parent folder", async () => {
      const archive = join(root, "collision.zip");
      await writeFile(
        archive,
        zip([
          { path: "SKILL.md", data: content("review-prose") },
          { path: "scripts", data: "file" },
          { path: "SCRIPTS/run.sh", data: "command" },
        ])
      );
      await expect(readSkillPackage(archive, "local")).rejects.toThrow(/duplicate/);
    });

    it("rejects a source file changed after preflight instead of mixing file revisions", async () => {
      const skill = join(root, "review-prose");
      await mkdir(skill);
      await writeFile(join(skill, "SKILL.md"), content("review-prose"));
      const support = join(skill, "reference.md");
      await writeFile(support, "original");
      const originalRealpath = fs.promises.realpath.bind(fs.promises);
      const spy = jest.spyOn(fs.promises, "realpath").mockImplementation(async (path) => {
        if (path === support) await writeFile(support, "changed after the inventory was read");
        return originalRealpath(path);
      });
      try {
        await expect(readSkillPackage(skill, "local")).rejects.toThrow(/changed/);
      } finally {
        spy.mockRestore();
      }
    });

    it.each(["../outside", "/absolute", "C:/drive", "bad\\path"])(
      "rejects unsafe ZIP member %s before writing any files",
      async (path) => {
        const archive = join(root, "unsafe.zip");
        await writeFile(archive, zip([{ path, data: "secret" }]));
        await expect(readSkillPackage(archive, "local")).rejects.toThrow();
        expect(await readdir(root)).toEqual(["unsafe.zip"]);
      }
    );

    it("rejects ZIP links, duplicate names and declared oversize contents", async () => {
      const archive = join(root, "unsafe.zip");
      for (const entries of [
        [{ path: "link", mode: 0o120777, data: "../outside" }],
        [{ path: "same" }, { path: "SAME" }],
        [{ path: "big", size: 51 * 1024 * 1024 }],
      ]) {
        await writeFile(archive, zip(entries));
        await expect(readSkillPackage(archive, "local")).rejects.toThrow();
      }
    });

    it("rejects symlinks inside a folder instead of following their contents", async () => {
      await writeFile(join(root, "SKILL.md"), content("unused"));
      await writeFile(join(root, "outside"), "private");
      await symlink(join(root, "outside"), join(root, "link"));
      await expect(readSkillPackage(root, "local")).rejects.toThrow(/link|链接/i);
    });

    it("rejects ambiguous descriptions and multiple nested skill folders", async () => {
      const archive = join(root, "ambiguous.zip");
      await writeFile(
        archive,
        zip([
          { path: "SKILL.md", data: content("review-prose") },
          { path: "skill.md", data: content("review-prose") },
        ])
      );
      await expect(readSkillPackage(archive, "local")).rejects.toThrow();
      for (const name of ["one", "two"]) {
        await mkdir(join(root, name));
        await writeFile(join(root, name, "SKILL.md"), content(name));
      }
      await expect(readSkillPackage(root, "local")).rejects.toThrow();
    });

    it("rejects an archive above the file-count limit before decoding it", async () => {
      const archive = join(root, "large.zip");
      await writeFile(
        archive,
        zip(Array.from({ length: SKILL_IMPORT_MAX_FILES + 1 }, (_, i) => ({ path: `${i}.txt` })))
      );
      await expect(readSkillPackage(archive, "local")).rejects.toThrow();
    });

    it("preserves validation failures and stops cancelled work", async () => {
      await expect(readSkillPackage(root, "local")).rejects.toThrow();
      const controller = new AbortController();
      controller.abort();
      await expect(readSkillPackage(root, "local", controller.signal)).rejects.toThrow();
    });
  });
});
