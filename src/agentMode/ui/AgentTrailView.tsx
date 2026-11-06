import { t } from "@/lib/i18n";
import React, { memo, useCallback, useMemo } from "react";
import { Layers } from "lucide-react";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { agentResponseText, buildAgentTrail } from "@/agentMode/ui/agentTrail";
import type { AgentMessagePart, StopReason, TurnFileChange } from "@/agentMode/session/types";
import { ActionCard } from "@/agentMode/ui/ActionCard";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import { ActivityGroupCard } from "@/agentMode/ui/ActivityGroupCard";
import {
  foldActivityGroups,
  summarizeActivity,
  type ActivityGroupNode,
  type GroupedTrailNode,
} from "@/agentMode/ui/activityGroups";
import { activityLiveStep, isReasoningActive } from "@/agentMode/ui/activityLiveStep";
import { CompactionRow } from "@/agentMode/ui/CompactionRow";
import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { SubAgentCard } from "@/agentMode/ui/SubAgentCard";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { planEntryClass, planEntryIcon } from "@/agentMode/ui/planEntryStyles";
import type { ToolSummaryContext } from "@/agentMode/ui/toolSummaries";
import { summarizeDrawing } from "@/excalidraw/agentMode/excalidrawToolRun";
import { ExcalidrawToolCard } from "@/excalidraw/agentMode/ui/ExcalidrawToolCard";
import { useThinkingClock } from "@/agentMode/ui/useThinkingClock";
import { useTrailExpansion, type TrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import {
  AgentTurnDurationIndicator,
  formatWorkedDuration,
} from "@/agentMode/ui/AgentTurnDurationIndicator";
import { useAgentTasks, type AgentTasksContextValue } from "@/agentMode/ui/AgentTasksContext";
import { TaskCard } from "@/agentMode/ui/TaskCard";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { getVaultBase } from "@/utils/vaultPath";
import { openVaultPath } from "@/utils/openVaultPath";
import { App } from "obsidian";

interface AgentTrailProps {
  parts: AgentMessagePart[];
  isStreaming: boolean;
  turnStartedAtMs?: number;
  turnDurationMs?: number;
  timestamp?: string;
  app: App;
  turnStopReason?: StopReason;
  errorText?: string;
  fileChanges?: TurnFileChange[];
  onOpenFileChange?: (change: TurnFileChange) => void;
  onFork?: () => void;
  forkDisabled?: boolean;
}

const noopOpenFileChange = () => {};

const EARLY_STOP_CAUSES: Partial<Record<StopReason, string>> = {
  max_tokens: "the model hit its output limit",
  refusal: "the model's safety system stopped it",
};

function stopReasonNotice(stopReason: StopReason | undefined): string | undefined {
  const notices: Partial<Record<StopReason, string>> = {
    interrupted: "System recovery: this reply was interrupted. It was not automatically resumed.",
    max_turn_requests:
      "**Step limit reached.** The agent has ended this turn. Review its summary and send another message to continue.",
    quota_exhausted:
      "**Service quota exhausted.** This is an account limit, not a code problem. Add quota or reopen the chat, then send another message to continue.",
    authentication_error:
      "**Authentication failed.** Check the provider credentials in Models, then send another message to continue.",
    context_limit:
      "**Context limit reached.** Context could not be compacted safely. Your conversation is preserved; shorten the request or choose a model with a larger context window.",
    request_error:
      "**Model request failed.** Check the provider connection and settings, then send another message to retry.",
    cancelled: "**Cancelled by you.** Send another message when you want to continue.",
  };
  if (stopReason && notices[stopReason]) return t(notices[stopReason]);
  const cause = stopReason && EARLY_STOP_CAUSES[stopReason];
  return (
    cause &&
    t(
      "**Stopped early:** {p0}, so its last step may not have run. Send another message to continue.",
      { p0: cause }
    )
  );
}

export const AgentTrail: React.FC<AgentTrailProps> = ({
  parts,
  isStreaming,
  turnStartedAtMs,
  turnDurationMs,
  timestamp,
  app,
  turnStopReason,
  errorText,
  fileChanges,
  onOpenFileChange = noopOpenFileChange,
  onFork,
  forkDisabled,
}) => {
  const answer = agentResponseText(parts);
  const expansion = useTrailExpansion(isStreaming);
  const processParts = useMemo(
    () => parts.filter((part) => part.kind === "tool_call" || part.kind === "thought"),
    [parts]
  );
  const visibleParts = useMemo(
    () => parts.filter((part) => part.kind !== "tool_call" && part.kind !== "thought"),
    [parts]
  );
  const hasSeveralProcessGroups = useMemo(
    () =>
      foldActivityGroups(buildAgentTrail(parts)).filter(
        (node) => node.type !== "text" && node.type !== "plan" && node.type !== "compaction"
      ).length > 1,
    [parts]
  );
  const processSummary = useMemo(
    () =>
      summarizeActivity(
        processParts.map((part) =>
          part.kind === "tool_call"
            ? { type: "action" as const, part }
            : {
                type: "reasoning" as const,
                part,
              }
        )
      ),
    [processParts]
  );
  const recoveryNotices = useMemo(
    () =>
      parts
        .filter((part) => part.kind === "tool_call" && part.synthetic)
        .flatMap((part) =>
          part.kind === "tool_call"
            ? [
                {
                  id: part.seq ?? part.id,
                  text: (part.output ?? [])
                    .flatMap((output) => (output.type === "text" ? [output.text] : []))
                    .join("\n\n"),
                },
              ]
            : []
        ),
    [parts]
  );
  const notice = errorText || stopReasonNotice(turnStopReason);
  const hasRunningDuration = isStreaming && turnStartedAtMs !== undefined;
  const trailNodes = buildAgentTrail(parts);
  const compactionOnly =
    trailNodes.length > 0 && trailNodes.every((node) => node.type === "compaction");
  const footer =
    !isStreaming && turnStopReason !== "cancelled" && answer.length > 0 ? (
      <AgentMessageActions
        text={answer}
        app={app}
        onFork={onFork}
        forkDisabled={forkDisabled}
        timestamp={timestamp}
      />
    ) : !hasRunningDuration && timestamp ? (
      <AssistantResponseFooter timestamp={timestamp} />
    ) : null;

  return (
    <div className="tw-group tw-flex tw-flex-col tw-gap-1">
      {!isStreaming && hasSeveralProcessGroups ? (
        <>
          <AgentActivityCard
            icon={Layers}
            label={
              turnDurationMs === undefined
                ? processSummary.line
                : `${t("Worked for")} ${formatWorkedDuration(turnDurationMs)}, ${processSummary.line}`
            }
            expandable
            open={expansion.isOpen("completed-turn", false)}
            onToggle={() => expansion.toggle("completed-turn", false)}
          >
            <LinearTrail parts={processParts} isStreaming={false} app={app} />
          </AgentActivityCard>
          <LinearTrail parts={visibleParts} isStreaming={false} app={app} />
        </>
      ) : (
        <LinearTrail
          parts={parts}
          isStreaming={isStreaming}
          app={app}
          turnDurationMs={!isStreaming && !compactionOnly ? turnDurationMs : undefined}
        />
      )}
      {recoveryNotices.map(({ id, text }) => (
        <div role="alert" key={id} className="tw-text-warning">
          <span className="tw-text-xs">{t("Recovered after interruption")}</span>
          <AgentMarkdownText text={text} app={app} />
        </div>
      ))}
      {notice ? (
        <div
          role={turnStopReason === "interrupted" ? "alert" : undefined}
          className="tw-text-error"
        >
          <AgentMarkdownText text={notice} app={app} />
        </div>
      ) : null}
      {turnStopReason !== undefined && fileChanges && fileChanges.length > 0 ? (
        <FilesChangedCard changes={fileChanges} onOpen={onOpenFileChange} />
      ) : null}
      {hasRunningDuration && !compactionOnly ? (
        <AgentTurnDurationIndicator status="running" startedAtMs={turnStartedAtMs} />
      ) : null}
      {compactionOnly ? null : footer}
    </div>
  );
};

interface TrailContext {
  app: App;
  lastPart: AgentMessagePart | undefined;
  expansion: TrailExpansion;
  summaryCtx: ToolSummaryContext;
  tasks: AgentTasksContextValue | null;
  turnDurationMs?: number;
  durationGroupId?: string;
  isStreaming: boolean;
}

const LinearTrail: React.FC<{
  parts: AgentMessagePart[];
  isStreaming: boolean;
  app: App;
  turnDurationMs?: number;
}> = ({ parts, isStreaming, app, turnDurationMs }) => {
  const expansion = useTrailExpansion(isStreaming);
  const tasks = useAgentTasks();
  const summaryCtx = useMemo(() => ({ vaultBase: getVaultBase(app) }), [app]);
  const nodes = foldActivityGroups(buildAgentTrail(parts), (part) =>
    Boolean(tasks?.tasks.some((task) => task.toolCallId === part.id))
  );
  const durationGroup = nodes.find((node) => node.type === "activityGroup");
  const ctx: TrailContext = {
    app,
    lastPart: parts.length > 0 ? parts[parts.length - 1] : undefined,
    expansion,
    isStreaming,
    summaryCtx,
    tasks,
    turnDurationMs,
    durationGroupId: durationGroup?.type === "activityGroup" ? durationGroup.id : undefined,
  };
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      {turnDurationMs !== undefined && !durationGroup ? (
        <AgentTurnDurationIndicator status="complete" durationMs={turnDurationMs} inline />
      ) : null}
      {nodes.map((node, i) =>
        renderNode(node, i, ctx, isStreaming && i === nodes.length - 1, "root")
      )}
    </div>
  );
};

