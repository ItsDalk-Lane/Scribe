import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { CommandBadge } from "./CommandPillNode";

interface CommandChipLineProps {
  kind: string;
  name: string;
  trailing: string;
}

function CommandChipLine({ kind, name, trailing }: CommandChipLineProps) {
  return (
    <p className="tw-m-0 tw-flex tw-items-center tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-2 tw-text-sm tw-text-normal">
      <CommandBadge name={name} kind={kind} />
      {trailing}
    </p>
  );
}

const meta = {
  title: "Chat/Command chip",
  component: CommandBadge,
  parameters: { gallery: { host: "leaf", layout: "padded" } },
  args: { name: "review-notes", kind: "skill" },
} satisfies Meta<{ name: string; kind: string }>;
export default meta;

export const SkillCommand: StoryObj<{ name: string; kind: string }> = {
  args: { name: "review-notes", kind: "skill" },
};
export const BuiltinCommand: StoryObj<{ name: string; kind: string }> = {
  args: { name: "compact", kind: "builtin" },
};
export const InComposer: StoryObj<{ name: string; kind: string }> = {
  render: () => (
    <div className="tw-space-y-2">
      <CommandChipLine kind="skill" name="review-notes" trailing=" 检查这份笔记的论证结构" />
      <CommandChipLine kind="skill" name="skill-creator" trailing=" 帮我把这个流程做成技能" />
      <CommandChipLine kind="builtin" name="compact" trailing="" />
    </div>
  ),
};
