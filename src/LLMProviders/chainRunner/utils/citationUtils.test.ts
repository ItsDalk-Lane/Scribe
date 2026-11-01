import { processInlineCitations } from "./citationUtils";

describe("citationUtils", () => {
  describe("processInlineCitations()", () => {
    it("keeps ordinary text unchanged when it has no sources section", () => {
      expect(processInlineCitations("A normal answer.")).toBe("A normal answer.");
    });

    it("renders cited note sources as expandable source details", () => {
      const result = processInlineCitations(
        "A cited answer [^1]\n\n#### Sources\n[^1]: [[Project notes]]"
      );
      expect(result).toContain("A cited answer");
      expect(result).toContain('class="copilot-citation-ref"');
      expect(result).toContain("<details");
      expect(result).toContain("Project notes");
    });

    it("keeps the original answer when inline citations are disabled", () => {
      const answer = "An answer [^1]\n\n#### Sources\n[^1]: [[Project notes]]";
      expect(processInlineCitations(answer, false)).toBe(answer);
    });
  });
});
