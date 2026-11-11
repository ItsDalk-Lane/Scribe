import {
  ProjectInstructionsField,
  type ProjectInstructionsFieldProps,
} from "./ProjectInstructionsField";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Instructions/Project Instructions Field",
  component: ProjectInstructionsField,
  args: { value: "", onChange: () => {} },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ProjectInstructionsFieldProps>;
export default meta;

export const EmptyDraftWithPriorityGuidance: StoryObj<ProjectInstructionsFieldProps> = {};

export const LoadedDraft: StoryObj<ProjectInstructionsFieldProps> = {
  args: {
    value:
      "Write project summaries in concise Chinese.\n\nCite only notes tagged #verified unless the current request specifies other sources.",
  },
};

export const OverflowingDraft: StoryObj<ProjectInstructionsFieldProps> = {
  args: {
    value: Array.from(
      { length: 12 },
      (_, i) => `${i + 1}. Rule the agent follows for every interaction in this project.`
    ).join("\n"),
  },
};
