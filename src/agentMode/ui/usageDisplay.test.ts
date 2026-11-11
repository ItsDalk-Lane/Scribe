import {
  formatReportedCount,
  formatCompactTokens,
  formatTokenRate,
  formatFirstTokenTime,
  formatCacheHitPercent,
} from "@/agentMode/ui/usageDisplay";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/52";

describe("usageDisplay", () => {
  describe("formatReportedCount()", () => {
    it(`shows reported counts and distinguishes zero from unknown ${issue}`, () => {
      expect(formatReportedCount(12345)).toBe("12,345");
      expect(formatReportedCount(0)).toBe("0");
      expect(formatReportedCount(undefined)).toBe("Not recorded");
    });
  });
  describe("formatCompactTokens()", () => {
    it(`uses readable token units without inventing unknown usage ${issue}`, () => {
      expect(formatCompactTokens(1300000)).toBe("1.3M");
      expect(formatCompactTokens(12300)).toBe("12.3k");
      expect(formatCompactTokens(28)).toBe("28");
      expect(formatCompactTokens(undefined)).toBe("Not recorded");
    });
  });
  describe("formatTokenRate()", () => {
    it(`formats measured rates and explicitly labels an unavailable rate ${issue}`, () => {
      expect(formatTokenRate(38.25)).toBe("38.3 token/s");
      expect(formatTokenRate(0)).toBe("0.0 token/s");
      expect(formatTokenRate(undefined)).toBe("Speed unavailable");
    });
  });
  describe("formatFirstTokenTime()", () => {
    it(`shows recorded subsecond latency and leaves missing latency unknown ${issue}`, () => {
      expect(formatFirstTokenTime(1580)).toBe("1.6s");
      expect(formatFirstTokenTime(0)).toBe("0.0s");
      expect(formatFirstTokenTime(undefined)).toBe("Not recorded");
    });
  });
  describe("formatCacheHitPercent()", () => {
    it(`formats an actual cache rate without turning missing data into zero ${issue}`, () => {
      expect(formatCacheHitPercent(83.8)).toBe("84%");
      expect(formatCacheHitPercent(0)).toBe("0%");
      expect(formatCacheHitPercent(undefined)).toBe("Not recorded");
    });
  });
});
