import { escapeXml } from "./xmlParsing";

describe("xmlParsing", () => {
  describe("escapeXml()", () => {
    it.each([
      ["an ampersand", "foo & bar", "foo &amp; bar"],
      ["a less-than sign", "foo < bar", "foo &lt; bar"],
      ["a greater-than sign", "foo > bar", "foo &gt; bar"],
      ["double quotes", 'foo "bar" baz', "foo &quot;bar&quot; baz"],
      ["single quotes", "foo 'bar' baz", "foo &apos;bar&apos; baz"],
    ])("escapes %s", (_label, input, expected) => {
      expect(escapeXml(input)).toBe(expected);
    });

    it("escapes every special character in markup", () => {
      expect(escapeXml('<tag attr="value">content & more</tag>')).toBe(
        "&lt;tag attr=&quot;value&quot;&gt;content &amp; more&lt;/tag&gt;"
      );
    });

    it("escapes the ampersand of text that already looks like an entity", () => {
      expect(escapeXml("&lt;&gt;&quot;&apos;&amp;")).toBe(
        "&amp;lt;&amp;gt;&amp;quot;&amp;apos;&amp;amp;"
      );
    });

    it("returns plain and empty strings unchanged", () => {
      expect(escapeXml("hello world")).toBe("hello world");
      expect(escapeXml("")).toBe("");
    });

    it("returns an empty string for non-string input", () => {
      expect(escapeXml(null)).toBe("");
      expect(escapeXml(undefined)).toBe("");
      expect(escapeXml(123)).toBe("");
    });
  });
});
