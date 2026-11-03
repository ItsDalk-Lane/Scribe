import { DEFAULT_SETTINGS } from "@/constants";
import { BUILTIN_SKILLS } from "@/builtinSkills/builtinSkills";
import {
  availableBuiltinAgents,
  reconcileBuiltinSkills,
  type BuiltinPreferences,
} from "./reconcileBuiltinSkills";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import type { BuiltinSeedFs } from "./seedBuiltinSkills";

jest.mock("@/logger", () => ({ logError: jest.fn(), logInfo: jest.fn(), logWarn: jest.fn() }));
jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: jest.fn(),
}));

const mockIsObsidianCliEnabled = jest.mocked(isObsidianCliEnabled);

const ISSUE = "https://github.com/logancyang/obsidian-copilot/issues/3022";
const folder = "copilot/skills";
function fixture(preferences?: BuiltinPreferences) {
  const files = new Map<string, string>();
  const dirs = new Set<string>();
  const fs: BuiltinSeedFs = {
    exists: async (path) => files.has(path) || dirs.has(path),
    read: async (path) => {
      if (!files.has(path)) throw new Error("unreadable");
      return files.get(path)!;
    },
    write: async (path, content) => {
      files.set(path, content);
    },
    mkdir: async (path) => {
      dirs.add(path);
    },
    removeDir: async (path) => {
      for (const file of files.keys()) {
        if (file.startsWith(`${path}/`)) files.delete(file);
      }
      for (const dir of dirs) {
        if (dir === path || dir.startsWith(`${path}/`)) dirs.delete(dir);
      }
    },
  };
  const settings = {
    ...DEFAULT_SETTINGS,
    agentMode: { ...DEFAULT_SETTINGS.agentMode, skills: { ...DEFAULT_SETTINGS.agentMode.skills } },
  };
  settings.agentMode.skills.builtinPreferences = preferences;
  const options = {
    folder,
    fs,
    settings,
    availableAgents: [] as string[],
    registeredAgents: ["claude", "codex", "opencode"],
  };
  return {
    files,
    dirs,
    options,
    path: (name: string) => `${folder}/${name}/SKILL.md`,
  };
}

