import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { SubagentChatPanel } from "@/agentMode/ui/SubagentChatPanel";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { AgentChatMessage, PermissionPrompt } from "@/agentMode/session/types";
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
  createdAt: 10,
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
  "call-2": [runContent("a2", "正在按新口径重新核对第二份总结……")],
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
