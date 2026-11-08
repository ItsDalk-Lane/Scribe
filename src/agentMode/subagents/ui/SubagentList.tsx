import React from "react";
import { t } from "@/lib/i18n";
import { MoreVertical, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SettingSwitch } from "@/components/ui/setting-switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
          className="tw-flex tw-items-start tw-justify-between tw-gap-3 tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-3"
        >
          <div className="tw-min-w-0 tw-flex-1">
            <div className="tw-break-words tw-text-sm tw-font-medium">{item.name}</div>
            <p className="tw-m-0 tw-mt-1 tw-break-words tw-text-ui-smaller tw-text-muted">
              {item.description}
            </p>
          </div>
          <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2">
            <SettingSwitch
              aria-label={t("Enable {name}", { name: item.name })}
              checked={item.enabled}
              disabled={busy}
              onCheckedChange={(enabled) => onToggle(item, enabled)}
            />
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={t("More actions for {p0}", { p0: item.name })}
                  disabled={busy}
                >
                  <MoreVertical className="tw-size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => onEdit(item)}>
                  <Pencil className="tw-size-4" />
                  {t("Edit")}
                </DropdownMenuItem>
                <DropdownMenuItem className="tw-text-error" onSelect={() => onRemove(item)}>
                  <Trash2 className="tw-size-4" />
                  {t("Delete")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      ))}
    </div>
  );
}
