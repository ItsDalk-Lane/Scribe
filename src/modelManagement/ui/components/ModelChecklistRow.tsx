import { t } from "@/lib/i18n";
import {
  isChatModelInfo,
  capabilitiesFromConfiguredInfo,
} from "@/modelManagement/chatModel/modelCapabilityFlags";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ModelCapabilityIcons, hasCapabilityIcons } from "@/components/ui/model-display";
import {
  ModelModalityIcons,
  ModelStatusBadge,
} from "@/modelManagement/ui/components/ModelMetaBadges";
import { isModelSelectable } from "@/modelManagement/ui/utils/modelConfigForm";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import { formatContextWindow } from "@/modelManagement/ui/utils/formatModelMetadata";
import { Pencil, X } from "lucide-react";
import React from "react";

export interface ModelChecklistRowProps {
  model: ModelInfo;
  checked: boolean;
  onToggle: (id: string, next: boolean) => void;
  isLastChecked?: boolean;
  removable?: boolean;
  onRemoveId?: (id: string) => void;
  onEdit?: (model: ModelInfo) => void;
}

export const ModelChecklistRow: React.FC<ModelChecklistRowProps> = ({
  model,
  checked,
  onToggle,
  isLastChecked,
  removable,
  onRemoveId,
  onEdit,
}) => {
  const contextLabel = formatContextWindow(model.limits?.context);
  const capabilities = capabilitiesFromConfiguredInfo(model);
  // 弃用模型不可新增选择；已勾选（已配置）的保留可取消勾选以便移除。https://github.com/ItsDalk-Lane/Scribe/issues/67
  const selectable = isModelSelectable(model, checked);
  const hasTrailingActions = removable || onEdit !== undefined;
  return (
    <label
      role="listitem"
      data-testid={`model-row-${model.id}`}
      className={cn(
        "tw-group tw-grid tw-cursor-pointer tw-items-center tw-gap-2 tw-p-3 tw-text-sm",
        "hover:tw-bg-modifier-hover",
        hasTrailingActions
          ? "tw-grid-cols-[auto_minmax(0,1fr)_auto]"
          : "tw-grid-cols-[auto_minmax(0,1fr)]",
        isLastChecked && "scribe-divider-b"
      )}
    >
      <Checkbox
        checked={checked}
        disabled={!selectable}
        onCheckedChange={(next) => {
          if (!selectable) return;
          onToggle(model.id, next === true);
        }}
      />
      <span className="tw-flex tw-min-w-0 tw-flex-wrap tw-items-center tw-gap-2">
        <span className="tw-min-w-0 tw-break-words tw-text-normal">{model.displayName}</span>
        {model.isEmbedding && (
          <Badge variant={"secondary"} className="tw-shrink-0 tw-text-ui-smaller">
            {t("Embedding")}
          </Badge>
        )}

        {!model.isEmbedding && !isChatModelInfo(model) && (
          <Badge variant={"secondary"} className="tw-shrink-0 tw-text-ui-smaller">
            {t("Non-chat")}
          </Badge>
        )}
        <ModelStatusBadge status={model.status} />
        {hasCapabilityIcons(capabilities) && (
          <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-0.5">
            <ModelCapabilityIcons capabilities={capabilities} iconSize={14} />
          </span>
        )}
        {contextLabel && (
          <span
            data-testid={`model-row-context-${model.id}`}
            className={cn(
              "tw-shrink-0 tw-rounded tw-border tw-border-solid tw-border-border",
              "tw-bg-secondary tw-px-1.5 tw-text-ui-smaller tw-leading-5 tw-text-muted"
            )}
          >
            {contextLabel}
          </span>
        )}
        <ModelModalityIcons info={model} iconSize={14} />
      </span>
      {hasTrailingActions && (
        <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-1">
          {onEdit && (
            <Button
              variant={"ghost"}
              size={"icon"}
              aria-label={t("Configure {id}", { id: model.id })}
              data-testid={`model-row-edit-${model.id}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onEdit(model);
              }}
            >
              <Pencil className="tw-size-4" />
            </Button>
          )}
          {removable && (
            <Button
              variant={"ghost"}
              size={"icon"}
              aria-label={t("Remove {id}", { id: model.id })}
              data-testid={`model-row-remove-${model.id}`}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onRemoveId?.(model.id);
              }}
            >
              <X className="tw-size-4" />
            </Button>
          )}
        </span>
      )}
    </label>
  );
};
