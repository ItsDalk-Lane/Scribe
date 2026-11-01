import React from "react";
import ChatSingleMessage from "./ChatSingleMessage";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useApp } from "@/context";
import type { Meta, StoryObj } from "@/lib/story";

interface AssistantMessageProps {
  text: string;
  isStreaming?: boolean;
  isErrorMessage?: boolean;
}

function AssistantMessage({
  text,
  isStreaming = false,
  isErrorMessage = false,
}: AssistantMessageProps) {
  const app = useApp();
  return (
    <TooltipProvider>
      <ChatSingleMessage
        message={{
          id: "assistant-preview",
          sender: "assistant",
          message: text,
          isVisible: true,
          timestamp: null,
          isErrorMessage,
        }}
        app={app}
        isStreaming={isStreaming}
      />
    </TooltipProvider>
  );
}

const meta = {
  title: "Chat/Assistant Message",
  component: AssistantMessage,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<AssistantMessageProps>;
export default meta;

export const MarkdownAnswer: StoryObj<AssistantMessageProps> = {
  args: {
    text: "## Research findings\n\nThe notes agree on **three priorities**:\n\n- Improve accuracy\n- Reduce repeated work\n- Keep the evidence visible",
  },
};
export const Thinking: StoryObj<AssistantMessageProps> = {
  args: { text: "<think>Compare the notes and check the supporting evidence.", isStreaming: true },
};
export const CompletedThinking: StoryObj<AssistantMessageProps> = {
  args: {
    text: "<think>Compare the notes and check the supporting evidence.</think>The notes agree on three priorities.",
  },
};
export const ProviderError: StoryObj<AssistantMessageProps> = {
  args: {
    text: "Model request failed: The provider rejected this API key. Check the key in BYOK settings.",
    isErrorMessage: true,
  },
};

export const CitedAnswer: StoryObj<AssistantMessageProps> = {
  args: {
    text: "The launch plan lists three milestones [^1].\n\n#### Sources\n[^1]: [[Launch plan]]",
  },
};
