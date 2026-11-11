import { t } from "@/lib/i18n";
import React, { memo, useCallback, useMemo } from "react";
import {
  agentResponseText,
  buildAgentTrail,
  splitCompletedAgentTrail,
  type CompletedAgentTrail,
} from "@/agentMode/ui/agentTrail";
import type { UsageMetrics } from "@/agentMode/session/usageMetrics";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { ListChecks } from "lucide-react";
import { formatWorkedDuration } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { TurnUsageBadge } from "@/agentMode/ui/TurnUsageBadge";
import type { AgentMessagePart, StopReason, TurnFileChange } from "@/agentMode/session/types";
import { ActionCard } from "@/agentMode/ui/ActionCard";
import { FilesChangedCard } from "@/agentMode/ui/FilesChangedCard";
import { foldActivityGroups, type GroupedTrailNode } from "@/agentMode/ui/activityGroups";
import { CompactionRow } from "@/agentMode/ui/CompactionRow";
import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { SubAgentCard } from "@/agentMode/ui/SubAgentCard";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { planEntryClass, planEntryIcon } from "@/agentMode/ui/planEntryStyles";
import { summarizeDrawing } from "@/excalidraw/agentMode/excalidrawToolRun";
import { ExcalidrawToolCard } from "@/excalidraw/agentMode/ui/ExcalidrawToolCard";
import { useTrailExpansion, type TrailExpansion } from "@/agentMode/ui/useTrailExpansion";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { useAgentTasks, type AgentTasksContextValue } from "@/agentMode/ui/AgentTasksContext";
import { TaskCard } from "@/agentMode/ui/TaskCard";
import { AssistantResponseFooter } from "@/components/ui/AssistantResponseFooter";
import { cn } from "@/lib/utils";
import { openVaultPath } from "@/utils/openVaultPath";
import { App } from "obsidian";

