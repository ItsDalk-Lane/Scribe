import React from "react";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import {
  DEFAULT_SKILL_CATALOG_BUDGET_MAX_TOKENS,
  DEFAULT_SKILL_CATALOG_BUDGET_PERCENT,
} from "@/constants";
import { t } from "@/lib/i18n";

export interface SkillCatalogBudgetSettingsProps {
  percent?: number;
  maxTokens?: number;
  onChange: (budget: { catalogBudgetPercent?: number; catalogBudgetMaxTokens?: number }) => void;
}

// 模型可见技能清单的上下文占比与绝对上限均可在此覆盖；非法输入不提交变更。
// https://github.com/ItsDalk-Lane/Scribe/issues/40
export function SkillCatalogBudgetSettings({
  percent,
  maxTokens,
  onChange,
}: SkillCatalogBudgetSettingsProps) {
  return (
    <>
      <SettingItem
        type="custom"
        title={t("Context share (percent)")}
        description={t(
          "The model-visible skill list is capped by this share of the model context window. Default is {default}.",
          { default: String(DEFAULT_SKILL_CATALOG_BUDGET_PERCENT) }
        )}
      >
        <Input
          type="number"
          min={0.1}
          max={100}
          step={0.5}
          aria-label={t("Context share (percent)")}
          defaultValue={percent}
          className="tw-w-full sm:tw-w-[200px]"
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isFinite(next) && next > 0 && next <= 100)
              onChange({ catalogBudgetPercent: next });
          }}
        />
      </SettingItem>
      <SettingItem
        type="custom"
        title={t("Absolute token maximum")}
        description={t(
          "The catalog never exceeds this token count even for large context windows. Default is {default}.",
          { default: String(DEFAULT_SKILL_CATALOG_BUDGET_MAX_TOKENS) }
        )}
      >
        <Input
          type="number"
          min={1}
          step={1000}
          aria-label={t("Absolute token maximum")}
          defaultValue={maxTokens}
          className="tw-w-full sm:tw-w-[200px]"
          onChange={(event) => {
            const next = Number(event.target.value);
            if (Number.isSafeInteger(next) && next > 0) onChange({ catalogBudgetMaxTokens: next });
          }}
        />
      </SettingItem>
    </>
  );
}
