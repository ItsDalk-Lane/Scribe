import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { AgentStepLimitSetting, type AgentStepLimitSettingProps } from "./AgentStepLimitSetting";

const meta = {
  title: "Settings/Agent step limit",
  component: AgentStepLimitSetting,
  args: { onChange: () => undefined },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<AgentStepLimitSettingProps>;
export default meta;

export const Unlimited: StoryObj<AgentStepLimitSettingProps> = {};
export const ExplicitLimit: StoryObj<AgentStepLimitSettingProps> = { args: { maxSteps: 50 } };
export const LargeLimit: StoryObj<AgentStepLimitSettingProps> = { args: { maxSteps: 1500 } };
export const ChangeLimit: StoryObj<AgentStepLimitSettingProps> = {
  render: function ChangeLimitPreview() {
    const [maxSteps, setMaxSteps] = React.useState<number>();
    return <AgentStepLimitSetting maxSteps={maxSteps} onChange={setMaxSteps} />;
  },
};
