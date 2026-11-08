import type {
  BackendState,
  CompactionSnapshot,
  PlanUsage,
  SessionUsage,
  AgentChatMessage,
} from "@/agentMode/session/types";
import {
  aggregateUsageMetrics,
  type ModelCallObservation,
  type UsageMetrics,
  type StopReason,
  STOP_REASONS,
} from "@/agentMode/session/usageMetrics";

import type { SubagentRunSnapshot } from "@/agentMode/session/subagentTypes";
import { isSubagentRunActive } from "@/agentMode/session/subagentSessions";

export interface UsageTrackerDeps {
  getModelId(): string | undefined;
  notifyMessages(): void;
}

interface ChildRoundLifecycle {
  subagentId: string;
  roundId: string;
  runId?: string;
  startedAt?: number;
  endedAt?: number;
  stopReason?: StopReason;
  eventStarted?: boolean;
}

export class UsageTracker {
  private readonly calls = new Map<string, ModelCallObservation>();
  private readonly roundPrompts = new Map<string, string>();

  private readonly childRounds = new Map<string, ChildRoundLifecycle>();

  markMetricsRoundStarted(
    roundId: string | undefined,
    promptId: string,
    child?: { subagentId: string; runId?: string; startedAt?: number }
  ): void {
    if (roundId) this.roundPrompts.set(roundId, promptId);
    if (roundId && child) {
      const key = JSON.stringify([child.subagentId, roundId]);
      const previousCall = [...this.calls.values()]
        .filter(
          (call) =>
            call.subagentId === child.subagentId &&
            call.runId === child.runId &&
            call.roundId !== roundId &&
            call.purpose === "chat"
        )
        .at(-1);
      const previous = previousCall
        ? (this.childRounds.get(JSON.stringify([child.subagentId, previousCall.roundId])) ?? {
            subagentId: child.subagentId,
            roundId: previousCall.roundId,
            runId: child.runId,
          })
        : [...this.childRounds.values()].find(
            (entry) =>
              entry.subagentId === child.subagentId &&
              entry.runId === child.runId &&
              entry.roundId !== roundId &&
              entry.endedAt === undefined
          );
      // 新用户输入已实际投递，前一子轮止于此边界，不能借用整个执行的结束时间。https://github.com/ItsDalk-Lane/Scribe/issues/52
      if (
        !this.childRounds.get(key)?.eventStarted &&
        previous &&
        child.startedAt !== undefined &&
        previous.endedAt === undefined
      ) {
        previous.endedAt = child.startedAt;
        const final = [...this.calls.values()]
          .filter(
            (call) =>
              call.subagentId === child.subagentId &&
              call.roundId === previous.roundId &&
              call.purpose === "chat" &&
              call.segmentSeq !== undefined
          )
          .at(-1);
        previous.stopReason =
          final?.segmentSeq !== undefined && this.finalSegments.has(final.segmentSeq)
            ? "end_turn"
            : "interrupted";
        this.childRounds.set(JSON.stringify([child.subagentId, previous.roundId]), previous);
        this.endedChildRounds.add(JSON.stringify([child.subagentId, previous.roundId]));
      }
      this.childRounds.set(key, {
        ...this.childRounds.get(key),
        subagentId: child.subagentId,
        roundId,
        runId: child.runId,
        startedAt: this.childRounds.get(key)?.eventStarted
          ? this.childRounds.get(key)?.startedAt
          : child.startedAt,
        eventStarted: true,
      });
    }
    this.refreshMetrics();
  }

