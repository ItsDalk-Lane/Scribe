import {
  getSourceType,
  isRecoverable,
  extractSourceFromBlock,
  extractContentFromBlock,
  CONTEXT_BLOCK_TYPES,
} from "./contextBlockRegistry";

describe("contextBlockRegistry", () => {
  describe("CONTEXT_BLOCK_TYPES", () => {
    it("registers every context block tag the prompt builders emit", () => {
      expect(CONTEXT_BLOCK_TYPES.map((block) => block.tag)).toEqual([
        "note_context",
        "active_note",
        "embedded_note",
        "web_tab_context",
        "active_web_tab",
        "youtube_video_context",
        "selected_text",
        "web_selected_text",
      ]);
    });
  });

  describe("getSourceType()", () => {
    it("classifies note-producing tags as note", () => {
      expect(getSourceType("note_context")).toBe("note");
      expect(getSourceType("active_note")).toBe("note");
      expect(getSourceType("embedded_note")).toBe("note");
    });

    it("classifies web-tab tags as url", () => {
      expect(getSourceType("web_tab_context")).toBe("url");
      expect(getSourceType("active_web_tab")).toBe("url");
    });

    it("classifies the YouTube tag as youtube", () => {
      expect(getSourceType("youtube_video_context")).toBe("youtube");
    });

    it("classifies selected-text blocks", () => {
      expect(getSourceType("selected_text")).toBe("selected_text");
      expect(getSourceType("web_selected_text")).toBe("selected_text");
    });

    it("returns unknown for an unregistered tag", () => {
      expect(getSourceType("random_tag")).toBe("unknown");
    });
  });

  describe("isRecoverable()", () => {
    it("marks note, web-tab, and YouTube blocks as recoverable", () => {
      expect(isRecoverable("note_context")).toBe(true);
      expect(isRecoverable("web_tab_context")).toBe(true);
      expect(isRecoverable("youtube_video_context")).toBe(true);
    });

    it("marks selected-text blocks as not recoverable", () => {
      expect(isRecoverable("selected_text")).toBe(false);
      expect(isRecoverable("web_selected_text")).toBe(false);
    });

    it("treats an unregistered tag as not recoverable", () => {
      expect(isRecoverable("unknown_type")).toBe(false);
    });
  });

  describe("extractSourceFromBlock()", () => {
    it("extracts the path from a note block", () => {
      const xml = `<note_context>
<title>My Note</title>
<path>folder/my-note.md</path>
<content>Content here</content>
</note_context>`;
      expect(extractSourceFromBlock(xml, "note_context")).toBe("folder/my-note.md");
    });

    it("extracts the URL from a web_tab_context block", () => {
      const xml = `<web_tab_context>
<url>https://example.com/page</url>
<content>Content</content>
</web_tab_context>`;
      expect(extractSourceFromBlock(xml, "web_tab_context")).toBe("https://example.com/page");
    });

    it("returns an empty string for a block type with no source extractor", () => {
      const xml = `<selected_text><content>Just text</content></selected_text>`;
      expect(extractSourceFromBlock(xml, "selected_text")).toBe("");
    });
  });

  describe("extractContentFromBlock()", () => {
    it("returns the text inside the content tag", () => {
      const xml = `<note_context>
<title>Title</title>
<content>This is the content</content>
</note_context>`;
      expect(extractContentFromBlock(xml)).toBe("This is the content");
    });

    it("returns the whole block when it has no content tag", () => {
      const xml = "<note>Plain text</note>";
      expect(extractContentFromBlock(xml)).toBe(xml);
    });
  });
});
