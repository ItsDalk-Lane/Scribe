import type { Meta, StoryObj } from "@/lib/story";
import * as React from "react";
import { SegmentedControl } from "./segmented-control";

const meta = {
  title: "UI/Segmented Control",
  component: SegmentedControl,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof SegmentedControl<string>>>;
export default meta;

export const SelectedMiddle: StoryObj<React.ComponentProps<typeof SegmentedControl<string>>> = {
  render: () => (
    <SegmentedControl
      aria-label="Preset plan"
      value="coding"
      onChange={() => undefined}
      options={[
        { value: "payg", label: "Pay-as-you-go" },
        { value: "coding", label: "Coding subscription" },
        { value: "agent", label: "Agent Plan" },
      ]}
    />
  ),
};

export const SelectedFirst: StoryObj<React.ComponentProps<typeof SegmentedControl<string>>> = {
  render: () => (
    <SegmentedControl
      aria-label="Preset region"
      value="cn"
      onChange={() => undefined}
      options={[
        { value: "cn", label: "China" },
        { value: "intl", label: "International" },
      ]}
    />
  ),
};

export const WithDisabledOption: StoryObj<React.ComponentProps<typeof SegmentedControl<string>>> = {
  render: () => (
    <SegmentedControl
      aria-label="Preset plan"
      value="intl"
      onChange={() => undefined}
      options={[
        { value: "payg", label: "Pay-as-you-go" },
        { value: "coding", label: "Coding subscription" },
        { value: "agent", label: "Agent Plan", disabled: true },
        { value: "intl", label: "International" },
      ]}
    />
  ),
};