  applyChildRun(subagentId: string, run: SubagentRunSnapshot): void {
    if (!run.roundId) return;
    const key = JSON.stringify([subagentId, run.roundId]);
    const previous = this.childRounds.get(key);
    const ended = !isSubagentRunActive(run.status);
    const reported = STOP_REASONS.find((reason) => reason === run.stopReason);
    const reason =
      (reported === "end_turn" && run.status !== "completed" ? undefined : reported) ??
      (run.status === "completed"
        ? "end_turn"
        : run.status === "stopped"
          ? "cancelled"
          : run.status === "failed"
            ? "request_error"
            : undefined);
    this.childRounds.set(key, {
      ...previous,
      subagentId,
      roundId: run.roundId,
      runId: run.id,
      startedAt: previous?.eventStarted
        ? previous.startedAt
        : (run.startedAt ?? previous?.startedAt),
      // 恢复快照的 interrupted 结束点是最后已知活动，不是实际停止时间。https://github.com/ItsDalk-Lane/Scribe/issues/52
      endedAt:
        previous?.endedAt ?? (ended && run.status !== "interrupted" ? run.endedAt : undefined),
      stopReason: previous?.stopReason ?? (ended ? reason : undefined),
    });
    if (ended) this.endedChildRounds.add(key);
    this.refreshMetrics();
  }
  private readonly endedRounds = new Set<string>();
  private readonly endedChildRounds = new Set<string>();

  markChildRoundEnded(
    subagentId: string,
    roundId: string,
    endedAt?: number,
    stopReason?: StopReason
  ): void {
    const key = JSON.stringify([subagentId, roundId]);
    const previous = this.childRounds.get(key);
    this.childRounds.set(key, {
      ...previous,
      subagentId,
      roundId,
      endedAt: previous?.endedAt ?? endedAt,
      stopReason: previous?.stopReason ?? stopReason,
    });
    this.endedChildRounds.add(key);
    this.refreshMetrics();
  }
  private readonly finalSegments = new Set<number>();
  private readonly tools = new Map<string, { roundId: string; sourceId: string }>();
  private readonly childUsage = new Map<string, SessionUsage>();

  recordToolExecution(roundId: string, sourceId: string, toolCallId: string): void {
    this.tools.set(toolCallId, { roundId, sourceId });
    this.refreshMetrics();
  }

  completeReplay(): void {
    // 重开只恢复已保存事实，不把中断的模型请求或子任务重新视为正在执行。https://github.com/ItsDalk-Lane/Scribe/issues/52
    for (const roundId of this.roundPrompts.keys()) this.endedRounds.add(roundId);
    for (const [id, call] of this.calls) {
      if (call.status === "running")
        this.calls.set(id, {
          ...call,
          status: "cancelled",
          usagePartial: true,
          dispatchUnknown: true,
        });
      this.endedRounds.add(call.roundId);
      if (call.subagentId)
        this.endedChildRounds.add(JSON.stringify([call.subagentId, call.roundId]));
    }
    this.refreshMetrics();
  }

  getSubagentUsage(subagentId: string): SessionUsage | null {
    return this.childUsage.get(subagentId) ?? null;
  }

  applyModelCall(observation: ModelCallObservation): void {
    this.calls.set(observation.id, observation);
    this.refreshMetrics();
  }

  markMetricsRoundEnded(roundId: string | undefined): void {
    if (roundId) this.endedRounds.add(roundId);
    this.refreshMetrics();
  }

  markFinalSegment(segmentSeq: number): void {
    this.finalSegments.add(segmentSeq);
  }

