import React from "react";
import type { CustomCommand } from "@/commands/type";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { t } from "@/lib/i18n";
import { CopyPlus, Trash2 } from "lucide-react";

export interface CommandConfigurationRowProps {
  command: CustomCommand;
  dragHandle?: React.ReactNode;
  onEnabledChange: (enabled: boolean) => void;
  onEdit: () => void;
  onCopy: () => void;
  onDelete: () => void;
}

export function CommandConfigurationRow({
  command,
  dragHandle,
  onEnabledChange,
  onEdit,
  onCopy,
  onDelete,
}: CommandConfigurationRowProps) {
  const description = command.content.trim().replace(/\s+/g, " ");
  return (
    <article
      aria-label={command.title}
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest("button, [role=switch]")) onEdit();
      }}
      className="tw-group/settings tw-flex tw-min-w-0 tw-flex-wrap tw-items-center tw-gap-3 tw-p-3"
    >
      {dragHandle && <div className="tw-shrink-0 tw-self-start">{dragHandle}</div>}
      <div className="tw-min-w-0 tw-flex-1 tw-basis-48 tw-space-y-1.5">
        <button
          type="button"
          aria-label={command.title}
          onClick={onEdit}
          className="!tw-block !tw-h-auto tw-w-full !tw-border-0 !tw-bg-transparent !tw-p-0 tw-text-left !tw-shadow-none focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring"
        >
          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1.5">
            <span className="tw-min-w-0 tw-truncate tw-text-sm tw-font-medium">
              {command.title}
            </span>
            {command.showInContextMenu && (
              <Badge variant="secondary" className="tw-shrink-0">
                {t("Right-click")}
              </Badge>
            )}
            {command.showInSlashMenu && (
              <Badge variant="secondary" className="tw-shrink-0">
                {t("Slash menu")}
              </Badge>
            )}
          </div>
          {description && (
            <p className="tw-m-0 tw-truncate tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
              {description}
            </p>
          )}
        </button>
      </div>
      <div className="tw-ml-auto tw-flex tw-shrink-0 tw-items-center tw-gap-1.5">
        <SettingSwitch
          checked={command.enabled !== false}
          onCheckedChange={onEnabledChange}
          aria-label={t("Enable {name}", { name: command.title })}
        />
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label={t("Duplicate {name}", { name: command.title })}
          onClick={onCopy}
        >
          <CopyPlus aria-hidden="true" className="tw-size-4" />
        </Button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="hover:tw-text-error group-[]/settings:hover:!tw-text-error"
          aria-label={t("Delete {name}", { name: command.title })}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" className="tw-size-4" />
        </Button>
      </div>
    </article>
  );
}
