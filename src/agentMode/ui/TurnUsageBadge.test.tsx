import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { TurnUsageBadge } from "@/agentMode/ui/TurnUsageBadge";
import type { UsageMetrics } from "@/agentMode/session/usageMetrics";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/52";
const mockPopoverContent = jest.fn();
jest.mock("@/components/ui/popover", () => {
  const actual =
    jest.requireActual<typeof import("@/components/ui/popover")>("@/components/ui/popover");
  return {
    ...actual,
    PopoverContent: (props: React.ComponentProps<typeof actual.PopoverContent>) => {
      mockPopoverContent(props);
      return <actual.PopoverContent {...props} />;
    },
  };
});
const metrics: UsageMetrics = {
  totalTokens: 16000,
  inputTokens: 14000,
  outputTokens: 2000,
  cacheReadTokens: 10000,
  cacheHitPercent: 10000 / 140,
  ttftMs: 1230,
  tokensPerSecond: 50,
  steps: 3,
  partial: false,
  sources: [
    {
      sourceId: "main:model",
      sourceName: "Main assistant",
      kind: "main",
      modelId: "glm-5.3",
      modelName: "GLM-5.3",
      purpose: "chat",
      totalTokens: 16000,
      inputTokens: 14000,
      outputTokens: 2000,
      cacheReadTokens: 10000,
      cacheHitPercent: 10000 / 140,
      ttftMs: 1230,
      tokensPerSecond: 50,
      steps: 3,
      partial: false,
    },
  ],
};

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = document;
});

describe("TurnUsageBadge", () => {
  describe("TurnUsageBadge()", () => {
    it(`prevents downward flipping and scrolls within Radix's available upper space while retaining width limits ${issue}`, () => {
      render(<TurnUsageBadge metrics={metrics} />);
      fireEvent.click(screen.getByLabelText("This reply's usage"));
      expect(mockPopoverContent).toHaveBeenLastCalledWith(
        expect.objectContaining({ side: "top", avoidCollisions: false })
      );
      const content = screen.getByRole("dialog");
      expect(content.className).toContain(
        "tw-max-h-[min(32rem,75vh,var(--radix-popover-content-available-height))]"
      );
      expect(content.className).toContain("tw-overflow-y-auto");
      expect(content.className).toContain("tw-box-border");
      expect(content.className).toContain("tw-w-[28rem]");
      expect(content.className).toContain("tw-max-w-[calc(100vw-2rem)]");
    });
    it(`opens a measured usage breakdown above the reply without hiding the trigger ${issue}`, () => {
      render(<TurnUsageBadge metrics={metrics} />);
      const trigger = screen.getByLabelText("This reply's usage");
      expect(trigger.textContent).toContain("16.0k token");
      expect(trigger.textContent).toContain("50.0 token/s");
      fireEvent.click(trigger);
      expect(screen.getByRole("dialog")).toBeTruthy();
      expect(screen.getAllByText("GLM-5.3").length).toBeGreaterThan(0);
      expect(screen.getAllByText("16,000").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Cache read tokens").length).toBeGreaterThan(0);
      expect(screen.getAllByText("1.2s").length).toBeGreaterThan(0);
      expect(screen.getByRole("dialog").getAttribute("data-side")).toBe("top");
      expect(screen.getByLabelText("This reply's usage")).toBe(trigger);
    });
    it(`shows missing historical measurements instead of estimated zero rates ${issue}`, () => {
      render(<TurnUsageBadge />);
      expect(screen.getByLabelText("This reply's usage").textContent).toContain(
        "Usage unavailable"
      );
      expect(screen.getByLabelText("This reply's usage").textContent).not.toContain("0.0 token/s");
      fireEvent.click(screen.getByLabelText("This reply's usage"));
      expect(screen.getAllByText("Not recorded").length).toBeGreaterThan(0);
    });
    it(`labels partial statistics without presenting unknown cache as a zero-percent hit ${issue}`, () => {
      render(
        <TurnUsageBadge
          metrics={{ ...metrics, partial: true, cacheHitPercent: undefined, sources: [] }}
        />
      );
      expect(screen.getByLabelText("This reply's usage").textContent).toContain(
        "Partial statistics"
      );
      fireEvent.click(screen.getByLabelText("This reply's usage"));
      expect(screen.queryByText("0%")).toBeNull();
    });
  });
});
