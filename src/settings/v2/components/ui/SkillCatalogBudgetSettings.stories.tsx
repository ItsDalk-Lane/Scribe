import React from "react";
import type { Meta, StoryObj } from "@/lib/story";
import {
  SkillCatalogBudgetSettings,
  type SkillCatalogBudgetSettingsProps,
} from "./SkillCatalogBudgetSettings";

const meta = {
  title: "Settings/Skill catalog budget",
  component: SkillCatalogBudgetSettings,
  args: { percent: 2, maxTokens: 10000, onChange: () => undefined },
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<SkillCatalogBudgetSettingsProps>;
export default meta;

export const Defaults: StoryObj<SkillCatalogBudgetSettingsProps> = {};
export const ChangeBudget: StoryObj<SkillCatalogBudgetSettingsProps> = {
  render: function ChangeBudgetPreview() {
    const [budget, setBudget] = React.useState({
      catalogBudgetPercent: 2,
      catalogBudgetMaxTokens: 10000,
    });
    return (
      <SkillCatalogBudgetSettings
        percent={budget.catalogBudgetPercent}
        maxTokens={budget.catalogBudgetMaxTokens}
        onChange={(next) => setBudget((current) => ({ ...current, ...next }))}
      />
    );
  },
};
