import { EmptyPlaceholder } from "@/agentMode/skills/ui/EmptyPlaceholder";
import type { Meta, StoryObj } from "@/lib/story";
import type React from "react";

type EmptyPlaceholderProps = React.ComponentProps<typeof EmptyPlaceholder>;

const meta = {
  title: "Agent Mode/Skills/Empty Placeholder",
  component: EmptyPlaceholder,
  args: { folder: "Scribe/skills" },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<EmptyPlaceholderProps>;
export default meta;

export const Empty: StoryObj<EmptyPlaceholderProps> = {};
