import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { UsageMetrics } from "@/agentMode/session/usageMetrics";
import { SubagentChatPanel } from "@/agentMode/ui/SubagentChatPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import type { AgentChatMessage, PermissionPrompt, SessionUsage } from "@/agentMode/session/types";
import type {
  SubagentMessage,
  SubagentRunSnapshot,
  SubagentSessionSnapshot,
} from "@/agentMode/session/subagentTypes";
import type { Meta, StoryObj } from "@/lib/story";
import type ScribePlugin from "@/main";
import React from "react";

type SubagentChatPanelProps = React.ComponentProps<typeof SubagentChatPanel>;

const completedRun: SubagentRunSnapshot = {
  id: "native-task-run-1",
  taskGenerationId: "gen-1",
  toolCallId: "call-1",
  status: "completed",
  createdAt: 1,
  startedAt: 2,
  endedAt: 3,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
};

const runningRun: SubagentRunSnapshot = {
  ...completedRun,
  id: "native-task-run-2",
  toolCallId: "call-2",
  status: "running",
  createdAt: Date.now() - 12000,
  startedAt: Date.now() - 12000,
  endedAt: undefined,
};

const session: SubagentSessionSnapshot = {
  id: "child-audit",
  parentSessionId: "parent-chat",
  name: "资料核对",
  modelId: "configured-model",
  cwd: "/vault",
  retention: "retained",
  createdAt: 0,
  updatedAt: 12,
  runs: [completedRun, runningRun],
  messages: [
    {
      id: "m1",
      sequence: 1,
      subagentId: "child-audit",
      runId: "run-1",
      taskGenerationId: "gen-1",
      direction: "to_child",
      sender: "main",
      kind: "instruction",
      text: "核对 vault 里的三份月度总结，输出一致的结论。",
      state: "delivered",
      acceptedAt: 1,
      deliveredAt: 2,
    },
    {
      id: "m2",
      sequence: 2,
      subagentId: "child-audit",
      runId: "run-1",
      taskGenerationId: "gen-1",
      direction: "to_parent",
      sender: "subagent",
      kind: "discovery",
      text: "两份总结的口径不一致，已在结果中标注。",
      state: "delivered",
      acceptedAt: 2,
      deliveredAt: 3,
    },
    {
      id: "m3",
      sequence: 3,
      subagentId: "child-audit",
      runId: "run-2",
      taskGenerationId: "gen-1",
      direction: "to_child",
      sender: "user",
      kind: "instruction",
      text: "按新口径重新核对第二份总结。",
      state: "accepted",
      acceptedAt: 11,
    },
    {
      id: "m4",
      sequence: 4,
      subagentId: "child-audit",
      runId: "run-2",
      taskGenerationId: "gen-1",
      direction: "to_parent",
      sender: "subagent",
      kind: "question",
      text: "新口径下是否需要保留上次的异常清单？",
      state: "accepted",
      acceptedAt: 12,
    },
  ],
};

const runContent = (id: string, text: string): AgentChatMessage => ({
  id,
  sender: "ai",
  message: text,
  timestamp: null,
  isVisible: true,
});

const transcriptByCall: Record<string, AgentChatMessage[]> = {
  "call-1": [runContent("a1", "第一轮核对完成，发现两处口径差异。")],
  "call-2": [
    {
      ...runContent("a2", ""),
      parts: [
        {
          kind: "thought",
          text: "第一份已核对。\n正在按新口径重新核对第二份总结……",
          segmentSeq: 20,
          startedAtMs: runningRun.startedAt,
        },
      ],
    },
  ],
};

const childPermission: PermissionPrompt = {
  sessionId: "backend-session",
  requester: {
    taskId: "native-task-run-2",
    subagentId: "child-audit",
    subagentName: "资料核对",
  },
  toolCall: {
    toolCallId: "child-tool-1",
    status: "pending",
    title: "write_note",
    rawInput: {},
  },
  options: [
    { optionId: "allow_once", name: "Allow once", kind: "allow_once" },
    { optionId: "reject_once", name: "Deny once", kind: "reject_once" },
  ],
};