interface AgentTrailProps {
  messageId?: string;
  metrics?: UsageMetrics;
  parts: AgentMessagePart[];
  isStreaming: boolean;
  turnStartedAtMs?: number;
  turnDurationMs?: number;
  timestamp?: string;
  app: App;
  sourcePath?: string;
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
    max_task_requests:
      "**Task request limit reached.** The parent chat and its children have used this task's request budget. Saved progress is preserved; explicitly continue to allow more requests.",
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
  messageId,
  metrics,
  parts,
  isStreaming,
  turnStartedAtMs,
  turnDurationMs,
  timestamp,
  app,
  sourcePath = "",
  turnStopReason,
  errorText,
  fileChanges,
  onOpenFileChange = noopOpenFileChange,
  onFork,
  forkDisabled,
}) => {
  // 仅收起已经确认最终响应、且相关工作全部结束的正常回合；中断和旧记录保留原貌。https://github.com/ItsDalk-Lane/Scribe/issues/52
  const finalResponse = splitCompletedAgentTrail(parts, metrics?.finalResponseSegmentSeq);
  const completed =
    !isStreaming && turnStopReason === "end_turn" && !errorText && metrics?.hasActiveWork === false
      ? finalResponse
      : undefined;
  const answer = agentResponseText(finalResponse?.response ?? parts);
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
        metrics={metrics}
        app={app}
        onFork={onFork}
        forkDisabled={forkDisabled}
        timestamp={timestamp}
      />
    ) : !hasRunningDuration && timestamp ? (
      <AssistantResponseFooter
        timestamp={timestamp}
        afterTimestamp={<TurnUsageBadge metrics={metrics} />}
      />
    ) : null;

  return (
    <div className="tw-group tw-flex tw-flex-col tw-gap-1">
      <LinearTrail
        parts={parts}
        messageId={messageId}
        metrics={metrics}
        completed={completed}
        isStreaming={isStreaming}
        app={app}
        sourcePath={sourcePath}
        turnDurationMs={!isStreaming && !compactionOnly ? turnDurationMs : undefined}
      />
      {recoveryNotices.map(({ id, text }) => (
        <div role="alert" key={id} className="tw-text-warning">
          <span className="tw-text-xs">{t("Recovered after interruption")}</span>
          <AgentMarkdownText
            text={text}
            app={app}
            sourcePath={sourcePath}
            renderIdentity={`${messageId ?? "root"}/recovery:${id}`}
          />
        </div>
      ))}
      {notice ? (
        <div
          role={turnStopReason === "interrupted" ? "alert" : undefined}
          className="tw-text-error"
        >
          <AgentMarkdownText
            text={notice}
            app={app}
            sourcePath={sourcePath}
            renderIdentity={`${messageId ?? "root"}/notice`}
          />
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
  sourcePath: string;
  partPositions: ReadonlyMap<AgentMessagePart, number>;
  isStreaming: boolean;
  lastPart: AgentMessagePart | undefined;
  expansion: TrailExpansion;
  tasks: AgentTasksContextValue | null;
}

const LinearTrail: React.FC<{
  parts: AgentMessagePart[];
  isStreaming: boolean;
  app: App;
  sourcePath: string;
  turnDurationMs?: number;
  messageId?: string;
  metrics?: UsageMetrics;
  completed?: CompletedAgentTrail;
}> = ({ parts, isStreaming, app, sourcePath, turnDurationMs, messageId, metrics, completed }) => {
  const expansion = useTrailExpansion();
  const tasks = useAgentTasks();
  const partPositions = useMemo(() => new Map(parts.map((part, index) => [part, index])), [parts]);
  const nodes = foldActivityGroups(buildAgentTrail(parts), () => true);
  const processNodes = completed
    ? foldActivityGroups(buildAgentTrail(completed.process), () => true)
    : [];
  const finalNodes = completed ? buildAgentTrail(completed.response) : [];
  // 中间工具失败不等于整轮失败；正常收尾后仍折叠过程，但把异常数量留在标题中。https://github.com/ItsDalk-Lane/Scribe/issues/52
  const processStatuses = completed?.process.flatMap((part) =>
    part.kind === "tool_call" || part.kind === "compaction" ? [part.status] : []
  );
  const failedCount = processStatuses?.filter((status) => status === "failed").length ?? 0;
  const cancelledCount = processStatuses?.filter((status) => status === "cancelled").length ?? 0;
  const trailId = messageId ?? "root";
  const processId = `${trailId}/process`;
  const hasProcess = processNodes.length > 0;
  const visibleNodes = hasProcess ? finalNodes : nodes;
  const ctx: TrailContext = {
    app,
    sourcePath,
    partPositions,
    isStreaming,
    lastPart: parts.length > 0 ? parts[parts.length - 1] : undefined,
    expansion,
    tasks,
  };
  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      {!hasProcess && turnDurationMs !== undefined ? (
        <AgentTurnDurationIndicator status="complete" durationMs={turnDurationMs} inline />
      ) : null}
      {hasProcess ? (
        <AgentActivityCard
          icon={ListChecks}
          ariaLabel={t("Process details")}
          label={
            <>
              <span className="tw-shrink-0">
                {t("Worked for")}{" "}
                {turnDurationMs === undefined
                  ? "—"
                  : formatWorkedDuration(Math.max(100, turnDurationMs))}
              </span>
              <span className="tw-truncate tw-font-normal">
                · {t("Thinking time")}{" "}
                {metrics?.thinkingDurationMs === undefined
                  ? "—"
                  : formatWorkedDuration(metrics.thinkingDurationMs)}
                {" · "}
                {t("Tool calls")} {metrics?.toolCallCount ?? "—"}
              </span>
            </>
          }
          expandable
          trailing={
            failedCount || cancelledCount ? (
              <span className="tw-flex tw-shrink-0 tw-gap-2 tw-text-xs tw-tabular-nums">
                {failedCount ? (
                  <span className="tw-text-error">
                    {t("Failed")} {failedCount}
                  </span>
                ) : null}
                {cancelledCount ? (
                  <span className="tw-text-muted">
                    {t("Cancelled")} {cancelledCount}
                  </span>
                ) : null}
              </span>
            ) : null
          }
          open={expansion.isOpen(processId)}
          onToggle={() => expansion.toggle(processId)}
        >
          {processNodes.map((node) => renderNode(node, ctx, false, trailId))}
        </AgentActivityCard>
      ) : null}
      {visibleNodes.map((node, index) =>
        renderNode(node, ctx, isStreaming && index === visibleNodes.length - 1, trailId)
      )}
    </div>
  );
};

function renderNode(
  node: GroupedTrailNode,
  ctx: TrailContext,
  atLiveEdge: boolean,
  trailId: string
): React.ReactNode {
  const key = trailNodeIdentity(node, ctx.partPositions);
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
          {node.members.map((part) => renderNode({ type: "action", part }, ctx, false, trailId))}
        </ExcalidrawToolCard>
      );
    }
    case "activityGroup":
      return node.members.map((member) => renderNode(member, ctx, atLiveEdge, trailId));
    case "subagent": {
      const children = foldActivityGroups(node.children);
      const lastChild = children[children.length - 1];
      const childTrailId = `${trailId}/subagent:${node.parent.id}`;
      return (
        <SubAgentCard
          key={key}
          parent={node.parent}
          expansion={ctx.expansion}
          expansionId={childTrailId}
          childNodes={children}
          truncated={node.truncated}
          app={ctx.app}
          renderNode={(n) => renderNode(n, ctx, atLiveEdge && n === lastChild, childTrailId)}
        />
      );
    }
    case "reasoning": {
      const isActive =
        atLiveEdge && node.part === ctx.lastPart && node.part.durationMs === undefined;
      const expansionId = `${trailId}/reasoning:${node.part.segmentSeq ?? key}:${node.part.contentIndex ?? 0}`;
      return (
        <ReasoningBlock
          key={key}
          part={node.part}
          isStreaming={isActive}
          open={ctx.expansion.isOpen(expansionId)}
          onToggle={() => ctx.expansion.toggle(expansionId)}
        />
      );
    }
    case "text":
      return (
        <AgentMarkdownText
          key={key}
          text={node.part.text}
          app={ctx.app}
          sourcePath={ctx.sourcePath}
          renderIdentity={`${trailId}/${key}`}
          isStreaming={atLiveEdge}
        />
      );
    case "plan":
      return <PlanPill key={key} entries={node.part.entries} isRunning={ctx.isStreaming} />;
    case "compaction":
      return <CompactionRow key={key} part={node.part} />;
  }
}

