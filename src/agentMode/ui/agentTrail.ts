import type { AgentMessagePart } from "@/agentMode/session/types";
import { cleanMessageForCopy } from "@/utils";
import { toolPresentationName } from "@/agentMode/session/toolName";

export type ToolCallPart = Extract<AgentMessagePart, { kind: "tool_call" }>;
export type ThoughtPart = Extract<AgentMessagePart, { kind: "thought" }>;
export type TextPart = Extract<AgentMessagePart, { kind: "text" }>;
export type PlanPart = Extract<AgentMessagePart, { kind: "plan" }>;
export type CompactionPart = Extract<AgentMessagePart, { kind: "compaction" }>;

export type RenderNode =
  | { type: "action"; part: ToolCallPart }
  | { type: "subagent"; parent: ToolCallPart; children: RenderNode[]; truncated?: boolean }
  | { type: "reasoning"; part: ThoughtPart }
  | { type: "text"; part: TextPart }
  | { type: "plan"; part: PlanPart }
  | { type: "compaction"; part: CompactionPart };

export interface BuildAgentTrailOptions {
  maxDepth?: number;
}

export function agentResponseText(parts: AgentMessagePart[]): string {
  const text = parts
    .filter((p): p is TextPart => p.kind === "text" && p.text.trim().length > 0)
    .map((p) => p.text)
    .join("\n\n");
  return cleanMessageForCopy(text);
}

export interface CompletedAgentTrail {
  process: AgentMessagePart[];
  response: AgentMessagePart[];
}

export function splitCompletedAgentTrail(
  parts: AgentMessagePart[],
  finalResponseSegmentSeq: number | undefined
): CompletedAgentTrail | undefined {
  // 中间正文属于过程，只能用已确认的最后响应段拆分；缺失身份的历史记录保持原序展示。https://github.com/ItsDalk-Lane/Scribe/issues/52
  if (finalResponseSegmentSeq === undefined) return undefined;
  const start = parts.findIndex(
    (part) =>
      part.kind === "text" &&
      part.segmentSeq === finalResponseSegmentSeq &&
      !part.synthetic &&
      part.text.trim().length > 0
  );
  if (start < 0) return undefined;
  const response = parts.slice(start);
  if (
    response.some(
      (part) =>
        part.kind !== "text" || part.segmentSeq !== finalResponseSegmentSeq || part.synthetic
    )
  )
    return undefined;
  return { process: parts.slice(0, start), response };
}

function isHiddenTool(part: AgentMessagePart): boolean {
  return part.kind === "tool_call" && part.vendorToolName === "ToolSearch";
}

function isSubAgentLaunch(part: ToolCallPart): boolean {
  const name = part.vendorToolName ? toolPresentationName(part.vendorToolName) : undefined;
  if (!part.mcpServer && (name === "Agent" || name === "Task")) {
    return true;
  }
  if (part.vendorToolName || part.mcpServer) return false;
  if (part.toolKind && part.toolKind !== "other") return false;
  const input = part.input as { subagent_type?: unknown } | null | undefined;
  return typeof input?.subagent_type === "string";
}

export function buildAgentTrail(
  parts: AgentMessagePart[],
  opts: BuildAgentTrailOptions = {}
): RenderNode[] {
  const maxDepth = opts.maxDepth ?? 3;
  parts = parts.filter((p) => !isHiddenTool(p));
  const byId = new Map<string, ToolCallPart>();
  for (const p of parts) {
    if (p.kind === "tool_call") byId.set(p.id, p);
  }
  const childrenByParent = new Map<string, ToolCallPart[]>();
  for (const p of parts) {
    if (p.kind !== "tool_call") continue;
    const parentId = p.parentToolCallId;
    if (parentId && byId.has(parentId)) {
      const list = childrenByParent.get(parentId) ?? [];
      list.push(p);
      childrenByParent.set(parentId, list);
    }
  }

  const topLevel = parts.filter((p) => {
    if (p.kind !== "tool_call") return true;
    const parentId = p.parentToolCallId;
    return !(parentId && byId.has(parentId));
  });

  return foldNodes(topLevel, childrenByParent, maxDepth, 0);
}

function foldNodes(
  peers: AgentMessagePart[],
  childrenByParent: Map<string, ToolCallPart[]>,
  maxDepth: number,
  depth: number
): RenderNode[] {
  const out: RenderNode[] = [];
  for (const p of peers) {
    if (p.kind === "thought") {
      // 服务商可能保留空思考块；仅在投影中跳过，避免纯正文出现空过程折叠。https://github.com/ItsDalk-Lane/Scribe/issues/52
      if (p.text.trim().length === 0) continue;
      out.push({ type: "reasoning", part: p });
      continue;
    }
    if (p.kind === "text") {
      if (p.text.trim().length === 0) continue;
      out.push({ type: "text", part: p });
      continue;
    }
    if (p.kind === "plan") {
      // 没有条目的计划没有可显示内容，不能独自撑起过程折叠块。https://github.com/ItsDalk-Lane/Scribe/issues/52
      if (p.entries.length === 0) continue;
      out.push({ type: "plan", part: p });
      continue;
    }
    if (p.kind === "compaction") {
      out.push({ type: "compaction", part: p });
      continue;
    }
    const children = childrenByParent.get(p.id);
    if ((children && children.length > 0) || isSubAgentLaunch(p)) {
      const childNodes =
        depth + 1 >= maxDepth
          ? []
          : foldNodes(children ?? [], childrenByParent, maxDepth, depth + 1);
      out.push({
        type: "subagent",
        parent: p,
        children: childNodes,
        truncated: depth + 1 >= maxDepth,
      });
      continue;
    }
    out.push({ type: "action", part: p });
  }
  return out;
}
