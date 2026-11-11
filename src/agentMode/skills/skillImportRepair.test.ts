import { attemptSkillImportRepair } from "@/agentMode/skills/skillImportRepair";
import { parseSkillFile } from "@/agentMode/skills/skillFormat";

// 导入暂存区自动修复：仅两类安全瑕疵，修复副本必须通过严格校验，原始字节不动。
// https://github.com/ItsDalk-Lane/Scribe/issues/44
describe("skillImportRepair", () => {
  describe("attemptSkillImportRepair()", () => {
    it("quotes an unquoted description containing a colon and reports the line change", () => {
      const original = "---\nname: fixable\ndescription: Use ffmpeg: converts media\n---\nBody\n";
      const repaired = attemptSkillImportRepair(original);
      expect(repaired).not.toBeNull();
      expect(repaired!.changes).toEqual([
        {
          before: "description: Use ffmpeg: converts media",
          after: 'description: "Use ffmpeg: converts media"',
        },
      ]);
      expect(repaired!.content).toContain('description: "Use ffmpeg: converts media"');
      expect(() => parseSkillFile(repaired!.content, "fixable")).not.toThrow();
      expect(original).toBe(
        "---\nname: fixable\ndescription: Use ffmpeg: converts media\n---\nBody\n"
      );
    });

    it("normalizes lenient boolean switches to YAML booleans with line changes", () => {
      const original =
        '---\nname: fixable\ndescription: Works\nuser-invocable: yes\ndisable-model-invocation: "0"\n---\nBody\n';
      const repaired = attemptSkillImportRepair(original);
      expect(repaired).not.toBeNull();
      expect(repaired!.changes).toEqual([
        { before: "user-invocable: yes", after: "user-invocable: true" },
        { before: 'disable-model-invocation: "0"', after: "disable-model-invocation: false" },
      ]);
      const parsed = parseSkillFile(repaired!.content, "fixable");
      expect(parsed.frontmatter.userInvocable).toBe(true);
      expect(parsed.frontmatter.disableModelInvocation).toBe(false);
    });

    it("keeps already valid content unrepaired and returns null", () => {
      expect(
        attemptSkillImportRepair("---\nname: fine\ndescription: Works\n---\nBody\n")
      ).toBeNull();
    });

    it("returns null for a quoted description even when it contains a colon", () => {
      expect(
        attemptSkillImportRepair('---\nname: fine\ndescription: "Use ffmpeg: media"\n---\nBody\n')
      ).toBeNull();
    });

    it("returns null when the remaining issues are beyond the safe repairs", () => {
      expect(attemptSkillImportRepair("---\ndescription: no name here\n---\nBody\n")).toBeNull();
      expect(
        attemptSkillImportRepair("---\nname: Broken Name\ndescription: Works\n---\nBody\n")
      ).toBeNull();
    });

    it("never touches indented metadata lines or the body", () => {
      const original =
        "---\nname: fixable\ndescription: Use ffmpeg: converts media\nmetadata:\n  note: plain value\n---\nuser-invocable: yes\n";
      const repaired = attemptSkillImportRepair(original);
      expect(repaired).not.toBeNull();
      expect(repaired!.changes).toHaveLength(1);
      expect(repaired!.content).toContain("  note: plain value");
      expect(repaired!.content.endsWith("---\nuser-invocable: yes\n")).toBe(true);
    });
  });
});
