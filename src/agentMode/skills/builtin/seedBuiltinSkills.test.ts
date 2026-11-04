import { removeSeededBuiltin, seedBuiltinSkills, type BuiltinSeedFs } from "./seedBuiltinSkills";
import type { BuiltinSkill } from "@/builtinSkills/builtinSkills";

jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn() }));

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

    it("preserves user-modified scribe-enabled-agents when upgrading a builtin", async () => {
      const disabledMd = skill(1).skillMd.replace(
        "scribe-enabled-agents: claude, codex, opencode",
        "scribe-enabled-agents: claude"
      );
      const fs = memFs({ [MD]: disabledMd, [SCRIPT]: "// script v1" });
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [skill(2)] });

      const written = fs.files.get(MD) ?? "";
      expect(written).toContain("scribe-enabled-agents: claude\n");
      expect(written).not.toContain("scribe-enabled-agents: claude, codex, opencode");
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

  describe("removeSeededBuiltin", () => {
    it("removes the whole managed directory including user additions and leaves sibling skills intact", async () => {
      const definition = {
        ...skill(1),
        files: [{ path: "references/owned.md", content: "owned" }],
      };
      const fs = memFs();
      await seedBuiltinSkills({ skillsFolderRelPath: FOLDER, fs, skills: [definition] });
      const root = `${FOLDER}/${definition.name}`;
      fs.files.set(`${root}/references/my-notes.md`, "personal reference");
      fs.dirs.add(`${root}/themes`);
      fs.files.set(`${root}/themes/custom.css`, "personal theme");
      const sibling = `${root}-extra`;
      fs.dirs.add(sibling);
      fs.files.set(`${sibling}/SKILL.md`, "sibling skill");

      expect(await removeSeededBuiltin(FOLDER, definition.name, fs)).toBe("removed");
      expect([...fs.files.entries()]).toEqual([[`${sibling}/SKILL.md`, "sibling skill"]]);
      expect([...fs.dirs].filter((dir) => dir === root || dir.startsWith(`${root}/`))).toEqual([]);
      expect(fs.dirs.has(sibling)).toBe(true);
      expect(fs.dirs.has(FOLDER)).toBe(true);
    });

    it("removes a marked skill without requiring a catalog entry", async () => {
      const path = `${FOLDER}/unknown/SKILL.md`;
      const fs = memFs({ [path]: skill(1).skillMd });
      expect(await removeSeededBuiltin(FOLDER, "unknown", fs)).toBe("removed");
      expect(fs.files.size).toBe(0);
    });
  });
});
