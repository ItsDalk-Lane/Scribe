import React from "react";
import { Input } from "@/components/ui/input";
import { SettingDisclosure } from "@/components/ui/setting-disclosure";
import { SettingItem } from "@/components/ui/setting-item";
import { t } from "@/lib/i18n";
import { getSettings, updateSetting } from "@/settings/model";
import type { SkillCatalogStatus } from "@/agentMode/skills/modelCatalogState";
import {
  DEFAULT_SKILL_CATALOG_BUDGET_MAX_TOKENS,
  DEFAULT_SKILL_CATALOG_BUDGET_PERCENT,
} from "@/constants";

export interface SkillCatalogBudgetNoticeProps {
  status: SkillCatalogStatus | null;
}

// 设置页可见的目录预算状态：正常 / 已淘汰部分条目 / 已降级为仅名字。
// https://github.com/ItsDalk-Lane/Scribe/issues/40
export function SkillCatalogBudgetNotice({ status }: SkillCatalogBudgetNoticeProps) {
  if (!status || (status.includedNames.length === 0 && status.omittedNames.length === 0))
    return null;
  if (status.mode === "full")
    return (
      <p role="status" className="tw-text-ui-small tw-text-muted">
        {t("Skill catalog budget: normal ({count} skills listed).", {
          count: String(status.includedNames.length),
        })}
      </p>
    );
  if (status.mode === "pruned")
    return (
      <p role="status" className="tw-text-ui-small tw-text-muted">
        {t(
          "Skill catalog budget: {omitted} of {total} skills are not in the model-visible list: {names}.",
          {
            omitted: String(status.omittedNames.length),
            total: String(status.includedNames.length + status.omittedNames.length),
            names: status.omittedNames.join(", "),
          }
        )}
      </p>
    );
  return (
    <p role="status" className="tw-text-ui-small tw-text-warning">
      {t(
        "Skill catalog budget: degraded to skill names only; {count} skill descriptions are not in the model-visible list.",
        { count: String(status.omittedNames.length + status.includedNames.length) }
      )}
    </p>
  );
}

export interface SkillCatalogBudgetSettingsProps {
  percent?: number;
  maxTokens?: number;
}

// 预算百分比与绝对上限均可在此覆盖；非法输入不覆盖已保存值。
// https://github.com/ItsDalk-Lane/Scribe/issues/40
export function SkillCatalogBudgetSettings({
  percent,
  maxTokens,
}: SkillCatalogBudgetSettingsProps) {
  const [open, setOpen] = React.useState(false);
  const save = (next: { percent?: number; maxTokens?: number }) => {
    const agentMode = getSettings().agentMode;
    updateSetting("agentMode", {
      ...agentMode,
      skills: {
        ...agentMode.skills,
        ...next,
      },
    });
  };
  return (
    <div>
      <SettingDisclosure
        open={open}
        label={t("Skill catalog budget")}
        onClick={() => setOpen(!open)}
      />
      {open && (
        <div className="tw-space-y-2">
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
                if (Number.isFinite(next) && next > 0 && next <= 100) save({ percent: next });
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
                if (Number.isSafeInteger(next) && next > 0) save({ maxTokens: next });
              }}
            />
          </SettingItem>
        </div>
      )}
    </div>
  );
}
