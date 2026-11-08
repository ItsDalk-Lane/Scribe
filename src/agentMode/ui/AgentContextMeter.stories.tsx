import { UsageMeter, type UsageMeterProps } from "@/agentMode/ui/AgentContextMeter";
import { TooltipProvider } from "@/components/ui/tooltip";
import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

function UsageMeterStory(props: UsageMeterProps) {
  return (
    <TooltipProvider>
      <UsageMeter {...props} />
    </TooltipProvider>
  );
}

const meta = {
  title: "Agent Mode/UsageMeter",
  component: UsageMeterStory,
} satisfies Meta<UsageMeterProps>;
export default meta;

const CONTEXT: UsageMeterProps["usage"] = {
  usedTokens: 48_000,
  contextWindow: 200_000,
  updatedAt: 1,
};
export const ContextOnly: StoryObj<UsageMeterProps> = {
  args: { usage: CONTEXT, contextWindow: 200_000 },
};
export const ContextNearlyFull: StoryObj<UsageMeterProps> = {
  args: {
    usage: { usedTokens: 186_000, contextWindow: 200_000, updatedAt: 1 },
    contextWindow: 200_000,
  },
};
export const UnknownContextWindow: StoryObj<UsageMeterProps> = {
  args: { usage: { usedTokens: 12_400, updatedAt: 1 }, contextWindow: null },
};

export const CumulativeWithChildren: StoryObj<UsageMeterProps> = {
  args: {
    usage: {
      ...CONTEXT,
      cumulativeInputTokens: 110000,
      cumulativeOutputTokens: 20000,
      cumulativeCacheReadTokens: 10000,
      cumulativeCacheWriteTokens: 0,
      cumulativeTotalTokens: 140000,
    },
    contextWindow: 200000,
  },
};

export const CompactedWithCumulative: StoryObj<UsageMeterProps> = {
  args: {
    usage: { ...CONTEXT, usedTokens: 2000, cumulativeTotalTokens: 140000 },
    contextWindow: 200000,
  },
};

export const CumulativeUnknownContext: StoryObj<UsageMeterProps> = {
  args: {
    usage: { usedTokens: 0, cumulativeTotalTokens: 140000, updatedAt: 1 },
    contextWindow: null,
  },
};
