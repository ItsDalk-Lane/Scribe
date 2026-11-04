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
    if (!usage.usedTokens) return;
    if (usage.contextWindow === undefined && this.sessionUsage?.contextWindow !== undefined) {
      return;
    }
    this.sessionUsage = usage;
    this.deps.notifyMessages();
  }

  applyCompactedUsage(compaction: CompactionSnapshot): boolean {
    if (compaction.status !== "completed" || compaction.postTokens === undefined) return false;
    this.sessionUsage = {
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
