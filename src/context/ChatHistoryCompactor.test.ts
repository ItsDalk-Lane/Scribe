import { compactAssistantOutput } from "./ChatHistoryCompactor";

describe("ChatHistoryCompactor", () => {
  describe("compactAssistantOutput()", () => {
    it("returns text without tool results unchanged", () => {
      const output = "This is a short response without tool results.";
      expect(compactAssistantOutput(output)).toBe(output);
    });

    it("compacts the text parts of a multimodal array and leaves image parts untouched", () => {
      const largeContent = "B".repeat(10000);
      const textItem = {
        type: "text",
        text: `<note_context><path>note.md</path><content>${largeContent}</content></note_context>`,
      };
      const imageItem = { type: "image_url", url: "data:image/png;base64,..." };
      const output = [textItem, imageItem];

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(Array.isArray(result)).toBe(true);
      const resultArray = result as Array<{ text: string; type: string }>;
      expect(resultArray[0].text.length).toBeLessThan(textItem.text.length);
      expect(resultArray[1]).toEqual(imageItem);
    });

    it("never compacts a selected_text block however large", () => {
      const largeContent = "X".repeat(20000);
      const output = `<selected_text>
<content>${largeContent}</content>
</selected_text>`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });
      expect(result).toBe(output);
    });

    it("returns non-string, non-array content as-is", () => {
      const output = { some: "object" };
      expect(compactAssistantOutput(output as unknown as string)).toBe(output);
    });

    it("compacts an oversized note_context block into a prior_context preview that keeps its headings", () => {
      const largeContent = `## Section 1
${"Content for section 1. ".repeat(200)}

## Section 2
${"Content for section 2. ".repeat(200)}`;

      const output = `<note_context>
<title>My Note</title>
<path>notes/mynote.md</path>
<content>${largeContent}</content>
</note_context>`;

      const result = compactAssistantOutput(output, { verbatimThreshold: 1000 });

      expect(typeof result).toBe("string");
      expect((result as string).length).toBeLessThan(output.length);
      expect(result).toContain('<prior_context source="notes/mynote.md" type="note">');
      expect(result).toContain("## Section 1");
      expect(result).toContain("## Section 2");
    });
  });
});
