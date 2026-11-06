import { SkillCatalogBudgetSettings } from "@/agentMode/skills/ui/SkillCatalogBudget";
import type { Meta, StoryObj } from "@/lib/story";
import type React from "react";

type SettingsProps = React.ComponentProps<typeof SkillCatalogBudgetSettings>;

const meta = {
  title: "Agent Mode/Skills/Skill Catalog Budget Settings",
  component: SkillCatalogBudgetSettings,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SettingsProps>;

export default meta;

export const Defaults: StoryObj<SettingsProps> = {
  args: { percent: 2, maxTokens: 10000 },
};
