import React from "react";
import { SubAgentCard } from "@/agentMode/ui/SubAgentCard";
import type { ToolCallPart } from "@/agentMode/ui/agentTrail";
import type { Meta, StoryObj } from "@/lib/story";
import { useApp } from "@/context";

const sample: ToolCallPart = {
  kind: "tool_call",
  id: "delegate",
  title: "delegate_task",
  vendorToolName: "delegate_task",
  status: "in_progress",
  input: { subagent_type: "资料研究", description: "检查笔记并整理资料" },
};
function SubAgentExample({ status }: { status: ToolCallPart["status"] }) {
  const app = useApp();
  return (
    <SubAgentCard
      parent={{ ...sample, status }}
      childNodes={[]}
      app={app}
      renderNode={() => null}
    />
  );
}
type Props = React.ComponentProps<typeof SubAgentExample>;
const meta = {
  title: "Agent Mode/Subagent Activity",
  component: SubAgentExample,
  args: { status: "in_progress" },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;
export const Running: StoryObj<Props> = {};
export const Waiting: StoryObj<Props> = { args: { status: "pending" } };
export const Completed: StoryObj<Props> = { args: { status: "completed" } };
export const Failed: StoryObj<Props> = { args: { status: "failed" } };
export const Cancelled: StoryObj<Props> = { args: { status: "cancelled" } };
