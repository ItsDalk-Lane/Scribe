import React from "react";
import { render, screen } from "@testing-library/react";
import type { App } from "obsidian";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import { SubAgentCard } from "@/agentMode/ui/SubAgentCard";

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => <div>{text}</div>,
}));

describe("SubAgentCard", () => {
  describe("SubAgentCard()", () => {
    it("animates the actual subagent action only while executing and restores the original ended title https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const parent: ToolCallPart = {
        kind: "tool_call",
        id: "delegate",
        title: "delegate_task",
        vendorToolName: "delegate_task",
        status: "in_progress",
        input: { subagent_type: "Research", description: "Inspect notes" },
      };
      const props = { parent, childNodes: [], app: {} as App, renderNode: jest.fn() };
      const { container, rerender } = render(<SubAgentCard {...props} />);
      expect(container.querySelector(".scribe-shimmer-text")?.textContent).toBe(
        'Calling subagent · Research · "Inspect notes"'
      );
      rerender(<SubAgentCard {...props} parent={{ ...parent, status: "pending" }} />);
      expect(screen.getByText("Waiting to run · Delegate task")).toBeTruthy();
      expect(container.querySelector(".scribe-shimmer-text")).toBeNull();
      for (const status of ["completed", "failed", "cancelled"] as const) {
        rerender(<SubAgentCard {...props} parent={{ ...parent, status }} />);
        expect(screen.getByText('Research · "Inspect notes"')).toBeTruthy();
        expect(container.querySelector(".scribe-shimmer-text")).toBeNull();
      }
    });
  });
});