describe("reconcileBuiltinSkills", () => {
  describe("availableBuiltinAgents()", () => {
    it("reuses the ready agent list when membership is unchanged https://github.com/logancyang/obsidian-copilot/issues/3022", () => {
      const previous = ["claude"];
      expect(
        availableBuiltinAgents({ claude: { kind: "ready", source: "managed" } }, previous)
      ).toBe(previous);
    });

    it(`preserves a known ready agent during checking without enabling an unverified first install ${ISSUE}`, () => {
      expect(
        availableBuiltinAgents(
          {
            claude: { kind: "checking", source: "custom" },
            codex: { kind: "checking", source: "custom" },
            opencode: { kind: "ready", source: "managed" },
          },
          ["claude"]
        )
      ).toEqual(["claude", "opencode"]);
      expect(
        availableBuiltinAgents(
          { claude: { kind: "absent" }, codex: { kind: "error", message: "incompatible" } },
          ["claude", "codex"]
        )
      ).toEqual([]);
    });
  });
  describe("reconcileBuiltinSkills()", () => {
    beforeEach(() => {
      mockIsObsidianCliEnabled.mockReturnValue(true);
    });

    it("creates no obsidian-cli folder while Obsidian's command line interface is off, and keeps a synced copy for devices that have it on https://github.com/Brevilabs/obsidian-copilot-private/issues/726", async () => {
      const f = fixture({});
      f.options.availableAgents = ["opencode"];
      mockIsObsidianCliEnabled.mockReturnValue(false);
      await reconcileBuiltinSkills(f.options);
      expect(f.files.has(f.path("obsidian-cli"))).toBe(false);
      expect(f.files.has(f.path("obsidian-markdown"))).toBe(true);

      mockIsObsidianCliEnabled.mockReturnValue(true);
      await reconcileBuiltinSkills(f.options);
      const content = f.files.get(f.path("obsidian-cli"));
      expect(content).toBeDefined();

      mockIsObsidianCliEnabled.mockReturnValue(false);
      await reconcileBuiltinSkills(f.options);
      expect(f.files.get(f.path("obsidian-cli"))).toBe(content);
    });

    it(`keeps canonical metadata stable across devices and retains existing files without a local agent ${ISSUE}`, async () => {
      const skill = BUILTIN_SKILLS[0];
      const f = fixture();
      f.options.availableAgents = ["claude"];
      await reconcileBuiltinSkills(f.options);
      const content = f.files.get(f.path(skill.name));
      expect(parseSkillFile(content!, skill.name).frontmatter.enabledAgents).toEqual([
        "claude",
        "codex",
        "opencode",
      ]);
      f.options.availableAgents = ["codex"];
      f.options.settings.agentMode.skills.builtinPreferences = undefined;
      await reconcileBuiltinSkills(f.options);
      expect(f.files.get(f.path(skill.name))).toBe(content);
      expect(f.options.settings.agentMode.skills.builtinPreferences).toBeUndefined();
      f.options.availableAgents = [];
      await reconcileBuiltinSkills(f.options);
      expect(f.files.get(f.path(skill.name))).toBe(content);
      const userPath = `${folder}/${skill.name}/references/personal.md`;
      f.files.set(userPath, "personal reference");
      f.options.settings.agentMode.skills.builtinPreferences = { [skill.name]: { disabled: true } };
      await reconcileBuiltinSkills(f.options);
      expect(f.files.has(f.path(skill.name))).toBe(true);
      expect(f.files.get(userPath)).toBe("personal reference");
    });
    it(`preserves current-name user content containing a body marker with no agents and with an available agent ${ISSUE}`, async () => {
      const skill = BUILTIN_SKILLS[0];
      const f = fixture();
      const content = `---\nname: ${skill.name}\ndescription: A user-owned skill.\n---\nExample:\n  copilot-builtin-version: "1"`;
      f.files.set(f.path(skill.name), content);
      await reconcileBuiltinSkills(f.options);
      expect(f.files.get(f.path(skill.name))).toBe(content);
      f.options.availableAgents = ["claude"];
      await expect(reconcileBuiltinSkills(f.options)).rejects.toThrow(
        "A user-owned skill occupies"
      );
      expect(f.files.get(f.path(skill.name))).toBe(content);
    });
    it(`reports incomplete writes instead of claiming installation succeeded ${ISSUE}`, async () => {
      const f = fixture();
      f.options.availableAgents = ["claude"];
      f.options.fs.write = async () => {
        throw new Error("disk full");
      };
      await expect(reconcileBuiltinSkills(f.options)).rejects.toThrow(
        "Could not install built-in skill"
      );
    });
    it(`creates no folders without an available agent and records no opt-outs for unavailable agents ${ISSUE}`, async () => {
      const f = fixture();
      await reconcileBuiltinSkills(f.options);
      expect(f.files.size).toBe(0);
      expect(f.dirs.size).toBe(0);
      expect(
        f.options.settings.agentMode.skills.builtinPreferences?.[BUILTIN_SKILLS[0].name]
      ).toBeUndefined();
    });
    it("leaves an opted-out built-in skill unseeded for its disabled agents", async () => {
      const skill = BUILTIN_SKILLS[0];
      const f = fixture({ [skill.name]: { disabled: true, disabledAgents: ["claude"] } });
      f.options.availableAgents = ["claude"];
      await reconcileBuiltinSkills(f.options);
      expect(f.files.has(f.path(skill.name))).toBe(false);
    });

    it(`uses defaults for a newly bundled skill without adding or changing preferences ${ISSUE}`, async () => {
      const first = BUILTIN_SKILLS[0];
      const f = fixture({ [first.name]: { disabledAgents: ["opencode"] } });
      const preferences = f.options.settings.agentMode.skills.builtinPreferences;
      const added = {
        ...first,
        name: "new-bundled-skill",
        skillMd: first.skillMd.replaceAll(first.name, "new-bundled-skill"),
      };
      try {
        (BUILTIN_SKILLS as (typeof added)[]).push(added);
        f.options.availableAgents = ["claude"];
        await reconcileBuiltinSkills(f.options);
        expect(f.files.has(f.path(added.name))).toBe(true);
        expect(f.options.settings.agentMode.skills.builtinPreferences).toBe(preferences);
        expect(preferences).toEqual({ [first.name]: { disabledAgents: ["opencode"] } });
      } finally {
        (BUILTIN_SKILLS as (typeof added)[]).pop();
      }
    });
  });
});
