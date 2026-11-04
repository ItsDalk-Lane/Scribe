import type { Meta, StoryObj } from "@/lib/story";
import type * as React from "react";
import { ScribeBrandIcon } from "./ScribeBrandIcon";

type IconProps = React.ComponentProps<typeof ScribeBrandIcon>;

const meta = {
  title: "UI/Scribe Brand Icon",
  component: ScribeBrandIcon,
  args: { className: "tw-size-8 tw-text-normal" },
  parameters: { gallery: { host: "leaf", layout: "padded" } },
} satisfies Meta<IconProps>;
export default meta;

export const Default: StoryObj<IconProps> = {};
