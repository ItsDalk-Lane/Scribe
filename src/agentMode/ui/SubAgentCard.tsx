import { t } from "@/lib/i18n";
import React from "react";
import { useTrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import { ChevronDown, ChevronRight } from "lucide-react";
import { App } from "obsidian";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { GroupedTrailNode } from "@/agentMode/ui/activityGroups";
import { StatusBadge } from "@/agentMode/ui/ActionCard";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import {
  extractSubAgentInputPrompt,
  extractSubAgentReturnText,
  lookupToolSummary,
} from "@/agentMode/ui/toolSummaries";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";

interface SubAgentCardProps {
  parent: ToolCallPart;
  childNodes: GroupedTrailNode[];
  truncated?: boolean;
  isTurnStreaming?: boolean;
  app: App;
  renderNode: (node: GroupedTrailNode, key: string | number) => React.ReactNode;
}

export const SubAgentCard: React.FC<SubAgentCardProps> = ({
  parent,
  childNodes,
  truncated,
  app,
  renderNode,
  isTurnStreaming = false,
}) => {
  const expansion = useTrailExpansion(isTurnStreaming);
  const open = expansion.isOpen("subagent");
  const promptOpen = expansion.isOpen("prompt", false);
  const summary = lookupToolSummary(parent);
  const Icon = summary.icon;
  const line = summary.collapsedLine(parent);
  const outcome = summary.outcome(parent);
  const childCounts = countChildren(childNodes);
  const inputPrompt = extractSubAgentInputPrompt(parent);
  const returnText = extractSubAgentReturnText(parent);

  return (
    <AgentActivityCard
      icon={Icon}
      label={line}
      trailing={<StatusBadge status={parent.status} />}
      secondary={outcome}
      expandable
      open={open}
      onToggle={() => expansion.toggle("subagent")}
    >
      {childCounts.tools > 0 || childCounts.reasoning > 0 || truncated ? (
        <div className="tw-text-xs tw-text-muted">{describeCounts(childCounts, truncated)}</div>
      ) : null}
      {inputPrompt ? (
        <div className="tw-my-1">
          <div
            className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-text-xs tw-text-muted"
            onClick={() => expansion.toggle("prompt", false)}
            role="button"
          >
            <span className="tw-flex-1 tw-truncate">{t("Prompt")}</span>
            {promptOpen ? (
              <ChevronDown className="tw-size-3" />
            ) : (
              <ChevronRight className="tw-size-3" />
            )}
          </div>
          {promptOpen ? (
            <div className="tw-mt-1 tw-border-l-[2px] tw-border-border tw-pl-2">
              <AgentMarkdownText text={inputPrompt} app={app} />
            </div>
          ) : null}
        </div>
      ) : null}
      {truncated ? (
        <div className="tw-text-xs tw-text-muted">
          {t("This subagent's steps are nested too deep to show here.")}
        </div>
      ) : (
        childNodes.map((c, i) => renderNode(c, i))
      )}
      {returnText ? (
        <div className="tw-my-1 tw-border-l-[2px] tw-border-border tw-pl-2">
          <AgentMarkdownText text={returnText} app={app} />
        </div>
      ) : null}
    </AgentActivityCard>
  );
};

interface ChildCounts {
  tools: number;
  reasoning: number;
}

function countChildren(nodes: GroupedTrailNode[]): ChildCounts {
  let tools = 0;
  let reasoning = 0;
  for (const n of nodes) {
    if (n.type === "action" || n.type === "subagent") tools += 1;
    else if (n.type === "reasoning") reasoning += 1;
    else if (n.type === "excalidrawDrawing") tools += n.members.length;
    else if (n.type === "activityGroup") {
      for (const m of n.members) {
        if (m.type === "action") tools += 1;
        else reasoning += 1;
      }
    }
  }
  return { tools, reasoning };
}

function describeCounts(c: ChildCounts, truncated?: boolean): string {
  if (truncated) return "Nested";
  const bits: string[] = [];
  if (c.tools > 0) bits.push(`${c.tools} ${c.tools === 1 ? t("tool") : t("tools")}`);
  if (c.reasoning > 0) bits.push(t("{p0} reasoning", { p0: c.reasoning }));
  return bits.length > 0 ? bits.join(" · ") : t("No activity");
}
