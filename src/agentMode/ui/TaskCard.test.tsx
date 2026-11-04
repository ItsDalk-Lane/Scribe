import { TaskCard } from "@/agentMode/ui/TaskCard";
import { makeCommandTask, makeTask } from "@/agentMode/ui/testing/taskFixtures";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("TaskCard", () => {
  it(`shows a subagent's type and title, and that it is running only to screen readers beside the spinner`, () => {
    render(<TaskCard task={makeTask()} onOpen={jest.fn()} />);

    expect(screen.getByText("general-purpose · Count words in Welcome")).toBeTruthy();
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

  it(`opens the task's view when clicked, whether running or finished`, () => {
    const onOpen = jest.fn();
    render(<TaskCard task={makeTask({ status: "completed" })} onOpen={onOpen} />);

    fireEvent.click(screen.getByRole("button"));

    expect(onOpen).toHaveBeenCalledWith("call-1");
  });
});
