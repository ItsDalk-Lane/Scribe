import { ConcurrencyLimiter } from "@/utils/ConcurrencyLimiter";
export type { ConcurrencyReservation as SubagentReservation } from "@/utils/ConcurrencyLimiter";

export interface SubagentLimits {
  maxConcurrent: number;
  maxQueued: number;
  maxTaskRequests: number;
}

export class SubagentScheduler extends ConcurrencyLimiter {
  constructor(getLimits: () => SubagentLimits) {
    super(() => ({ ...getLimits(), queueFullMessage: "The subagent waiting queue is full." }));
  }
}
