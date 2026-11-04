import type { App } from "obsidian";

export type MarkdownBlockType = "code" | "heading" | "table" | "text";

export interface MarkdownBlock {
  type: MarkdownBlockType;
  text: string;
  continuesList?: true;
  extraBlankLines?: number;
}

export interface MarkdownSplit {
  frontmatter: string | null;
  blocks: readonly MarkdownBlock[];
}

interface ParsedSection {
  type: string;
  position: { start: { line: number; offset: number }; end: { line: number; offset: number } };
}

interface ParsedListItem {
  parent: number;
  position: { start: { line: number } };
}

interface ParsedMetadata {
  sections?: ParsedSection[];
  listItems?: ParsedListItem[];
}

interface MetadataParser {
  computeMetadataAsync?: (buffer: ArrayBuffer) => Promise<ParsedMetadata>;
}

const EMPTY_BLOCKS: readonly MarkdownBlock[] = Object.freeze([]);
const SECTION_BLOCK_TYPES: Readonly<Record<string, MarkdownBlockType>> = {
  code: "code",
  comment: "code",
  definition: "code",
  heading: "heading",
  html: "code",
  math: "code",
  table: "table",
};

const LIST_FENCE = /^[ \t]*(?:`{3,}|~{3,})/m;

function blockOf(type: MarkdownBlockType, text: string): MarkdownBlock {
  return { type: text.includes("%%") ? "code" : type, text };
}

function listBlocks(
  lines: readonly string[],
  first: number,
  last: number,
  itemStarts: readonly number[]
): MarkdownBlock[] {
  const starts = itemStarts.filter((line) => line >= first && line <= last);
  const ends = starts.map((_, index) => (starts[index + 1] ?? last + 1) - 1);
  const spans =
    starts.length > 1 && ends.every((end) => lines[end].trim() !== "")
      ? starts.map((start, index) => [start, ends[index]])
      : [[first, last]];
  return spans.map(([start, end], index) => {
    const text = lines.slice(start, end + 1).join("\n");
    const block = blockOf(LIST_FENCE.test(text) ? "code" : "text", text);
    return index > 0 ? { ...block, continuesList: true } : block;
  });
}

export async function splitMarkdown(app: App, source: string): Promise<MarkdownSplit> {
  const parser = app.metadataCache as unknown as MetadataParser;
  if (typeof parser.computeMetadataAsync !== "function") {
    throw new Error("Obsidian's Markdown parser is unavailable");
  }
  const buffer = new TextEncoder().encode(source).buffer as ArrayBuffer;
  const metadata = await parser.computeMetadataAsync(buffer);
  const lines = source.split("\n");
  const itemStarts = (metadata.listItems ?? [])
    .filter((item) => item.parent < 0)
    .map((item) => item.position.start.line);
  const blocks: MarkdownBlock[] = [];
  let frontmatter: string | null = null;
  let previousEnd: number | null = null;
  for (const { type, position } of metadata.sections ?? []) {
    if (position.start.offset === position.end.offset) continue;
    const text = lines.slice(position.start.line, position.end.line + 1).join("\n");
    if (type === "yaml" && position.start.line === 0) {
      frontmatter = text;
    } else {
      const sectionBlocks =
        type === "list"
          ? listBlocks(lines, position.start.line, position.end.line, itemStarts)
          : [blockOf(SECTION_BLOCK_TYPES[type] ?? "text", text)];
      const extraBlankLines = previousEnd === null ? 0 : position.start.line - previousEnd - 2;
      if (extraBlankLines > 0) sectionBlocks[0] = { ...sectionBlocks[0], extraBlankLines };
      blocks.push(...sectionBlocks);
      previousEnd = position.end.line;
    }
  }
  return { frontmatter, blocks: blocks.length === 0 ? EMPTY_BLOCKS : blocks };
}
