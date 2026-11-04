import { alignBlocks } from "@/agentMode/ui/renderedDiff/alignBlocks";
import {
  DEL_CLOSE,
  DEL_OPEN,
  INS_CLOSE,
  INS_OPEN,
  SENTINEL,
} from "@/agentMode/ui/renderedDiff/applySentinels";
import type { MarkdownBlock, MarkdownSplit } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { splitMarkdown } from "@/agentMode/ui/renderedDiff/splitBlocks";
import { diffTableBlock } from "@/agentMode/ui/renderedDiff/tableDiff";
import { diffTextBlock } from "@/agentMode/ui/renderedDiff/tokenDiff";
import { logWarn } from "@/logger";
import { diffLines } from "diff";
import type { App } from "obsidian";

export type DiffChange = "unchanged" | "deleted" | "inserted";

export interface CodeDiffLine {
  change: DiffChange;
  text: string;
}

export type DiffSegment =
  | { kind: "markdown"; markdown: string; continuesList?: true }
  | { kind: "block"; change: "deleted" | "inserted"; markdown: string; continuesList?: true }
  | { kind: "code"; lines: CodeDiffLine[] };

const EMPTY_PLAN: readonly DiffSegment[] = Object.freeze([]);

const VISIBLE_MARK = new RegExp(`[${INS_OPEN}${DEL_OPEN}]\\s*[^\\s${INS_CLOSE}${DEL_CLOSE}]`);

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown)$/i.test(path);
}

export function diffCodeLines(before: string, after: string): CodeDiffLine[] {
  const lines: CodeDiffLine[] = [];
  for (const part of diffLines(before, after)) {
    const change: DiffChange = part.added ? "inserted" : part.removed ? "deleted" : "unchanged";
    const terminated = part.value.endsWith("\n");
    const texts = part.value.split("\n");
    if (terminated) texts.pop();
    for (const text of texts) lines.push({ change, text });
    if (!terminated && before.endsWith("\n") !== after.endsWith("\n")) {
      lines.push({ change, text: "\\ No newline at end of file" });
    }
  }
  return lines;
}

export async function buildRenderedDiffPlan(
  app: App,
  before: string | null,
  after: string | null,
  markdown: boolean
): Promise<readonly DiffSegment[]> {
  const beforeText = (before ?? "").replace(/\r\n/g, "\n");
  const afterText = (after ?? "").replace(/\r\n/g, "\n");
  if (!markdown || SENTINEL.test(beforeText) || SENTINEL.test(afterText)) {
    return verbatimPlan(beforeText, afterText);
  }

  let beforeSplit: MarkdownSplit;
  let afterSplit: MarkdownSplit;
  try {
    [beforeSplit, afterSplit] = await Promise.all([
      splitMarkdown(app, beforeText),
      splitMarkdown(app, afterText),
    ]);
  } catch (error) {
    logWarn("[RenderedDiff] Markdown parsing failed, showing a line diff", error);
    return verbatimPlan(beforeText, afterText);
  }
  const segments: DiffSegment[] = [];
  if (beforeSplit.frontmatter !== afterSplit.frontmatter) {
    segments.push({
      kind: "code",
      lines: diffCodeLines(beforeSplit.frontmatter ?? "", afterSplit.frontmatter ?? ""),
    });
  }

  for (const pairing of alignBlocks(beforeSplit.blocks, afterSplit.blocks)) {
    const { extraBlankLines } = pairing.kind === "deleted" ? pairing.before : pairing.after;
    if (extraBlankLines) {
      segments.push({
        kind: "markdown",
        markdown: `<div aria-hidden="true">${"<br>".repeat(extraBlankLines)}</div>`,
      });
    }
    switch (pairing.kind) {
      case "unchanged":
        segments.push({
          kind: "markdown",
          markdown: pairing.after.text,
          continuesList: pairing.after.continuesList,
        });
        break;
      case "deleted":
        segments.push({
          kind: "block",
          change: "deleted",
          markdown: pairing.before.text,
          continuesList: pairing.before.continuesList,
        });
        break;
      case "inserted":
        segments.push({
          kind: "block",
          change: "inserted",
          markdown: pairing.after.text,
          continuesList: pairing.after.continuesList,
        });
        break;
      default:
        segments.push(...modifiedSegments(pairing.before, pairing.after));
    }
  }
  const collapsed = collapseSegments(segments);
  const rendersChange = collapsed.some(
    (segment) => segment.kind !== "markdown" || VISIBLE_MARK.test(segment.markdown)
  );
  if (!rendersChange && beforeText !== afterText) return verbatimPlan(beforeText, afterText);
  return collapsed.length === 0 ? EMPTY_PLAN : collapsed;
}

function verbatimPlan(before: string, after: string): readonly DiffSegment[] {
  const lines = diffCodeLines(before, after);
  return lines.length === 0 ? EMPTY_PLAN : [{ kind: "code", lines }];
}

function modifiedSegments(before: MarkdownBlock, after: MarkdownBlock): DiffSegment[] {
  if (after.type === "code") {
    return [{ kind: "code", lines: diffCodeLines(before.text, after.text) }];
  }
  if (after.type === "table") {
    const merged = diffTableBlock(before.text, after.text);
    if (merged !== null) return [{ kind: "markdown", markdown: merged }];
    return [
      { kind: "block", change: "deleted", markdown: before.text },
      { kind: "block", change: "inserted", markdown: after.text },
    ];
  }
  return [
    {
      kind: "markdown",
      markdown: diffTextBlock(before.text, after.text),
      continuesList: after.continuesList,
    },
  ];
}

function collapseSegments(segments: readonly DiffSegment[]): DiffSegment[] {
  const collapsed: DiffSegment[] = [];
  for (const segment of segments) {
    const previous = collapsed[collapsed.length - 1];
    if (
      (previous?.kind === "markdown" && segment.kind === "markdown") ||
      (previous?.kind === "block" && segment.kind === "block" && previous.change === segment.change)
    ) {
      collapsed[collapsed.length - 1] = {
        ...previous,
        markdown: `${previous.markdown}${segment.continuesList ? "\n" : "\n\n"}${segment.markdown}`,
      };
      continue;
    }
    collapsed.push(segment);
  }
  return collapsed;
}
