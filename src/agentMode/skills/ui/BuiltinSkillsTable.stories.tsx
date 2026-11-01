import type { Meta, StoryObj } from "@/lib/story";
import { Bot } from "lucide-react";
import { BuiltinSkillsTable, type BuiltinSkillsTableProps } from "./BuiltinSkillsTable";

const args: BuiltinSkillsTableProps = {
  skills: [
    {
      name: "obsidian-markdown",
      description: "Create and edit Obsidian Markdown notes.",
      content: "# Obsidian Markdown\n\nCreate notes with links, embeds and callouts.",
    },
  ],
  agents: [{ id: "claude", displayName: "Claude", Icon: Bot }],
  availableAgents: ["claude"],
};
const meta = {
  title: "Skills/Built-in Skills",
  component: BuiltinSkillsTable,
  args,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<BuiltinSkillsTableProps>;
export default meta;
export const AlwaysEnabled: StoryObj<BuiltinSkillsTableProps> = {};
export const NotInstalled: StoryObj<BuiltinSkillsTableProps> = { args: { availableAgents: [] } };
export const NameCollision: StoryObj<BuiltinSkillsTableProps> = {
  args: {
    unavailableReasons: {
      "obsidian-markdown": "A skill with this name already exists. Your file is kept unchanged.",
    },
  },
};
export const ReadFailure: StoryObj<BuiltinSkillsTableProps> = {
  args: { error: "Some built-in skill files could not be updated. Check folder permissions." },
};
