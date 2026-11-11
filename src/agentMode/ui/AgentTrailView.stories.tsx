import { Button } from "@/components/ui/button";
import { useApp } from "@/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { AgentMessagePart, StopReason, TurnFileChange } from "@/agentMode/session/types";
import { AgentTrail } from "@/agentMode/ui/AgentTrailView";
import { t } from "@/lib/i18n";
import type { Meta, StoryObj } from "@/lib/story";
import React, { useState } from "react";

type AgentTrailProps = React.ComponentProps<typeof AgentTrail>;

function tool(
  id: string,
  vendorToolName: string,
  overrides: Partial<Extract<AgentMessagePart, { kind: "tool_call" }>> = {}
): AgentMessagePart {
  return {
    kind: "tool_call",
    id,
    title: id,
    status: "completed",
    vendorToolName,
    ...overrides,
  };
}

const think = (text: string): AgentMessagePart => ({ kind: "thought", text });
const say = (text: string): AgentMessagePart => ({ kind: "text", text });

const TURN: AgentMessagePart[] = [
  think("The conference is probably on the calendar rather than in a note."),
  tool("s1", "Skill", { input: { skill: "gcal" } }),
  think("The helper is not on PATH here."),
  tool("b1", "Bash", { input: { description: "Locate the gws binary" } }),
  think("Searching the calendar for anything summit-shaped."),
  tool("b2", "Bash", { input: { description: "Search calendar for summit events" } }),
  tool("b3", "Bash", { input: { description: "Check calendar auth options" } }),
  think("Two accounts are configured, so I should ask which one to read."),
  say("I found two calendar accounts on this machine. Reading the personal one first."),
  tool("q1", "AskUserQuestion", {
    input: { questions: [{ header: "Account", question: "Which calendar should I read?" }] },
  }),
  tool("b4", "Bash", { input: { description: "Fetch Aug 1–2 events with descriptions" } }),
  tool("b5", "Bash", {
    input: { description: "Re-run with the personal profile" },
    status: "failed",
  }),
  think("The first profile has no access; the second one works."),
  say("Found it — **Agentic AI Summit 2026**, August 1–2 at the Marriott. Saving it to the vault."),
  tool("e1", "Edit", { input: { file_path: "Events/Agentic AI Summit 2026.md" } }),
  say("Saved to [[Agentic AI Summit 2026]] with the schedule and the two talks you flagged."),
];

const STREAMING: AgentMessagePart[] = [
  ...TURN.slice(0, 8),
  tool("b6", "Bash", {
    input: { description: "Fetch Aug 1–2 events with descriptions" },
    status: "in_progress",
  }),
];

const UNIFIED_CARDS: AgentMessagePart[] = [
  think("I should inspect the source before changing it."),
  say("The reasoning row uses the same inset and disclosure treatment as the work below."),
  tool("read-1", "Read", {
    locations: [{ path: "src/agentMode/ui/AgentTrailView.tsx" }],
    output: [{ type: "text", text: "export const AgentTrail = ..." }],
  }),
  say("A single expandable tool remains its own row."),
  tool("read-2", "Read", { locations: [{ path: "src/agentMode/ui/ActionCard.tsx" }] }),
  tool("test-1", "Bash", { input: { description: "Run focused activity-card tests" } }),
  say("Consecutive tools remain separate rows with their own folded details."),
  tool("delegate-1", "Task", {
    input: { subagent_type: "Explore", description: "Check nested trail cards" },
  }),
  tool("delegate-read", "Read", {
    parentToolCallId: "delegate-1",
    locations: [{ path: "src/agentMode/ui/SubAgentCard.tsx" }],
  }),
  say("Reasoning, individual tools, grouped work, and delegated work now align."),
];