const childUsage: SessionUsage = {
  usedTokens: 0,
  updatedAt: 12,
  metrics: {
    totalTokens: 3262,
    inputTokens: 3000,
    outputTokens: 262,
    cacheReadTokens: 1500,
    cacheHitPercent: 50,
    rounds: 2,
    steps: 4,
    partial: false,
    sources: [
      {
        sourceId: "child-audit",
        sourceName: "资料核对",
        kind: "subagent",
        modelId: "glm-4.7",
        modelName: "GLM-4.7",
        purpose: "chat",
        totalTokens: 3262,
        inputTokens: 3000,
        outputTokens: 262,
        cacheReadTokens: 1500,
        cacheHitPercent: 50,
        steps: 4,
        partial: false,
      },
    ],
  },
};

const createParentBackend = (
  current: SubagentSessionSnapshot | null,
  permissions: readonly PermissionPrompt[] = []
): AgentChatBackend =>
  ({
    subscribe: () => () => {},
    sendMessage: () => ({ id: "stub", turn: Promise.resolve() }),
    acceptsMidTurnMessages: () => true,
    getQueuedPrompts: () => [],
    canWithdrawMessages: () => false,
    withdrawMessage: async () => {},
    takeWithdrawnPrompts: () => [],
    cancel: async () => {},
    sendWaitingNow: async () => {},
    deleteMessage: async () => false,
    clearMessages: () => {},
    getMessages: () => [],
    getTasks: (): readonly AgentTask[] => [],
    getTaskMessages: (toolCallId: string) => transcriptByCall[toolCallId] ?? [],
    getMessageUsageMetrics: (message: AgentChatMessage) =>
      message.parts?.some((part) => part.segmentSeq === 20)
        ? {
            partial: true,
            sources: [],
            roundStartedAtMs: runningRun.startedAt,
            hasActiveWork: current?.runs.some(
              (run) => run.id === runningRun.id && run.status === "running"
            ),
          }
        : undefined,
    canStopTasks: () => true,
    stopTask: async () => {},
    isStarting: () => false,
    isTurnInFlight: () => false,
    isReplyRunning: () => false,
    getBackendState: () => null,
    canSwitchModel: () => false,
    canSwitchEffort: () => false,
    canSwitchMode: () => false,
    resolvePlanProposal: async () => {},
    getCurrentPlan: () => null,
    getCurrentTodoList: () => null,
    getSessionUsage: () => null,
    getSubagentUsage: (subagentId: string) => (subagentId === current?.id ? childUsage : null),
    getPlanUsage: () => null,
    hasPendingPlanPermission: () => false,
    getPendingToolPermissions: () => permissions,
    resolveToolPermission: () => {},
    getPendingAskUserQuestions: () => [],
    resolveAskUserQuestion: () => {},
    getSubagentSessions: () => (current ? [current] : []),
    sendSubagentMessage: async () => ({ subagentId: current?.id ?? "", status: "enqueued" }),
    stopSubagent: async () => {},
    setSubagentArchived: async () => {},
    deleteSubagentSession: async () => {},
    refreshSubagentSessions: async () => {},
  }) as unknown as AgentChatBackend;

const managerStub = (): AgentSessionManager =>
  ({
    drafts: {
      get: () => undefined,
      subscribe: () => () => {},
      update: () => {},
    },
    subscribe: () => () => {},
    getStartingBackendId: () => null,
    getActiveSession: () => null,
    getActiveChatUIState: () => null,
    getCachedModelCatalog: () => null,
    getPreloadStatus: () => "ready",
    getEffortCatalog: () => null,
  }) as unknown as AgentSessionManager;

const pluginStub = {
  app: {} as SubagentChatPanelProps["plugin"]["app"],
  manifest: { version: "1.0.0" } as SubagentChatPanelProps["plugin"]["manifest"],
  updateUserMessageHistory: () => {},
} as unknown as ScribePlugin;

const PanelPreview: React.FC<Partial<SubagentChatPanelProps>> = (props) => {
  const app = useApp();
  return (
    <TooltipProvider>
      <div className="tw-h-[32rem] tw-w-full tw-overflow-hidden">
        <SubagentChatPanel
          app={app}
          plugin={{ ...pluginStub, app } as ScribePlugin}
          manager={managerStub()}
          parentBackend={createParentBackend(session, [childPermission])}
          subagentId="child-audit"
          onBack={() => {}}
          {...props}
        />
      </div>
    </TooltipProvider>
  );
};

