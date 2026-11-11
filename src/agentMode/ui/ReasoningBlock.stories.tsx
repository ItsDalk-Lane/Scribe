import { Button } from "@/components/ui/button";
import { AgentTurnDurationIndicator } from "@/agentMode/ui/AgentTurnDurationIndicator";
import { AgentMessageActions } from "@/agentMode/ui/AgentMessageActions";
import { AgentMarkdownText } from "@/agentMode/ui/AgentMarkdownText";
import { ReasoningBlock } from "@/agentMode/ui/ReasoningBlock";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type ReasoningBlockProps = React.ComponentProps<typeof ReasoningBlock>;

const REASONING = {
  kind: "thought" as const,
  text: "先核对界面和请求记录。\n\n正在比较新增内容与原始顺序，保留完整思考中的  空格和换行。",
  startedAtMs: Date.now() - 18_426,
  durationMs: 18_426,
};

const meta = {
  title: "Agent Mode/Reasoning Block",
  component: ReasoningBlock,
  args: { part: REASONING, isStreaming: false },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<ReasoningBlockProps>;
export default meta;

export const Complete: StoryObj<ReasoningBlockProps> = {};

const ThinkingDeltasDemo: React.FC = () => {
  const [text, setText] = React.useState("先读取现有记录。\n\n正在检查");
  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      <Button onClick={() => setText((value) => value + " 新到达的思考片段。")}>
        接收下一片思考
      </Button>
      <ReasoningBlock part={{ kind: "thought", text }} isStreaming />
    </div>
  );
};

export const StreamingDeltas: StoryObj<ReasoningBlockProps> = { render: ThinkingDeltasDemo };

export const Active: StoryObj<ReasoningBlockProps> = {
  args: {
    part: { ...REASONING, startedAtMs: undefined, durationMs: undefined },
    isStreaming: true,
  },
};

export const LongPreviewWithDuration: StoryObj<ReasoningBlockProps> = {
  args: {
    part: {
      kind: "thought",
      text: "正在核对本轮模型返回的完整内容，并保留思考用时在标题后面，较长的单行预览会在可用宽度处截断，不把计时挤到整行最右侧。",
      startedAtMs: Date.now(),
    },
    isStreaming: true,
  },
};

export const EndedWhileResponseContinues: StoryObj<ReasoningBlockProps> = {
  args: {
    part: { ...REASONING, durationMs: 4_100 },
    isStreaming: true,
  },
};

const ReasoningResponseDurationDemo: React.FC = () => {
  const app = useApp();
  return (
    <TooltipProvider>
      <div className="tw-group tw-flex tw-flex-col tw-gap-1">
        <AgentTurnDurationIndicator status="complete" durationMs={138_000} inline />
        <ReasoningBlock part={REASONING} isStreaming={false} />
        <AgentMarkdownText
          text="The completed duration appears above the reply; the timestamp stays beside the response controls."
          app={app}
        />
        <AgentMessageActions
          text="The completed duration appears above the reply; the timestamp stays beside the response controls."
          app={app}
          timestamp="2026/10/31 21:00:00"
        />
      </div>
    </TooltipProvider>
  );
};

export const WithResponseAndWorkedFor: StoryObj<ReasoningBlockProps> = {
  render: ReasoningResponseDurationDemo,
};