const FAILED_FILE_CHANGES: AgentMessagePart[] = [
  say("The edit was denied, so the card says the note was not edited."),
  tool("failed-edit", "Edit", { status: "failed", input: { file_path: "Projects/plan.md" } }),
  say("A denied write with no diff says the note was not edited."),
  tool("failed-write", "Write", {
    status: "failed",
    input: { file_path: "Projects/notes.md", content: "# Notes\n" },
    output: [{ type: "text", text: "User declined" }],
  }),
  say("A denied delete says the note was not deleted."),
  tool("failed-delete", "Delete", {
    status: "failed",
    toolKind: "delete",
    input: { filePath: "Archive/old.md" },
  }),
  say("A failed shell command still ran, so its label is unchanged."),
  tool("failed-bash", "Bash", { status: "failed", input: { command: "npm test" } }),
  say("A completed edit keeps its past-tense label."),
  tool("done-edit", "Edit", { input: { file_path: "Projects/plan.md" } }),
];

type CompactionOverrides = Partial<Extract<AgentMessagePart, { kind: "compaction" }>>;

const compaction = (overrides: CompactionOverrides = {}): AgentMessagePart => ({
  kind: "compaction",
  id: "compaction-1",
  status: "completed",
  trigger: "manual",
  startedAtMs: Date.now() - 12_000,
  ...overrides,
});

const TrailDemo: React.FC<{
  parts: AgentMessagePart[];
  isStreaming?: boolean;
  showCompletedDuration?: boolean;
  fileChanges?: TurnFileChange[];
  stopReason?: StopReason;
  errorText?: string;
  metrics?: AgentTrailProps["metrics"];
}> = ({
  parts,
  isStreaming = false,
  showCompletedDuration = true,
  fileChanges,
  stopReason = "end_turn",
  errorText,
  metrics,
}) => {
  const app = useApp();
  return (
    <TooltipProvider>
      <AgentTrail
        parts={parts}
        isStreaming={isStreaming}
        turnStartedAtMs={isStreaming ? Date.now() - 138_000 : undefined}
        turnDurationMs={!isStreaming && showCompletedDuration ? 138_000 : undefined}
        timestamp="2026/08/07 20:31:10"
        app={app}
        turnStopReason={isStreaming ? undefined : stopReason}
        fileChanges={fileChanges}
        errorText={errorText}
        metrics={metrics}
      />
    </TooltipProvider>
  );
};

const meta = {
  title: "Agent Mode/Agent Trail",
  component: AgentTrail,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AgentTrailProps>;
export default meta;

export const GroupedTurn: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={TURN} />,
};

export const Streaming: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={STREAMING} isStreaming />,
};

export const EmptyReply: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[]}
      errorText={`**${t("Error:")}** ${t("No response or action was returned. Try again, or switch models if this happens repeatedly.")}`}
    />
  ),
};

export const PartialReplyFailure: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[say("I found the first note but could not finish.")]}
      errorText={`**${t("Error:")}** ${t("Failed to send message. Please try again.")}`}
    />
  ),
};

export const UnifiedCardStyles: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={UNIFIED_CARDS} />,
};

export const FailedFileChanges: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={FAILED_FILE_CHANGES} />,
};

export const StoppedAtOutputLimit: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        say("I'll load the meeting note skill first."),
        tool("s1", "Skill", { input: { skill: "meeting-note" } }),
        tool("r1", "Read", { locations: [{ path: "Meetings/2026-10-12 Weekly sync.md" }] }),
        tool("w1", "Write", {
          toolKind: "edit",
          status: "failed",
          input: { file_path: "Meetings/2026-10-19 Weekly sync.md" },
        }),
      ]}
      stopReason="max_tokens"
    />
  ),
};

export const StepLimitSummary: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[say("已完成两篇笔记的整理，剩余笔记尚未处理。发送新消息可以继续。")]}
      stopReason="max_turn_requests"
    />
  ),
};

export const TaskRequestLimit: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[say("已完成的资料整理和子会话已保存，等待明确继续。")]}
      stopReason="max_task_requests"
    />
  ),
};

export const QuotaExhausted: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo parts={[say("已检查现有内容，最后的修改尚未开始。")]} stopReason="quota_exhausted" />
  ),
};

export const AuthenticationFailure: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[]} stopReason="authentication_error" />,
};

export const ContextLimit: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[say("已完成的工作已保留。")]} stopReason="context_limit" />,
};

export const RequestFailure: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[]} stopReason="request_error" />,
};

export const CancelledByUser: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[say("已读取两篇笔记。")]} stopReason="cancelled" />,
};

export const CompletedWithoutDuration: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={UNIFIED_CARDS} showCompletedDuration={false} />,
};

