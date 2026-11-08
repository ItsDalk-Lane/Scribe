import type { PermissionPrompt } from "@/agentMode/session/types";
import {
  TASK_OUTPUT_POLL_MS,
  TaskOutputReaderContext,
} from "@/agentMode/ui/hooks/useTaskOutputTail";
import {
  RunningTasksIndicator,
  STOP_UNAVAILABLE_UNTIL_STARTED,
} from "@/agentMode/ui/RunningTasksIndicator";
import { makeCommandTask, makeTask, textOutputReader } from "@/agentMode/ui/testing/taskFixtures";
import { TooltipProvider } from "@/components/ui/tooltip";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

const OUTPUT = "/tmp/tasks/task-2.output";

function renderIndicator(
  props: Partial<React.ComponentProps<typeof RunningTasksIndicator>>,
  files: Record<string, string> = {}
) {
  const onOpenTask = jest.fn();
  const createReader = textOutputReader(files);
  const element = (next: Partial<React.ComponentProps<typeof RunningTasksIndicator>>) => (
    <TooltipProvider>
      <TaskOutputReaderContext.Provider value={createReader}>
        <RunningTasksIndicator
          tasks={[makeCommandTask()]}
          permissions={[]}
          onOpenTask={onOpenTask}
          {...next}
        />
      </TaskOutputReaderContext.Provider>
    </TooltipProvider>
  );
  const result = render(element(props));
  return {
    ...result,
    onOpenTask,
    rerenderWith: (next: typeof props) => result.rerender(element(next)),
  };
}

