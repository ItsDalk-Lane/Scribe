export const MAX_ENHANCED_BLOCK_CHARACTERS = 50000;

export interface MarkdownEnhancementInspection {
  heavy: boolean;
  closed: boolean;
  oversized: boolean;
}

export interface MarkdownFenceMarker {
  marker: string;
  info: string;
  quoteDepth: number;
  hasListMarker: boolean;
}

export function readMarkdownFence(line: string): MarkdownFenceMarker | undefined {
  let remaining = line;
  let quoteDepth = 0;
  let hasListMarker = false;
  while (remaining) {
    remaining = remaining.replace(/^[ \t]+/, "");
    if (remaining.startsWith(">")) {
      quoteDepth++;
      remaining = remaining.slice(1);
      continue;
    }
    const list = /^(?:[-+*]|\d{1,9}[.)])[ \t]+/.exec(remaining);
    if (!list) break;
    hasListMarker = true;
    remaining = remaining.slice(list[0].length);
  }
  const match = /^(`{3,}|~{3,})([^\r\n]*)\r?$/.exec(remaining);
  return match ? { marker: match[1], info: match[2], quoteDepth, hasListMarker } : undefined;
}

interface Fence {
  marker: string;
  start: number;
  quoteDepth: number;
}

interface Formula {
  end: "$" | "$$" | "\\)" | "\\]";
  start: number;
}

const PLAIN_CONTENT: MarkdownEnhancementInspection = Object.freeze({
  heavy: false,
  closed: true,
  oversized: false,
});

function runEnd(text: string, start: number): number {
  let end = start + 1;
  while (text[end] === text[start]) end++;
  return end;
}

function inlineCodeEnd(text: string, start: number, openingEnd: number): number | undefined {
  const width = openingEnd - start;
  const blankLine = /\n[ \t\r]*\n/g;
  blankLine.lastIndex = openingEnd;
  const boundary = blankLine.exec(text)?.index ?? text.length;
  let index = openingEnd;
  while (index < boundary) {
    const next = text.indexOf("`", index);
    if (next < 0 || next >= boundary) return undefined;
    const end = runEnd(text, next);
    if (end - next === width) return end;
    index = end;
  }
  return undefined;
}

export function inspectMarkdownEnhancement(text: string): MarkdownEnhancementInspection {
  let fence: Fence | undefined;
  let formula: Formula | undefined;
  let heavy = false;
  let oversized = false;
  let index = 0;
  while (index < text.length) {
    if ((index === 0 || text[index - 1] === "\n") && !formula) {
      const newline = text.indexOf("\n", index);
      const end = newline < 0 ? text.length : newline;
      const marker = readMarkdownFence(text.slice(index, end));
      if (fence) {
        if (
          marker &&
          marker.marker[0] === fence.marker[0] &&
          marker.marker.length >= fence.marker.length &&
          marker.quoteDepth === fence.quoteDepth &&
          !marker.hasListMarker &&
          !marker.info.trim()
        ) {
          oversized ||= end - fence.start > MAX_ENHANCED_BLOCK_CHARACTERS;
          fence = undefined;
        }
        index = end + 1;
        continue;
      }
      if (marker && !(marker.marker[0] === "`" && marker.info.includes("`"))) {
        heavy = true;
        fence = { marker: marker.marker, start: index, quoteDepth: marker.quoteDepth };
        index = end + 1;
        continue;
      }
    }
    const character = text[index];
    if (formula) {
      const dollarEnd = character === "$" ? runEnd(text, index) : undefined;
      const matchingDollar =
        dollarEnd !== undefined &&
        formula.end[0] === "$" &&
        dollarEnd - index === formula.end.length &&
        (formula.end === "$$" || !/\s/.test(text[index - 1]));
      if (matchingDollar || (character === "\\" && text.startsWith(formula.end, index))) {
        index += formula.end.length;
        oversized ||= index - formula.start > MAX_ENHANCED_BLOCK_CHARACTERS;
        formula = undefined;
      } else {
        index = dollarEnd ?? index + (character === "\\" ? 2 : 1);
      }
      continue;
    }
    if (character === "`") {
      const end = runEnd(text, index);
      index = inlineCodeEnd(text, index, end) ?? end;
      continue;
    }
    if (character === "\\") {
      if (text[index + 1] === "(" || text[index + 1] === "[") {
        heavy = true;
        formula = { end: text[index + 1] === "(" ? "\\)" : "\\]", start: index };
      }
      index += 2;
      continue;
    }
    if (character === "$") {
      const end = runEnd(text, index);
      const width = end - index;
      if (width === 2 || (width === 1 && text[end] !== undefined && !/\s/.test(text[end]))) {
        heavy = true;
        formula = { end: width === 2 ? "$$" : "$", start: index };
      }
      index = end;
      continue;
    }
    index++;
  }
  // 预算只计算各个增强块，长正文不能让其中的小代码块被误判超限。https://github.com/ItsDalk-Lane/Scribe/issues/72
  const unfinished = fence ?? formula;
  oversized ||= !!unfinished && text.length - unfinished.start > MAX_ENHANCED_BLOCK_CHARACTERS;
  return heavy ? { heavy, closed: !unfinished, oversized } : PLAIN_CONTENT;
}
