import React, { useState } from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { WebSearchSetting, type WebSearchSettingProps } from "./WebSearchSetting";

const meta = {
  title: "Settings/Web Search",
  component: WebSearchSetting,
  args: { providers: [], onChange: () => undefined },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<WebSearchSettingProps>;
export default meta;

export const Default: StoryObj<WebSearchSettingProps> = {};

export const DeepSeek: StoryObj<WebSearchSettingProps> = {
  args: {
    providerId: "deepseek",
    providers: [{ providerId: "deepseek", displayName: "DeepSeek" }],
  },
  render: function SearchEngineSelection(args) {
    const [providerId, setProviderId] = useState(args.providerId);
    return (
      <WebSearchSetting
        providers={args.providers ?? []}
        providerId={providerId}
        onChange={setProviderId}
      />
    );
  },
};

export const MissingAccount: StoryObj<WebSearchSettingProps> = {
  args: { providerId: "removed-account" },
};
