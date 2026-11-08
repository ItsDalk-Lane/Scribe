import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { App } from "obsidian";
import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { TooltipProvider } from "@/components/ui/tooltip";

describe("AgentMessageActions", () => {
  describe("AgentMessageActions()", () => {
    it("keeps usage beside the original timestamp and preserves fork actions https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const fork = jest.fn();
      render(
        <TooltipProvider>
          <AgentMessageActions
            app={new App()}
            text="Final answer"
            timestamp="2026/11/08 12:00"
            onFork={fork}
            metrics={{ totalTokens: 1000, tokensPerSecond: 25, partial: false, sources: [] }}
          />
        </TooltipProvider>
      );
      const badge = screen.getByLabelText("This reply's usage");
      expect(badge.textContent).toContain("1.0k token");
      expect(badge.parentElement?.textContent).toContain("2026/11/08 12:00");
      fireEvent.click(screen.getByTitle("Fork conversation"));
      expect(fork).toHaveBeenCalledTimes(1);
      expect(screen.getByTitle("Copy")).toBeTruthy();
    });
  });
});
