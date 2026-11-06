import { buildSkillEditorContent } from "@/agentMode/skills/ui/skillEditorContent";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";

describe("skillEditorContent", () => {
  describe("buildSkillEditorContent()", () => {
    it("shows every proposed field in a complete descriptor without changing body whitespace", () => {
      const content = buildSkillEditorContent(
        "review-notes",
        'Review: "notes"',
        "  Read every note\n\n"
      );
      const parsed = parseSkillFile(content, "review-notes");
      expect(parsed.frontmatter.description).toBe('Review: "notes"');
      expect(parsed.body).toBe("  Read every note\n\n");
    });
    it("keeps invalid proposed names visible so the confirmation editor can correct them", () => {
      expect(buildSkillEditorContent("Bad Name", "Review", "Read")).toContain('name: "Bad Name"');
    });
  });
});
