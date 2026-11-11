import type { App } from "obsidian";
import { readMarkdownFence } from "@/components/markdown/markdownEnhancementPolicy";

export interface MarkdownDisplayBlock {
  id: string;
  text: string;
  kind: "markdown" | "code" | "math";
  closed: boolean;
}

export interface MarkdownSection {
  type: string;
  start: number;
  end: number;
}

export type MarkdownSectionParser = (text: string) => Promise<readonly MarkdownSection[]>;

interface StoredBlock {
  start: number;
  display: MarkdownDisplayBlock;
}

interface SyntaxState {
  unsafe: boolean;
  closed: boolean;
}

interface HostMetadata {
  sections?: readonly {
    type: string;
    position: { start: { offset: number }; end: { offset: number } };
  }[];
}

interface HostMetadataParser {
  computeMetadataAsync?: (buffer: ArrayBuffer) => Promise<HostMetadata>;
}

const EMPTY_BLOCKS: readonly MarkdownDisplayBlock[] = Object.freeze([]);
const EMPTY_STORED_BLOCKS: readonly StoredBlock[] = Object.freeze([]);
const INDEPENDENT_SECTION_TYPES = new Set([
  "paragraph",
  "heading",
  "list",
  "blockquote",
  "callout",
  "table",
  "code",
  "math",
  "thematicBreak",
  "thematic-break",
  "hr",
]);

function inspectSyntax(text: string): SyntaxState {
  let fence: { marker: string; quoteDepth: number } | undefined;
  let mathEnd: "$$" | "\\]" | undefined;
  let unsafe = false;
  for (const line of text.split("\n")) {
    const marker = readMarkdownFence(line);
    if (fence) {
      if (
        marker &&
        marker.marker[0] === fence.marker[0] &&
        marker.marker.length >= fence.marker.length &&
        marker.quoteDepth === fence.quoteDepth &&
        !marker.hasListMarker &&
        !marker.info.trim()
      ) {
        fence = undefined;
      }
      continue;
    }
    if (!mathEnd && marker && !(marker.marker[0] === "`" && marker.info.includes("`"))) {
      fence = { marker: marker.marker, quoteDepth: marker.quoteDepth };
      continue;
    }
    if (/^[ \t]{0,3}\[[^\]\n]+\]:/.test(line) || /<[!/A-Za-z]|%%/.test(line)) unsafe = true;
    for (const [delimiter] of line.matchAll(/\$\$|\\\[|\\\]/g)) {
      if (mathEnd) {
        if (delimiter === mathEnd) mathEnd = undefined;
      } else if (delimiter !== "\\]") {
        mathEnd = delimiter === "$$" ? "$$" : "\\]";
      }
    }
  }
  return { unsafe, closed: !fence && !mathEnd };
}

function displayBlock(id: string, text: string, sectionType?: string): MarkdownDisplayBlock {
  const trimmed = text.trimStart();
  const kind =
    sectionType === "code" || /^(?:`{3,}|~{3,})/.test(trimmed)
      ? "code"
      : sectionType === "math" || /^(?:\$\$|\\\[)/.test(trimmed)
        ? "math"
        : "markdown";
  return { id, text, kind, closed: inspectSyntax(text).closed };
}

function sectionBlocks(
  text: string,
  offset: number,
  sections: readonly MarkdownSection[]
): StoredBlock[] | undefined {
  if (!sections.length) return undefined;
  let previousEnd = 0;
  for (const section of sections) {
    if (
      !INDEPENDENT_SECTION_TYPES.has(section.type) ||
      !Number.isInteger(section.start) ||
      !Number.isInteger(section.end) ||
      section.start < previousEnd ||
      section.end <= section.start ||
      section.end > text.length ||
      text.slice(previousEnd, section.start).trim()
    )
      return undefined;
    previousEnd = section.end;
  }
  if (text.slice(previousEnd).trim()) return undefined;
  return sections.map((section, index) => {
    const start = index === 0 ? 0 : section.start;
    const end = sections[index + 1]?.start ?? text.length;
    return {
      start: offset + start,
      display: displayBlock(`block:${offset + start}`, text.slice(start, end), section.type),
    };
  });
}

export class StreamingMarkdownDocument {
  private source = "";
  private blocks: readonly StoredBlock[] = EMPTY_STORED_BLOCKS;
  private display: readonly MarkdownDisplayBlock[] = EMPTY_BLOCKS;
  private whole = false;
  private request = 0;

  constructor(private readonly parseSections: MarkdownSectionParser) {}

  async update(text: string): Promise<readonly MarkdownDisplayBlock[]> {
    // 清空也要使尚未结束的旧解析失效，防止旧正文重新进入缓存。https://github.com/ItsDalk-Lane/Scribe/issues/72
    const request = ++this.request;
    if (text === this.source) return this.display;
    const appended = text.startsWith(this.source);
    const previous = this.blocks;
    const retained = appended && !this.whole ? Math.max(0, previous.length - 2) : 0;
    const offset = previous[retained]?.start ?? 0;
    const tail = text.slice(offset);
    // 后到的定义可能改变已经冻结的内容，出现跨块语义后持续使用全文。https://github.com/ItsDalk-Lane/Scribe/issues/72
    const whole =
      (appended && this.whole) || /^---(?:\r?\n|$)/.test(text) || inspectSyntax(tail).unsafe;
    let next: readonly StoredBlock[] | undefined;
    if (!whole && text) {
      try {
        const sections = await this.parseSections(tail);
        const parsed = sectionBlocks(tail, offset, sections);
        if (parsed) next = [...previous.slice(0, retained), ...parsed];
      } catch {
        next = undefined;
      }
    }
    const fallback = !!text && !next;
    next ??= text ? [{ start: 0, display: displayBlock("whole", text) }] : EMPTY_STORED_BLOCKS;
    next = next.map((block, index) => {
      const old = previous[index];
      return old &&
        old.display.id === block.display.id &&
        old.display.text === block.display.text &&
        old.display.kind === block.display.kind &&
        old.display.closed === block.display.closed
        ? old
        : block;
    });
    const display = next.length ? next.map((block) => block.display) : EMPTY_BLOCKS;
    if (request === this.request) {
      this.source = text;
      this.blocks = next;
      this.display = display;
      this.whole = fallback;
    }
    return display;
  }
}

export function createObsidianSectionParser(app: App): MarkdownSectionParser {
  const parser = app.metadataCache as unknown as HostMetadataParser;
  return async (text) => {
    if (typeof parser.computeMetadataAsync !== "function") return [];
    const buffer = new TextEncoder().encode(text).buffer as ArrayBuffer;
    const metadata = await parser.computeMetadataAsync(buffer);
    return (metadata.sections ?? []).map(({ type, position }) => ({
      type,
      start: position.start.offset,
      end: position.end.offset,
    }));
  };
}