const EDITED_FILES: TurnFileChange[] = [
  {
    path: "Events/Agentic AI Summit 2026.md",
    status: "created",
    before: null,
    after: "after\n",
    additions: 42,
    deletions: 0,
  },
  {
    path: "Daily/2026-08-07.md",
    status: "modified",
    before: "before\n",
    after: "after\n",
    additions: 3,
    deletions: 1,
  },
];

export const WithFilesChanged: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={TURN} fileChanges={EDITED_FILES} />,
};

export const CompactionRunningManual: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[compaction({ status: "in_progress" })]} isStreaming />,
};

export const CompactionRunningAuto: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        say("Reading the remaining notes before I summarize them."),
        compaction({ status: "in_progress", trigger: "auto" }),
      ]}
      isStreaming
    />
  ),
};

export const CompactionCompletedWithTokens: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[compaction({ preTokens: 182_340, postTokens: 24_100 })]}
      showCompletedDuration={false}
    />
  ),
};

export const CompactionCompletedWithoutTokens: StoryObj<AgentTrailProps> = {
  render: () => <TrailDemo parts={[compaction()]} showCompletedDuration={false} />,
};

export const CompactionCompletedAutomatically: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        tool("b1", "Bash", { input: { description: "Search the vault" } }),
        tool("b2", "Bash", { input: { description: "Read the matching notes" } }),
        compaction({ trigger: "auto", preTokens: 910_000, postTokens: 31_000 }),
        tool("b3", "Bash", { input: { description: "Draft the summary" } }),
        tool("b4", "Bash", { input: { description: "Save it to the vault" } }),
        say("Saved the summary to [[Weekly review]]."),
      ]}
    />
  ),
};

export const CompactionFailed: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[compaction({ status: "failed", error: "The summarization request timed out." })]}
      showCompletedDuration={false}
    />
  ),
};

export const CompactionCancelled: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo parts={[compaction({ status: "cancelled" })]} showCompletedDuration={false} />
  ),
};

export const CompactionSkipped: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo parts={[compaction({ status: "skipped" })]} showCompletedDuration={false} />
  ),
};

const ForkableReplyDemo = () => {
  const app = useApp();
  const [forked, setForked] = useState(false);
  return (
    <TooltipProvider>
      <AgentTrail
        app={app}
        parts={TURN}
        isStreaming={false}
        turnStopReason="end_turn"
        turnDurationMs={138_000}
        timestamp="2026/10/31 21:00:00"
        onFork={() => setForked(true)}
      />
      {forked ? <div role="status">Fork conversation selected</div> : null}
    </TooltipProvider>
  );
};

export const ForkableReply: StoryObj<AgentTrailProps> = { render: ForkableReplyDemo };

const ActivityLifecycleDemo: React.FC<{ singleTool?: boolean; reasoningOnly?: boolean }> = ({
  singleTool = false,
  reasoningOnly = false,
}) => {
  const app = useApp();
  const [startedAt, setStartedAt] = useState(() => Date.now() - 12_000);
  const [stoppedAt, setStoppedAt] = useState<number | null>(null);
  const running = stoppedAt === null;
  const read = tool("lifecycle-read", "Read", {
    locations: [{ path: "Example.md" }],
    output: [{ type: "text", text: "工具详情默认收起，点击此工具即可查看。" }],
  });
  const parts = reasoningOnly
    ? [
        {
          kind: "thought" as const,
          text: "思考详情默认收起；手动展开后，完成时仍保留展开。",
          durationMs: 3_000,
        },
      ]
    : singleTool
      ? [read]
      : [
          say("先查看第一篇笔记，再检查结果。"),
          read,
          tool("lifecycle-check", "Bash", {
            input: { command: "npm test" },
            status: running ? "in_progress" : "completed",
          }),
          say("第一轮检查已完成，接着查看另一篇笔记。"),
          tool("lifecycle-read-second", "Read", { locations: [{ path: "Another.md" }] }),
          tool("lifecycle-check-second", "Bash", {
            input: { command: "npm run lint" },
            status: running ? "in_progress" : "completed",
          }),
          say("这些正文始终留在原来的位置；完成时不会被移到最后。"),
        ];
  return (
    <TooltipProvider>
      <div className="tw-flex tw-flex-col tw-gap-3">
        <div className="tw-flex tw-gap-2">
          <Button onClick={() => setStoppedAt(Date.now())} disabled={!running}>
            完成本轮
          </Button>
          <Button
            onClick={() => {
              setStartedAt(Date.now());
              setStoppedAt(null);
            }}
          >
            重新运行
          </Button>
        </div>
        <AgentTrail
          app={app}
          parts={parts}
          isStreaming={running}
          turnStartedAtMs={startedAt}
          turnStopReason={running ? undefined : "end_turn"}
          turnDurationMs={stoppedAt === null ? undefined : stoppedAt - startedAt}
          timestamp="2026/11/01 09:00:00"
        />
      </div>
    </TooltipProvider>
  );
};