function renderNode(
  node: GroupedTrailNode,
  key: string | number,
  ctx: TrailContext,
  atLiveEdge: boolean,
  trailId: string
): React.ReactNode {
  const launch = node.type === "action" ? node.part : node.type === "subagent" ? node.parent : null;
  const task = launch && ctx.tasks?.tasks.find((t) => t.toolCallId === launch.id);
  if (task && ctx.tasks) return <TaskCard key={key} task={task} onOpen={ctx.tasks.openTask} />;
  switch (node.type) {
    case "action": {
      const expansionId = actionExpansionId(trailId, node.part.id);
      return (
        <TrailAction
          key={key}
          part={node.part}
          open={ctx.expansion.isOpen(expansionId)}
          expansionId={expansionId}
          toggle={ctx.expansion.toggle}
        />
      );
    }
    case "excalidrawDrawing": {
      const expansionId = `${trailId}/drawing:${node.id}`;
      return (
        <ExcalidrawToolCard
          key={key}
          {...summarizeDrawing(node.members)}
          onOpenDrawing={(path, pane) => openVaultPath(ctx.app, path, { pane })}
          open={ctx.expansion.isOpen(expansionId)}
          onToggle={() => ctx.expansion.toggle(expansionId)}
        >
          {node.members.map((part) =>
            renderNode({ type: "action", part }, part.id, ctx, false, trailId)
          )}
        </ExcalidrawToolCard>
      );
    }
    case "activityGroup":
      return (
        <ActivityGroupRow
          key={key}
          group={node}
          ctx={ctx}
          atLiveEdge={atLiveEdge}
          trailId={trailId}
          turnDurationMs={
            trailId === "root" && node.id === ctx.durationGroupId ? ctx.turnDurationMs : undefined
          }
        />
      );
    case "subagent": {
      const children = foldActivityGroups(node.children);
      const lastChild = children[children.length - 1];
      const childTrailId = `${trailId}/subagent:${node.parent.id}`;
      return (
        <SubAgentCard
          key={key}
          parent={node.parent}
          isTurnStreaming={ctx.isStreaming}
          childNodes={children}
          truncated={node.truncated}
          app={ctx.app}
          renderNode={(n, k) => renderNode(n, k, ctx, atLiveEdge && n === lastChild, childTrailId)}
        />
      );
    }
    case "reasoning": {
      const isActive =
        atLiveEdge && node.part === ctx.lastPart && node.part.durationMs === undefined;
      return (
        <ReasoningBlock
          key={key}
          part={node.part}
          isStreaming={isActive}
          isTurnStreaming={ctx.isStreaming}
        />
      );
    }
    case "text":
      return <AgentMarkdownText key={key} text={node.part.text} app={ctx.app} />;
    case "plan":
      return <PlanPill key={key} entries={node.part.entries} />;
    case "compaction":
      return <CompactionRow key={key} part={node.part} />;
  }
}

