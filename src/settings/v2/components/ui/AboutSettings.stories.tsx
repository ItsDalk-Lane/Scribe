import type { Meta, StoryObj } from "@/lib/story";
import React from "react";
import { AboutSettings } from "./AboutSettings";

const meta = {
  title: "Settings/About",
  component: AboutSettings,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof AboutSettings>>;
export default meta;

export const Default: StoryObj<React.ComponentProps<typeof AboutSettings>> = {
  args: { version: "4.0.17", onReset: () => undefined },
};
