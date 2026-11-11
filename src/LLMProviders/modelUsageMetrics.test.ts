import { reportedTokenUsage } from "@/LLMProviders/modelUsageMetrics";

describe("modelUsageMetrics", () => {
  describe("reportedTokenUsage()", () => {
    it("keeps unreported usage unknown and preserves explicitly reported zero cache hits https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      expect(reportedTokenUsage({ choices: [] })).toEqual({});
      expect(
        reportedTokenUsage({
          usage: {
            prompt_tokens: 10,
            completion_tokens: 4,
            total_tokens: 14,
            prompt_tokens_details: { cached_tokens: 0 },
          },
        })
      ).toEqual({ inputTokens: 10, outputTokens: 4, totalTokens: 14, cacheReadTokens: 0 });
    });
    it("reads the actual nested Cohere and SAP usage envelopes without inventing cache reports https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      expect(
        reportedTokenUsage({ delta: { usage: { tokens: { input_tokens: 20, output_tokens: 8 } } } })
      ).toEqual({ inputTokens: 20, outputTokens: 8, totalTokens: 28 });
      expect(
        reportedTokenUsage({
          final_result: { usage: { prompt_tokens: 11, completion_tokens: 6, total_tokens: 17 } },
        })
      ).toEqual({ inputTokens: 11, outputTokens: 6, totalTokens: 17 });
    });
    it("includes reasoning in Google output once and includes cache reads in Anthropic input https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      expect(
        reportedTokenUsage({
          usageMetadata: {
            promptTokenCount: 10,
            candidatesTokenCount: 3,
            thoughtsTokenCount: 7,
            totalTokenCount: 20,
          },
        })
      ).toMatchObject({ inputTokens: 10, outputTokens: 10, totalTokens: 20 });
      expect(
        reportedTokenUsage({
          message: {
            usage: {
              input_tokens: 10,
              output_tokens: 4,
              cache_read_input_tokens: 20,
              cache_creation_input_tokens: 0,
            },
          },
        })
      ).toMatchObject({ inputTokens: 30, outputTokens: 4, cacheReadTokens: 20, totalTokens: 34 });
    });
  });
});
