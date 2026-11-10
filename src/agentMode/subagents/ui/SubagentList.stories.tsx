import type { Meta, StoryObj } from "@/lib/story";
import { SubagentList, type SubagentListProps } from "./SubagentList";
const meta = {
  title: "Agent Mode/Subagents/List",
  component: SubagentList,
  args: { items: [], onEdit: () => {}, onRemove: () => {}, onToggle: () => {} },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SubagentListProps>;
export default meta;
export const Empty: StoryObj<SubagentListProps> = {};
export const Several: StoryObj<SubagentListProps> = {
  args: {
    items: [
      {
        id: "reviewer",
        name: "事实核查与资料来源审阅助手",
        description: "检查长篇笔记中的事实、引用与论证，整理需要进一步核实的资料来源。",
        instructions: "Check facts",
        enabled: true,
      },
      {
        id: "writer",
        name: "写作助手",
        description: "整理草稿并改善表达。",
        instructions: "Write clearly",
        enabled: false,
      },
    ],
  },
};
export const Saving: StoryObj<SubagentListProps> = {
  ...Several,
  args: { ...Several.args, busy: true },
};
