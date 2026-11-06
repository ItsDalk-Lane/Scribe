import React from "react";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { SettingSwitch } from "@/components/ui/setting-switch";
import type { SubagentEditorValue } from "./SubagentEditorForm";

export interface SubagentListItem extends SubagentEditorValue {
  id: string;
}
export interface SubagentListProps {
  items: readonly SubagentListItem[];
  busy?: boolean;
  onEdit: (item: SubagentListItem) => void;
  onRemove: (item: SubagentListItem) => void;
  onToggle: (item: SubagentListItem, enabled: boolean) => void;
}

export function SubagentList({ items, busy, onEdit, onRemove, onToggle }: SubagentListProps) {
  return (
    <div className="tw-flex tw-flex-col tw-gap-3">
      {!items.length && (
        <p className="tw-m-0 tw-text-sm tw-text-muted">{t("No custom subagents yet.")}</p>
      )}
      {items.map((item) => (
        <div
          key={item.id}
          className="tw-flex tw-flex-col tw-gap-2 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3"
        >
          <div className="tw-flex tw-items-start tw-justify-between tw-gap-3">
            <div className="tw-min-w-0 tw-flex-1">
              <div className="tw-break-words tw-text-sm tw-font-medium">{item.name}</div>
              <p className="tw-m-0 tw-mt-1 tw-break-words tw-text-ui-smaller tw-text-muted">
                {item.description}
              </p>
            </div>
            <SettingSwitch
              aria-label={t("Enable {name}", { name: item.name })}
              checked={item.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => onToggle(item, enabled)}
            />
          </div>
          <div className="tw-flex tw-flex-wrap tw-justify-end tw-gap-2">
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onEdit(item)}
              aria-label={t("Edit {name}", { name: item.name })}
            >
              {t("Edit")}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => onRemove(item)}
              aria-label={t("Delete {name}", { name: item.name })}
            >
              {t("Delete")}
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