const meta = {
  title: "Agent Mode/Subagent Chat",
  component: SubagentChatPanel,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<SubagentChatPanelProps>;
export default meta;

export const RunningWithSteeredMessage: StoryObj<SubagentChatPanelProps> = {
  render: (props) => <PanelPreview {...props} />,
};

export const WokenStreamingWithDeliveredInput: StoryObj<SubagentChatPanelProps> = {
  render: function ChildLivePreview(props) {
    const [startedAt] = React.useState(() => Date.now());
    const [thought, setThought] = React.useState("");
    const current: SubagentSessionSnapshot = {
      ...session,
      runs: [{ ...runningRun, startedAt: startedAt - 10000 }],
      messages: [
        {
          ...session.messages[2],
          runId: runningRun.id,
          roundId: "delivered-round",
          state: "delivered",
          deliveredAt: startedAt,
          deliverySeq: 15,
        },
      ],
    };
    return (
      <div className="tw-flex tw-flex-col tw-gap-2">
        <Button
          onClick={() =>
            setThought((text) =>
              text ? text + " 新到达的片段。" : "第一行  保留空格。\n正在核对追加要求。"
            )
          }
        >
          接收下一片思考
        </Button>
        <PanelPreview
          {...props}
          parentBackend={{
            ...createParentBackend(current),
            getTaskMessages: (toolCallId) =>
              toolCallId === runningRun.toolCallId
                ? [
                    {
                      ...runContent("live-reply", ""),
                      parts: [
                        { kind: "text", text: "上一段已完成的答复。", segmentSeq: 10 },
                        ...(thought
                          ? [
                              {
                                kind: "thought" as const,
                                text: thought,
                                startedAtMs: startedAt,
                                segmentSeq: 20,
                              },
                            ]
                          : []),
                      ],
                    },
                  ]
                : [],
            getMessageUsageMetrics: (message) =>
              message.parts?.some((part) => part.segmentSeq === 20)
                ? {
                    partial: true,
                    sources: [],
                    roundId: "delivered-round",
                    roundStartedAtMs: startedAt,
                    hasActiveWork: true,
                  }
                : {
                    partial: false,
                    sources: [],
                    roundStopReason: "end_turn",
                    roundDurationMs: 2000,
                  },
          }}
        />
      </div>
    );
  },
};

export const CompletedWithOwnUsage: StoryObj<SubagentChatPanelProps> = {
  render: (props) => {
    const roundId = "child-round-complete";
    const completed: SubagentSessionSnapshot = {
      ...session,
      runs: [{ ...completedRun, roundId, startedAt: 1000, endedAt: 12900, stopReason: "end_turn" }],
      messages: [{ ...session.messages[0], runId: completedRun.id, roundId, acceptedAt: 1000 }],
    };
    const metrics: UsageMetrics = {
      roundId,
      subagentId: completed.id,
      totalTokens: 1600,
      inputTokens: 1500,
      outputTokens: 100,
      cacheReadTokens: 750,
      cacheHitPercent: 50,
      tokensPerSecond: 32.5,
      ttftMs: 850,
      rounds: 1,
      steps: 2,
      activeRounds: 0,
      roundDurationMs: 11900,
      roundStopReason: "end_turn",
      finalResponseSegmentSeq: 20,
      thinkingDurationMs: 3200,
      toolCallCount: 1,
      hasActiveWork: false,
      partial: false,
      sources: [
        {
          ...childUsage.metrics!.sources[0],
          totalTokens: 1600,
          inputTokens: 1500,
          outputTokens: 100,
          cacheReadTokens: 750,
          steps: 2,
        },
      ],
    };
    const reply: AgentChatMessage = {
      ...runContent("completed-reply", "核对完成，三份总结的统计口径已统一。"),
      timestamp: {
        epoch: 12900,
        display: "2026/11/08 18:23:06",
        fileName: "20261108_182306",
      },
      parts: [
        { kind: "thought", text: "先逐项核对三份总结。", durationMs: 1200, segmentSeq: 10 },
        { kind: "text", text: "已核对第一份总结，接着确认其余记录。", segmentSeq: 10 },
        {
          kind: "tool_call",
          id: "completed-read",
          title: "Read Notes/Summary.md",
          vendorToolName: "Read",
          input: { file_path: "Notes/Summary.md" },
          output: [{ type: "text", text: "三份总结的完整核对记录。" }],
          status: "completed",
          segmentSeq: 11,
        },
        { kind: "thought", text: "按统一口径整理结果。", durationMs: 2000, segmentSeq: 20 },
        { kind: "text", text: "核对完成，三份总结的统计口径已统一。", segmentSeq: 20 },
      ],
    };
    return (
      <PanelPreview
        {...props}
        parentBackend={{
          ...createParentBackend(completed),
          getSubagentSessions: () => [
            completed,
            {
              ...session,
              id: "child-sibling",
              name: "仍在整理资料的子任务",
              runs: [{ ...runningRun, roundId }],
              messages: [],
            },
          ],
          getTaskMessages: (toolCallId) => (toolCallId === completedRun.toolCallId ? [reply] : []),
          getMessageUsageMetrics: (message) =>
            message.parts?.some((part) => part.segmentSeq === 20) ? metrics : undefined,
        }}
      />
    );
  },
};

export const CompactedWithOwnContext: StoryObj<SubagentChatPanelProps> = {
  render: (props) => {
    const compacted: SubagentSessionSnapshot = {
      ...session,
      runs: [completedRun],
      messages: [
        {
          ...session.messages[0],
          sender: "user",
          runId: completedRun.id,
          text: "/compact 保留笔记路径、口径差异和未完成核对项",
        },
      ],
    };
    const reply: AgentChatMessage = {
      ...runContent("compression-reply", ""),
      parts: [
        {
          kind: "compaction",
          id: "child-compression",
          trigger: "manual",
          status: "completed",
          startedAtMs: 1000,
          preTokens: 28000,
          postTokens: 2400,
          summary:
            "目标：统一三份月度总结的统计口径。\n约束：保留原始笔记与所有路径。\n已完成：核对第一份总结，标出两处差异。\n继续位置：读取第二份总结，按新口径复核，保留尚未解决的异常清单。",
        },
      ],
    };
    return (
      <PanelPreview
        {...props}
        parentBackend={{
          ...createParentBackend(compacted),
          getTaskMessages: (toolCallId) => (toolCallId === completedRun.toolCallId ? [reply] : []),
          getSubagentUsage: (subagentId) =>
            subagentId === compacted.id
              ? { ...childUsage, usedTokens: 2400, contextWindow: 64000 }
              : null,
        }}
      />
    );
  },
};

export const WaitingToRetry: StoryObj<SubagentChatPanelProps> = {
  render: (props) => (
    <PanelPreview
      {...props}
      parentBackend={createParentBackend({
        ...session,
        runs: [completedRun],
        messages: session.messages.filter((message: SubagentMessage) => message.id !== "m4"),
      })}
    />
  ),
};

export const SentReferenceContent: StoryObj<SubagentChatPanelProps> = {
  render: (props) => (
    <PanelPreview
      {...props}
      parentBackend={createParentBackend({
        ...session,
        runs: [completedRun],
        messages: [
          {
            ...session.messages[0],
            sender: "user",
            text: "请结合这些内容给出摘要。",
            payload: {
              content: [
                {
                  type: "image",
                  mimeType: "image/png",
                  data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
                },
              ],
              context: {
                notes: [],
                webTabs: [{ url: "https://example.com", title: "参考网页" }],
                selectedTextContexts: [
                  {
                    id: "selection",
                    sourceType: "web",
                    title: "参考网页",
                    url: "https://example.com",
                    content: "选中的示例内容",
                  },
                ],
              },
            },
          },
        ],
      })}
    />
  ),
};

export const RecoveryBlocked: StoryObj<SubagentChatPanelProps> = {
  render: (props) => (
    <PanelPreview
      {...props}
      parentBackend={createParentBackend({
        ...session,
        runs: [{ ...runningRun, status: "interrupted" }],
        recoveryBlocked: "原先使用的模型已移除。请恢复模型配置后再继续。",
      })}
    />
  ),
};

export const Archived: StoryObj<SubagentChatPanelProps> = {
  render: (props) => (
    <PanelPreview
      {...props}
      parentBackend={createParentBackend({ ...session, retention: "archived" })}
    />
  ),
};

export const DeletedChild: StoryObj<SubagentChatPanelProps> = {
  render: (props) => <PanelPreview {...props} parentBackend={createParentBackend(null)} />,
};
