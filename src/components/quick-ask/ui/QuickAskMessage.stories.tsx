import { QuickAskMessageComponent } from "@/components/quick-ask/ui/QuickAskMessage";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

type Props = React.ComponentProps<typeof QuickAskMessageComponent>;

const meta = {
  title: "Quick Ask/Message",
  component: QuickAskMessageComponent,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

const args = {
  message: {
    id: "preview",
    role: "assistant" as const,
    content: "完整回答会保留**格式**，相对链接使用提问时的笔记位置。",
    timestamp: 1,
  },
  isStreaming: false,
  isLastAssistantMessage: true,
  onCopy: () => {},
  onInsert: () => {},
  onReplace: () => {},
  hasSelection: true,
  isReplaceValid: true,
  replaceInvalidReason: null,
  filePathSnapshot: "",
};
export const Complete: StoryObj<Props> = { args };
export const Streaming: StoryObj<Props> = { args: { ...args, isStreaming: true } };
export const LargeCode: StoryObj<Props> = {
  args: {
    ...args,
    message: {
      ...args.message,
      content: `\`\`\`text\n${"完整原文，不丢失内容。\n".repeat(6000)}\`\`\``,
    },
  },
};
