import { parseTextForPills, $replaceTriggeredTextWithPill } from "./lexicalTextUtils";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor, TextNode } from "lexical";
import { CommandPillNode } from "@/components/chat-components/pills/CommandPillNode";
import { App, TFile } from "obsidian";
import { mockTFolder } from "@/__tests__/mockObsidian";

const MockTFile = TFile as unknown as jest.Mock;

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
}));

const mockApp = {
  workspace: {
    getActiveFile: jest.fn(),
  },
  vault: {
    getMarkdownFiles: jest.fn(),
    getAllLoadedFiles: jest.fn(),
  },
  metadataCache: {
    getFirstLinkpathDest: jest.fn(),
    getFileCache: jest.fn(),
  },
};
const app = mockApp as unknown as App;

const text = (content: string) => ({ type: "text", content });

describe("lexicalTextUtils", () => {
  describe("parseTextForPills()", () => {
    beforeEach(() => {
      jest.clearAllMocks();
      MockTFile.mockImplementation(function (this: Record<string, unknown>) {
        this.basename = "Valid Note";
        this.path = "Valid Note.md";
      });
      mockApp.metadataCache.getFirstLinkpathDest.mockImplementation((noteName: string) =>
        noteName === "Valid Note" || noteName === "Valid Note.md" ? new TFile() : null
      );
      mockApp.workspace.getActiveFile.mockReturnValue(null);
      mockApp.vault.getAllLoadedFiles.mockReturnValue([
        mockTFolder({ path: "Projects", name: "Projects" }),
        mockTFolder({ path: "folder with spaces", name: "folder with spaces" }),
      ]);
    });

    it("keeps URLs and tool-like mentions as ordinary text", () => {
      const input = "Visit https://example.com and ask @vault";
      expect(parseTextForPills(app, input)).toEqual([text(input)]);
    });

    it("keeps URLs beside a recognized note as ordinary text", () => {
      const result = parseTextForPills(app, "https://example.com [[Valid Note]] @websearch");
      expect(result.map(({ type, content }) => [type, content])).toEqual([
        ["text", "https://example.com "],
        ["note-pill", "Valid Note"],
        ["text", " @websearch"],
      ]);
    });

    it("turns a note reference into a note pill between its surrounding text", () => {
      expect(
        parseTextForPills(app, "Check out [[Valid Note]] for more info", { includeNotes: true })
      ).toEqual([
        text("Check out "),
        {
          type: "note-pill",
          content: "Valid Note",
          file: expect.any(TFile) as unknown,
          isActive: false,
        },
        text(" for more info"),
      ]);
    });

    it("turns an existing folder reference into a folder pill between its surrounding text", () => {
      expect(
        parseTextForPills(app, "Files in {Projects} folder", { includeCustomTemplates: true })
      ).toEqual([
        text("Files in "),
        { type: "folder-pill", content: "Projects", folder: expect.any(Object) as unknown },
        text(" folder"),
      ]);
    });

    it("matches a folder whose name contains spaces", () => {
      const result = parseTextForPills(app, "See {folder with spaces} now", {
        includeCustomTemplates: true,
      });

      expect(result.map((part) => part.type)).toEqual(["text", "folder-pill", "text"]);
      expect(result[1].content).toBe("folder with spaces");
    });

    it("keeps unresolvable note references as text", () => {
      expect(
        parseTextForPills(app, "Invalid [[Nonexistent Note]] reference", { includeNotes: true })
      ).toEqual([text("Invalid "), text("[[Nonexistent Note]]"), text(" reference")]);
    });

    it("keeps nonexistent folder references as text", () => {
      expect(
        parseTextForPills(app, "Files in {Nonexistent} folder", { includeCustomTemplates: true })
      ).toEqual([text("Files in "), text("{Nonexistent}"), text(" folder")]);
    });

    it("pills a resolvable note and keeps an unresolvable one as text in the same message", () => {
      const result = parseTextForPills(app, "[[Valid Note]] and [[Nonexistent Note]]", {
        includeNotes: true,
      });

      expect(result.map((part) => [part.type, part.content])).toEqual([
        ["note-pill", "Valid Note"],
        ["text", " and "],
        ["text", "[[Nonexistent Note]]"],
      ]);
    });

    it("returns no segments for empty text", () => {
      expect(parseTextForPills(app, "")).toEqual([]);
    });

    it("splits a note reference containing brackets into two text segments", () => {
      expect(parseTextForPills(app, "[[Note with [brackets]]]", { includeNotes: true })).toEqual([
        text("[[Note with [brackets]]"),
        text("]"),
      ]);
    });
  });
  describe("$replaceTriggeredTextWithPill()", () => {
    it("replaces typed slash text with a command chip that keeps the exact slash text content (https://github.com/ItsDalk-Lane/Scribe/issues/35)", () => {
      const editor = createEditor({
        namespace: "command-chip-insert",
        nodes: [CommandPillNode],
        onError: (error) => {
          throw error;
        },
      });
      editor.setRootElement(document.body.createDiv());
      editor.update(
        () => {
          const paragraph = $createParagraphNode();
          paragraph.append($createTextNode("/rev"));
          $getRoot().clear();
          $getRoot().append(paragraph);
          const textNode = $getRoot().getFirstDescendant();
          (textNode as TextNode).select(4, 4);
          $replaceTriggeredTextWithPill("/", {
            type: "command",
            title: "review-notes",
            data: "skill",
          });
          expect($getRoot().getTextContent()).toBe("/review-notes ");
        },
        { discrete: true }
      );
      expect(editor.getRootElement()?.querySelector(".command-pill-wrapper")).toBeTruthy();
    });
  });
});