const TrailAction = memo(function TrailAction({
  part,
  open,
  expansionId,
  toggle,
}: {
  part: Extract<AgentMessagePart, { kind: "tool_call" }>;
  open: boolean;
  expansionId: string;
  toggle: TrailExpansion["toggle"];
}) {
  const onToggle = useCallback(() => toggle(expansionId), [toggle, expansionId]);
  return <ActionCard part={part} open={open} onToggle={onToggle} />;
});

interface ActivityGroupRowProps {
  group: ActivityGroupNode;
  atLiveEdge: boolean;
  ctx: TrailContext;
  trailId: string;
  turnDurationMs?: number;
}

const ActivityGroupRow: React.FC<ActivityGroupRowProps> = ({
  group,
  atLiveEdge,
  ctx,
  trailId,
  turnDurationMs,
}) => {
  const trailingMember = group.members[group.members.length - 1];
  const groupAtLiveEdge = atLiveEdge && trailingMember?.part === ctx.lastPart;
  const reasoningActive = isReasoningActive(group.members, groupAtLiveEdge);
  const activeThoughtStartedAtMs =
    reasoningActive && trailingMember?.type === "reasoning"
      ? trailingMember.part.startedAtMs
      : undefined;
  const thinkingMs = useThinkingClock(reasoningActive, activeThoughtStartedAtMs);
  const groupExpansionId = `${trailId}/group:${group.id}`;
  const memberExpansionIds = group.members.flatMap((member) =>
    member.type === "action" ? [actionExpansionId(trailId, member.part.id)] : []
  );
  const groupOpen = ctx.expansion.isOpen(
    groupExpansionId,
    ctx.isStreaming || memberExpansionIds.some((id) => ctx.expansion.isOpen(id, false))
  );

  const toggleGroup = () => {
    if (!groupOpen) {
      ctx.expansion.toggle(groupExpansionId);
      return;
    }
    if (ctx.expansion.isOpen(groupExpansionId)) ctx.expansion.toggle(groupExpansionId);
    for (const id of memberExpansionIds) {
      if (ctx.expansion.isOpen(id)) ctx.expansion.toggle(id);
    }
  };

  return (
    <ActivityGroupCard
      group={group}
      turnDurationMs={turnDurationMs}
      thinkingMs={thinkingMs}
      open={groupOpen}
      onToggle={toggleGroup}
      renderMember={(member, i) =>
        renderNode(
          member,
          member.type === "action" ? member.part.id : `thought-${i}`,
          ctx,
          groupAtLiveEdge,
          trailId
        )
      }
      liveStep={activityLiveStep(group.members, groupAtLiveEdge, ctx.summaryCtx)}
    />
  );
};

function actionExpansionId(trailId: string, toolCallId: string): string {
  return `${trailId}/action:${toolCallId}`;
}

interface PlanPillProps {
  entries: { content: string; status: "pending" | "in_progress" | "completed" }[];
}

const PlanPill: React.FC<PlanPillProps> = ({ entries }) =>
  entries.length === 0 ? null : (
    <div className="tw-my-1 tw-rounded tw-border tw-border-border tw-bg-secondary tw-px-2 tw-py-1">
      <p className="tw-mb-1 tw-text-xs tw-text-muted">{t("Plan")}</p>
      <ul className="tw-flex tw-flex-col tw-gap-0.5 tw-text-sm">
        {entries.map((e, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- plan entries are positional and may share content
          <li key={`plan-${i}`} className="tw-flex tw-items-start tw-gap-2">
            <span aria-hidden="true">{planEntryIcon(e.status)}</span>
            <span className={planEntryClass(e.status)}>{e.content}</span>
          </li>
        ))}
      </ul>
    </div>
  );
