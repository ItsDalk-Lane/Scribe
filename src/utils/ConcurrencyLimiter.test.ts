import { ConcurrencyLimiter } from "@/utils/ConcurrencyLimiter";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/70";

describe("ConcurrencyLimiter", () => {
  describe("ConcurrencyLimiter", () => {
    describe("reserve()", () => {
      it(`admits one active lease and rejects overflow before another job is accepted ${issue}`, async () => {
        const limiter = new ConcurrencyLimiter(() => ({
          maxConcurrent: 1,
          maxQueued: 1,
          queueFullMessage: "Tool queue full",
        }));
        const active = limiter.reserve();
        const queued = limiter.reserve();
        expect(() => limiter.reserve()).toThrow("Tool queue full");
        (await active.ready)();
        (await queued.ready)();
      });
      it(`rejects an already cancelled reservation without taking capacity ${issue}`, async () => {
        const limiter = new ConcurrencyLimiter(() => ({ maxConcurrent: 1, maxQueued: 0 }));
        expect(() => limiter.reserve(AbortSignal.abort())).toThrow("Aborted");
        const active = limiter.reserve();
        expect(() => limiter.reserve()).toThrow("queue");
        (await active.ready)();
      });
    });
    describe("acquire()", () => {
      it(`grants waiting leases in FIFO order and ignores duplicate releases ${issue}`, async () => {
        const limiter = new ConcurrencyLimiter(() => ({ maxConcurrent: 1, maxQueued: 2 }));
        const releaseFirst = await limiter.acquire();
        const order: string[] = [];
        const second = limiter.acquire().then((release) => {
          order.push("second");
          return release;
        });
        const third = limiter.acquire().then((release) => {
          order.push("third");
          return release;
        });
        releaseFirst();
        const releaseSecond = await second;
        releaseFirst();
        expect(order).toEqual(["second"]);
        releaseSecond();
        const releaseThird = await third;
        expect(order).toEqual(["second", "third"]);
        releaseThird();
      });
      it(`removes cancelled queued work and applies reduced limits to subsequent grants ${issue}`, async () => {
        const limits = { maxConcurrent: 2, maxQueued: 1 };
        const limiter = new ConcurrencyLimiter(() => limits);
        const first = await limiter.acquire();
        const second = await limiter.acquire();
        const abort = new AbortController();
        const cancelled = limiter.acquire(abort.signal);
        abort.abort();
        await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
        limits.maxConcurrent = 1;
        const next = limiter.acquire();
        first();
        await expect(limiter.acquire()).rejects.toThrow("queue");
        second();
        (await next)();
      });
    });
  });
});
