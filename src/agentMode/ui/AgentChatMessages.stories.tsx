import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type {
  AgentChatMessage,
  AskUserQuestionPrompt,
  PermissionPrompt,
  SessionId,
} from "@/agentMode/session/types";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useMemo, useState } from "react";

type AgentChatMessagesProps = React.ComponentProps<typeof AgentChatMessages>;

const SESSION_ID = "gallery-session" as SessionId;
const message: AgentChatMessage = {
  id: "gallery-response",
  sender: "ai",
  message: "I need a few decisions before I can continue.",
  timestamp: { epoch: Date.now(), display: "", fileName: "" },
  isVisible: true,
};

function permission(id: string, title: string): PermissionPrompt {
  return {
    sessionId: SESSION_ID,
    toolCall: { toolCallId: id, status: "pending", title },
    options: [
      { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
      { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
    ],
  };
}

function question(id: string, text: string): AskUserQuestionPrompt {
  return {
    sessionId: SESSION_ID,
    requestId: id,
    questions: [{ question: text, options: [{ label: "Yes" }, { label: "No" }] }],
  };
}

const permissions = [
  permission("read-roadmap", "Read roadmap.md"),
  permission("edit-brief", "Edit launch brief.md"),
  permission("run-checks", "Run validation checks"),
];
const questions = [
  question("audience", "Should the brief target existing customers?"),
  question("publish", "Should I prepare a publish-ready version?"),
];
const tallQuestion: AskUserQuestionPrompt = {
  sessionId: SESSION_ID,
  requestId: "deployment-strategy",
  questions: [
    {
      question: "Which deployment strategy should I use for the staged rollout?",
      options: Array.from({ length: 8 }, (_, index) => ({
        label: `Strategy ${index + 1}: staged rollout with regional validation`,
        description:
          "Validate telemetry, rollback readiness, and user impact before expanding to the next region.",
      })),
    },
  ],
};

const QueuedActionsDemo: React.FC<AgentChatMessagesProps> = (props) => {
  const app = useApp();
  const [pendingToolPermissions, setPendingToolPermissions] = useState(
    props.pendingToolPermissions
  );
  const [pendingAskUserQuestions, setPendingAskUserQuestions] = useState(
    props.pendingAskUserQuestions
  );
  const chatBackend = useMemo(
    () =>
      ({
        resolveToolPermission: (toolCallId: string) => {
          setPendingToolPermissions((current) =>
            current.filter((request) => request.toolCall.toolCallId !== toolCallId)
          );
        },
        resolveAskUserQuestion: (requestId: string) => {
          setPendingAskUserQuestions((current) =>
            current.filter((request) => request.requestId !== requestId)
          );
        },
      }) as unknown as AgentChatBackend,
    []
  );

  return (
    <TooltipProvider>
      <div className="tw-h-96 tw-overflow-hidden">
        <AgentChatMessages
          {...props}
          plugin={{ app, manifest: props.plugin.manifest }}
          pendingToolPermissions={pendingToolPermissions}
          pendingAskUserQuestions={pendingAskUserQuestions}
          chatBackend={chatBackend}
        />
      </div>
    </TooltipProvider>
  );
};

const actionRailArgs: AgentChatMessagesProps = {
  messages: [message],
  plugin: {
    app: {} as AgentChatMessagesProps["plugin"]["app"],
    manifest: { version: "4.1.0" } as AgentChatMessagesProps["plugin"]["manifest"],
  },
  currentPlan: null,
  pendingToolPermissions: permissions,
  pendingAskUserQuestions: questions,
  chatBackend: {} as AgentChatBackend,
  isLoading: true,
};

const meta = {
  title: "Agent Mode/Agent Chat Messages",
  component: AgentChatMessages,
  args: actionRailArgs,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentChatMessagesProps>;
export default meta;

export const LongHistoryPaging: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    isLoading: false,
    pendingAskUserQuestions: [],
    pendingToolPermissions: [],
    messages: Array.from({ length: 65 }, (_, index) => [
      {
        ...message,
        id: `history-user-${index}`,
        sender: "user",
        message: `第 ${index + 1} 轮：整理本周笔记。`,
      },
      {
        ...message,
        id: `history-reply-${index}`,
        message: `第 ${index + 1} 轮已整理完成，原始内容已保留。`,
        turnStopReason: "end_turn" as const,
      },
    ]).flat(),
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const QueuedActions: StoryObj<AgentChatMessagesProps> = {
  render: () => <QueuedActionsDemo {...actionRailArgs} />,
};

export const LongResponse: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    currentPlan: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      { ...message, id: "long-request", sender: "user", message: "Review the project notes." },
      {
        ...message,
        id: "long-response",
        message: Array.from(
          { length: 12 },
          (_, index) => `Finding ${index + 1}: The notes clarify the next step for the project.`
        ).join("\n\n"),
      },
    ],
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const TallQuestion: StoryObj<AgentChatMessagesProps> = {
  render: () => (
    <QueuedActionsDemo
      {...actionRailArgs}
      pendingToolPermissions={[]}
      pendingAskUserQuestions={[tallQuestion]}
    />
  ),
};

export const RunningAfterStop: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      { ...message, id: "first-request", sender: "user", message: "Summarize this note." },
      {
        ...message,
        id: "stopped-response",
        message: "I will read the note and summarize its main points.",
        turnStopReason: "cancelled",
        turnDurationMs: 2300,
      },
      { ...message, id: "next-request", sender: "user", message: "List its action items instead." },
      { ...message, id: "running-response", message: "" },
    ],
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const StoppedCommand: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "slow-request",
        sender: "user",
        message: "Rebuild the index of every note.",
      },
      {
        ...message,
        id: "stopped-command",
        message: "",
        turnStopReason: "cancelled",
        turnDurationMs: 4100,
        parts: [
          {
            kind: "tool_call",
            id: "list-notes",
            title: "Run ls notes",
            status: "completed",
            vendorToolName: "Bash",
            input: { command: "ls notes" },
          },
          {
            kind: "tool_call",
            id: "rebuild",
            title: "Run ./rebuild-index.sh",
            status: "cancelled",
            vendorToolName: "Bash",
            input: { command: "./rebuild-index.sh" },
          },
        ],
      },
    ],
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const FinishedReplyWhileSubagentsRun: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "launch-request",
        sender: "user",
        message: "Research both vendors in parallel and compare them when you're done.",
      },
      {
        ...message,
        id: "launch-reply",
        message:
          "I started two subagents, one per vendor. I'll compare them once both report back.",
        turnStopReason: "end_turn",
        turnDurationMs: 13_000,
      },
    ],
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const MessageDeliveredMidTurn: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      {
        ...message,
        id: "long-request",
        sender: "user",
        message: "Write a one-line summary of each note in the vault.",
      },
      {
        ...message,
        id: "before-steer",
        message: "Alpha: launch checklist for the spring release.",
        turnStopReason: "end_turn",
        turnDurationMs: 8200,
      },
      {
        ...message,
        id: "steer",
        sender: "user",
        message: "Only do the first two notes.",
      },
      { ...message, id: "after-steer", message: "Beta: notes from the design review." },
    ],
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const ApprovedPlanRunning: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    currentPlan: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      { ...message, id: "plan-request", sender: "user", message: "Plan a note for my trip." },
      {
        ...message,
        id: "plan-implementation",
        message: "The plan is approved. I'm creating the note now.",
      },
    ],
    isLoading: true,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const PlanResponses: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    currentPlan: null,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    messages: [
      { ...message, id: "request", sender: "user", message: "Plan my trip." },
      {
        ...message,
        id: "responses",
        message: "",
        parts: [
          {
            kind: "tool_call",
            id: "answer",
            title: "Answered: Checklist",
            status: "completed",
            userResponse: "Answered: Checklist",
            output: [{ type: "text", text: "Choose a format: Checklist" }],
          },
          {
            kind: "tool_call",
            id: "plan-approval",
            title: "Approved plan",
            status: "completed",
            toolKind: "switch_mode",
            userResponse: "Approved plan",
          },
        ],
      },
    ],
    isLoading: false,
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};

export const ChildNoticeDuringReasoning: StoryObj<AgentChatMessagesProps> = {
  args: {
    ...actionRailArgs,
    pendingToolPermissions: [],
    pendingAskUserQuestions: [],
    isLoading: true,
    messages: [
      {
        ...message,
        id: "live-main",
        message: "",
        parts: [
          { kind: "thought", text: "正在结合两个子代理的结果继续思考。", startedAtMs: Date.now() },
        ],
      },
      { ...message, id: "child-notice", synthetic: true, message: "子代理A已完成自己的部分。" },
    ],
  },
  render: (props) => <QueuedActionsDemo {...actionRailArgs} {...props} />,
};
