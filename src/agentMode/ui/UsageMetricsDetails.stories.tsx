import {
  UsageMetricsDetails,
  type UsageMetricsDetailsProps,
} from "@/agentMode/ui/UsageMetricsDetails";
import type { Meta, StoryObj } from "@/lib/story";

const meta = {
  title: "Agent Mode/Usage Metrics Details",
  component: UsageMetricsDetails,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<UsageMetricsDetailsProps>;
export default meta;
export const MainAndChild: StoryObj<UsageMetricsDetailsProps> = {
  args: {
    showRounds: true,
    metrics: {
      totalTokens: 21300,
      inputTokens: 18000,
      outputTokens: 3300,
      cacheReadTokens: 13500,
      cacheHitPercent: 75,
      ttftMs: 850,
      tokensPerSecond: 60,
      steps: 5,
      rounds: 2,
      activeRounds: 1,
      partial: false,
      sources: [
        {
          sourceId: "main:glm",
          sourceName: "主助手",
          kind: "main",
          modelId: "glm-5.3",
          modelName: "GLM-5.3",
          provider: "Zhipu",
          purpose: "chat",
          totalTokens: 16000,
          inputTokens: 14000,
          outputTokens: 2000,
          cacheReadTokens: 10000,
          cacheHitPercent: 71.4,
          ttftMs: 850,
          tokensPerSecond: 50,
          steps: 3,
          partial: false,
        },
        {
          sourceId: "research:deepseek",
          sourceName: "资料整理",
          kind: "subagent",
          modelId: "deepseek-chat",
          modelName: "DeepSeek",
          provider: "DeepSeek",
          purpose: "chat",
          totalTokens: 5300,
          inputTokens: 4000,
          outputTokens: 1300,
          cacheReadTokens: 3500,
          cacheHitPercent: 87.5,
          ttftMs: 900,
          tokensPerSecond: 86.7,
          steps: 2,
          partial: false,
        },
      ],
    },
  },
};
export const MissingData: StoryObj<UsageMetricsDetailsProps> = { args: {} };
export const PartialCompaction: StoryObj<UsageMetricsDetailsProps> = {
  args: {
    metrics: {
      totalTokens: 6000,
      steps: 2,
      partial: true,
      sources: [
        {
          sourceId: "compact",
          sourceName: "主助手",
          kind: "main",
          modelId: "glm-5.3",
          modelName: "GLM-5.3",
          purpose: "compaction",
          totalTokens: 6000,
          steps: 2,
          partial: true,
        },
      ],
    },
  },
};
