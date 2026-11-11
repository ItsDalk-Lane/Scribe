import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { PlanUsage, SessionUsage } from "@/agentMode/session/types";
import AgentContextMeter from "@/agentMode/ui/AgentContextMeter";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";

beforeAll(() => {
  (window as unknown as { activeDocument: Document }).activeDocument = window.document;
});

function makeBackend(
  usage: SessionUsage | null,
  planUsage: PlanUsage | null = null
): AgentChatBackend {
  return {
    getSessionUsage: () => usage,
    getPlanUsage: () => planUsage,
    getBackendState: () => null,
    subscribe: () => () => {},
  } as unknown as AgentChatBackend;
}

function renderMeter(backend: AgentChatBackend) {
  return render(
    <TooltipProvider>
      <AgentContextMeter backend={backend} />
    </TooltipProvider>
  );
}

describe("AgentContextMeter", () => {
  describe("AgentContextMeter()", () => {
    it("shows actual tokens, cache hit, rounds and steps without a cumulative label https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      renderMeter(
        makeBackend({
          usedTokens: 1000,
          contextWindow: 200000,
          updatedAt: 1,
          ...{
            metrics: {
              totalTokens: 16000,
              inputTokens: 14000,
              outputTokens: 2000,
              cacheReadTokens: 10000,
              cacheHitPercent: 71.428,
              rounds: 2,
              steps: 5,
              partial: false,
              sources: [],
            },
          },
        })
      );
      const trigger = screen.getByLabelText("Usage");
      expect(trigger.textContent).toContain("16.0k token");
      expect(trigger.textContent).toContain("Cache hit 71%");
      expect(trigger.textContent).not.toContain("Cumulative usage");
      fireEvent.focus(trigger);
      expect(screen.getAllByText("2 rounds · 5 steps").length).toBeGreaterThan(0);
      expect(screen.getAllByText("1.0k / 200.0k (1%)").length).toBeGreaterThan(0);
    });
    it("shows actual cumulative parent and child consumption separately from the current context https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      renderMeter(
        makeBackend({
          usedTokens: 1000,
          contextWindow: 200000,
          cumulativeTotalTokens: 150000,
          cumulativeInputTokens: 130000,
          cumulativeOutputTokens: 20000,
          updatedAt: 1,
        })
      );
      expect(screen.getByLabelText("Usage").textContent).toContain("150.0k");
      fireEvent.focus(screen.getByLabelText("Usage"));
      expect(screen.getAllByText("1.0k / 200.0k (1%)").length).toBeGreaterThan(0);
      expect(screen.getAllByText("Cumulative input").length).toBeGreaterThan(0);
      expect(screen.getAllByText("130.0k").length).toBeGreaterThan(0);
    });

    it("keeps reported cumulative usage visible when current capacity is unknown and does not invent a missing ledger https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const first = renderMeter(
        makeBackend({ usedTokens: 0, cumulativeTotalTokens: 140000, updatedAt: 1 })
      );
      expect(screen.getByLabelText("Usage").textContent).toContain("140.0k");
      first.unmount();
      renderMeter(makeBackend({ usedTokens: 1000, contextWindow: 200000, updatedAt: 1 }));
      expect(screen.queryByText(/Cumulative usage/)).toBeNull();
    });
    it("renders the % ring plus tooltip numbers when contextWindow is known", () => {
      const usage: SessionUsage = {
        usedTokens: 50_000,
        contextWindow: 200_000,
        inputTokens: 40_000,
        outputTokens: 8_000,
        cacheReadTokens: 1_500,
        cacheWriteTokens: 500,
        updatedAt: 1,
      };
      renderMeter(makeBackend(usage));

      const trigger = screen.getByLabelText("Usage");
      expect(trigger.textContent).not.toContain("25%");

      fireEvent.focus(trigger);

      expect(screen.getAllByText("Context window").length).toBeGreaterThan(0);
      expect(screen.getAllByText("50.0k / 200.0k (25%)").length).toBeGreaterThan(0);
      expect(screen.queryByText(/in ·|out ·| cache/)).toBeNull();
    });

    it("applies the warning color once usage reaches 85%", () => {
      const usage: SessionUsage = {
        usedTokens: 170_000,
        contextWindow: 200_000,
        updatedAt: 1,
      };
      renderMeter(makeBackend(usage));

      const trigger = screen.getByLabelText("Usage");
      expect(trigger.className).toContain("tw-text-warning");
      expect(trigger.className).not.toContain("tw-text-accent");

      fireEvent.focus(trigger);
      expect(screen.getAllByText("170.0k / 200.0k (85%)").length).toBeGreaterThan(0);
    });

    it("uses the quiet label color below the warning threshold https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const usage: SessionUsage = {
        usedTokens: 100_000,
        contextWindow: 200_000,
        updatedAt: 1,
      };
      renderMeter(makeBackend(usage));

      const trigger = screen.getByLabelText("Usage");
      expect(trigger.className).toContain("tw-text-muted");
      expect(trigger.className).not.toContain("tw-text-warning");
    });

    it("falls back to the count-only TokenCounter when there is no contextWindow", () => {
      const usage: SessionUsage = {
        usedTokens: 12_000,
        inputTokens: 10_000,
        updatedAt: 1,
      };
      const { container } = renderMeter(makeBackend(usage));

      expect(screen.queryByLabelText("Context usage")).toBeNull();
      expect(container.textContent).toContain("12k");
    });

    it("renders nothing (no separator) when usage is null", () => {
      const { container } = render(<AgentContextMeter backend={makeBackend(null)} />);
      expect(container.childElementCount).toBe(0);
    });

    it("renders nothing (no separator, no chip) when usedTokens is 0 and there is no contextWindow", () => {
      const usage: SessionUsage = { usedTokens: 0, updatedAt: 1 };
      const { container } = render(<AgentContextMeter backend={makeBackend(usage)} />);
      expect(container.childElementCount).toBe(0);
      expect(screen.queryByLabelText("Context usage")).toBeNull();
    });

    it("keeps the context ring while omitting external account subscription rows", () => {
      renderMeter(
        makeBackend(
          { usedTokens: 50000, contextWindow: 200000, updatedAt: 1 },
          {
            windows: [{ id: "weekly", label: "Weekly account quota", percent: 95 }],
            updatedAt: 1,
          }
        )
      );
      fireEvent.focus(screen.getByLabelText("Usage"));
      expect(screen.queryAllByText("Weekly account quota")).toHaveLength(0);
      expect(screen.getAllByText("50.0k / 200.0k (25%)").length).toBeGreaterThan(0);
    });
  });
});
