import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";
import { render, screen } from "@testing-library/react";
import React from "react";

describe("AgentReasoningBlock", () => {
  describe("AgentReasoningBlock()", () => {
    it("keeps the brain icon when reasoning changes from active to complete", () => {
      const { container, rerender } = render(
        <AgentReasoningBlock
          status="reasoning"
          elapsedSeconds={3}
          steps={["Inspecting the current interface"]}
        />
      );

      expect(container.querySelector(".lucide-brain")).toBeTruthy();
      expect(container.querySelector(".scribe-spinner")).toBeNull();
      expect(container.textContent).toContain("Reasoning...");
      expect(screen.queryByText("3s")).toBeNull();
      expect(container.querySelector(".scribe-shimmer-text")?.textContent).toBe("...");

      rerender(
        <AgentReasoningBlock
          status="complete"
          elapsedSeconds={4}
          steps={["Inspecting the current interface"]}
        />
      );

      expect(container.querySelector(".lucide-brain")).toBeTruthy();
      expect(container.querySelector(".scribe-spinner")).toBeNull();
      expect(screen.getByText("Thought for")).toBeTruthy();
      expect(screen.getByText("4s")).toBeTruthy();
      expect(container.querySelector(".scribe-shimmer-text")).toBeNull();
    });
  });
});
