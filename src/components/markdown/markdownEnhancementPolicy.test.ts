import {
  inspectMarkdownEnhancement,
  MAX_ENHANCED_BLOCK_CHARACTERS,
  readMarkdownFence,
} from "@/components/markdown/markdownEnhancementPolicy";

const ISSUE = "https://github.com/ItsDalk-Lane/Scribe/issues/72";

describe("markdownEnhancementPolicy", () => {
  describe("inspectMarkdownEnhancement()", () => {
    it(`leaves ordinary long text and links outside the heavy-content budget for ${ISSUE}`, () => {
      const text = `Read [the article](https://example.com/${"a".repeat(60000)}).`;

      expect(inspectMarkdownEnhancement(text)).toEqual({
        heavy: false,
        closed: true,
        oversized: false,
      });
      expect(MAX_ENHANCED_BLOCK_CHARACTERS).toBe(50000);
    });

    it.each([
      ["closed backtick fence", "```ts\nconst price = '$unfinished';\n```", true],
      ["closed tilde fence", "~~~text\n$unfinished\n~~~~\n", true],
      ["unclosed fence", "```ts\nconst value = 1", false],
      ["shorter closing fence", "````ts\nconst value = 1\n```", false],
      ["CRLF fence", "```ts\r\nconst value = 1\r\n```\r\n", true],
    ] as const)(
      `recognizes %s and ignores code-contained math for ${ISSUE}`,
      (_name, text, closed) => {
        expect(inspectMarkdownEnhancement(text)).toEqual({ heavy: true, closed, oversized: false });
      }
    );

    it.each([
      ["single-dollar math", "$x + y$", true],
      ["unfinished single-dollar math", "$x + y", false],
      ["double-dollar math", "$$\nx + y\n$$", true],
      ["unfinished double-dollar math", "$$\nx + y", false],
      ["parenthesized math", "The value is \\(x + y\\).", true],
      ["unfinished parenthesized math", "The value is \\(x + y", false],
      ["bracketed math", "\\[x + y\\]", true],
      ["unfinished bracketed math", "\\[x + y", false],
    ] as const)(`recognizes %s for ${ISSUE}`, (_name, text, closed) => {
      expect(inspectMarkdownEnhancement(text)).toEqual({ heavy: true, closed, oversized: false });
    });

    it.each([
      ["backtick span", "Use `$unfinished` as literal text."],
      ["multiple-backtick span", "Use ``literal ` and $unfinished`` as text."],
      ["escaped dollar", "The token is \\$unfinished."],
      ["escaped backslash", "The token is \\\\(unfinished."],
      ["literal whitespace-surrounded dollar", "The separator $ is literal."],
      ["mid-line tildes", "Before ~~~text and after"],
    ] as const)(`leaves %s outside enhancement processing for ${ISSUE}`, (_name, text) => {
      expect(inspectMarkdownEnhancement(text)).toEqual({
        heavy: false,
        closed: true,
        oversized: false,
      });
    });

    it(`does not mistake an unmatched inline backtick for a real code span for ${ISSUE}`, () => {
      expect(inspectMarkdownEnhancement("A literal ` before $unfinished")).toEqual({
        heavy: true,
        closed: false,
        oversized: false,
      });
    });

    it(`does not treat a backtick after a paragraph break as a matching inline-code delimiter for ${ISSUE}`, () => {
      expect(inspectMarkdownEnhancement("A literal `\n\n$unfinished\n\nAnother `")).toEqual({
        heavy: true,
        closed: false,
        oversized: false,
      });
    });

    it(`does not apply the block budget to unrelated surrounding prose for ${ISSUE}`, () => {
      const text = "Long ordinary prose. ".repeat(3000) + "\n\n```js\nconst value = 1;\n```";

      expect(inspectMarkdownEnhancement(text)).toEqual({
        heavy: true,
        closed: true,
        oversized: false,
      });
    });

    it(`does not combine separate heavy blocks into one size budget for ${ISSUE}`, () => {
      const code = "\n```text\n" + "x".repeat(30000) + "\n```\n";

      expect(inspectMarkdownEnhancement(`${code}\n${code}`)).toEqual({
        heavy: true,
        closed: true,
        oversized: false,
      });
    });

    it.each([
      ["code", (size: number) => "```\n" + "x".repeat(size - 8) + "\n```"],
      ["math", (size: number) => `$${"x".repeat(size - 2)}$`],
    ] as const)(
      `limits each %s block only above 50000 source characters for ${ISSUE}`,
      (_name, source) => {
        expect(inspectMarkdownEnhancement(source(50000))).toEqual({
          heavy: true,
          closed: true,
          oversized: false,
        });
        expect(inspectMarkdownEnhancement(source(50001))).toEqual({
          heavy: true,
          closed: true,
          oversized: true,
        });
      }
    );

    it(`applies the same size bound to unfinished heavy blocks for ${ISSUE}`, () => {
      expect(inspectMarkdownEnhancement("```js\n" + "x".repeat(50000))).toEqual({
        heavy: true,
        closed: false,
        oversized: true,
      });
      expect(inspectMarkdownEnhancement(`\\(${"x".repeat(50000)}`)).toEqual({
        heavy: true,
        closed: false,
        oversized: true,
      });
    });

    it(`does not split a mismatched dollar delimiter run into an artificial formula closing marker for ${ISSUE}`, () => {
      expect(inspectMarkdownEnhancement("$x" + "$".repeat(100))).toEqual({
        heavy: true,
        closed: false,
        oversized: false,
      });
    });

    it.each([
      ["list", "- ```js\n  const x = '$unfinished';\n  ```"],
      ["nested list", "- Parent\n    ```js\n    const x = '$unfinished';\n    ```"],
      ["quote", "> ```js\n> const x = '$unfinished';\n> ```"],
      ["list inside quote", "> - ```js\n>   const x = '$unfinished';\n>   ```"],
    ] as const)(
      `recognizes closed code inside a %s without treating code-contained dollars as math for ${ISSUE}`,
      (_kind, text) => {
        expect(inspectMarkdownEnhancement(text)).toEqual({
          heavy: true,
          closed: true,
          oversized: false,
        });
      }
    );

    it(`applies the individual budget to deeply indented container code for ${ISSUE}`, () => {
      const text = "- Parent\n    ```js\n    " + "x".repeat(50000) + "\n    ```";

      expect(inspectMarkdownEnhancement(text)).toEqual({
        heavy: true,
        closed: true,
        oversized: true,
      });
    });

    it(`does not let container-looking code text close an outer code fence for ${ISSUE}`, () => {
      const text = "```text\n- ```\n> ```\n$unfinished\n```";

      expect(inspectMarkdownEnhancement(text)).toEqual({
        heavy: true,
        closed: true,
        oversized: false,
      });
    });

    it(`retains unfinished container code as raw content for ${ISSUE}`, () => {
      expect(inspectMarkdownEnhancement("> - ```js\n>   const x = 1;")).toEqual({
        heavy: true,
        closed: false,
        oversized: false,
      });
    });
  });

  describe("readMarkdownFence()", () => {
    it.each([
      ["```js", "```", "js", 0, false],
      ["- ```js", "```", "js", 0, true],
      ["    ```", "```", "", 0, false],
      ["> > - 1. ~~~~text", "~~~~", "text", 2, true],
      ["\t  > ```js\r", "```", "js", 1, false],
    ] as const)(
      `recognizes container prefixes before %s for ${ISSUE}`,
      (line, marker, info, quoteDepth, hasListMarker) => {
        expect(readMarkdownFence(line)).toEqual({ marker, info, quoteDepth, hasListMarker });
      }
    );

    it.each(["Ordinary ```js text", "- ordinary ```js text", "~~text", "1.```js"])(
      `does not turn ordinary text into a fence for %s ${ISSUE}`,
      (line) => {
        expect(readMarkdownFence(line)).toBeUndefined();
      }
    );
  });
});
