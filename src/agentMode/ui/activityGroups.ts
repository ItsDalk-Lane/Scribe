import { t } from "@/lib/i18n";
import type { RenderNode, ThoughtPart, ToolCallPart } from "@/agentMode/ui/agentTrail";
import { pluralize, SUBAGENT_INSPECTION_SUMMARIES } from "@/agentMode/ui/toolSummaries";
import { excalidrawToolRun } from "@/excalidraw/agentMode/excalidrawToolRun";
import { formatDuration } from "@/lib/duration";

export type ActivityMember =
  | { type: "action"; part: ToolCallPart }
  | { type: "reasoning"; part: ThoughtPart };

export interface ActivityGroupNode {
  type: "activityGroup";
  id: string;
  members: ActivityMember[];
}

export interface ExcalidrawDrawingNode {
  type: "excalidrawDrawing";
  id: string;
  path: string | null;
  members: ToolCallPart[];
}

export type GroupedTrailNode = RenderNode | ActivityGroupNode | ExcalidrawDrawingNode;

function isInteractive(part: ToolCallPart): boolean {
  if (part.userResponse) return true;
  if (part.mcpServer) return false;
  const name = part.vendorToolName;
  return (
    part.toolKind === "switch_mode" ||
    name === "AskUserQuestion" ||
    name === "ExitPlanMode" ||
    name === "EnterPlanMode"
  );
}

const EMPTY_GROUPED_TRAIL = Object.freeze([]) as unknown as GroupedTrailNode[];

const NEVER_STANDALONE = () => false;

export function foldActivityGroups(
  nodes: RenderNode[],
  isStandalone: (part: ToolCallPart) => boolean = NEVER_STANDALONE
): GroupedTrailNode[] {
  if (nodes.length === 0) return EMPTY_GROUPED_TRAIL;
  const out: GroupedTrailNode[] = [];
  let run: ActivityMember[] = [];
  let groupCount = 0;
  let drawing: ExcalidrawDrawingNode | null = null;
  let drawingCount = 0;

  const flush = () => {
    if (run.length === 0) return;
    if (run.length === 1) {
      out.push(run[0]);
    } else {
      out.push({ type: "activityGroup", id: `activity-${groupCount++}`, members: run });
    }
    run = [];
  };

  for (const node of nodes) {
    switch (node.type) {
      case "reasoning":
        run.push(node);
        break;
      case "action": {
        const excalidraw = excalidrawToolRun(node.part);
        if (excalidraw?.path && drawing?.path === excalidraw.path) {
          drawing.members.push(node.part);
          break;
        }
        if (excalidraw) {
          flush();
          drawing = {
            type: "excalidrawDrawing",
            id: `drawing-${drawingCount++}`,
            path: excalidraw.path,
            members: [node.part],
          };
          out.push(drawing);
          break;
        }
        if (isInteractive(node.part) || isStandalone(node.part)) {
          flush();
          drawing = null;
          out.push(node);
        } else {
          run.push(node);
        }
        break;
      }
      default:
        flush();
        drawing = null;
        out.push(node);
    }
  }
  flush();
  return out;
}

type FileActivityFamily = "read" | "edit";

function fileFamilyFor(part: ToolCallPart): FileActivityFamily | null {
  // 保留的子会话读取不是文件读取，旧聊天也必须正确显示。https://github.com/ItsDalk-Lane/Scribe/issues/50
  if (!part.mcpServer && SUBAGENT_INSPECTION_SUMMARIES.has(part.vendorToolName ?? "")) {
    return null;
  }
  if (!part.mcpServer) {
    switch (part.vendorToolName) {
      case "Read":
      case "NotebookRead":
        return "read";
      case "Edit":
      case "MultiEdit":
      case "Write":
      case "NotebookEdit":
        return "edit";
    }
  }
  switch (part.toolKind) {
    case "read":
      return "read";
    case "edit":
      return "edit";
    default:
      return null;
  }
}

function filePhraseFor(family: FileActivityFamily, n: number): string {
  switch (family) {
    case "read":
      return t("read {count}", { count: pluralize(n, "file") });
    case "edit":
      return t("edited {count}", { count: pluralize(n, "file") });
  }
}

interface FileCount {
  paths: Set<string>;
  withoutPath: number;
}

function filePathsFor(part: ToolCallPart): Set<string> {
  const paths = new Set(part.locations?.map((location) => location.path) ?? []);
  for (const output of part.output ?? []) {
    if (output.type === "diff") paths.add(output.path);
  }
  return paths;
}

export interface ActivitySummaryOptions {
  thinkingMs?: number;
}

export interface ActivitySummary {
  line: string;
  failed: number;
}

export function summarizeActivity(
  members: ActivityMember[],
  options: ActivitySummaryOptions = {}
): ActivitySummary {
  const fileOrder: FileActivityFamily[] = [];
  const fileCounts = new Map<FileActivityFamily, FileCount>();
  let commands = 0;
  let thoughts = 0;
  let completedThinkingMs = 0;
  let failed = 0;

  for (const member of members) {
    if (member.type === "reasoning") {
      thoughts++;
      completedThinkingMs += member.part.durationMs ?? 0;
      continue;
    }
    commands++;
    if (member.part.status === "failed") failed++;
    const family = fileFamilyFor(member.part);
    if (!family) continue;
    if (
      family === "edit" &&
      (member.part.status === "failed" || member.part.status === "cancelled")
    ) {
      continue;
    }
    if (!fileCounts.has(family)) {
      fileOrder.push(family);
      fileCounts.set(family, { paths: new Set(), withoutPath: 0 });
    }
    const count = fileCounts.get(family)!;
    const paths = filePathsFor(member.part);
    if (paths.size === 0) count.withoutPath++;
    else for (const path of paths) count.paths.add(path);
  }

  const parts = commands > 0 ? [t("ran {count}", { count: pluralize(commands, "command") })] : [];
  for (const family of fileOrder) {
    const count = fileCounts.get(family)!;
    parts.push(filePhraseFor(family, count.paths.size + count.withoutPath));
  }

  const thinkingMs = completedThinkingMs + (options.thinkingMs ?? 0);
  if (thoughts > 0) {
    if (thinkingMs >= 1000)
      parts.push(t("thought for {duration}", { duration: formatDuration(thinkingMs) }));
    else if (parts.length === 0) parts.push(t("thought"));
  }

  const line = parts.join(", ");
  return {
    line: line.length > 0 ? line.charAt(0).toUpperCase() + line.slice(1) : t("Worked"),
    failed,
  };
}
