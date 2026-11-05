import type { Meta, StoryObj } from "@/lib/story";
import { CommandEditorForm, type CommandEditorFormProps } from "./CommandEditorForm";

const command: CommandEditorFormProps["command"] = {
  title: "Review notes",
  content: "Review the selected text and identify unclear statements.",
  enabled: true,
  modelKey: "review-model",
  showInContextMenu: true,
  showInSlashMenu: true,
  order: 0,
  lastUsedMs: 0,
};
const meta = {
  title: "Commands/Editor",
  component: CommandEditorForm,
  args: {
    command,
    modelOptions: [{ label: "Review model", value: "review-model" }],
    validateName: () => null,
    onConfirm: () => {},
    onCancel: () => {},
  },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CommandEditorFormProps>;
export default meta;
export const EditCommand: StoryObj<CommandEditorFormProps> = {};
export const Saving: StoryObj<CommandEditorFormProps> = { args: { saving: true } };
export const SaveError: StoryObj<CommandEditorFormProps> = {
  args: { error: "无法保存指令，请检查文件权限后重试。填写的内容已保留。" },
};
export const UnavailableModel: StoryObj<CommandEditorFormProps> = { args: { modelOptions: [] } };
export const TemplatingOff: StoryObj<CommandEditorFormProps> = {
  args: { command: { ...command, enableTemplating: false } },
};
export const ShadowedBuiltinName: StoryObj<CommandEditorFormProps> = {
  args: { command: { ...command, title: "compact" } },
};
