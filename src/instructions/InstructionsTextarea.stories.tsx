import { InstructionsTextarea, type InstructionsTextareaProps } from "./InstructionsTextarea";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Instructions/Instructions Textarea",
  component: InstructionsTextarea,
  args: { value: "", onChange: () => {}, label: "Custom vault instructions" },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<InstructionsTextareaProps>;
export default meta;

export const Empty: StoryObj<InstructionsTextareaProps> = {};

export const ChineseInstructions: StoryObj<InstructionsTextareaProps> = {
  args: { label: "库的自定义说明", value: "保留用户自行编写的说明及 Inbox/ 路径。" },
};

export const UserAuthored: StoryObj<InstructionsTextareaProps> = {
  args: {
    value:
      "Put new notes in Inbox/ and link them to a related note.\n\nAsk before editing anything under Archive/.",
  },
};
