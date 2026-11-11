import { TimeoutError } from "@/error";
import { abortSignalWithDeadline } from "@/utils/abortDeadline";

describe("abortDeadline", () => {
  describe("abortSignalWithDeadline()", () => {
    it("aborts with a TimeoutError reason when the deadline elapses", async () => {
      jest.useFakeTimers();
      try {
        const deadline = abortSignalWithDeadline(undefined, 5000);
        const reason = new Promise<unknown>((resolve) =>
          deadline.signal.addEventListener("abort", () => resolve(deadline.signal.reason))
        );
        jest.advanceTimersByTime(5000);
        await expect(reason).resolves.toBeInstanceOf(TimeoutError);
        deadline.dispose();
      } finally {
        jest.useRealTimers();
      }
    });

    it("forwards an external cancellation immediately with its reason", async () => {
      const external = new AbortController();
      const deadline = abortSignalWithDeadline(external.signal, 60000);
      const reason = new Promise<unknown>((resolve) =>
        deadline.signal.addEventListener("abort", () => resolve(deadline.signal.reason))
      );
      const cancelled = new DOMException("Stopped", "AbortError");
      external.abort(cancelled);
      await expect(reason).resolves.toBe(cancelled);
      deadline.dispose();
    });

    it("does not abort after disposal and stops listening to the external signal", () => {
      jest.useFakeTimers();
      try {
        const external = new AbortController();
        const deadline = abortSignalWithDeadline(external.signal, 1000);
        deadline.dispose();
        jest.advanceTimersByTime(5000);
        expect(deadline.signal.aborted).toBe(false);
        external.abort();
        expect(deadline.signal.aborted).toBe(false);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
