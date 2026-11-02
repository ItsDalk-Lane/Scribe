import type React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { ExtensionAvailabilityDot } from "./extension-availability-dot";

type Props = React.ComponentProps<typeof ExtensionAvailabilityDot>;

const meta = {
  title: "UI/Extension Availability Dot",
  component: ExtensionAvailabilityDot,
  args: {
    state: { enabled: false, reason: "Resolve the loading error before enabling this item." },
  },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const Failed: StoryObj<Props> = {};
export const Connecting: StoryObj<Props> = {
  args: { state: { enabled: false, connecting: true, reason: "Connecting…" } },
};
export const Informational: StoryObj<Props> = {
  args: {
    state: { enabled: true, informational: true, reason: "Read-only; manage at its source" },
  },
};
export const Unconfirmed: StoryObj<Props> = {
  args: {
    state: { enabled: false, reason: "Availability could not be confirmed. Check again." },
  },
};
