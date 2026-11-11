import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import {
  SubagentSessionsButton,
  SubagentSessionsPanel,
  TaskBudgetContinuation,
} from "@/agentMode/ui/SubagentSessionsPanel";
import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";

const completedChild: SubagentSessionSnapshot = {
  id: "child-1",
  parentSessionId: "parent-1",
  modelId: "model-1",
  name: "资料整理",
  cwd: "/vault",
  retention: "retained",
  createdAt: 1,
  updatedAt: 2,
  runs: [
    {
      id: "run-1",
      toolCallId: "tool-1",
      taskGenerationId: "g-1",
      status: "completed",
      createdAt: 1,
      result: "整理了三份资料",
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3 },
    },
  ],
  messages: [],
};

const runningChild: SubagentSessionSnapshot = {
  ...completedChild,
  id: "child-2",
  name: "资料核对",
  updatedAt: 3,
  runs: [
    {
      id: "run-2",
      toolCallId: "tool-2",
      taskGenerationId: "g-1",
      status: "running",
      createdAt: 2,
      usage: { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 3 },
    },
  ],
};

function fixture(sessions: readonly SubagentSessionSnapshot[] = [completedChild]) {
  const onOpen = jest.fn();
  const onRefresh = jest.fn(async () => undefined);
  const utils = render(
    <SubagentSessionsPanel sessions={sessions} onOpen={onOpen} onRefresh={onRefresh} />
  );
  return { ...utils, onOpen, onRefresh };
}

describe("SubagentSessionsPanel", () => {
  describe("SubagentSessionsPanel()", () => {
    it("groups executing children under Running and finished ones under Completed", () => {
      fixture([completedChild, runningChild]);
      const running = screen.getByRole("region", { name: "Running" });
      const completed = screen.getByRole("region", { name: "Completed" });
      expect(within(running).getByText("资料核对")).toBeTruthy();
      expect(within(completed).getByText("资料整理")).toBeTruthy();
    });

    it("shows the latest run status, archived and recovery markers on each row", () => {
      fixture([
        {
          ...completedChild,
          retention: "archived",
          recoveryBlocked: "原先使用的模型已移除。",
          runs: [{ ...completedChild.runs[0], status: "interrupted" }],
        },
      ]);
      const row = screen.getByText("资料整理").closest("button")!;
      expect(row.textContent).toContain("Interrupted");
      expect(row.textContent).toContain("Archived");
      expect(row.textContent).toContain("Recovery blocked");
    });

    it("opens the clicked child and orders both groups by latest activity", () => {
      const { onOpen } = fixture([
        { ...completedChild, id: "old", name: "较早完成", updatedAt: 1 },
        { ...completedChild, id: "new", name: "较晚完成", updatedAt: 9 },
      ]);
      const completed = screen.getByRole("region", { name: "Completed" });
      const rows = within(completed).getAllByRole("button");
      expect(rows[0].textContent).toContain("较晚完成");
      fireEvent.click(rows[1]);
      expect(onOpen).toHaveBeenCalledWith("old");
    });

    it("shows an empty hint without group sections when no child exists", () => {
      fixture([]);
      expect(screen.getByText("No child sessions yet.")).toBeTruthy();
      expect(screen.queryByRole("region", { name: "Running" })).toBeNull();
      expect(screen.queryByRole("region", { name: "Completed" })).toBeNull();
    });

    it("surfaces a failed refresh as an alert without clearing the list", async () => {
      const onRefresh = jest.fn(async () => {
        throw new Error("刷新失败");
      });
      render(
        <SubagentSessionsPanel
          sessions={[completedChild]}
          onOpen={jest.fn()}
          onRefresh={onRefresh}
        />
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Refresh child sessions" }));
      });
      expect(screen.getByRole("alert").textContent).toBe("刷新失败");
      expect(screen.getByText("资料整理")).toBeTruthy();
    });
  });

  describe("SubagentSessionsButton()", () => {
    it("opens the grouped panel from the trigger and closes it after picking a child", async () => {
      const onOpen = jest.fn();
      const onRefresh = jest.fn(async () => undefined);
      render(
        <SubagentSessionsButton
          sessions={[completedChild, runningChild]}
          onOpen={onOpen}
          onRefresh={onRefresh}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: /Subagents \(2\)/ }));
      const row = await screen.findByText("资料整理");
      fireEvent.click(row.closest("button")!);
      expect(onOpen).toHaveBeenCalledWith("child-1");
      expect(screen.queryByText("资料核对")).toBeNull();
    });
  });

  describe("TaskBudgetContinuation()", () => {
    it("accepts one explicit allowance increase while saving and waits for reliable acceptance https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
      let complete!: () => void;
      const saved = new Promise<void>((resolve) => {
        complete = resolve;
      });
      const onContinue = jest.fn(() => saved);
      render(<TaskBudgetContinuation onContinue={onContinue} />);
      const button = screen.getByRole("button", { name: "Add model requests for this task" });
      fireEvent.click(button);
      fireEvent.click(button);
      expect(onContinue).toHaveBeenCalledTimes(1);
      expect(button).toHaveProperty("disabled", true);
      expect(screen.queryByRole("status")).toBeNull();
      await act(async () => {
        complete();
        await saved;
      });
      expect(screen.getByRole("status").textContent).toContain("Request allowance added");
    });

    it("retains the request identity after a failed allowance update and never starts the task https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
      const onContinue = jest
        .fn<Promise<void>, [string]>(async () => undefined)
        .mockRejectedValueOnce(new Error("保存失败"));
      render(<TaskBudgetContinuation onContinue={onContinue} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Add model requests for this task" }));
      });
      expect(screen.getByRole("alert").textContent).toBe("保存失败");
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Add model requests for this task" }));
      });
      expect(onContinue.mock.calls[0][0]).toBe(onContinue.mock.calls[1][0]);
      expect(screen.getByRole("status").textContent).toContain("Explicitly continue");
      expect(screen.queryByRole("button", { name: "Add model requests for this task" })).toBeNull();
    });
  });
});
