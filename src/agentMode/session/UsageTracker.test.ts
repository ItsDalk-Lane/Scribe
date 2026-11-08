import type { SessionUsage } from "./types";
import { UsageTracker, type UsageTrackerDeps } from "./UsageTracker";

function makeTracker(overrides: Partial<UsageTrackerDeps> = {}) {
  const notifyMessages = jest.fn();
  const tracker = new UsageTracker({
    getModelId: () => "google/gemini-3-pro",
    notifyMessages,
    ...overrides,
  });
  return { tracker, notifyMessages };
}

const WINDOWED: SessionUsage = { usedTokens: 5000, contextWindow: 200_000, updatedAt: 1 };

describe("UsageTracker", () => {
  describe("UsageTracker", () => {
    describe("getSessionUsage", () => {
      it("starts with no session usage", () => {
        expect(makeTracker().tracker.getSessionUsage()).toBeNull();
      });
    });

    describe("getPlanUsage", () => {
      it("starts with no plan usage", () => {
        expect(makeTracker().tracker.getPlanUsage()).toBeNull();
      });
    });

    describe("applyPlanUsage", () => {
      it("stores the latest plan usage, including a cleared one, and notifies each time", () => {
        const { tracker, notifyMessages } = makeTracker();
        const planUsage = { windows: [{ id: "week", label: "Week", percent: 10 }], updatedAt: 1 };

        tracker.applyPlanUsage(planUsage);
        expect(tracker.getPlanUsage()).toBe(planUsage);

        tracker.applyPlanUsage(null);
        expect(tracker.getPlanUsage()).toBeNull();
        expect(notifyMessages).toHaveBeenCalledTimes(2);
      });
    });

    describe("seedSessionUsage", () => {
      it("restores a count-only snapshot and accepts the next native capacity reading", () => {
        const { tracker, notifyMessages } = makeTracker();
        const saved = { usedTokens: 4200, updatedAt: 1 };
        tracker.seedSessionUsage(saved);
        expect(tracker.getSessionUsage()).toBe(saved);
        tracker.applyUsageUpdate({ usedTokens: 5100, contextWindow: 128000, updatedAt: 2 });
        expect(tracker.getSessionUsage()).toEqual({
          usedTokens: 5100,
          contextWindow: 128000,
          updatedAt: 2,
        });
        expect(notifyMessages).toHaveBeenCalledTimes(2);
      });

      it("stores a persisted snapshot that already has its window and notifies", () => {
        const { tracker, notifyMessages } = makeTracker();

        tracker.seedSessionUsage(WINDOWED);

        expect(tracker.getSessionUsage()).toBe(WINDOWED);
        expect(notifyMessages).toHaveBeenCalledTimes(1);
      });

      it("leaves usage untouched when the seed is undefined", () => {
        const { tracker, notifyMessages } = makeTracker();

        tracker.seedSessionUsage(undefined);

        expect(tracker.getSessionUsage()).toBeNull();
        expect(notifyMessages).not.toHaveBeenCalled();
      });
    });

    describe("applyUsageUpdate", () => {
      it("accepts child cumulative usage without replacing the parent's current context occupancy https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
        const { tracker } = makeTracker();
        tracker.applyUsageUpdate({ ...WINDOWED, cumulativeTotalTokens: 100000 });
        tracker.applyUsageUpdate({
          usedTokens: 0,
          cumulativeTotalTokens: 150000,
          cumulativeInputTokens: 130000,
          cumulativeOutputTokens: 20000,
          updatedAt: 2,
        });
        expect(tracker.getSessionUsage()).toMatchObject({
          usedTokens: 5000,
          contextWindow: 200000,
          cumulativeTotalTokens: 150000,
          cumulativeInputTokens: 130000,
          cumulativeOutputTokens: 20000,
        });
      });
      it("stores a positive reading and notifies", () => {
        const { tracker, notifyMessages } = makeTracker();

        tracker.applyUsageUpdate(WINDOWED);

        expect(tracker.getSessionUsage()).toBe(WINDOWED);
        expect(notifyMessages).toHaveBeenCalledTimes(1);
      });

      it("lets a fuller snapshot's contextWindow replace an earlier one", () => {
        const { tracker } = makeTracker();
        tracker.applyUsageUpdate({ usedTokens: 5000, contextWindow: 200_000, updatedAt: 1 });
        tracker.applyUsageUpdate({ usedTokens: 6000, contextWindow: 1_000_000, updatedAt: 2 });
        expect(tracker.getSessionUsage()?.contextWindow).toBe(1_000_000);
      });

      it("ignores a used-only fallback once an occupancy snapshot exists", () => {
        const { tracker } = makeTracker();
        tracker.applyUsageUpdate({ usedTokens: 5000, contextWindow: 200_000, updatedAt: 1 });
        tracker.applyUsageUpdate({ usedTokens: 6000, updatedAt: 2 });
        expect(tracker.getSessionUsage()).toEqual({
          usedTokens: 5000,
          contextWindow: 200_000,
          updatedAt: 1,
        });
      });

      it("ignores a zero reading", () => {
        const { tracker, notifyMessages } = makeTracker();

        tracker.applyUsageUpdate({ usedTokens: 0, contextWindow: 200_000, updatedAt: 1 });

        expect(tracker.getSessionUsage()).toBeNull();
        expect(notifyMessages).not.toHaveBeenCalled();
      });
    });

    describe("applyCompactedUsage", () => {
      it("reduces current context after compaction while preserving cumulative parent and child consumption https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
        const { tracker } = makeTracker();
        tracker.applyUsageUpdate({
          ...WINDOWED,
          cumulativeTotalTokens: 150000,
          cumulativeInputTokens: 130000,
        });
        tracker.applyCompactedUsage({
          id: "cumulative-compaction",
          status: "completed",
          trigger: "manual",
          postTokens: 1000,
        });
        expect(tracker.getSessionUsage()).toMatchObject({
          usedTokens: 1000,
          cumulativeTotalTokens: 150000,
          cumulativeInputTokens: 130000,
        });
        tracker.applyUsageUpdate({ usedTokens: 1200, contextWindow: 200000, updatedAt: 3 });
        expect(tracker.getSessionUsage()?.cumulativeTotalTokens).toBe(150000);
      });
      it("sets the count to a completed compaction's post-compaction tokens, keeping the window, without notifying", () => {
        const { tracker, notifyMessages } = makeTracker();
        tracker.applyUsageUpdate(WINDOWED);
        notifyMessages.mockClear();

        const metered = tracker.applyCompactedUsage({
          id: "c1",
          status: "completed",
          trigger: "manual",
          postTokens: 4_046,
        });

        expect(metered).toBe(true);
        expect(tracker.getSessionUsage()).toEqual({
          usedTokens: 4_046,
          contextWindow: 200_000,
          updatedAt: expect.any(Number),
        });
        expect(notifyMessages).not.toHaveBeenCalled();
      });

      it.each([
        ["still running", { status: "in_progress" as const }],
        ["skipped", { status: "skipped" as const }],
        ["failed", { status: "failed" as const, error: "boom" }],
        ["completed without a post-compaction count", { status: "completed" as const }],
      ])("leaves the meter alone for a compaction that is %s", (_label, snapshot) => {
        const { tracker } = makeTracker();
        tracker.applyUsageUpdate({ usedTokens: 103_000, contextWindow: 200_000, updatedAt: 1 });

        expect(tracker.applyCompactedUsage({ id: "c1", trigger: "manual", ...snapshot })).toBe(
          false
        );

        expect(tracker.getSessionUsage()).toEqual({
          usedTokens: 103_000,
          contextWindow: 200_000,
          updatedAt: 1,
        });
      });
    });

    describe("dropUsageWindowOnModelChange", () => {
      const stateOn = (baseModelId: string) => ({
        model: {
          current: { baseModelId, effort: null },
          apply: { kind: "setModel" as const },
          availableModels: [],
        },
        mode: null,
      });

      it("accepts the new model's native reading after clearing the previous capacity", () => {
        const { tracker } = makeTracker();
        tracker.applyUsageUpdate(WINDOWED);
        tracker.dropUsageWindowOnModelChange(stateOn("ollama/llama"));
        tracker.applyUsageUpdate({ usedTokens: 6000, contextWindow: 32768, updatedAt: 2 });
        expect(tracker.getSessionUsage()).toEqual({
          usedTokens: 6000,
          contextWindow: 32768,
          updatedAt: 2,
        });
      });

      it("keeps the capacity and count when the model has not changed", () => {
        const { tracker, notifyMessages } = makeTracker();
        tracker.applyUsageUpdate(WINDOWED);
        notifyMessages.mockClear();
        tracker.dropUsageWindowOnModelChange(stateOn("google/gemini-3-pro"));
        expect(tracker.getSessionUsage()).toBe(WINDOWED);
        expect(notifyMessages).not.toHaveBeenCalled();
      });

      it("drops the held window but keeps the count when the model changes", () => {
        const { tracker, notifyMessages } = makeTracker();
        tracker.applyUsageUpdate(WINDOWED);
        notifyMessages.mockClear();

        tracker.dropUsageWindowOnModelChange(stateOn("ollama/llama"));

        expect(tracker.getSessionUsage()).toEqual({ usedTokens: 5000, updatedAt: 1 });
        expect(notifyMessages).toHaveBeenCalledTimes(1);
      });
    });
  });
});
