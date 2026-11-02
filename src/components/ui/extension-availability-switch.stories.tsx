import type React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { ExtensionAvailabilitySwitch } from "./extension-availability-switch";

type Props = React.ComponentProps<typeof ExtensionAvailabilitySwitch>;

const meta = {
  title: "UI/Extension Availability Switch",
  component: ExtensionAvailabilitySwitch,
  args: {
    label: "Enable notes",
    state: { checked: true, disabled: false },
    onToggle: () => {},
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const Available: StoryObj<Props> = {};
export const Unavailable: StoryObj<Props> = {
  args: { state: { checked: false, disabled: false } },
};
export const Checking: StoryObj<Props> = {
  args: {
    state: { checked: false, disabled: true, phase: "checking", reason: "Checking availability…" },
  },
};
export const WaitingForTask: StoryObj<Props> = {
  args: { state: { checked: true, disabled: false }, busy: true },
};
export const LockedBuiltin: StoryObj<Props> = {
  args: {
    state: {
      checked: true,
      disabled: true,
      reason: "This item cannot be switched in the selected scope.",
    },
  },
};
