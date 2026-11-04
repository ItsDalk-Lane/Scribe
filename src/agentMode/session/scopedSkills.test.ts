import { filterSkillsForScope } from "@/agentMode/session/scopedSkills";

describe("scopedSkills", () => {
  describe("filterSkillsForScope()", () => {
    const shared = {
      name: "shared",
      dirPath: "/vault/Scribe/skills/shared",
      location: { kind: "canonical" },
    };
    const first = {
      name: "first",
      dirPath: "/vault/first/.scribe/skills/first",
      location: { kind: "project" },
    };
    const second = {
      name: "second",
      dirPath: "/vault/second/.scribe/skills/second",
      location: { kind: "project" },
    };
    it("keeps shared skills and only the current project's registered directory", () => {
      expect(
        filterSkillsForScope([shared, first, second], "/vault/first", ".scribe/skills")
      ).toEqual([shared, first]);
      expect(
        filterSkillsForScope([shared, first, second], "/vault/second", ".scribe/skills")
      ).toEqual([shared, second]);
      expect(filterSkillsForScope([shared, first, second], null, ".scribe/skills")).toEqual([
        shared,
      ]);
    });
    it("rejects sibling prefixes and returns the same empty slice for absent matches", () => {
      const empty = filterSkillsForScope([second], "/vault/first", ".scribe/skills");
      expect(empty).toBe(filterSkillsForScope([first], "/vault/firs", ".scribe/skills"));
      expect(Object.isFrozen(empty)).toBe(true);
    });
  });
});
