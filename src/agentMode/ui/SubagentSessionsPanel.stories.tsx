import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";
import {
  SubagentSessionsButton,
  SubagentSessionsPanel,
  TaskBudgetContinuation,
  type SubagentSessionsPanelProps,
} from "@/agentMode/ui/SubagentSessionsPanel";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

const completedChild: SubagentSessionSnapshot = {
  id: "child-notes",
  parentSessionId: "parent-chat",
  name: "资料整理",
  modelId: "configured-model",
  cwd: "/vault",
  retention: "retained",
  createdAt: 1,
  updatedAt: 3,
  runs: [
    {
      id: "run-1",
      taskGenerationId: "task-1",
      toolCallId: "tool-1",
      status: "completed",
      createdAt: 1,
      endedAt: 2,
      result: "已整理三份资料，保留了尚未核实的两处结论。",
      usage: { input: 230, output: 100, cacheRead: 30, cacheWrite: 0, totalTokens: 360 },
    },
  ],
  messages: [],
};

const runningChild: SubagentSessionSnapshot = {
  ...completedChild,
  id: "child-audit",
  name: "资料核对",
  updatedAt: 9,
  runs: [
    {
      id: "run-2",
      taskGenerationId: "task-2",
      toolCallId: "tool-2",
      status: "running",
      createdAt: 8,
      usage: { input: 40, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 60 },
    },
  ],
};

const meta = {
  title: "Agent Mode/Child Sessions",
  component: SubagentSessionsPanel,
  parameters: { gallery: { host: "popover", layout: "padded" } },
  args: {
    sessions: [runningChild, completedChild],
    onOpen: () => undefined,
    onRefresh: async () => undefined,
  },
} satisfies Meta<SubagentSessionsPanelProps>;
export default meta;

export const RunningAndCompleted: StoryObj<SubagentSessionsPanelProps> = {};
export const Empty: StoryObj<SubagentSessionsPanelProps> = { args: { sessions: [] } };
export const ArchivedChild: StoryObj<SubagentSessionsPanelProps> = {
  args: {
    sessions: [{ ...completedChild, retention: "archived" }],
  },
};
export const RecoveryBlockedChild: StoryObj<SubagentSessionsPanelProps> = {
  args: {
    sessions: [
      {
        ...completedChild,
        recoveryBlocked: "原先使用的模型已移除。请恢复模型配置后再继续。",
        runs: [{ ...completedChild.runs[0], status: "interrupted" }],
      },
    ],
  },
};
export const EntryButton: StoryObj<SubagentSessionsPanelProps> = {
  render: (props) => <SubagentSessionsButton {...meta.args} {...props} />,
};

export const RequestAllowance: StoryObj<SubagentSessionsPanelProps> = {
  render: () => <TaskBudgetContinuation onContinue={async () => undefined} />,
};
