import type { Meta, StoryObj } from "@/lib/story";
import React from "react";

import { McpToolLoadingSetting, type McpToolLoadingSettingProps } from "./McpToolLoadingSetting";

const meta = {
  title: "Settings/MCP tool loading",
  component: McpToolLoadingSetting,
  args: {
    mode: "auto",
    thresholdChars: 4000,
    onModeChange: () => undefined,
    onThresholdChange: () => undefined,
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<McpToolLoadingSettingProps>;
export default meta;

export const AutoWithThreshold: StoryObj<McpToolLoadingSettingProps> = {};

export const AlwaysDeferred: StoryObj<McpToolLoadingSettingProps> = {
  args: { mode: "always" },
};

export const Off: StoryObj<McpToolLoadingSettingProps> = {
  args: { mode: "off" },
};

export const SavingLocked: StoryObj<McpToolLoadingSettingProps> = {
  args: { disabled: true },
};

export const Interactive: StoryObj<McpToolLoadingSettingProps> = {
  render: function InteractivePreview() {
    const [mode, setMode] = React.useState<"auto" | "always" | "off">("auto");
    const [threshold, setThreshold] = React.useState<number | undefined>(4000);
    return (
      <McpToolLoadingSetting
        mode={mode}
        thresholdChars={threshold}
        onModeChange={setMode}
        onThresholdChange={setThreshold}
      />
    );
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
};
