import { seedBuiltinSkills, type BuiltinSeedFs } from "./seedBuiltinSkills";
import { logWarn } from "@/logger";
import type { BuiltinSkill } from "@/builtinSkills/builtinSkills";
import { OBSIDIAN_SKILLS } from "@/builtinSkills/obsidianSkills";

jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));

function memFs(initialFiles: Record<string, string> = {}): BuiltinSeedFs & {
  files: Map<string, string>;
  dirs: Set<string>;
} {
  const files = new Map(Object.entries(initialFiles));
  const dirs = new Set<string>();
  return {
    files,
    dirs,
    exists: async (p) => files.has(p) || dirs.has(p),
    read: async (p) => {
      const v = files.get(p);
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    write: async (p, c) => {
      files.set(p, c);
    },
    mkdir: async (p) => {
      dirs.add(p);
    },
    removeDir: async (p) => {
      for (const file of files.keys()) {
        if (file.startsWith(`${p}/`)) files.delete(file);
      }
      for (const dir of dirs) {
        if (dir === p || dir.startsWith(`${p}/`)) dirs.delete(dir);
      }
    },
  };
}

function skill(version: number): BuiltinSkill {
  return {
    name: "test-helper",
    version,
    skillMd: `---\nname: test-helper\ndescription: d\nmetadata:\n  scribe-enabled-agents: claude, codex, opencode\n  scribe-builtin-version: "${version}"\n---\nbody v${version}`,
    files: [{ path: "helper.sh", content: `// script v${version}` }],
  };
}

function managedPreviousSkillMd(): string {
  return skill(8).skillMd.replaceAll("test-helper", "previous-helper");
}

function renamedSkill(): BuiltinSkill {
  const base = skill(1);
  return {
    ...base,
    name: "renamed-helper",
    skillMd: base.skillMd.replaceAll("test-helper", "renamed-helper"),
    files: [{ path: "renamed-helper.sh", content: "// script v1" }],
  };
}

const FOLDER = "scribe/skills";
const MD = "scribe/skills/test-helper/SKILL.md";
const SCRIPT = "scribe/skills/test-helper/helper.sh";
const LEGACY_RENAMED_MD = "scribe/skills/previous-helper/SKILL.md";
const RENAMED_MD = "scribe/skills/renamed-helper/SKILL.md";
const RENAMED_SCRIPT = "scribe/skills/renamed-helper/renamed-helper.sh";

describe("seedBuiltinSkills", () => {
  describe("seedBuiltinSkills", () => {
    it("is idempotent: skips a skill already present at the current version", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "// user-touched" });
      const { seeded } = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(1)],
      });

      expect(seeded).toEqual([]);
      expect(fs.files.get(SCRIPT)).toBe("// user-touched");
    });

    it("never touches unrelated user skills in the same folder", async () => {
      const userMd = "scribe/skills/my-skill/SKILL.md";
      const fs = memFs({ [userMd]: "user content" });
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(1)] });

      expect(fs.files.get(userMd)).toBe("user content");
    });

    it("still upgrades an unmodified builtin and carries a content baseline forward (https://github.com/ItsDalk-Lane/Scribe/issues/19)", async () => {
      const fs = memFs();
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(1)] });

      const { seeded } = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(2)],
      });

      expect(seeded).toEqual(["test-helper"]);
      expect(fs.files.get(MD)).toContain("body v2");
      expect(fs.files.get(SCRIPT)).toBe("// script v2");
    });

    it("keeps a user-edited SKILL.md body instead of replacing it on update (https://github.com/ItsDalk-Lane/Scribe/issues/19)", async () => {
      const fs = memFs();
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(1)] });
      fs.files.set(MD, (fs.files.get(MD) ?? "").replace("body v1", "body v1 with my notes"));

      const { seeded } = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(2)],
      });

      expect(seeded).toEqual([]);
      expect(fs.files.get(MD)).toContain("my notes");
      expect(fs.files.get(MD)).not.toContain("body v2");
    });

    it("records a baseline for an older install without a hash and defers the update (https://github.com/ItsDalk-Lane/Scribe/issues/19)", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "// script v1" });

      const { seeded } = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(2)],
      });

      expect(seeded).toEqual([]);
      expect(fs.files.get(MD)).toContain("body v1");
      expect(fs.files.get(MD)).toMatch(/scribe-content-hash:/);
    });

    it("reports the skipped update without claiming an inline-metadata baseline was recorded (https://github.com/ItsDalk-Lane/Scribe/issues/19)", async () => {
      const markdown = OBSIDIAN_SKILLS.find((entry) => entry.name === "obsidian-markdown")!;
      const olderContent = markdown.skillMd.replace(
        /metadata:\n {2}scribe-enabled-agents: claude\n {2}scribe-builtin-version: "3"\n {2}scribe-upstream-revision: "([^"]+)"\n/,
        'metadata: { scribe-enabled-agents: claude, scribe-builtin-version: "2", scribe-upstream-revision: "$1" }\n'
      );
      expect(olderContent).not.toBe(markdown.skillMd);
      const directory = `${FOLDER}/${markdown.name}`;
      const fs = memFs({
        [`${directory}/SKILL.md`]: olderContent,
        [`${directory}/references/EMBEDS.md`]: "personal reference edits",
        [`${directory}/my-notes.md`]: "personal notes",
      });
      const original = new Map(fs.files);
      jest.spyOn(fs, "write");
      jest.spyOn(fs, "removeDir");
      jest.mocked(logWarn).mockClear();

      const result = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [markdown],
      });

      expect(result.seeded).toEqual([]);
      expect(fs.files).toEqual(original);
      expect(fs.write).not.toHaveBeenCalled();
      expect(fs.removeDir).not.toHaveBeenCalled();
      expect(logWarn).toHaveBeenCalledWith(
        `[Skills] builtin skill obsidian-markdown lacked a verifiable content baseline, so the v3 update was skipped`
      );
    });

    it("uses the same accurate skipped-update warning when a missing baseline is recorded (https://github.com/ItsDalk-Lane/Scribe/issues/19)", async () => {
      const fs = memFs({ [MD]: skill(1).skillMd, [SCRIPT]: "// script v1" });
      jest.spyOn(fs, "write");
      jest.spyOn(fs, "removeDir");
      jest.mocked(logWarn).mockClear();

      const result = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(2)],
      });

      expect(result.seeded).toEqual([]);
      expect(fs.write).toHaveBeenCalledTimes(1);
      expect(fs.removeDir).not.toHaveBeenCalled();
      expect(fs.files.get(MD)).toContain("body v1");
      expect(fs.files.get(MD)).toMatch(/scribe-content-hash:/);
      expect(fs.files.get(SCRIPT)).toBe("// script v1");
      expect(logWarn).toHaveBeenCalledWith(
        `[Skills] builtin skill test-helper lacked a verifiable content baseline, so the v2 update was skipped`
      );
    });

    it("leaves a folder with another owner's markers and user files unchanged", async () => {
      const otherOwnerMd = skill(1).skillMd.replace(/scribe-/g, "independent-");
      const notes = `${FOLDER}/test-helper/my-notes.md`;
      const fs = memFs({ [MD]: otherOwnerMd, [SCRIPT]: "// user script", [notes]: "my notes" });

      const first = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(2)],
      });
      const second = await seedBuiltinSkills({
        skillsFolderRelPath: FOLDER,
        fs,
        skills: [skill(2)],
      });

      expect(first.seeded).toEqual([]);
      expect(second.seeded).toEqual([]);
      expect(fs.files.get(MD)).toBe(otherOwnerMd);
      expect(fs.files.get(SCRIPT)).toBe("// user script");
      expect(fs.files.get(notes)).toBe("my notes");
    });

    it("preserves user-modified scribe-enabled-agents when upgrading an unmodified builtin (https://github.com/ItsDalk-Lane/Scribe/issues/19)", async () => {
      const fs = memFs();
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(1)] });
      const seededMd = fs.files.get(MD) ?? "";
      fs.files.set(
        MD,
        seededMd.replace(
          "scribe-enabled-agents: claude, codex, opencode",
          "scribe-enabled-agents: claude"
        )
      );

      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(2)] });

      const written = fs.files.get(MD) ?? "";
      expect(written).toContain("scribe-enabled-agents: claude\n");
      expect(written).toContain("body v2");
    });

    it("uses fresh defaults for a new name without reading or modifying its predecessor", async () => {
      const oldMd = managedPreviousSkillMd().replace("claude, codex, opencode", "codex");
      const fs = memFs({ [LEGACY_RENAMED_MD]: oldMd });
      fs.read = jest.fn(async () => {
        throw new Error("unreadable predecessor");
      });
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [renamedSkill()] });
      expect(fs.files.get(RENAMED_MD)).toContain("scribe-enabled-agents: claude, codex, opencode");
      expect(fs.files.get(RENAMED_SCRIPT)).toBe("// script v1");
      expect(fs.files.get(LEGACY_RENAMED_MD)).toBe(oldMd);
      expect(fs.read).not.toHaveBeenCalled();
    });

    it("leaves unreadable targets untouched because ownership cannot be verified", async () => {
      const content = "user-authored content";
      const fs = memFs({ [MD]: content });
      fs.read = async () => {
        throw new Error("temporarily unreadable");
      };
      fs.write = jest.fn(fs.write);
      await expect(
        seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(1)] })
      ).resolves.toEqual({ seeded: [] });
      expect(fs.files.get(MD)).toBe(content);
      expect(fs.write).not.toHaveBeenCalled();
    });
  });
});
