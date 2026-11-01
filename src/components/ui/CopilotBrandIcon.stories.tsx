import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";
import { CopilotBrandIcon } from "./CopilotBrandIcon";

type IconProps = React.ComponentProps<typeof CopilotBrandIcon>;

const meta = {
  title: "UI/Scribe Brand Icon",
  component: CopilotBrandIcon,
  args: { className: "tw-size-8 tw-text-normal" },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<IconProps>;
export default meta;

export const Default: StoryObj<IconProps> = {};
