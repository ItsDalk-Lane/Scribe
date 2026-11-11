import { TaskCard } from "@/agentMode/ui/TaskCard";
import { makeCommandTask, makeTask } from "@/agentMode/ui/testing/taskFixtures";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("TaskCard", () => {
  describe("TaskCard()", () => {
    it("describes a running subagent in its title and reserves the duplicate status for screen readers https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      render(<TaskCard task={makeTask()} onOpen={jest.fn()} />);

      expect(
        screen.getByText("Calling subagent · general-purpose · Count words in Welcome")
      ).toBeTruthy();
      expect(screen.getByText("Running").classList.contains("tw-sr-only")).toBe(true);
    });

    it.each([
      ["completed", "Completed"],
      ["failed", "Failed"],
      ["stopped", "Stopped"],
    ] as const)(
      `shows a %s task's final status by its icon, in words only to screen readers, and no result text`,
      (status, label) => {
        render(
          <TaskCard
            task={makeCommandTask({ status, summary: "Background command done" })}
            onOpen={jest.fn()}
          />
        );

        expect(screen.getByText("Print 30 progress lines")).toBeTruthy();
        expect(screen.getByText(label).classList.contains("tw-sr-only")).toBe(true);
        expect(screen.queryByText("Background command done")).toBeNull();
      }
    );

    it("shows the child's step-limit reason beside its title (https://github.com/ItsDalk-Lane/Scribe/issues/31)", () => {
      render(
        <TaskCard
          task={makeTask({ status: "failed", stopReason: "max_turn_requests" })}
          onOpen={jest.fn()}
        />
      );
      expect(screen.getByText("Step limit reached").classList.contains("tw-sr-only")).toBe(false);
    });

    it("animates a running task title but leaves a queued child title still https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { container, rerender } = render(<TaskCard task={makeTask()} onOpen={jest.fn()} />);
      expect(container.querySelector(".scribe-shimmer-text")?.textContent).toContain(
        "Count words in Welcome"
      );
      rerender(<TaskCard task={makeTask({ subagentStatus: "queued" })} onOpen={jest.fn()} />);
      expect(container.querySelector(".scribe-shimmer-text")).toBeNull();
    });
    it("describes a running background command but restores its original title while awaiting approval or after ending https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const { rerender, container } = render(
        <TaskCard task={makeCommandTask()} onOpen={jest.fn()} />
      );
      expect(screen.getByText("Running command · Print 30 progress lines")).toBeTruthy();
      rerender(
        <TaskCard task={makeTask({ subagentStatus: "awaiting_approval" })} onOpen={jest.fn()} />
      );
      expect(screen.getByText("general-purpose · Count words in Welcome")).toBeTruthy();
      expect(screen.getByText("Needs approval")).toBeTruthy();
      expect(container.querySelector(".scribe-shimmer-text")).toBeNull();
    });

    it(`opens the task's view when clicked, whether running or finished`, () => {
      const onOpen = jest.fn();
      render(<TaskCard task={makeTask({ status: "completed" })} onOpen={onOpen} />);

      fireEvent.click(screen.getByRole("button"));

      expect(onOpen).toHaveBeenCalledWith("call-1");
    });
  });
});
