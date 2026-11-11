import React from "react";
import { t } from "@/lib/i18n";
import type { SkillCatalogStatus } from "@/agentMode/skills/modelCatalogState";

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
  // 名称也可能被预算淘汰，不能笼统显示“仅技能名”而掩盖实际缺失。https://github.com/ItsDalk-Lane/Scribe/issues/40
  if (status.includedNames.length === 0)
    return (
      <p role="status" className="tw-text-ui-small tw-text-warning">
        {t(
          "Skill catalog budget: No skill names are in the model-visible list. Omitted skills ({count}): {names}. Increase the budget to show them.",
          {
            count: String(status.omittedNames.length),
            names: status.omittedNames.join(", "),
          }
        )}
      </p>
    );
  if (status.omittedNames.length > 0)
    return (
      <p role="status" className="tw-text-ui-small tw-text-warning">
        {t(
          "Skill catalog budget: descriptions are omitted. Omitted skill names ({count}): {names}.",
          {
            count: String(status.omittedNames.length),
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
