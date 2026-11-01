import { TurnDiffPane, type TurnDiffPaneProps } from "@/agentMode/ui/TurnDiffView";
import { NON_MARKDOWN_FILE, WORDING_CHANGE } from "@/agentMode/ui/renderedDiff/testing/fixtures";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/File Changes Modal",
  component: TurnDiffPane,
  parameters: { gallery: { host: "modal", layout: "fullscreen" } },
  args: { onStepperChange: () => {} },
} satisfies Meta<TurnDiffPaneProps>;
export default meta;

export const MarkdownChanges: StoryObj<TurnDiffPaneProps> = {
  args: {
    state: { ...WORDING_CHANGE, status: "modified", additions: 1, deletions: 1, turnId: "turn-1" },
  },
};

export const PlainFileChanges: StoryObj<TurnDiffPaneProps> = {
  args: {
    state: {
      ...NON_MARKDOWN_FILE,
      status: "modified",
      additions: 1,
      deletions: 1,
      turnId: "turn-1",
    },
  },
};

export const DeletedFile: StoryObj<TurnDiffPaneProps> = {
  args: {
    state: {
      ...WORDING_CHANGE,
      status: "deleted",
      after: null,
      additions: 0,
      deletions: 2,
      turnId: "turn-1",
    },
  },
};
