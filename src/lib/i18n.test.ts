import {
  chineseTranslations,
  getInterfaceLocale,
  resolveInterfaceLocale,
  setInterfaceLocale,
  t,
  translate,
} from "@/lib/i18n";

describe("i18n", () => {
  afterEach(() => setInterfaceLocale("en"));

  describe("resolveInterfaceLocale()", () => {
    it.each(["zh", "zh-CN", "zh_TW", "ZH-hans", "zh-Hant-HK"])(
      "uses Simplified Chinese for the Chinese language %s",
      (language) => expect(resolveInterfaceLocale(language, "en-US")).toBe("zh-CN")
    );

    it("prefers Obsidian English over a Chinese system", () => {
      expect(resolveInterfaceLocale("en", "zh-CN")).toBe("en");
    });

    it("uses English for an unsupported Obsidian language even on a Chinese system", () => {
      expect(resolveInterfaceLocale("de", "zh-CN")).toBe("en");
    });

    it.each([undefined, "", "  "])("uses the system when Obsidian provides %s", (language) => {
      expect(resolveInterfaceLocale(language, "zh-CN")).toBe("zh-CN");
    });

    it("uses English when neither language is available", () => {
      expect(resolveInterfaceLocale(undefined, undefined)).toBe("en");
    });
  });

  describe("translate()", () => {
    it("returns the original English when English is selected", () => {
      expect(translate("en", "Chat link copied.")).toBe("Chat link copied.");
    });

    it("returns Chinese when Simplified Chinese is selected", () => {
      expect(translate("zh-CN", "Chat link copied.")).toBe("已复制聊天链接。");
    });

    it("falls back to the original English for an untranslated message", () => {
      expect(translate("zh-CN", "A future untranslated message")).toBe(
        "A future untranslated message"
      );
    });

    it("preserves names, paths, dollar signs and braces inserted into a Chinese sentence", () => {
      const path = "notes/$&/{private}/旅行.md";
      expect(translate("zh-CN", "Open this file manually: {path}", { path })).toBe(
        `请手动打开此文件：${path}`
      );
    });

    it("replaces repeated placeholders and zero without removing unknown placeholders", () => {
      expect(translate("en", "{count}/{count} {name}", { count: 0 })).toBe("0/0 {name}");
    });

    it("preserves placeholders when no parameters are supplied", () => {
      expect(translate("en", "Choose {name}")).toBe("Choose {name}");
    });

    it("does not use inherited object properties as translations", () => {
      expect(translate("zh-CN", "constructor")).toBe("constructor");
      expect(translate("en", "{toString}", {})).toBe("{toString}");
    });

    it("keeps every Chinese sentence's placeholders equivalent to its English sentence", () => {
      const placeholders = (text: string) =>
        [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      for (const [english, chinese] of Object.entries(chineseTranslations)) {
        expect({ english, placeholders: placeholders(chinese) }).toEqual({
          english,
          placeholders: placeholders(english),
        });
        expect(chinese.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe("setInterfaceLocale()", () => {
    it("changes the language used by subsequent lookups without changing English text", () => {
      setInterfaceLocale("zh-CN");
      expect(t("Chat link copied.")).toBe("已复制聊天链接。");
      setInterfaceLocale("en");
      expect(t("Chat link copied.")).toBe("Chat link copied.");
    });
  });

  describe("t()", () => {
    it("uses the current language and passes dynamic values through unchanged", () => {
      setInterfaceLocale("zh-CN");
      expect(t("Open this file manually: {path}", { path: "my vault/日记.md" })).toBe(
        "请手动打开此文件：my vault/日记.md"
      );
    });
  });

  describe("getInterfaceLocale()", () => {
    it("returns the selected interface language for date and number formatting", () => {
      expect(getInterfaceLocale()).toBe("en");
      setInterfaceLocale("zh-CN");
      expect(getInterfaceLocale()).toBe("zh-CN");
    });
  });
});
