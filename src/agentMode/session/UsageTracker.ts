import type {
  BackendState,
  CompactionSnapshot,
  PlanUsage,
  SessionUsage,
} from "@/agentMode/session/types";

export interface UsageTrackerDeps {
  getModelId(): string | undefined;
  notifyMessages(): void;
}

export class UsageTracker {
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
    this.deps.notifyMessages();
  }

  applyUsageUpdate(usage: SessionUsage): void {
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
    this.deps.notifyMessages();
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
