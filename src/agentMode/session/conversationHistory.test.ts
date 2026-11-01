import {
  buildConversationHistoryBlock,
  buildBranchHistoryContent,
  CONVERSATION_HISTORY_MAX_CHARS,
} from "@/agentMode/session/conversationHistory";
import type { AgentChatMessage } from "@/agentMode/session/types";
import { AI_SENDER, USER_SENDER } from "@/constants";

const histMsg = (sender: string, message: string): AgentChatMessage => ({
  id: `${sender}-${message.slice(0, 8)}`,
  sender,
  timestamp: null,
  isVisible: true,
  message,
});

describe("conversationHistory", () => {
  describe("buildBranchHistoryContent()", () => {
    it("preserves all turns, full excerpts, attachment references, and real image blocks", () => {
      const longText = "complete history ".repeat(4_000);
      const excerpt = "full excerpt ".repeat(300);
      const image = { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } };
      const blocks = buildBranchHistoryContent([
        {
          ...histMsg(USER_SENDER, longText),
          content: [image],
          context: {
            notes: [{ path: "notes/attached.md" } as never],
            selectedTextContexts: [
              {
                id: "selection",
                sourceType: "note",
                noteTitle: "Attached",
                notePath: "notes/attached.md",
                startLine: 1,
                endLine: 2,
                content: excerpt,
              },
            ],
            folders: ["notes"],
            tags: ["#research"],
            webTabs: [{ url: "https://example.com", title: "Reference" }],
          },
        },
        histMsg(AI_SENDER, "The inherited answer."),
      ]);
      const text = blocks
        .flatMap((block) => (block.type === "text" ? [block.text] : []))
        .join("\n");
      expect(text).toContain(longText);
      expect(text).toContain(excerpt);
      expect(text).toContain("notes/attached.md");
      expect(text).toContain("https://example.com");
      expect(text).toContain("#research");
      expect(text).toContain("The inherited answer.");
      expect(text).not.toContain("truncated");
      expect(text).not.toContain("omitted");
      expect(blocks).toContainEqual({ type: "image", mimeType: "image/png", data: "AQID" });
    });

    it("refuses missing attachments and images that cannot be sent rather than silently dropping them", () => {
      expect(() =>
        buildBranchHistoryContent([
          { ...histMsg(USER_SENDER, "Attached"), missingAttachments: ["notes/missing.md"] },
        ])
      ).toThrow("notes/missing.md");
      expect(() =>
        buildBranchHistoryContent([
          {
            ...histMsg(USER_SENDER, "Image"),
            content: [{ type: "image_url", image_url: { url: "broken" } }],
          },
        ])
      ).toThrow("unreadable image");
    });

    it("rejects unsupported image formats explicitly instead of replacing them with an omitted-image notice", () => {
      expect(() =>
        buildBranchHistoryContent([
          {
            ...histMsg(USER_SENDER, "Attached photo"),
            content: [{ type: "image_url", image_url: { url: "data:image/heic;base64,AQID" } }],
          },
        ])
      ).toThrow("Cannot inherit image type image/heic");
      expect(
        buildBranchHistoryContent([
          {
            ...histMsg(USER_SENDER, "JPEG"),
            content: [{ type: "image_url", image_url: { url: "data:image/jpg;base64,AQID" } }],
          },
        ])
      ).toContainEqual({ type: "image", mimeType: "image/jpeg", data: "AQID" });
    });

    it("returns no inherited content for an empty transcript", () => {
      expect(buildBranchHistoryContent([])).toEqual([]);
      expect(buildBranchHistoryContent([])).toBe(buildBranchHistoryContent([]));
    });
  });

  describe("buildConversationHistoryBlock()", () => {
    it("renders prior turns labeled by role, framed as read-only history", () => {
      const block = buildConversationHistoryBlock(
        [histMsg(USER_SENDER, "What is the plan?"), histMsg(AI_SENDER, "Here is the plan.")],
        CONVERSATION_HISTORY_MAX_CHARS
      )!;
      expect(block).toContain("<conversation_history>");
      expect(block).toContain("</conversation_history>");
      expect(block).toContain('<turn role="user">');
      expect(block).toContain('<turn role="assistant">');
      expect(block).toContain("What is the plan?");
      expect(block).toContain("Here is the plan.");
      expect(block.toLowerCase()).toContain("do not");
      expect(block.indexOf("What is the plan?")).toBeLessThan(block.indexOf("Here is the plan."));
    });

    it("returns null for an empty transcript", () => {
      expect(buildConversationHistoryBlock([], CONVERSATION_HISTORY_MAX_CHARS)).toBeNull();
    });

    it("drops the oldest turns first and prepends a truncation marker past the cap", () => {
      const big = "x".repeat(400);
      const messages = Array.from({ length: 20 }, (_, i) =>
        histMsg(i % 2 === 0 ? USER_SENDER : AI_SENDER, `turn-${i}-${big}`)
      );
      const block = buildConversationHistoryBlock(messages, 1000)!;
      expect(block).toContain("[earlier conversation truncated]");
      expect(block).not.toContain("turn-0-");
      expect(block).toContain("turn-19-");
    });
  });
});