function trailNodeIdentity(
  node: GroupedTrailNode,
  partPositions: ReadonlyMap<AgentMessagePart, number>
): string {
  if (node.type === "activityGroup") return node.id;
  if (node.type === "excalidrawDrawing") return `drawing:${node.members[0].id}`;
  if (node.type === "subagent") return `subagent:${node.parent.id}`;
  if (node.type === "action") return `action:${node.part.id}`;
  const part = node.part;
  return `${node.type}:${part.segmentSeq ?? "legacy"}:${part.contentIndex ?? part.seq ?? partPositions.get(part)}`;
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

function actionExpansionId(trailId: string, toolCallId: string): string {
  return `${trailId}/action:${toolCallId}`;
}

interface PlanPillProps {
  entries: { content: string; status: "pending" | "in_progress" | "completed" }[];
  isRunning: boolean;
}

const PlanPill: React.FC<PlanPillProps> = ({ entries, isRunning }) =>
  entries.length === 0 ? null : (
    <div className="tw-my-1 tw-rounded tw-border tw-border-border tw-bg-secondary tw-px-2 tw-py-1">
      {/* 计划状态可能未被模型收尾，回合停止后必须停下动效并保留原始条目。https://github.com/ItsDalk-Lane/Scribe/issues/52 */}
      <p
        className={cn(
          "tw-mb-1 tw-text-xs tw-text-muted",
          isRunning &&
            entries.some((entry) => entry.status === "in_progress") &&
            "scribe-shimmer-text motion-reduce:tw-animate-none"
        )}
      >
        {t("Plan")}
      </p>
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
