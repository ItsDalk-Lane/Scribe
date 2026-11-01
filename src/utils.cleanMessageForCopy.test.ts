import { cleanMessageForCopy } from "./utils";

describe("utils", () => {
  describe("cleanMessageForCopy()", () => {
    it("preserves normal Markdown content", () => {
      const input = `# Heading
This is a normal message with:
- Bullet points
- Code blocks: \`const x = 1;\`
- **Bold** and *italic* text

\`\`\`javascript
function test() {
  return true;
}
\`\`\`

More content here.`;
      expect(cleanMessageForCopy(input)).toBe(input);
    });

    it("removes multi-line think blocks", () => {
      const input = "Start\n<think>\nLine 1 of thought\nLine 2 of thought\n</think>\nEnd";
      expect(cleanMessageForCopy(input)).toBe("Start\n\nEnd");
    });

    it("collapses runs of blank lines to a single blank line", () => {
      expect(cleanMessageForCopy("Text\n\n\n\n\nMore text")).toBe("Text\n\nMore text");
    });

    it("trims leading and trailing whitespace", () => {
      expect(cleanMessageForCopy("\n\n  Content with spaces  \n\n")).toBe("Content with spaces");
    });

    it("returns an empty string for an empty message or one made only of removable blocks", () => {
      expect(cleanMessageForCopy("")).toBe("");
      expect(cleanMessageForCopy("<think>Only a thought</think>")).toBe("");
    });
  });
});
