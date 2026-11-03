import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
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
    it("attributes a symlinked copy of the managed file to the managed skill", () => {
      const root = mkdtempSync(join(tmpdir(), "scribe-skill-"));
      const canonical = join(root, "skills", "review", "SKILL.md");
      mkdirSync(dirname(canonical), { recursive: true });
      writeFileSync(canonical, "x");
      const linkRoot = join(root, ".claude", "skills");
      mkdirSync(linkRoot, { recursive: true });
      symlinkSync(dirname(canonical), join(linkRoot, "review"));
      const linked = join(linkRoot, "review", "SKILL.md");
      expect(
        skillRuntimeItem({ ...skill, filePath: canonical, dirPath: dirname(canonical) }, "claude", [
          { ...observed, location: linked },
        ]).availability
      ).toBe("loaded");
      rmSync(root, { recursive: true, force: true });
    });
    it("does not let another file with the same name claim the managed skill's availability", () => {
      const other = { ...observed, id: "other", location: "/elsewhere/review/SKILL.md" };
      expect(skillRuntimeItem(skill, "claude", [other]).availability).toBe("manual_only");
    });
    it("accepts an unambiguous runtime-only name when no file path was reported", () => {
      expect(
        skillRuntimeItem(skill, "claude", [
          { id: "runtime:review", name: "review", source: "runtime", availability: "loaded" },
        ]).availability
      ).toBe("loaded");
    });
    it("keeps a configured managed skill switchable as manual when runtime evidence is unavailable", () => {
      expect(skillRuntimeItem(skill, "claude")).toMatchObject({
        availability: "manual_only",
        canDisable: true,
      });
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
