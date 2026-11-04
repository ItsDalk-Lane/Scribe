import { describeChatDelete, formatChatDeleteNotice } from "@/lib/chatDeleteText";
import { setInterfaceLocale } from "@/lib/i18n";

describe("chatDeleteText", () => {
  afterEach(() => setInterfaceLocale("en"));
  describe("describeChatDelete()", () => {
    it("asks about deleting the Scribe chat", () => {
      expect(describeChatDelete()).toBe("Delete this chat from Scribe?");
    });
    it("shows the confirmation in Chinese", () => {
      setInterfaceLocale("zh-CN");
      expect(describeChatDelete()).toBe("要从 Scribe 删除此聊天吗？");
    });
  });
  describe("formatChatDeleteNotice()", () => {
    it("confirms removal from Scribe", () => {
      expect(formatChatDeleteNotice()).toBe("Chat deleted from Scribe.");
    });
    it("shows the completion in Chinese", () => {
      setInterfaceLocale("zh-CN");
      expect(formatChatDeleteNotice()).toBe("已从 Scribe 删除聊天。");
    });
  });
});
