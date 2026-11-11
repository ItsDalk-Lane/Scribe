import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { fireEvent, render, screen } from "@testing-library/react";
import { Brain } from "lucide-react";
import React from "react";

describe("AgentActivityCard", () => {
  describe("AgentActivityCard()", () => {
    it("shows its icon and label without exposing a static row as a control", () => {
      const { container } = render(<AgentActivityCard icon={Brain} label="Reasoning" />);

      expect(screen.getByText("Reasoning")).toBeTruthy();
      expect(container.querySelector(".lucide-brain")).not.toBeNull();
      expect(screen.queryByRole("button")).toBeNull();
    });

    it("animates only the running title and stops on completion https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container, rerender } = render(
        <AgentActivityCard icon={Brain} label="Reading notes" isRunning />
      );
      expect(container.querySelector(".scribe-shimmer-text")?.textContent).toBe("Reading notes");
      rerender(<AgentActivityCard icon={Brain} label="Read notes" />);
      expect(container.querySelector(".scribe-shimmer-text")).toBeNull();
    });
    it("puts the moving highlight around the actual text rather than the full flex row, including nested colored labels https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container } = render(
        <AgentActivityCard
          icon={Brain}
          label={<span className="tw-text-normal">Searching files</span>}
          isRunning
        />
      );
      expect(container.querySelector(".scribe-shimmer-text")?.tagName).toBe("SPAN");
      expect(container.querySelector(".scribe-shimmer-text")?.textContent).toBe("Searching files");
    });

    it("toggles on click, Enter, and Space and reveals its details only while open", () => {
      const onToggle = jest.fn();
      const { rerender } = render(
        <AgentActivityCard
          icon={Brain}
          label="Reasoning"
          expandable
          open={false}
          onToggle={onToggle}
        >
          <span>Details</span>
        </AgentActivityCard>
      );

      const closedHeader = screen.getByRole("button", { name: "Reasoning" });
      expect(closedHeader.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("Details")).toBeNull();

      fireEvent.click(closedHeader);
      fireEvent.keyDown(closedHeader, { key: "Enter" });
      fireEvent.keyDown(closedHeader, { key: " " });
      expect(onToggle).toHaveBeenCalledTimes(3);

      rerender(
        <AgentActivityCard icon={Brain} label="Reasoning" expandable open onToggle={onToggle}>
          <span>Details</span>
        </AgentActivityCard>
      );

      const openHeader = screen.getByRole("button", { name: "Reasoning" });
      expect(openHeader.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("Details")).not.toBeNull();
    });
  });
});