describe("RunningTasksIndicator", () => {
  beforeEach(() => {
    (window as unknown as { activeDocument: Document }).activeDocument = window.document;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it(`hides the whole entry when only subagent tasks exist so subagents stay in the child agent entry`, () => {
    const { container } = renderIndicator({ tasks: [makeTask()] });

    expect(container.textContent).toBe("");
  });

  it(`keeps the task entry after the last task completes`, () => {
    const { rerenderWith, container } = renderIndicator({});

    expect(screen.getByRole("button", { name: "Background tasks (1)" })).toBeTruthy();

    rerenderWith({ tasks: [makeCommandTask({ status: "completed" })] });

    expect(screen.getByRole("button", { name: "Background tasks (1)" })).toBeTruthy();
    expect(container.textContent).not.toBe("");
  });

  it(`keeps its list closed when tasks run again after the last one ended while the list was open`, () => {
    const { rerenderWith } = renderIndicator({ tasks: [makeTask(), makeCommandTask()] });
    fireEvent.pointerEnter(screen.getByRole("button", { name: "Background tasks (1)" }));
    expect(screen.getByText("Print 30 progress lines")).toBeTruthy();

    rerenderWith({ tasks: [] });
    rerenderWith({ tasks: [makeCommandTask({ taskId: "task-3", toolCallId: "call-3" })] });

    expect(screen.getByRole("button", { name: "Background tasks (1)" })).toBeTruthy();
    expect(screen.queryByText("Print 30 progress lines")).toBeNull();
  });

  it(`opens on hover with one row per running command and never lists subagent tasks`, async () => {
    renderIndicator(
      {
        permissions: [],
        tasks: [
          makeTask(),
          makeCommandTask(),
          makeCommandTask({ toolCallId: "call-3", taskId: "task-3" }),
        ],
      },
      { [OUTPUT]: "line 1\n" }
    );

    fireEvent.pointerEnter(screen.getByRole("button", { name: "Background tasks (2)" }));

    expect(screen.queryByText("general-purpose · Count words in Welcome")).toBeNull();
    expect(screen.getAllByText("Print 30 progress lines")).toHaveLength(2);
    expect(
      screen
        .getAllByText("Running")
        .filter((label) => label.tagName !== "H3")
        .map((label) => label.classList.contains("tw-sr-only"))
    ).toEqual([true, true]);
    expect((await screen.findAllByText("line 1")).length).toBe(2);
  });

  it(`shows a command waiting on its permission request as needing approval, in words since it shares the running spinner`, () => {
    const permission: PermissionPrompt = {
      sessionId: "s",
      requester: { taskId: "task-2" },
      toolCall: { toolCallId: "p1", title: "Bash" },
      options: [],
    };
    renderIndicator({ defaultOpen: true, permissions: [permission] });

    expect(screen.getByText("Needs approval").classList.contains("tw-sr-only")).toBe(false);
  });

  it(`follows a command's output file so its row shows the latest line`, async () => {
    jest.useFakeTimers();
    const files = { [OUTPUT]: "line 1\n" };
    renderIndicator({ defaultOpen: true }, files);
    expect(await screen.findByText("line 1")).toBeTruthy();

    files[OUTPUT] += "line 2\n";
    await act(() => jest.advanceTimersByTimeAsync(TASK_OUTPUT_POLL_MS));

    expect(screen.getByText("line 2")).toBeTruthy();
    expect(screen.queryByText("line 1")).toBeNull();
  });

  it("says a command has no output yet before its file has any", () => {
    renderIndicator({ defaultOpen: true, tasks: [makeCommandTask({ outputFile: undefined })] });

    expect(screen.getByText("No output yet")).toBeTruthy();
  });

  it(`moves an ended task into Completed while preserving its row and removing its stop control`, () => {
    const onStopTask = jest.fn();
    const { rerenderWith } = renderIndicator({ defaultOpen: true, onStopTask });

    rerenderWith({ tasks: [makeTask(), makeCommandTask({ status: "completed" })], onStopTask });

    expect(screen.getByRole("button", { name: "Background tasks (1)" })).toBeTruthy();
    expect(
      within(screen.getByRole("list", { name: "Completed" })).getByText("Print 30 progress lines")
    ).toBeTruthy();
    expect(screen.queryByRole("list", { name: "Running" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
  });

  it("groups running and ended commands separately, newest first, and opens completed task details", () => {
    const { onOpenTask } = renderIndicator({
      defaultOpen: true,
      tasks: [
        makeCommandTask(),
        makeCommandTask({ status: "failed" }),
        makeCommandTask({
          toolCallId: "call-3",
          taskId: "task-3",
          description: "New task",
        }),
        makeCommandTask({
          toolCallId: "call-4",
          taskId: "task-4",
          description: "Stopped command",
          status: "stopped",
        }),
      ],
    });
    const running = within(screen.getByRole("list", { name: "Running" }));
    const completed = within(screen.getByRole("list", { name: "Completed" }));

    expect(running.getAllByRole("button").map((button) => button.textContent)).toEqual([
      expect.stringContaining("New task"),
      expect.stringContaining("Print 30 progress lines"),
    ]);
    expect(completed.getAllByRole("button").map((button) => button.textContent)).toEqual([
      expect.stringContaining("Stopped command"),
      expect.stringContaining("Print 30 progress lines"),
    ]);
    fireEvent.click(completed.getByText("Stopped command"));
    expect(onOpenTask).toHaveBeenCalledWith("call-4");
  });

  it(`opens a task's view when its row is clicked`, () => {
    const { onOpenTask } = renderIndicator({
      defaultOpen: true,
      tasks: [makeTask(), makeCommandTask()],
    });

    fireEvent.click(screen.getByText("Print 30 progress lines"));

    expect(onOpenTask).toHaveBeenCalledWith("call-2");
  });

  it(`gives the running command row a stop control that stops that task without opening it`, () => {
    const onStopTask = jest.fn();
    const { onOpenTask } = renderIndicator({
      defaultOpen: true,
      onStopTask,
      tasks: [makeTask(), makeCommandTask()],
    });
    const stops = screen.getAllByRole("button", { name: "Stop task" });

    fireEvent.click(stops[0]);

    expect(stops).toHaveLength(1);
    expect(onStopTask).toHaveBeenCalledTimes(1);
    expect(onStopTask).toHaveBeenCalledWith("task-2");
    expect(onOpenTask).not.toHaveBeenCalled();
  });

  it(`shows a launched task's stop control disabled with the reason until the agent names the task, then enables the same control in place`, async () => {
    const onStopTask = jest.fn();
    const launching = makeCommandTask({ taskId: undefined });
    const { rerenderWith } = renderIndicator({
      defaultOpen: true,
      onStopTask,
      tasks: [launching],
    });
    const stop = screen.getByRole("button", { name: "Stop task" });
    const row = screen.getByText("Print 30 progress lines", { exact: false });

    fireEvent.click(stop);
    fireEvent.focus(stop);

    expect(stop.getAttribute("aria-disabled")).toBe("true");
    expect(onStopTask).not.toHaveBeenCalled();
    expect((await screen.findAllByText(STOP_UNAVAILABLE_UNTIL_STARTED)).length).toBeGreaterThan(0);

    rerenderWith({ defaultOpen: true, onStopTask, tasks: [{ ...launching, taskId: "task-1" }] });
    fireEvent.click(stop);

    expect(screen.getByRole("button", { name: "Stop task" })).toBe(stop);
    expect(screen.getByText("Print 30 progress lines", { exact: false })).toBe(row);
    expect(stop.getAttribute("aria-disabled")).toBeNull();
    expect(onStopTask).toHaveBeenCalledWith("task-1");
  });

  it(`shows no stop control when the agent cannot stop one task`, () => {
    renderIndicator({ defaultOpen: true });

    expect(screen.getByText("Print 30 progress lines")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Stop task" })).toBeNull();
  });
});
