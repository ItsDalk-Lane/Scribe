import { describeChatDelete, formatChatDeleteNotice } from "@/lib/chatDeleteText";
import { setInterfaceLocale } from "@/lib/i18n";

const AGENTS = [
  ["Claude Code", { displayName: "Claude", agentProductName: "Claude Code" }],
  ["Codex", { displayName: "Codex" }],
] as const;

describe("chatDeleteText", () => {
  afterEach(() => setInterfaceLocale("en"));
  describe("describeChatDelete()", () => {
    it("shows Chinese confirmation while preserving the agent's name", () => {
      setInterfaceLocale("zh-CN");
      expect(describeChatDelete({ displayName: "Codex" })).toBe(
        "要从 Scribe 删除此聊天吗？Codex 可能仍会在本机保留此对话的副本。"
      );
      expect(describeChatDelete(undefined)).toBe("要从 Scribe 删除此聊天吗？");
    });
    it.each(AGENTS)("names %s as the agent that may keep its own copy", (name, descriptor) => {
      expect(describeChatDelete(descriptor)).toBe(
        `Delete this chat from Scribe? ${name} may keep its own copy of this conversation on this computer.`
      );
    });

    it("asks only about Scribe when the chat has no known agent", () => {
      expect(describeChatDelete(undefined)).toBe("Delete this chat from Scribe?");
    });
  });

  describe("formatChatDeleteNotice()", () => {
    it("shows Chinese completion text while preserving the agent's name", () => {
      setInterfaceLocale("zh-CN");
      expect(formatChatDeleteNotice({ displayName: "Codex" })).toBe(
        "已从 Scribe 删除聊天。Codex 可能仍保留自己的副本。"
      );
      expect(formatChatDeleteNotice(undefined)).toBe("已从 Scribe 删除聊天。");
    });
    it.each(AGENTS)(
      "says the chat left Scribe and %s may keep its own copy",
      (name, descriptor) => {
        expect(formatChatDeleteNotice(descriptor)).toBe(
          `Chat deleted from Scribe. ${name} may keep its own copy.`
        );
      }
    );

    it("says only that the chat left Scribe when the chat has no known agent", () => {
      expect(formatChatDeleteNotice(undefined)).toBe("Chat deleted from Scribe.");
    });
  });
});