export const ActivityCompletesAndCollapses: StoryObj<AgentTrailProps> = {
  render: () => <ActivityLifecycleDemo />,
};
export const SingleToolCompletesAndCollapses: StoryObj<AgentTrailProps> = {
  render: () => <ActivityLifecycleDemo singleTool />,
};
export const ReasoningCompletesAndCollapses: StoryObj<AgentTrailProps> = {
  render: () => <ActivityLifecycleDemo reasoningOnly />,
};

export const InterruptedWithPreservedOriginal: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        tool("interrupted-edit", "Edit", {
          synthetic: true,
          status: "failed",
          input: { file_path: "Projects/Brief.md" },
          output: [
            {
              type: "text",
              text: "系统恢复说明：文件可能已被改动，结果无法确认。请核查实际文件后再重试。",
            },
          ],
        }),
        say("意外退出前已经显示的回复仍保留在这里。"),
        tool("finished-read", "Read", { input: { file_path: "Notes/Context.md" } }),
        compaction({
          summary: "用户正在整理项目说明；已完成资料阅读，文件修改结果需要人工核查。",
          fromIndex: 0,
          toIndex: 12,
        }),
      ]}
      stopReason="interrupted"
    />
  ),
};

export const SubagentInspection: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        think("查看已保存的子会话及其结果。"),
        tool("sessions", "list_subagent_sessions", { toolKind: "read" }),
        tool("result", "read_subagent_result", { toolKind: "read" }),
        say("子代理已完成工作。"),
      ]}
    />
  ),
};

const CompletedProcessDemo: React.FC = () => {
  const app = useApp();
  const [complete, setComplete] = useState(false);
  const [startedAt, setStartedAt] = useState(() => Date.now());
  const [duration, setDuration] = useState<number>();
  const parts: AgentMessagePart[] = [
    { kind: "thought", text: "先核对笔记中的记录。", durationMs: 1_234, segmentSeq: 1 },
    { ...say("先读取第一篇笔记。"), segmentSeq: 1 },
    tool("process-read-one", "Read", {
      locations: [{ path: "Notes/First.md" }],
      output: [{ type: "text", text: "第一篇笔记的完整结果。" }],
    }),
    { ...say("第一篇已读取，接着核对另一篇。"), segmentSeq: 5 },
    tool("process-read-two", "Read", {
      status: complete ? "completed" : "in_progress",
      locations: [{ path: "Notes/Second.md" }],
      output: complete ? [{ type: "text", text: "第二篇笔记的完整结果。" }] : undefined,
    }),
    ...(complete
      ? [
          {
            kind: "thought" as const,
            text: "把两份结果按原始顺序整理。",
            durationMs: 2_345,
            segmentSeq: 11,
          },
          { ...say("核对完成，两篇笔记的记录一致。最终正文保留在过程块外。"), segmentSeq: 11 },
        ]
      : []),
  ];
  return (
    <TooltipProvider>
      <div className="tw-flex tw-flex-col tw-gap-3">
        <div className="tw-flex tw-gap-2">
          <Button
            disabled={complete}
            onClick={() => {
              setDuration(Date.now() - startedAt);
              setComplete(true);
            }}
          >
            完成本轮
          </Button>
          <Button
            onClick={() => {
              setStartedAt(Date.now());
              setDuration(undefined);
              setComplete(false);
            }}
          >
            重新运行
          </Button>
        </div>
        <AgentTrail
          messageId="completed-process"
          app={app}
          parts={parts}
          isStreaming={!complete}
          turnStopReason={complete ? "end_turn" : undefined}
          turnStartedAtMs={startedAt}
          turnDurationMs={duration}
          timestamp="2026/11/08 09:00:00"
          metrics={{
            partial: false,
            sources: [],
            hasActiveWork: !complete,
            finalResponseSegmentSeq: complete ? 11 : undefined,
            thinkingDurationMs: complete ? 3579 : 1234,
            toolCallCount: 2,
          }}
        />
      </div>
    </TooltipProvider>
  );
};

