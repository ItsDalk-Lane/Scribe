import { CommandBlock } from "@/agentMode/backends/shared/ui/SetupSteps";
import type { Meta, StoryObj } from "@/lib/story";
import type { ComponentProps } from "react";

const meta = {
  title: "Agent Mode/Command Block",
  component: CommandBlock,
  args: { command: "npm install -g @anthropic-ai/claude-code" },
  parameters: { gallery: { host: "modal", layout: "padded" } },
} satisfies Meta<ComponentProps<typeof CommandBlock>>;
export default meta;

export const CommandsOnly: StoryObj<ComponentProps<typeof CommandBlock>> = {};

export const LongCommand: StoryObj<ComponentProps<typeof CommandBlock>> = {
  args: {
    command:
      "irm https://gist.githubusercontent.com/logancyang/7a87eb38d91015eac567521f8cc9c729/raw/install-claude-agent-mode-windows.ps1 | iex",
    shell: "powershell",
  },
};
