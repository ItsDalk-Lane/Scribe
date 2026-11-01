import { setInterfaceLocale, t } from "@/lib/i18n";
import { initializeInterfaceLanguage } from "@/services/interfaceLanguage";

describe("interfaceLanguage", () => {
  afterEach(() => setInterfaceLocale("en"));

  describe("initializeInterfaceLanguage()", () => {
    it("sets Chinese before interface text is requested", () => {
      expect(
        initializeInterfaceLanguage(
          () => "zh",
          () => "en-US"
        )
      ).toBe("zh-CN");
      expect(t("Chat link copied.")).toBe("已复制聊天链接。");
    });

    it("keeps Obsidian English even when the system is Chinese", () => {
      const systemLanguage = jest.fn(() => "zh-CN");
      initializeInterfaceLanguage(() => "en", systemLanguage);
      expect(t("Chat link copied.")).toBe("Chat link copied.");
      expect(systemLanguage).not.toHaveBeenCalled();
    });

    it("uses the system when the Obsidian language reader fails", () => {
      initializeInterfaceLanguage(
        () => {
          throw new Error("Unavailable");
        },
        () => "zh-SG"
      );
      expect(t("Chat link copied.")).toBe("已复制聊天链接。");
    });

    it("uses the system when the Obsidian language is empty", () => {
      expect(
        initializeInterfaceLanguage(
          () => " ",
          () => "zh-CN"
        )
      ).toBe("zh-CN");
    });

    it("uses English when both language readers fail", () => {
      const unavailable = () => {
        throw new Error("Unavailable");
      };
      expect(initializeInterfaceLanguage(unavailable, unavailable)).toBe("en");
    });

    it("uses Obsidian's official language reader by default", () => {
      expect(initializeInterfaceLanguage()).toBe("en");
    });
  });
});