  getMetricsForMessage(message: AgentChatMessage, child = false): UsageMetrics | undefined {
    const segments = new Set(
      message.parts?.flatMap((part) => (part.segmentSeq === undefined ? [] : [part.segmentSeq]))
    );
    const owner = [...this.calls.values()].find(
      (call) =>
        (call.segmentSeq !== undefined && segments.has(call.segmentSeq)) ||
        (call.kind === "main" && message.id === `assistant:${call.promptId}`)
    );
    if (!owner) {
      const round = [...this.roundPrompts].find(
        ([, promptId]) => message.id === `assistant:${promptId}`
      );
      if (!round) return message.turnMetrics;
      const ended = this.endedRounds.has(round[0]);
      return {
        partial: true,
        sources: [],
        roundId: round[0],
        promptId: round[1],
        steps: 0,
        rounds: ended ? 1 : 0,
        activeRounds: ended ? 0 : 1,
        hasActiveWork: !ended,
      };
    }
    const selected = [...this.calls.values()].filter(
      (call) => call.roundId === owner.roundId && (!child || call.sourceId === owner.sourceId)
    );
    const result = aggregateUsageMetrics(selected);
    result.toolCallCount = [...this.tools.values()].filter(
      (tool) => tool.roundId === owner.roundId && (!child || tool.sourceId === owner.sourceId)
    ).length;
    result.roundId = owner.roundId;
    result.promptId = owner.promptId;
    if (owner.subagentId) result.subagentId = owner.subagentId;
    const ended = child
      ? this.endedChildRounds.has(JSON.stringify([owner.subagentId, owner.roundId]))
      : this.endedRounds.has(owner.roundId);
    result.rounds = ended ? 1 : 0;
    result.activeRounds = ended ? 0 : 1;
    if (child && owner.subagentId) {
      const lifecycle = this.childRounds.get(JSON.stringify([owner.subagentId, owner.roundId]));
      // 追加回合的显示消息可能沿用首段时间戳，计时必须投影各自已记录的真实开始时间。https://github.com/ItsDalk-Lane/Scribe/issues/52
      if (lifecycle?.startedAt !== undefined) result.roundStartedAtMs = lifecycle.startedAt;
      if (lifecycle?.stopReason) result.roundStopReason = lifecycle.stopReason;
      if (
        lifecycle?.startedAt !== undefined &&
        lifecycle.endedAt !== undefined &&
        lifecycle.endedAt >= lifecycle.startedAt
      )
        result.roundDurationMs = lifecycle.endedAt - lifecycle.startedAt;
    }
    const final = [...segments].filter((seq) => this.finalSegments.has(seq));
    if (final.length) result.finalResponseSegmentSeq = Math.max(...final);
    return result;
  }

  private refreshMetrics(): void {
    if (!this.calls.size && !this.roundPrompts.size) return;
    const metrics = aggregateUsageMetrics([...this.calls.values()]);
    const rounds = new Set([
      ...this.roundPrompts.keys(),
      ...[...this.calls.values()]
        .filter((call) => call.purpose === "chat")
        .map((call) => call.roundId),
    ]);
    metrics.rounds = [...rounds].filter((id) => this.endedRounds.has(id)).length;
    metrics.activeRounds = rounds.size - metrics.rounds;
    metrics.toolCallCount = this.tools.size;
    if (!this.calls.size) metrics.steps = 0;
    metrics.hasActiveWork ||= metrics.activeRounds > 0;
    if (!this.calls.size) metrics.partial = true;
    // 旧聊天累计是已报告事实，新采集只覆盖部分历史时不能把小和冒充完整聊天。https://github.com/ItsDalk-Lane/Scribe/issues/52
    const previousTotal = this.sessionUsage?.cumulativeTotalTokens;
    if (previousTotal !== undefined && previousTotal > (metrics.totalTokens ?? 0)) {
      metrics.totalTokens = previousTotal;
      metrics.partial = true;
      metrics.cacheHitPercent = undefined;
      if (metrics.toolCallCount === 0) metrics.toolCallCount = undefined;
      if (metrics.steps === 0) metrics.steps = undefined;
      if (metrics.rounds === 0) metrics.rounds = undefined;
    }
    this.sessionUsage = { usedTokens: 0, ...this.sessionUsage, metrics, updatedAt: Date.now() };
    for (const id of new Set(
      [...this.calls.values()].flatMap((call) => (call.subagentId ? [call.subagentId] : []))
    )) {
      const calls = [...this.calls.values()].filter((call) => call.subagentId === id);
      const childMetrics = aggregateUsageMetrics(calls);
      const rounds = new Set(
        calls.filter((call) => call.purpose === "chat").map((call) => call.roundId)
      );
      childMetrics.rounds = [...rounds].filter((round) =>
        this.endedChildRounds.has(JSON.stringify([id, round]))
      ).length;
      childMetrics.activeRounds = rounds.size - childMetrics.rounds;
      childMetrics.toolCallCount = [...this.tools.values()].filter(
        (tool) => tool.sourceId === id
      ).length;
      this.childUsage.set(id, {
        usedTokens: 0,
        metrics: childMetrics,
        updatedAt: this.sessionUsage.updatedAt,
      });
    }
    this.deps.notifyMessages();
  }
  private sessionUsage: SessionUsage | null = null;
  private planUsage: PlanUsage | null = null;

