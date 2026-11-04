import { DEFAULT_SETTINGS } from "@/constants";
import type { ScribeSettings } from "@/settings/model";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import {
  BUILTIN_SKILLS,
  builtinSkillUnavailableReason,
  DEFAULT_BUILTIN_PREFERENCES,
  isBuiltinSkillEnabledFor,
} from "./builtinSkills";

jest.mock("@/services/obsidianCli/ObsidianCliClient", () => ({
  isObsidianCliEnabled: jest.fn(() => true),
}));

const mockIsObsidianCliEnabled = jest.mocked(isObsidianCliEnabled);

function settingsWith(
  builtinPreferences: NonNullable<ScribeSettings["agentMode"]["skills"]["builtinPreferences"]>,
  overrides: Partial<ScribeSettings> = {}
): ScribeSettings {
  return {
    ...DEFAULT_SETTINGS,
    ...overrides,
    agentMode: {
      ...DEFAULT_SETTINGS.agentMode,
      skills: { ...DEFAULT_SETTINGS.agentMode.skills, builtinPreferences },
    },
  };
}

describe("builtinSkills", () => {
  describe("BUILTIN_SKILLS", () => {
    it("ships only the Obsidian format and command line skills", () => {
      expect(BUILTIN_SKILLS.map(({ name }) => name)).toEqual([
        "obsidian-markdown",
        "obsidian-bases",
        "json-canvas",
        "obsidian-cli",
      ]);
    });

    it("keeps every SKILL.md frontmatter version in sync with the numeric version", () => {
      for (const skill of BUILTIN_SKILLS) {
        expect(skill.skillMd).toContain(`scribe-builtin-version: "${skill.version}"`);
      }
    });
  });

  describe("DEFAULT_BUILTIN_PREFERENCES", () => {
    it("keeps every builtin enabled without opt-out defaults", () => {
      expect(DEFAULT_BUILTIN_PREFERENCES).toEqual({});
    });
  });

  describe("builtinSkillUnavailableReason", () => {
    it("leaves every skill available while Obsidian's command line interface is on", () => {
      mockIsObsidianCliEnabled.mockReturnValue(true);
      for (const skill of BUILTIN_SKILLS) {
        expect(builtinSkillUnavailableReason(skill.name)).toBeUndefined();
      }
    });

    it("makes only obsidian-cli unavailable, naming the Obsidian setting, while the command line interface is off", () => {
      mockIsObsidianCliEnabled.mockReturnValue(false);
      expect(builtinSkillUnavailableReason("obsidian-cli")).toBe(
        "Turn on Command line interface in Obsidian's Settings → General to use this skill."
      );
      for (const skill of BUILTIN_SKILLS.filter((skill) => skill.name !== "obsidian-cli")) {
        expect(builtinSkillUnavailableReason(skill.name)).toBeUndefined();
      }
      mockIsObsidianCliEnabled.mockReturnValue(true);
    });
  });

  describe("isBuiltinSkillEnabledFor", () => {
    it("enables a supplied skill for each agent by default", () => {
      expect(isBuiltinSkillEnabledFor(settingsWith({}), "obsidian-markdown", "claude")).toBe(true);
    });
    it("honors a whole-skill opt-out and a per-agent opt-out", () => {
      expect(
        isBuiltinSkillEnabledFor(
          settingsWith({ "obsidian-markdown": { disabled: true } }),
          "obsidian-markdown",
          "claude"
        )
      ).toBe(false);
      const settings = settingsWith({ "obsidian-markdown": { disabledAgents: ["codex"] } });
      expect(isBuiltinSkillEnabledFor(settings, "obsidian-markdown", "codex")).toBe(false);
      expect(isBuiltinSkillEnabledFor(settings, "obsidian-markdown", "claude")).toBe(true);
    });

    it("reports a name that is not a managed builtin as disabled", () => {
      expect(isBuiltinSkillEnabledFor(settingsWith({}), "user-authored", "claude")).toBe(false);
    });
  });
});
