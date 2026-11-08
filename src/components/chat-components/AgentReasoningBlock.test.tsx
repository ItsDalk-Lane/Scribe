import { AgentReasoningBlock } from "@/components/chat-components/AgentReasoningBlock";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentReasoningBlock", () => {
  describe("AgentReasoningBlock()", () => {
    it.each(["reasoning", "complete"] as const)(
      "keeps the duration immediately beside the %s title https://github.com/ItsDalk-Lane/Scribe/issues/52",
      (status) => {
        render(<AgentReasoningBlock status={status} elapsedLabel="4.1s" text="正在检查最新内容" />);
        const title = screen.getByText(status === "reasoning" ? "Thinking" : "Thought for");
        expect(title.nextElementSibling).toBe(screen.getByText("4.1s"));
      }
    );

    it("keeps the brain icon and stops its title animation when thinking completes https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container, rerender } = render(
        <AgentReasoningBlock
          status="reasoning"
          elapsedLabel="3.2s"
          text="Inspecting the current interface"
        />
      );
      expect(container.querySelector(".lucide-brain")).toBeTruthy();
      expect(container.querySelector(".scribe-spinner")).toBeNull();
      expect(screen.getByText("Thinking")).toBeTruthy();
      expect(screen.getByText("3.2s")).toBeTruthy();
      expect(container.querySelector(".scribe-shimmer-text")?.textContent).toContain("Thinking");
      fireEvent.click(screen.getByRole("button"));
      rerender(
        <AgentReasoningBlock
          status="complete"
          elapsedLabel="4.6s"
          text="Inspecting the current interface"
        />
      );
      expect(container.querySelector(".lucide-brain")).toBeTruthy();
      expect(screen.getByText("Thought for")).toBeTruthy();
      expect(screen.getByText("4.6s")).toBeTruthy();
      expect(screen.getByRole("button").getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("Inspecting the current interface")).toBeTruthy();
      expect(container.querySelector(".scribe-shimmer-text")).toBeNull();
    });

    it("renders no thinking card before any thinking is available https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container } = render(<AgentReasoningBlock status="idle" text="" />);
      expect(container.textContent).toBe("");
    });
  });
});
