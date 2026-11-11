import React from "react";
import { t } from "@/lib/i18n";
import { Pencil, Trash2 } from "lucide-react";
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
          className="tw-group/settings tw-flex tw-flex-wrap tw-items-center tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3"
        >
          <div className="tw-min-w-0 tw-flex-1 tw-basis-48">
            <div className="tw-break-words tw-text-sm tw-font-medium">{item.name}</div>
            <p className="tw-m-0 tw-mt-1 tw-break-words tw-text-ui-smaller tw-text-muted">
              {item.description}
            </p>
          </div>
          <div className="tw-ml-auto tw-flex tw-shrink-0 tw-items-center tw-gap-2">
            <SettingSwitch
              aria-label={t("Enable {name}", { name: item.name })}
              checked={item.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => onToggle(item, enabled)}
            />
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Edit {name}", { name: item.name })}
              title={t("Edit")}
              disabled={busy}
              onClick={() => onEdit(item)}
            >
              <Pencil className="tw-size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              aria-label={t("Delete {name}", { name: item.name })}
              title={t("Delete")}
              className="hover:tw-text-error group-[]/settings:hover:!tw-text-error"
              disabled={busy}
              onClick={() => onRemove(item)}
            >
              <Trash2 className="tw-size-4" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
