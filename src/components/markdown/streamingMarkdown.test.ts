import {
  createObsidianSectionParser,
  StreamingMarkdownDocument,
  type MarkdownSection,
} from "@/components/markdown/streamingMarkdown";
import type { App } from "obsidian";

const ISSUE = "https://github.com/ItsDalk-Lane/Scribe/issues/72";

function sections(
  source: string,
  entries: readonly (readonly [string, string])[]
): MarkdownSection[] {
  let cursor = 0;
  return entries.map(([type, text]) => {
    const start = source.indexOf(text, cursor);
    if (start < 0) throw new Error(`Missing fixture section: ${text}`);
    cursor = start + text.length;
    return { type, start, end: cursor };
  });
}

describe("streamingMarkdown", () => {
  describe("StreamingMarkdownDocument", () => {
    describe("update()", () => {
      it(`preserves every source character and reuses unchanged results for ${ISSUE}`, async () => {
        const text = "\n中文👩‍💻\n\n# 标题\n\n";
        const parse = jest.fn(async (source: string) =>
          sections(source, [
            ["paragraph", "中文👩‍💻"],
            ["heading", "# 标题"],
          ])
        );
        const document = new StreamingMarkdownDocument(parse);

        const blocks = await document.update(text);

        expect(blocks.map((block) => block.text).join("")).toBe(text);
        expect(blocks.map((block) => block.id)).toEqual(["block:0", "block:10"]);
        expect(await document.update(text)).toBe(blocks);
        expect(parse).toHaveBeenCalledTimes(1);
      });

      it(`only parses the final two blocks on append and keeps stable prefix objects for ${ISSUE}`, async () => {
        const parse = jest.fn(async (source: string) =>
          sections(
            source,
            source.includes("First.")
              ? [
                  ["paragraph", "First."],
                  ["paragraph", "Second."],
                  ["paragraph", "Third."],
                  ["paragraph", "Fourth."],
                ]
              : [
                  ["paragraph", "Third."],
                  ["paragraph", "Fourth. More."],
                  ["paragraph", "Fifth."],
                ]
          )
        );
        const document = new StreamingMarkdownDocument(parse);
        const first = await document.update("First.\n\nSecond.\n\nThird.\n\nFourth.");
        const next = await document.update(
          "First.\n\nSecond.\n\nThird.\n\nFourth. More.\n\nFifth."
        );

        expect(parse.mock.calls[1][0]).toBe("Third.\n\nFourth. More.\n\nFifth.");
        expect(next[0]).toBe(first[0]);
        expect(next[1]).toBe(first[1]);
        expect(next[2]).toBe(first[2]);
        expect(next[3].id).toBe(first[3].id);
        expect(next.map((block) => block.text).join("")).toBe(
          "First.\n\nSecond.\n\nThird.\n\nFourth. More.\n\nFifth."
        );
      });

      it(`resets the stable prefix after non-append replacement for ${ISSUE}`, async () => {
        const parse = jest.fn(async (source: string) => [
          { type: "paragraph", start: 0, end: source.length },
        ]);
        const document = new StreamingMarkdownDocument(parse);
        await document.update("Original text");

        expect((await document.update("Replacement"))[0].text).toBe("Replacement");
        expect(parse.mock.calls[1][0]).toBe("Replacement");
      });

      it(`keeps nested lists, tables, Setext headings and embedded links within their host sections for ${ISSUE}`, async () => {
        const entries = [
          ["list", "- Parent\n\n  - Child\n\n  Continued"],
          ["table", "| Name |\n| --- |\n| One |"],
          ["heading", "Heading\n-------"],
          ["paragraph", "[[Note]] and ![[Image.png]]"],
        ] as const;
        const text = entries.map(([, content]) => content).join("\n\n");
        const document = new StreamingMarkdownDocument(async (source) => sections(source, entries));

        const blocks = await document.update(text);

        expect(blocks).toHaveLength(4);
        expect(blocks.every((block) => block.kind === "markdown" && block.closed)).toBe(true);
        expect(blocks.map((block) => block.text).join("")).toBe(text);
        expect(blocks[0].text).toContain("\n\n  Continued");
      });

      it.each([
        ["reference", "[target]: note.md"],
        ["footnote", "[^note]: Explanation"],
        ["HTML", "<div>\nParagraph\n</div>"],
        ["comment", "%% hidden %%"],
        ["frontmatter", "---\ntags: [one]\n---\nText"],
      ])(`keeps %s-dependent documents whole for ${ISSUE}`, async (_kind, special) => {
        const parse = jest.fn(async (source: string) => [
          { type: "paragraph", start: 0, end: source.length },
        ]);
        const document = new StreamingMarkdownDocument(parse);
        const text = special.startsWith("---") ? special : `Earlier [link][target].\n\n${special}`;

        const blocks = await document.update(text);

        expect(blocks).toEqual([{ id: "whole", text, kind: "markdown", closed: true }]);
        expect(parse).not.toHaveBeenCalled();
      });

      it(`invalidates frozen blocks when a later reference definition arrives for ${ISSUE}`, async () => {
        const parse = jest.fn(async (source: string) =>
          sections(source, [
            ["paragraph", "First [link][target]."],
            ["paragraph", "Second."],
            ["paragraph", "Third."],
            ["paragraph", "Fourth."],
          ])
        );
        const document = new StreamingMarkdownDocument(parse);
        const text = "First [link][target].\n\nSecond.\n\nThird.\n\nFourth.";
        await document.update(text);

        const blocks = await document.update(`${text}\n\n[target]: note.md`);

        expect(blocks).toEqual([
          { id: "whole", text: `${text}\n\n[target]: note.md`, kind: "markdown", closed: true },
        ]);
        expect(parse).toHaveBeenCalledTimes(1);
      });

      it.each([
        ["```js\nconst value = 1", "code", false],
        ["~~~js\nconst value = 1\n~~~~\n", "code", true],
        ["```html\n<div>%% literal %%</div>\n```", "code", true],
        ["$$\nx + y", "math", false],
        ["$$\nx + y\n$$\n", "math", true],
      ] as const)(
        `reports code and math closure without losing source for %s ${ISSUE}`,
        async (text, kind, closed) => {
          const parse = async () => [
            { type: kind === "math" ? "math" : "code", start: 0, end: text.length },
          ];

          expect(await new StreamingMarkdownDocument(parse).update(text)).toEqual([
            { id: "block:0", text, kind, closed },
          ]);
        }
      );

      it(`leaves a mixed fallback unfinished when it contains an open fence for ${ISSUE}`, async () => {
        const text = "<div>Context</div>\n\n```js\nconst value = 1";
        const document = new StreamingMarkdownDocument(async () => []);

        expect(await document.update(text)).toEqual([
          { id: "whole", text, kind: "markdown", closed: false },
        ]);
      });

      it(`leaves inline display math unfinished until its closing delimiter arrives for ${ISSUE}`, async () => {
        const parse = async (source: string) => [
          { type: "paragraph", start: 0, end: source.length },
        ];
        const document = new StreamingMarkdownDocument(parse);
        const text = "The value is $$x + y";

        expect((await document.update(text))[0].closed).toBe(false);
        expect((await document.update(`${text}$$`))[0].closed).toBe(true);
      });

      it.each([
        ["list", "list", "- ```js\n  [target]: note.md\n  ```"],
        ["nested list", "list", "- Parent\n    ```js\n    [target]: note.md\n    ```"],
        ["quote", "blockquote", "> ```js\n> [target]: note.md\n> ```"],
      ] as const)(
        `keeps closed %s code in its host section without treating code-contained definitions as global for ${ISSUE}`,
        async (_name, type, text) => {
          const parse = jest.fn(async () => [{ type, start: 0, end: text.length }]);
          const document = new StreamingMarkdownDocument(parse);

          expect(await document.update(text)).toEqual([
            { id: "block:0", text, kind: "markdown", closed: true },
          ]);
          expect(parse).toHaveBeenCalledTimes(1);
        }
      );

      it.each([
        ["list", "- ```js\n  const x = 1"],
        ["list", "- Parent\n    ```js\n    const x = 1"],
        ["blockquote", "> ```js\n> const x = 1"],
      ] as const)(
        `keeps unfinished container code unclosed in %s sections for ${ISSUE}`,
        async (type, text) => {
          const document = new StreamingMarkdownDocument(async () => [
            { type, start: 0, end: text.length },
          ]);

          expect((await document.update(text))[0].closed).toBe(false);
        }
      );

      it(`keeps container-looking code lines from exposing code-contained definitions as document definitions for ${ISSUE}`, async () => {
        const text = "```text\n- ```\n> ```\n[target]: note.md\n```";
        const parse = jest.fn(async () => [{ type: "code", start: 0, end: text.length }]);
        const document = new StreamingMarkdownDocument(parse);

        expect(await document.update(text)).toEqual([
          { id: "block:0", text, kind: "code", closed: true },
        ]);
        expect(parse).toHaveBeenCalledTimes(1);
      });

      it.each(["unknown section", "invalid offsets", "missing content", "parser failure"])(
        `preserves the complete document after %s for ${ISSUE}`,
        async (failure) => {
          const parse = async (): Promise<readonly MarkdownSection[]> => {
            if (failure === "parser failure") throw new Error("unavailable");
            if (failure === "unknown section") return [{ type: "plugin", start: 0, end: 8 }];
            if (failure === "invalid offsets") return [{ type: "paragraph", start: 5, end: 99 }];
            return [{ type: "paragraph", start: 5, end: 8 }];
          };
          const document = new StreamingMarkdownDocument(parse);

          expect(await document.update("Complete document")).toEqual([
            { id: "whole", text: "Complete document", kind: "markdown", closed: true },
          ]);
        }
      );

      it(`keeps an empty document referentially stable without calling the parser for ${ISSUE}`, async () => {
        const parse = jest.fn(async () => []);
        const document = new StreamingMarkdownDocument(parse);
        const first = await document.update("");

        expect(first).toEqual([]);
        expect(await document.update("")).toBe(first);
        expect(parse).not.toHaveBeenCalled();
      });

      it(`does not let a late parse restore content after the document is cleared for ${ISSUE}`, async () => {
        let finish: ((sections: readonly MarkdownSection[]) => void) | undefined;
        const parse = jest.fn(
          () =>
            new Promise<readonly MarkdownSection[]>((resolve) => {
              finish = resolve;
            })
        );
        const document = new StreamingMarkdownDocument(parse);
        const obsolete = document.update("Old text");
        const empty = await document.update("");
        finish?.([{ type: "paragraph", start: 0, end: 8 }]);
        await obsolete;

        expect(await document.update("")).toBe(empty);
        expect(parse).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("createObsidianSectionParser()", () => {
    it(`passes the exact UTF-8 source to the host and returns its character offsets for ${ISSUE}`, async () => {
      const computeMetadataAsync = jest.fn(async (_buffer: ArrayBuffer) => ({
        sections: [{ type: "paragraph", position: { start: { offset: 0 }, end: { offset: 4 } } }],
      }));
      const app = { metadataCache: { computeMetadataAsync } } as unknown as App;

      expect(await createObsidianSectionParser(app)("中文👋")).toEqual([
        { type: "paragraph", start: 0, end: 4 },
      ]);
      expect(new TextDecoder().decode(computeMetadataAsync.mock.calls[0][0])).toBe("中文👋");
    });

    it(`allows whole-document fallback when the host parser is unavailable for ${ISSUE}`, async () => {
      const app = { metadataCache: {} } as unknown as App;
      const document = new StreamingMarkdownDocument(createObsidianSectionParser(app));

      expect(await document.update("Readable text")).toEqual([
        { id: "whole", text: "Readable text", kind: "markdown", closed: true },
      ]);
    });
  });
});
