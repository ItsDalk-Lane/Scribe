import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { SubagentLimitSettings, type SubagentLimitSettingsProps } from "./SubagentLimitSettings";

const meta = {
  title: "Settings/Subagent limits",
  component: SubagentLimitSettings,
  args: {
    values: { maxConcurrent: 3, maxQueued: 20, maxTaskRequests: 100 },
    onChange: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SubagentLimitSettingsProps>;
export default meta;

export const Defaults: StoryObj<SubagentLimitSettingsProps> = {};
export const NoQueue: StoryObj<SubagentLimitSettingsProps> = {
  args: { values: { maxConcurrent: 1, maxQueued: 0, maxTaskRequests: 20 } },
};
export const ChangeLimits: StoryObj<SubagentLimitSettingsProps> = {
  render: function ChangeLimitsPreview() {
    const [values, onChange] = React.useState({
      maxConcurrent: 3,
      maxQueued: 20,
      maxTaskRequests: 100,
    });
    return <SubagentLimitSettings values={values} onChange={onChange} />;
  },
};
