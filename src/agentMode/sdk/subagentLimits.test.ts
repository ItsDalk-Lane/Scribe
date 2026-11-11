import { SubagentScheduler } from "@/agentMode/sdk/subagentLimits";

describe("subagentLimits", () => {
  describe("SubagentScheduler", () => {
    describe("reserve()", () => {
      it("rejects overflow synchronously before a task can be saved as accepted https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const scheduler = new SubagentScheduler(() => ({
          maxConcurrent: 1,
          maxQueued: 1,
          maxTaskRequests: 100,
        }));
        const first = scheduler.reserve();
        const queued = scheduler.reserve();
        expect(() => scheduler.reserve()).toThrow("queue");
        (await first.ready)();
        (await queued.ready)();
      });
    });

    describe("acquire()", () => {
      it("keeps ten simultaneous requests within three active runs https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const scheduler = new SubagentScheduler(() => ({
          maxConcurrent: 3,
          maxQueued: 20,
          maxTaskRequests: 100,
        }));
        const gates = Array.from({ length: 10 }, () => {
          let start!: () => void;
          let finish!: () => void;
          const started = new Promise<void>((resolve) => {
            start = resolve;
          });
          const completed = new Promise<void>((resolve) => {
            finish = resolve;
          });
          return { start, finish, started, completed };
        });
        let active = 0;
        let maximum = 0;
        const order: number[] = [];
        const work = gates.map(async (gate, index) => {
          const release = await scheduler.acquire();
          active++;
          maximum = Math.max(maximum, active);
          order.push(index);
          gate.start();
          await gate.completed;
          active--;
          release();
        });
        await Promise.all(gates.slice(0, 3).map((gate) => gate.started));
        expect(active).toBe(3);
        for (let index = 0; index < gates.length; index++) {
          gates[index].finish();
          await work[index];
          if (index + 3 < gates.length) await gates[index + 3].started;
        }
        expect(maximum).toBe(3);
        expect(order).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(active).toBe(0);
      });

      it("admits three runs and starts waiting runs in acceptance order https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const scheduler = new SubagentScheduler(() => ({
          maxConcurrent: 3,
          maxQueued: 20,
          maxTaskRequests: 100,
        }));
        const releases = await Promise.all([
          scheduler.acquire(),
          scheduler.acquire(),
          scheduler.acquire(),
        ]);
        const order: number[] = [];
        const fourth = scheduler.acquire().then((release) => {
          order.push(4);
          return release;
        });
        const fifth = scheduler.acquire().then((release) => {
          order.push(5);
          return release;
        });
        releases[0]();
        const releaseFourth = await fourth;
        expect(order).toEqual([4]);
        releaseFourth();
        const releaseFifth = await fifth;
        expect(order).toEqual([4, 5]);
        releaseFifth();
        releases[1]();
        releases[2]();
      });

      it("rejects a full waiting queue without taking a slot https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const scheduler = new SubagentScheduler(() => ({
          maxConcurrent: 1,
          maxQueued: 1,
          maxTaskRequests: 100,
        }));
        const release = await scheduler.acquire();
        const queued = scheduler.acquire();
        await expect(scheduler.acquire()).rejects.toThrow("queue");
        release();
        (await queued)();
      });

      it("removes cancelled waiting work and releases each lease only once https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const scheduler = new SubagentScheduler(() => ({
          maxConcurrent: 1,
          maxQueued: 1,
          maxTaskRequests: 100,
        }));
        const release = await scheduler.acquire();
        const controller = new AbortController();
        const cancelled = scheduler.acquire(controller.signal);
        controller.abort();
        await expect(cancelled).rejects.toMatchObject({ name: "AbortError" });
        const next = scheduler.acquire();
        release();
        release();
        const releaseNext = await next;
        const later = scheduler.acquire();
        await expect(scheduler.acquire()).rejects.toThrow("queue");
        releaseNext();
        (await later)();
        await expect(scheduler.acquire(AbortSignal.abort())).rejects.toMatchObject({
          name: "AbortError",
        });
      });

      it("uses a reduced concurrency limit when granting the next waiting run https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const limits = { maxConcurrent: 2, maxQueued: 20, maxTaskRequests: 100 };
        const scheduler = new SubagentScheduler(() => limits);
        const first = await scheduler.acquire();
        const second = await scheduler.acquire();
        limits.maxConcurrent = 1;
        const third = scheduler.acquire();
        first();
        second();
        (await third)();
      });
    });
  });
});
