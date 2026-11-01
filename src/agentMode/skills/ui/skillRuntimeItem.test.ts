import { skillRuntimeItem } from "./skillRuntimeItem";
import type { Skill } from "@/agentMode/skills/types";
import type { AgentExtensionItem } from "@/agentMode/session/extensionInventory";

const skill: Skill = {
  name: "review",
  description: "Review notes",
  filePath: "/vault/scribe/skills/review/SKILL.md",
  dirPath: "/vault/scribe/skills/review",
  body: "",
  enabledAgents: ["claude"],
  location: { kind: "canonical" },
};

const observed: AgentExtensionItem = {
  id: skill.filePath,
  name: "review",
  source: "project",
  location: skill.filePath,
  availability: "loaded",
};

describe("skillRuntimeItem", () => {
  describe("skillRuntimeItem()", () => {
    it("uses a loaded report for the exact managed file and exposes its switch", () => {
      expect(skillRuntimeItem(skill, "claude", [observed])).toMatchObject({
        availability: "loaded",
        canDisable: true,
      });
    });
    it("does not attribute another file with the same name to the managed skill", () => {
      const other = { ...observed, id: "other", location: "/elsewhere/review/SKILL.md" };
      expect(skillRuntimeItem(skill, "claude", [other]).availability).toBeUndefined();
    });
    it("accepts an unambiguous runtime-only name when no file path was reported", () => {
      expect(
        skillRuntimeItem(skill, "claude", [
          { id: "runtime:review", name: "review", source: "runtime", availability: "loaded" },
        ]).availability
      ).toBe("loaded");
    });
    it("keeps a configured skill unknown when runtime evidence is unavailable", () => {
      expect(skillRuntimeItem(skill, "claude").availability).toBeUndefined();
    });
    it("allows an unshared managed skill to be enabled after a completed check", () => {
      expect(skillRuntimeItem({ ...skill, enabledAgents: [] }, "claude", [])).toMatchObject({
        availability: "disabled",
        canEnable: true,
      });
    });
    it("locks a project skill when switching it would require a separate migration", () => {
      expect(
        skillRuntimeItem(
          { ...skill, location: { kind: "project", agentDirs: ["claude"] } },
          "claude",
          [observed]
        )
      ).toMatchObject({ availability: "loaded", canDisable: false });
    });
  });
});