  constructor(private readonly deps: UsageTrackerDeps) {}

  getSessionUsage(): SessionUsage | null {
    return this.sessionUsage;
  }

  getPlanUsage(): PlanUsage | null {
    return this.planUsage;
  }

  applyPlanUsage(planUsage: PlanUsage | null): void {
    this.planUsage = planUsage;
    this.deps.notifyMessages();
  }

  seedSessionUsage(usage: SessionUsage | undefined): void {
    if (!usage) return;
    this.sessionUsage = usage;
    this.refreshMetrics();
    this.deps.notifyMessages();
  }

  applyUsageUpdate(usage: SessionUsage): void {
    if (this.sessionUsage?.metrics && this.sessionUsage.metrics !== usage.metrics)
      usage = { ...usage, metrics: this.sessionUsage.metrics };
    const onlyCumulative =
      !usage.usedTokens ||
      (usage.contextWindow === undefined && this.sessionUsage?.contextWindow !== undefined);
    // 子请求的累计消耗不是父上下文占用；压缩和缺省读数也不能清掉已报告的累计。https://github.com/ItsDalk-Lane/Scribe/issues/50
    if (onlyCumulative && usage.cumulativeTotalTokens === undefined) return;
    const previous = this.sessionUsage;
    if (onlyCumulative || previous?.cumulativeTotalTokens !== undefined) {
      this.sessionUsage = {
        ...(onlyCumulative ? (previous ?? usage) : usage),
        cumulativeInputTokens: usage.cumulativeInputTokens ?? previous?.cumulativeInputTokens,
        cumulativeOutputTokens: usage.cumulativeOutputTokens ?? previous?.cumulativeOutputTokens,
        cumulativeCacheReadTokens:
          usage.cumulativeCacheReadTokens ?? previous?.cumulativeCacheReadTokens,
        cumulativeCacheWriteTokens:
          usage.cumulativeCacheWriteTokens ?? previous?.cumulativeCacheWriteTokens,
        cumulativeTotalTokens: usage.cumulativeTotalTokens ?? previous?.cumulativeTotalTokens,
        updatedAt: usage.updatedAt,
      };
    } else this.sessionUsage = usage;
    if (this.calls.size || this.roundPrompts.size) this.refreshMetrics();
    else this.deps.notifyMessages();
  }

  applyCompactedUsage(compaction: CompactionSnapshot): boolean {
    if (compaction.status !== "completed" || compaction.postTokens === undefined) return false;
    this.sessionUsage = {
      ...this.sessionUsage,
      usedTokens: compaction.postTokens,
      contextWindow: this.sessionUsage?.contextWindow,
      updatedAt: Date.now(),
    };
    return true;
  }

  dropUsageWindowOnModelChange(next: BackendState | null): void {
    const before = this.deps.getModelId();
    const after = next?.model?.current.baseModelId;
    if (!before || !after || before === after) return;
    if (this.sessionUsage?.contextWindow === undefined) return;
    const dropped = { ...this.sessionUsage, contextWindow: undefined };
    this.sessionUsage = dropped;
    this.deps.notifyMessages();
  }
}
