export interface SubagentLimits {
  maxConcurrent: number;
  maxQueued: number;
  maxTaskRequests: number;
}

export interface SubagentReservation {
  ready: Promise<() => void>;
}

interface WaitingSlot {
  grant: () => void;
  cancel: () => void;
}

export class SubagentScheduler {
  private active = 0;
  private readonly waiting: WaitingSlot[] = [];

  constructor(private readonly getLimits: () => SubagentLimits) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    return this.reserve(signal).ready;
  }

  reserve(signal?: AbortSignal): SubagentReservation {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const limits = this.getLimits();
    if (this.active < limits.maxConcurrent && this.waiting.length === 0)
      return { ready: Promise.resolve(this.takeSlot()) };
    if (this.waiting.length >= limits.maxQueued)
      throw new Error("The subagent waiting queue is full.");
    const ready = new Promise<() => void>((resolve, reject) => {
      const entry: WaitingSlot = {
        grant: () => {
          signal?.removeEventListener("abort", entry.cancel);
          resolve(this.takeSlot());
        },
        cancel: () => {
          const index = this.waiting.indexOf(entry);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          signal?.removeEventListener("abort", entry.cancel);
          reject(new DOMException("Aborted", "AbortError"));
        },
      };
      this.waiting.push(entry);
      signal?.addEventListener("abort", entry.cancel, { once: true });
      this.drain();
    });
    // 接纳保存期间也可能取消，提前挂拒绝处理但保留原Promise的错误结果。https://github.com/ItsDalk-Lane/Scribe/issues/50
    void ready.catch(() => {});
    return { ready };
  }

  private takeSlot(): () => void {
    this.active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      this.drain();
    };
  }

  private drain(): void {
    while (this.waiting.length && this.active < this.getLimits().maxConcurrent)
      this.waiting.shift()!.grant();
  }
}
