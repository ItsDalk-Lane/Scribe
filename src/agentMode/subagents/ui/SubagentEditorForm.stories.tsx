import type { Meta, StoryObj } from "@/lib/story";
import { SubagentEditorForm, type SubagentEditorFormProps } from "./SubagentEditorForm";
const meta = {
  title: "Agent Mode/Subagents/Editor",
  component: SubagentEditorForm,
  args: { onSave: async () => {}, onCancel: () => {} },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<SubagentEditorFormProps>;
export default meta;
export const New: StoryObj<SubagentEditorFormProps> = {};
export const Existing: StoryObj<SubagentEditorFormProps> = {
  args: {
    initialValue: {
      name: "事实核查与来源审阅助手",
      description: "检查笔记中的事实、引用和可能遗漏的依据。",
      instructions: "阅读指定笔记并列出需要核对的陈述。先提供审阅结果，等待用户决定是否修改。",
      enabled: true,
    },
  },
};
export const SaveFailure: StoryObj<SubagentEditorFormProps> = {
  ...Existing,
  args: {
    ...Existing.args,
    onSave: async () => {
      throw new Error("文件已被外部修改，草稿已保留。请刷新后核对。");
    },
  },
};
