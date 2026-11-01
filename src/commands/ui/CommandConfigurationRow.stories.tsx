import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import { Button } from "@/components/ui/button";
import { GripVertical } from "lucide-react";
import {
  CommandConfigurationRow,
  type CommandConfigurationRowProps,
} from "./CommandConfigurationRow";

const args: CommandConfigurationRowProps = {
  command: {
    title: "Review notes",
    content: "Read the selected notes and list questions that need clarification.",
    enabled: true,
    showInContextMenu: true,
    showInSlashMenu: true,
    modelKey: "",
    order: 0,
    lastUsedMs: 0,
  },
  dragHandle: (
    <Button type="button" size="icon" variant="ghost" aria-label="Reorder Review notes">
      <GripVertical aria-hidden="true" className="tw-size-4" />
    </Button>
  ),
  onEnabledChange: () => {},
  onEdit: () => {},
  onCopy: () => {},
  onDelete: () => {},
};
const meta = {
  title: "Commands/Configuration Row",
  component: CommandConfigurationRow,
  args,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<CommandConfigurationRowProps>;
export default meta;
export const Enabled: StoryObj<CommandConfigurationRowProps> = {};
export const Disabled: StoryObj<CommandConfigurationRowProps> = {
  args: { command: { ...args.command, enabled: false } },
};
export const MenuPreferencesOff: StoryObj<CommandConfigurationRowProps> = {
  args: { command: { ...args.command, showInContextMenu: false, showInSlashMenu: false } },
};
export const LongContent: StoryObj<CommandConfigurationRowProps> = {
  args: {
    command: {
      ...args.command,
      title: "审核所选笔记并汇总项目中需要澄清的决定与问题",
      content:
        "Compare the selected notes with the previous decisions, list the missing context, and explain which follow-up questions would help resolve those differences before rewriting the final project summary.",
    },
  },
};
export const GroupedCommands: StoryObj<CommandConfigurationRowProps> = {
  render: () => (
    <section className="tw-group/settings tw-space-y-3">
      <h3 className="tw-m-0 tw-text-sm tw-font-semibold">
        我的指令 <span className="tw-text-xs tw-font-normal tw-text-muted">2</span>
      </h3>
      <div className="tw-divide-y tw-divide-border tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-transparent">
        <CommandConfigurationRow {...args} />
        <CommandConfigurationRow
          {...args}
          command={{
            ...args.command,
            title: "Translate selection",
            content: "Translate the selected text while preserving its formatting.",
            showInContextMenu: false,
            enabled: false,
          }}
        />
      </div>
    </section>
  ),
};
