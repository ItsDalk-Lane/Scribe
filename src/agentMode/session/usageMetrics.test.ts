import { aggregateUsageMetrics } from "@/agentMode/session/usageMetrics";

describe("usageMetrics", () => {
  describe("aggregateUsageMetrics()", () => {
    it("keeps identical model names on different configurations separate and pairs speed with its reported output group https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const call = {
        id: "one",
        roundId: "r",
        sourceId: "main",
        sourceName: "Main",
        kind: "main" as const,
        purpose: "chat" as const,
        modelId: "same",
        modelName: "Same",
        modelSourceId: "configuration-one",
        requestIds: ["one"],
        status: "completed" as const,
        usage: { inputTokens: 100, outputTokens: 50, totalTokens: 150, cacheReadTokens: 40 },
        generationMs: 1000,
        generationOutputTokens: 20,
        usagePartial: true,
      };
      const result = aggregateUsageMetrics([
        call,
        {
          ...call,
          id: "two",
          requestIds: ["two"],
          modelSourceId: "configuration-two",
          generationMs: 2000,
          generationOutputTokens: 10,
        },
      ]);
      expect(result.sources).toHaveLength(2);
      expect(result.sources[0].sourceId).not.toBe(result.sources[1].sourceId);
      expect(result.tokensPerSecond).toBe(10);
      expect(result.outputTokens).toBe(100);
      expect(result.cacheHitPercent).toBeUndefined();
    });
    it("uses full input including cache for the hit ratio and preserves an empty history as unknown https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      expect(aggregateUsageMetrics([])).toEqual({ partial: false, sources: [] });
      expect(
        aggregateUsageMetrics([
          {
            id: "cache",
            roundId: "r",
            sourceId: "main",
            sourceName: "Main",
            kind: "main",
            purpose: "chat",
            modelId: "m",
            modelName: "M",
            requestIds: ["request"],
            status: "completed",
            usage: {
              inputTokens: 100,
              outputTokens: 0,
              totalTokens: 100,
              cacheReadTokens: 40,
              cacheWriteTokens: 20,
            },
          },
        ])
      ).toMatchObject({ cacheHitPercent: 40, totalTokens: 100 });
    });
    it("deduplicates call observations, keeps sources separate and weights speed by the same complete calls https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const base = {
        id: "one",
        roundId: "round",
        promptId: "prompt",
        sourceId: "main",
        sourceName: "Main",
        kind: "main" as const,
        purpose: "chat" as const,
        modelId: "model",
        modelName: "Model",
        requestIds: ["http-1", "http-2"],
        startedAt: 100,
        firstTokenAt: 300,
        generationMs: 1000,
        status: "completed" as const,
        usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, totalTokens: 120 },
      };
      const result = aggregateUsageMetrics([
        base,
        base,
        {
          ...base,
          id: "two",
          sourceId: "child",
          kind: "subagent",
          requestIds: ["http-3"],
          usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60 },
          generationMs: undefined,
        },
      ]);
      expect(result).toMatchObject({
        totalTokens: 180,
        inputTokens: 150,
        outputTokens: 30,
        steps: 3,
        ttftMs: 200,
        tokensPerSecond: 20,
        partial: true,
      });
      expect(result.sources).toHaveLength(2);
      expect(result.cacheHitPercent).toBeUndefined();
    });
  });
});
