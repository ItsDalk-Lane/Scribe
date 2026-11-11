import { formatToolText, toolValueText } from "./toolContentFormat";

describe("toolContentFormat", () => {
  describe("formatToolText()", () => {
    it("preserves ordinary text and line breaks without interpreting invalid JSON", () => {
      const text = "first line\nsecond line {not json}";
      expect(formatToolText(text)).toEqual({ kind: "text", text });
    });
    it("indents JSON without rounding large integers or rewriting escaped values https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const raw = '{"id":900719925474099312345,"escaped":"\\u4e2d","list":[1,2]}';
      const formatted = formatToolText(raw);
      expect(formatted.kind).toBe("json");
      expect(formatted.text).toContain('"id": 900719925474099312345');
      expect(formatted.text).toContain('"escaped": "\\u4e2d"');
      expect(formatted.text).toContain('\n  "list": [');
      expect(raw).toBe('{"id":900719925474099312345,"escaped":"\\u4e2d","list":[1,2]}');
    });
    it("keeps Markdown markup for normal document rendering https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      expect(formatToolText("# Result\n\n- first\n- second").kind).toBe("markdown");
    });
    it.each([
      '[{"title":"Obsidian","id":900719925474099312345,"escaped":"\\u4e2d","details":"{\\"kept\\":true}"}]',
      '{"title":"Obsidian","id":900719925474099312345,"escaped":"\\u4e2d","details":"{\\"kept\\":true}"}',
    ])(
      "shows JSON objects and arrays wrapped in one JSON string without rewriting their values: %s https://github.com/ItsDalk-Lane/Scribe/issues/52",
      (inner) => {
        const result = formatToolText(JSON.stringify(inner));
        expect(result.kind).toBe("json-string");
        expect(result.text).toContain('"title": "Obsidian"');
        expect(result.text).toContain('"id": 900719925474099312345');
        expect(result.text).toContain('"escaped": "\\u4e2d"');
        expect(result.text).toContain('"details": "{\\"kept\\":true}"');
      }
    );
    it.each(["ordinary text", "123", '"another JSON string"', "{invalid}"])(
      "keeps a root JSON string unchanged when its contents are not an object or array: %s https://github.com/ItsDalk-Lane/Scribe/issues/52",
      (value) => {
        const raw = JSON.stringify(value);
        expect(formatToolText(raw)).toEqual({ kind: "json", text: raw });
      }
    );
  });
  describe("toolValueText()", () => {
    it("retains SDK-decoded structured numbers without claiming to reconstruct original wire precision https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const decoded = JSON.parse('{"id":9007199254740993}') as unknown;
      expect(toolValueText(decoded)).toBe('{"id":9007199254740992}');
    });
    it("leaves a raw string unchanged and serializes structured values without dropping fields", () => {
      expect(toolValueText('{"id":900719925474099312345}')).toBe('{"id":900719925474099312345}');
      expect(toolValueText({ nested: [1, "a"], missing: null })).toBe(
        '{"nested":[1,"a"],"missing":null}'
      );
    });
  });
});