export const CompletedProcessWithFinalResponse: StoryObj<AgentTrailProps> = {
  render: CompletedProcessDemo,
};

export const CompletedWithUnsuccessfulSteps: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        say("读取失败后继续整理可用资料。"),
        tool("failed-read", "Read", {
          status: "failed",
          locations: [{ path: "Notes/Missing.md" }],
          output: [{ type: "text", text: "文件不存在。" }],
        }),
        tool("cancelled-read", "Read", {
          status: "cancelled",
          locations: [{ path: "Notes/Cancelled.md" }],
        }),
        compaction({ id: "failed-summary", status: "failed", error: "摘要请求失败。" }),
        compaction({ id: "cancelled-summary", status: "cancelled" }),
        {
          ...say("已整理现有结果。过程默认折叠，失败和取消数量保留在标题中，展开可查看原始记录。"),
          segmentSeq: 7,
        },
      ]}
      metrics={{ partial: false, sources: [], hasActiveWork: false, finalResponseSegmentSeq: 7 }}
    />
  ),
};

export const CompletedWithUnfinishedPlan: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        {
          kind: "plan",
          entries: [{ content: "尚未核对的笔记", status: "in_progress", priority: "medium" }],
        },
        { ...say("本轮已结束；展开过程可查看保留原状的计划，标题动效已停止。"), segmentSeq: 7 },
      ]}
      metrics={{ partial: false, sources: [], hasActiveWork: false, finalResponseSegmentSeq: 7 }}
    />
  ),
};

export const PlainResponseWithEmptyProcess: StoryObj<AgentTrailProps> = {
  render: () => (
    <TrailDemo
      parts={[
        { kind: "thought", text: "", segmentSeq: 7 },
        { kind: "thought", text: " \n\t ", segmentSeq: 7 },
        { kind: "plan", entries: [] },
        { ...say("这是本轮的完整正文，前面的空思考和空计划不会生成空过程块。"), segmentSeq: 7 },
      ]}
      metrics={{ partial: false, sources: [], hasActiveWork: false, finalResponseSegmentSeq: 7 }}
    />
  ),
};

const StableResponseCompletionDemo = () => {
  const app = useApp();
  const [completed, setCompleted] = useState(false);
  const parts: AgentMessagePart[] = [
    { kind: "text", text: "先核对相关笔记。", segmentSeq: 1, contentIndex: 0 },
    tool("stable-response-read", "Read", { locations: [{ path: "Example.md" }] }),
    {
      kind: "text",
      text: "## 整理结果\n\n可以先选中这段文字，再点击“完成回答”：过程会收起，选区和正文保持不变。\n\n```text\n完整内容一直保留，可以阅读和复制。\n```",
      segmentSeq: 7,
      contentIndex: 0,
    },
  ];
  return (
    <TooltipProvider>
      <div className="tw-flex tw-select-text tw-flex-col tw-gap-3">
        <div>
          <Button onClick={() => setCompleted(true)} disabled={completed}>
            完成回答
          </Button>
        </div>
        <AgentTrail
          app={app}
          messageId="stable-response-demo"
          parts={parts}
          isStreaming={!completed}
          turnStopReason={completed ? "end_turn" : undefined}
          turnDurationMs={completed ? 12_000 : undefined}
          metrics={{
            partial: !completed,
            sources: [],
            hasActiveWork: !completed,
            finalResponseSegmentSeq: 7,
          }}
        />
      </div>
    </TooltipProvider>
  );
};

export const StableFinalResponse: StoryObj<AgentTrailProps> = {
  render: StableResponseCompletionDemo,
};
