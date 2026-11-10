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
    describe("applyModelCall()", () => {
      const call = {
        id: "call",
        roundId: "round",
        promptId: "prompt",
        sourceId: "child",
        sourceName: "Child",
        kind: "subagent" as const,
        subagentId: "child",
        purpose: "chat" as const,
        modelId: "model",
        modelName: "Model",
        requestIds: ["http"],
        status: "completed" as const,
        usage: { inputTokens: 5, outputTokens: 3, totalTokens: 8, cacheReadTokens: 0 },
      };
      it("accumulates all child rounds once and keeps unchanged reads stable https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        tracker.applyModelCall(call);
        tracker.applyModelCall(call);
        tracker.applyModelCall({
          ...call,
          id: "next",
          roundId: "next-round",
          requestIds: ["next-http"],
        });
        const usage = tracker.getSubagentUsage("child");
        expect(usage?.metrics).toMatchObject({ totalTokens: 16, steps: 2 });
        expect(tracker.getSubagentUsage("child")).toBe(usage);
        expect(tracker.getSubagentUsage("other")).toBeNull();
      });
    });
    describe("markMetricsRoundStarted()", () => {
      it("counts a delivered error reply as one round with no model dispatch and keeps token usage unknown https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        tracker.markMetricsRoundStarted("round", "prompt");
        tracker.markMetricsRoundEnded("round");
        expect(tracker.getSessionUsage()?.metrics).toMatchObject({
          rounds: 1,
          activeRounds: 0,
          steps: 0,
          partial: true,
        });
        const message = {
          id: "assistant:prompt",
          sender: "ai",
          message: "Unlock cancelled",
          timestamp: null,
          isVisible: true,
        };
        expect(tracker.getMetricsForMessage(message)).toMatchObject({
          rounds: 1,
          steps: 0,
          hasActiveWork: false,
        });
        expect(tracker.getMetricsForMessage(message)?.totalTokens).toBeUndefined();
      });
    });
    describe("getMetricsForMessage()", () => {
      it("keeps late child work on its original round, separates model sources and retains a confirmed final segment https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        const base = {
          id: "main",
          roundId: "old",
          promptId: "old-prompt",
          sourceId: "main",
          sourceName: "Main",
          kind: "main" as const,
          purpose: "chat" as const,
          modelId: "one",
          modelName: "One",
          requestIds: ["main"],
          status: "completed" as const,
          usage: { totalTokens: 10 },
          segmentSeq: 1,
        };
        tracker.applyModelCall(base);
        tracker.markMetricsRoundEnded("old");
        tracker.applyModelCall({
          ...base,
          id: "new",
          roundId: "new",
          promptId: "new-prompt",
          segmentSeq: 2,
          requestIds: ["new"],
        });
        tracker.applyModelCall({
          ...base,
          id: "late",
          sourceId: "child",
          subagentId: "child",
          kind: "subagent",
          modelId: "two",
          requestIds: ["child"],
          segmentSeq: 3,
        });
        tracker.markFinalSegment(1);
        const message = {
          id: "assistant:old-prompt",
          sender: "ai",
          message: "Answer",
          timestamp: null,
          isVisible: true,
          parts: [{ kind: "text" as const, text: "Answer", segmentSeq: 1 }],
        };
        expect(tracker.getMetricsForMessage(message)).toMatchObject({
          roundId: "old",
          totalTokens: 20,
          steps: 2,
          rounds: 1,
          activeRounds: 0,
          finalResponseSegmentSeq: 1,
        });
        expect(tracker.getMetricsForMessage(message)?.sources).toHaveLength(2);
        expect(
          tracker.getMetricsForMessage({ ...message, id: "assistant:new-prompt", parts: [] })
        ).toMatchObject({ roundId: "new", totalTokens: 10 });
        expect(
          tracker.getMetricsForMessage({ ...message, id: "unknown", parts: [] })
        ).toBeUndefined();
      });
    });
    describe("markChildRoundEnded()", () => {
      it("uses the child lifecycle's own timestamps and reason rather than a successful parent turn https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        tracker.applyModelCall({
          id: "c",
          roundId: "r",
          subagentId: "child",
          runId: "run",
          sourceId: "child",
          sourceName: "Child",
          kind: "subagent",
          purpose: "chat",
          modelId: "m",
          modelName: "M",
          requestIds: ["req"],
          status: "completed",
          usage: { totalTokens: 7 },
          segmentSeq: 10,
        });
        tracker.markMetricsRoundStarted("r", "p", {
          subagentId: "child",
          runId: "run",
          startedAt: 1000,
        });
        tracker.markMetricsRoundEnded("r");
        const message = {
          id: "slice",
          sender: "ai",
          message: "Answer",
          isVisible: true,
          timestamp: null,
          parts: [{ kind: "text" as const, text: "Answer", segmentSeq: 10 }],
        };
        expect(tracker.getMetricsForMessage(message, true)?.roundStopReason).toBeUndefined();
        expect(tracker.getMetricsForMessage(message, true)).toMatchObject({
          roundStartedAtMs: 1000,
        });
        tracker.markChildRoundEnded("child", "r", 5000, "cancelled");
        expect(tracker.getMetricsForMessage(message, true)).toMatchObject({
          roundStartedAtMs: 1000,
          roundDurationMs: 4000,
          roundStopReason: "cancelled",
        });
      });
    });
    describe("applyChildRun()", () => {
      it("restores initial child timing from its own snapshot and keeps a split initial round bounded by the next delivered input https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        const base = {
          id: "first",
          roundId: "one",
          subagentId: "child",
          runId: "run",
          sourceId: "child",
          sourceName: "Child",
          kind: "subagent" as const,
          purpose: "chat" as const,
          modelId: "m",
          modelName: "M",
          requestIds: ["one"],
          status: "completed" as const,
          usage: { totalTokens: 7 },
          segmentSeq: 10,
        };
        tracker.applyModelCall(base);
        tracker.markFinalSegment(10);
        tracker.markMetricsRoundStarted("two", "second-input", {
          subagentId: "child",
          runId: "run",
          startedAt: 4000,
        });
        tracker.applyModelCall({
          ...base,
          id: "second",
          roundId: "two",
          segmentSeq: 20,
          requestIds: ["two"],
        });
        tracker.markChildRoundEnded("child", "two", 9000, "end_turn");
        tracker.applyChildRun("child", {
          id: "run",
          roundId: "one",
          taskGenerationId: "g",
          toolCallId: "tool",
          createdAt: 1000,
          startedAt: 1000,
          endedAt: 9000,
          status: "completed",
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        });
        const message = {
          id: "slice",
          sender: "ai",
          message: "Answer",
          isVisible: true,
          timestamp: null,
          parts: [{ kind: "text" as const, text: "Answer", segmentSeq: 10 }],
        };
        expect(tracker.getMetricsForMessage(message, true)).toMatchObject({
          roundStartedAtMs: 1000,
          roundDurationMs: 3000,
          roundStopReason: "end_turn",
        });
        expect(
          tracker.getMetricsForMessage(
            { ...message, parts: [{ kind: "text", text: "Second", segmentSeq: 20 }] },
            true
          )
        ).toMatchObject({
          roundStartedAtMs: 4000,
          roundDurationMs: 5000,
          roundStopReason: "end_turn",
        });
        tracker.markMetricsRoundStarted("two", "second-input", {
          subagentId: "child",
          runId: "run",
          startedAt: 4000,
        });
        expect(tracker.getMetricsForMessage(message, true)?.roundDurationMs).toBe(3000);
      });
      it("does not turn a failed or still running child into a normal completion because its parent finished https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        tracker.applyModelCall({
          id: "c",
          roundId: "r",
          subagentId: "child",
          runId: "run",
          sourceId: "child",
          sourceName: "Child",
          kind: "subagent",
          purpose: "chat",
          modelId: "m",
          modelName: "M",
          requestIds: ["req"],
          status: "completed",
          usage: {},
          segmentSeq: 10,
        });
        const run = {
          id: "run",
          roundId: "r",
          taskGenerationId: "g",
          toolCallId: "tool",
          createdAt: 1000,
          startedAt: 1000,
          status: "running" as const,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        };
        tracker.applyChildRun("child", run);
        tracker.markMetricsRoundEnded("r");
        const message = {
          id: "slice",
          sender: "ai",
          message: "Answer",
          isVisible: true,
          timestamp: null,
          parts: [{ kind: "text" as const, text: "Answer", segmentSeq: 10 }],
        };
        expect(tracker.getMetricsForMessage(message, true)?.roundStopReason).toBeUndefined();
        tracker.applyChildRun("child", {
          ...run,
          status: "failed",
          endedAt: 2000,
          stopReason: "end_turn",
        });
        expect(tracker.getMetricsForMessage(message, true)).toMatchObject({
          roundStopReason: "request_error",
          roundDurationMs: 1000,
        });
      });
    });
    describe("recordToolExecution()", () => {
      it("counts admitted tools once per source and only ends the matching child round https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        const call = {
          id: "child-call",
          roundId: "r",
          promptId: "p",
          sourceId: "child",
          subagentId: "child",
          sourceName: "Child",
          kind: "subagent" as const,
          purpose: "chat" as const,
          modelId: "m",
          modelName: "M",
          requestIds: ["req"],
          status: "completed" as const,
          usage: { totalTokens: 5 },
          segmentSeq: 8,
        };
        tracker.applyModelCall(call);
        tracker.recordToolExecution("r", "child", "tool");
        tracker.recordToolExecution("r", "child", "tool");
        tracker.recordToolExecution("r", "main", "main-tool");
        tracker.markChildRoundEnded("child", "r");
        expect(tracker.getSubagentUsage("child")?.metrics).toMatchObject({
          toolCallCount: 1,
          rounds: 1,
          activeRounds: 0,
        });
        expect(tracker.getSessionUsage()?.metrics).toMatchObject({
          toolCallCount: 2,
          rounds: 0,
          activeRounds: 1,
        });
        const message = {
          id: "child-bubble",
          sender: "ai",
          message: "Child",
          timestamp: null,
          isVisible: true,
          parts: [{ kind: "text" as const, text: "Child", segmentSeq: 8 }],
        };
        expect(tracker.getMetricsForMessage(message, true)).toMatchObject({
          toolCallCount: 1,
          activeRounds: 0,
        });
      });
    });
    describe("completeReplay()", () => {
      it("closes a persisted delivered round with no model calls after unlock interruption without claiming normal completion https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        tracker.markMetricsRoundStarted("unlock", "prompt");
        tracker.completeReplay();
        expect(tracker.getSessionUsage()?.metrics).toMatchObject({
          rounds: 1,
          activeRounds: 0,
          hasActiveWork: false,
        });
        const message = {
          id: "assistant:prompt",
          sender: "ai",
          message: "Interrupted",
          isVisible: true,
          timestamp: null,
        };
        expect(tracker.getMetricsForMessage(message)?.roundStopReason).toBeUndefined();
        expect(tracker.getMetricsForMessage(message)?.roundDurationMs).toBeUndefined();
      });
      it("keeps an interrupted pre-dispatch record unknown instead of proving zero actual requests https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        tracker.applyModelCall({
          id: "prepared",
          roundId: "r",
          sourceId: "main",
          sourceName: "Main",
          kind: "main",
          purpose: "chat",
          modelId: "m",
          modelName: "M",
          requestIds: [],
          status: "running",
          usage: {},
        });
        tracker.completeReplay();
        expect(tracker.getSessionUsage()?.metrics?.steps).toBeUndefined();
      });
      it("keeps interrupted request counts without leaving reopened work running or fabricating token usage https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        tracker.applyModelCall({
          id: "incomplete",
          roundId: "r",
          sourceId: "main",
          sourceName: "Main",
          kind: "main",
          purpose: "chat",
          modelId: "m",
          modelName: "M",
          requestIds: ["req"],
          status: "running",
          usage: {},
        });
        tracker.completeReplay();
        expect(tracker.getSessionUsage()?.metrics).toMatchObject({
          steps: 1,
          hasActiveWork: false,
          activeRounds: 0,
          partial: true,
        });
        expect(tracker.getSessionUsage()?.metrics?.totalTokens).toBeUndefined();
      });
    });
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
      it("preserves a confirmed old chat total without distributing it into newly observed rounds https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { tracker } = makeTracker();
        tracker.seedSessionUsage({ usedTokens: 100, updatedAt: 1, cumulativeTotalTokens: 1000 });
        tracker.applyModelCall({
          id: "new",
          roundId: "r",
          promptId: "p",
          sourceId: "main",
          sourceName: "Main",
          kind: "main",
          purpose: "chat",
          modelId: "m",
          modelName: "M",
          requestIds: ["req"],
          status: "completed",
          usage: { totalTokens: 10 },
        });
        expect(tracker.getSessionUsage()?.metrics).toMatchObject({
          totalTokens: 1000,
          partial: true,
        });
        expect(
          tracker.getMetricsForMessage({
            id: "assistant:p",
            sender: "ai",
            message: "Answer",
            timestamp: null,
            isVisible: true,
          })?.totalTokens
        ).toBe(10);
      });
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
      it("updates only the compacted child's context and retains its consumption when later replies update occupancy https://github.com/ItsDalk-Lane/Scribe/issues/66", () => {
        const { tracker } = makeTracker();
        tracker.applyUsageUpdate(WINDOWED);
        const main = tracker.getSessionUsage();
        tracker.applyCompactedUsage({
          id: "child-compact",
          status: "completed",
          trigger: "manual",
          subagentId: "child",
          runId: "run",
          postTokens: 1200,
          contextWindow: 32000,
        });
        expect(tracker.getSessionUsage()).toBe(main);
        expect(tracker.getSubagentUsage("child")).toMatchObject({
          usedTokens: 1200,
          contextWindow: 32000,
        });
        expect(tracker.getSubagentUsage("sibling")).toBeNull();

        tracker.applyModelCall({
          id: "summary-call",
          roundId: "round",
          sourceId: "child",
          sourceName: "Child",
          subagentId: "child",
          kind: "subagent",
          purpose: "compaction",
          modelId: "model",
          modelName: "Model",
          requestIds: ["summary-http"],
          status: "completed",
          usage: { inputTokens: 7000, outputTokens: 1000, totalTokens: 8000 },
        });
        expect(tracker.getSubagentUsage("child")).toMatchObject({
          usedTokens: 1200,
          contextWindow: 32000,
          metrics: { totalTokens: 8000, steps: 1 },
        });
        expect(tracker.getSessionUsage()?.usedTokens).toBe(WINDOWED.usedTokens);
        tracker.applyUsageUpdate({ usedTokens: 1800, contextWindow: 32000, updatedAt: 2 }, "child");
        expect(tracker.getSubagentUsage("child")).toMatchObject({
          usedTokens: 1800,
          contextWindow: 32000,
          metrics: { totalTokens: 8000, steps: 1 },
        });
        expect(tracker.getSessionUsage()?.usedTokens).toBe(WINDOWED.usedTokens);
      });

      it("uses the compacting model's window before any normal reply reports usage https://github.com/ItsDalk-Lane/Scribe/issues/66", () => {
        const { tracker } = makeTracker();
        tracker.applyCompactedUsage({
          id: "first-compact",
          status: "completed",
          trigger: "manual",
          postTokens: 1000,
          contextWindow: 64000,
        });
        expect(tracker.getSessionUsage()).toMatchObject({
          usedTokens: 1000,
          contextWindow: 64000,
        });
      });

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
