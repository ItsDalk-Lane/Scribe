export interface ConcurrencyLimits {
  maxConcurrent: number;
  maxQueued: number;
  queueFullMessage?: string;
}

export interface ConcurrencyReservation {
  ready: Promise<() => void>;
}

interface WaitingSlot {
  grant: () => void;
  cancel: () => void;
}

export class ConcurrencyLimiter {
  private active = 0;
  private readonly waiting: WaitingSlot[] = [];

  constructor(private readonly getLimits: () => ConcurrencyLimits) {}

  async acquire(signal?: AbortSignal): Promise<() => void> {
    return this.reserve(signal).ready;
  }

  reserve(signal?: AbortSignal): ConcurrencyReservation {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const limits = this.getLimits();
    if (this.active < limits.maxConcurrent && this.waiting.length === 0)
      return { ready: Promise.resolve(this.takeSlot()) };
    if (this.waiting.length >= limits.maxQueued)
      throw new Error(limits.queueFullMessage ?? "The concurrency waiting queue is full.");
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
    // 排队者开始等待前也可能取消，提前处理拒绝但仍向调用者保留原错误。https://github.com/ItsDalk-Lane/Scribe/issues/70
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
