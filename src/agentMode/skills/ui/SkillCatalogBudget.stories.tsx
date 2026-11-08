import { SkillCatalogBudgetNotice } from "@/agentMode/skills/ui/SkillCatalogBudget";
import type { Meta, StoryObj } from "@/lib/story";
import type React from "react";

type NoticeProps = React.ComponentProps<typeof SkillCatalogBudgetNotice>;

const meta = {
  title: "Agent Mode/Skills/Skill Catalog Budget Notice",
  component: SkillCatalogBudgetNotice,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<NoticeProps>;

export default meta;

export const Normal: StoryObj<NoticeProps> = {
  args: {
    status: { mode: "full", includedNames: ["note-format", "draw-diagram"], omittedNames: [] },
  },
};

export const Pruned: StoryObj<NoticeProps> = {
  args: {
    status: {
      mode: "pruned",
      includedNames: ["note-format"],
      omittedNames: ["summarize-paper", "translate-note"],
    },
  },
};

export const NamesOnly: StoryObj<NoticeProps> = {
  args: {
    status: {
      mode: "names-only",
      includedNames: ["note-format", "summarize-paper"],
      omittedNames: [],
    },
  },
};

export const NoNamesFit: StoryObj<NoticeProps> = {
  args: {
    status: {
      mode: "names-only",
      includedNames: [],
      omittedNames: ["note-format", "summarize-paper"],
    },
  },
};

export const SomeNamesOmitted: StoryObj<NoticeProps> = {
  args: {
    status: {
      mode: "names-only",
      includedNames: ["note-format"],
      omittedNames: ["summarize-paper"],
    },
  },
};

export const HiddenWithoutCatalog: StoryObj<NoticeProps> = {
  args: { status: null },
};
