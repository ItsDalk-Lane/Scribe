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

    it("stays on the accent color below the warning threshold", () => {
      const usage: SessionUsage = {
        usedTokens: 100_000,
        contextWindow: 200_000,
        updatedAt: 1,
      };
      renderMeter(makeBackend(usage));

      const trigger = screen.getByLabelText("Usage");
      expect(trigger.className).toContain("tw-text-accent");
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
