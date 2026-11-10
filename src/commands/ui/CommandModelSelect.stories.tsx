import type { Meta, StoryObj } from "@/lib/story";
import { CommandModelSelect, type CommandModelSelectProps } from "./CommandModelSelect";
const meta = {
  title: "Commands/Model selection",
  component: CommandModelSelect,
  args: { options: [{ label: "GPT-4o (OpenRouter)", value: "gpt4o" }], onChange: () => undefined },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<CommandModelSelectProps>;
export default meta;
export const DefaultModel: StoryObj<CommandModelSelectProps> = { args: { value: "" } };
export const ExplicitModel: StoryObj<CommandModelSelectProps> = { args: { value: "gpt4o" } };
export const UnavailableModel: StoryObj<CommandModelSelectProps> = {
  args: { value: "disabled-model" },
};
export const GroupedByProvider: StoryObj<CommandModelSelectProps> = {
  args: {
    value: "",
    options: [
      { label: "Claude Sonnet 4.5", value: "sonnet", group: "Anthropic" },
      { label: "GLM-5.3", value: "glm", group: "智谱" },
      { label: "DeepSeek V4.1", value: "ds", group: "智谱" },
    ],
  },
};
