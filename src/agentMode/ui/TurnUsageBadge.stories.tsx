import React from "react";
import { TurnUsageBadge, type TurnUsageBadgeProps } from "@/agentMode/ui/TurnUsageBadge";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Turn Usage Badge",
  component: TurnUsageBadge,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<TurnUsageBadgeProps>;
export default meta;
export const Measured: StoryObj<TurnUsageBadgeProps> = {
  args: {
    metrics: {
      totalTokens: 18650,
      inputTokens: 16000,
      outputTokens: 2650,
      cacheReadTokens: 12000,
      cacheHitPercent: 75,
      ttftMs: 850,
      tokensPerSecond: 68.4,
      steps: 3,
      partial: false,
      sources: [
        {
          sourceId: "main:glm",
          sourceName: "主助手",
          kind: "main",
          modelId: "glm-5.3",
          modelName: "GLM-5.3",
          purpose: "chat",
          totalTokens: 18650,
          inputTokens: 16000,
          outputTokens: 2650,
          cacheReadTokens: 12000,
          cacheHitPercent: 75,
          ttftMs: 850,
          tokensPerSecond: 68.4,
          steps: 3,
          partial: false,
        },
      ],
    },
  },
};
export const MissingHistory: StoryObj<TurnUsageBadgeProps> = { args: {} };
export const Partial: StoryObj<TurnUsageBadgeProps> = {
  args: { metrics: { totalTokens: 18650, steps: 4, partial: true, sources: [] } },
};
export const BesideTimestamp: StoryObj<TurnUsageBadgeProps> = {
  render: () => (
    <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
      <span className="tw-text-xs tw-text-muted">2026/11/08 18:23:06</span>
      <TurnUsageBadge {...Measured.args} />
    </div>
  ),
};
