import React from "react";
import { render, screen } from "@testing-library/react";
import { UsageMetricsDetails } from "@/agentMode/ui/UsageMetricsDetails";
import type { UsageMetrics } from "@/agentMode/session/usageMetrics";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/52";
describe("UsageMetricsDetails", () => {
  describe("UsageMetricsDetails()", () => {
    it(`shows only combined main and child totals with model and provider identities but no agent groups or explanatory notes ${issue}`, () => {
      const metrics: UsageMetrics = {
        totalTokens: 1000,
        inputTokens: 800,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheHitPercent: 0,
        ttftMs: 1250,
        tokensPerSecond: 40,
        steps: 3,
        rounds: 2,
        activeRounds: 1,
        partial: false,
        sources: [
          {
            sourceId: "main",
            sourceName: "Main assistant",
            kind: "main",
            modelId: "glm",
            modelName: "GLM",
            provider: "Zhipu",
            purpose: "chat",
            inputTokens: 500,
            outputTokens: 100,
            cacheReadTokens: 0,
            cacheHitPercent: 0,
            steps: 2,
            partial: false,
          },
          {
            sourceId: "child",
            sourceName: "Researcher",
            kind: "subagent",
            modelId: "deepseek",
            modelName: "DeepSeek",
            provider: "DeepSeek API",
            purpose: "compaction",
            inputTokens: 300,
            outputTokens: 100,
            cacheReadTokens: 0,
            steps: 1,
            partial: false,
          },
        ],
      };
      const original = JSON.stringify(metrics);
      render(<UsageMetricsDetails metrics={metrics} showRounds />);
      expect(screen.getByText("1,000")).toBeTruthy();
      expect(screen.getByText("40.0 token/s")).toBeTruthy();
      expect(screen.getByText("1.3s")).toBeTruthy();
      expect(screen.getByText("0%")).toBeTruthy();
      expect(screen.getByText(/2 rounds · 3 steps/).textContent).toContain("1 in progress");
      expect(screen.getByText("GLM · DeepSeek")).toBeTruthy();
      expect(screen.getByText("Zhipu · DeepSeek API")).toBeTruthy();
      expect(
        screen.queryByText(/Main agent|Main assistant|Researcher|Context compaction/)
      ).toBeNull();
      expect(screen.getAllByText("Input tokens")).toHaveLength(1);
      expect(screen.getByText("800")).toBeTruthy();
      expect(screen.queryByText("500")).toBeNull();
      expect(screen.queryByText("300")).toBeNull();
      expect(screen.queryByText(/Thinking time sums/)).toBeNull();
      expect(screen.queryByText(/Speed includes reasoning/)).toBeNull();
      expect(JSON.stringify(metrics)).toBe(original);
    });
    it(`does not invent unavailable historical counts or rates ${issue}`, () => {
      render(<UsageMetricsDetails metrics={{ partial: true, sources: [] }} />);
      expect(screen.getByText("Partial statistics")).toBeTruthy();
      expect(screen.getByText("Model not recorded")).toBeTruthy();
      expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
      expect(screen.getByText("Speed unavailable")).toBeTruthy();
      expect(screen.queryByText("0%")).toBeNull();
    });
  });
});
