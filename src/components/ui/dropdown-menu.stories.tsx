import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "./dropdown-menu";

type Props = React.ComponentProps<typeof DropdownMenu>;
const meta = {
  title: "UI/Dropdown Menu",
  component: DropdownMenu,
  parameters: { gallery: { host: "popover", layout: "padded" } },
} satisfies Meta<Props>;
export default meta;

export const Closed: StoryObj<Props> = {
  render: (args) => (
    <DropdownMenu {...args}>
      <DropdownMenuTrigger asChild>
        <Button variant="secondary">权限模式</Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>计划</DropdownMenuItem>
        <DropdownMenuItem>自动</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ),
};
export const FirstOpen: StoryObj<Props> = { args: { defaultOpen: true }, render: Closed.render };
