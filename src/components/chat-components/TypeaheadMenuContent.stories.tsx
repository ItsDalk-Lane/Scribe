import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import {
  composeSlashMenuItems,
  slashMenuItemGroup,
  slashMenuItemSourceLabel,
} from "./plugins/slashMenuItems";
import {
  SlashSourceBadge,
  TypeaheadMenuContent,
  type TypeaheadMenuContentProps,
} from "./TypeaheadMenuContent";

const agentSlashOptions = composeSlashMenuItems(
  [
    {
      name: "summarize",
      description: "Summarize the active note in five bullets",
      filePath: "/skills/summarize/SKILL.md",
      dirPath: "/skills/summarize",
      body: "Summarize the active note in five bullets.",
      enabledAgents: ["native"],
      location: { kind: "canonical" },
      source: { kind: "builtin" },
    },
    {
      name: "translate-notes",
      description: "Translate the active note into English",
      filePath: "/skills/translate-notes/SKILL.md",
      dirPath: "/skills/translate-notes",
      body: "Translate the active note into English.",
      enabledAgents: ["native"],
      location: { kind: "canonical" },
      source: { kind: "local" },
    },
  ],
  "native",
  true,
  {
    agentCommands: [
      {
        id: "draft",
        name: "draft",
        description: "Draft a reply from the active note",
        content: "Draft a concise reply based on the active note.",
        enabled: true,
      },
    ],
    subagents: [
      {
        id: "research",
        name: "research",
        description: "Collects and summarizes sources",
        instructions: "You research topics thoroughly and cite sources.",
        enabled: true,
      },
    ],
  }
).map((item) => ({
  key: item.key,
  title: item.name,
  subtitle: item.description || undefined,
  content: item.body,
  group: slashMenuItemGroup(item),
  trailingContent: <SlashSourceBadge label={slashMenuItemSourceLabel(item)} />,
}));

const meta = {
  title: "Chat/Typeahead Menu",
  component: TypeaheadMenuContent,
  parameters: { gallery: { host: "popover", layout: "centered" } },
} satisfies Meta<TypeaheadMenuContentProps>;
export default meta;

export const AgentSlashMenu: StoryObj<TypeaheadMenuContentProps> = {
  args: {
    options: agentSlashOptions,
    selectedIndex: 0,
    onSelect: () => undefined,
    onHighlight: () => undefined,
    showPreview: true,
  },
};

export const AgentSlashMenuSubagentSelected: StoryObj<TypeaheadMenuContentProps> = {
  args: {
    options: agentSlashOptions,
    selectedIndex: 4,
    onSelect: () => undefined,
    onHighlight: () => undefined,
    showPreview: true,
  },
};
