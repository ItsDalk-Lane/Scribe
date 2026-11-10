import { t } from "@/lib/i18n";
import { ProviderVerificationStatus } from "@/modelManagement/ui/components/ProviderVerificationStatus";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";
import { DestinationIcon } from "@/components/ui/DestinationIcon";
import { providerDestination } from "@/modelManagement/providers/providerDestination";
import { isProviderModelsEnabled } from "@/modelManagement/providers/providerEnablement";
import { SettingSwitch } from "@/components/ui/setting-switch";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import { useModelManagement } from "@/modelManagement/ui/ModelManagementContext";
import { providerRequiresApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import { ChevronRight, Pencil, Settings2, Trash2, XIcon } from "lucide-react";
import {
  ModelModalityIcons,
  ModelStatusBadge,
} from "@/modelManagement/ui/components/ModelMetaBadges";
import { formatContextWindow } from "@/modelManagement/ui/utils/formatModelMetadata";
import { Notice } from "obsidian";
import React, { useState } from "react";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

export interface ProviderModelGroup {
  provider: Provider;
  models: ConfiguredModel[];
  verification?: VerificationResult;
}

interface ProviderModelTableProps {
  groups: readonly ProviderModelGroup[];
  onConfigure: (providerId: string) => void;
  onRemove: (providerId: string) => void;
  onEditModel?: (configuredModelId: string) => void;
  emptyMessage?: React.ReactNode;
}

export const ProviderModelTable: React.FC<ProviderModelTableProps> = ({
  groups,
  onConfigure,
  onRemove,
  onEditModel,
  emptyMessage,
}) => {
  if (groups.length === 0) {
    return (
      <div
        className={cn(
          "tw-flex tw-flex-col tw-items-center tw-justify-center",
          "tw-rounded-md tw-border tw-border-solid tw-border-border tw-p-6",
          "tw-text-center tw-text-sm tw-text-muted"
        )}
        data-testid="byok-table-empty"
      >
        {emptyMessage ?? t("No providers yet — click + Add a provider to start.")}
      </div>
    );
  }

  return (
    <div className="tw-group/settings tw-flex tw-w-full tw-flex-col tw-gap-3" role="list">
      {groups.map((group) => (
        <ProviderCard
          key={group.provider.providerId}
          group={group}
          onConfigure={() => onConfigure(group.provider.providerId)}
          onRemove={() => onRemove(group.provider.providerId)}
          onEditModel={onEditModel}
        />
      ))}
    </div>
  );
};

interface ProviderCardProps {
  group: ProviderModelGroup;
  onConfigure: () => void;
  onRemove: () => void;
  onEditModel?: (configuredModelId: string) => void;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  group,
  onConfigure,
  onRemove,
  onEditModel,
}) => {
  const { provider, models } = group;
  const [isOpen, setIsOpen] = useState(false);
  const api = useModelManagement();
  const app = useApp();

  const handleRemoveModel = async (configuredModelId: string, modelName: string): Promise<void> => {
    const modal = new ConfirmModal(
      app,
      async () => {
        try {
          await api.coordinator.removeConfiguredModel(configuredModelId);
        } catch (err) {
          logError("[ProviderModelTable] removeConfiguredModel failed", err);
          new Notice(t("Failed to remove model."));
        }
      },
      t("Remove {modelName} from {displayName}?", {
        modelName: modelName,
        displayName: provider.displayName,
      }),
      t("Remove model"),
      t("Remove"),
      t("Cancel")
    );
    modal.open();
  };

  const getSubLine = (): string => {
    if (!providerRequiresApiKey(provider)) {
      return t("No API key required");
    }
    if (models.length === 0) {
      return t("No models added");
    }
    return models.length === 1
      ? t("{count} model", { count: models.length })
      : t("{count} models", { count: models.length });
  };

  const toggleProviderModels = (included: boolean): void => {
    safeAsyncHandler(async () => {
      try {
        await api.providerRegistry.update(provider.providerId, { enabled: included });
      } catch (err) {
        logError("[ProviderModelTable] provider enablement update failed", err);
        new Notice(t("Failed to update provider."));
      }
    })();
  };

  const included = isProviderModelsEnabled(provider);

  return (
    <Collapsible open={isOpen} onOpenChange={setIsOpen}>
      <div
        className={cn(
          "tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-transparent",
          "tw-overflow-hidden"
        )}
        role="listitem"
        data-testid={`byok-provider-${provider.providerId}`}
      >
        <CollapsibleTrigger asChild>
          <div
            role="button"
            tabIndex={0}
            aria-expanded={isOpen}
            className={cn(
              "tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-2 tw-p-3",
              "tw-transition-colors hover:tw-bg-modifier-hover",
              "focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
            )}
            onClick={() => setIsOpen(!isOpen)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                setIsOpen(!isOpen);
              }
            }}
          >
            <ChevronRight
              className={cn(
                "tw-size-4 tw-shrink-0 tw-text-muted tw-transition-transform tw-duration-200",
                isOpen && "tw-rotate-90"
              )}
              aria-hidden="true"
            />
            <div className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-1">
              <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
                <span
                  className={cn(
                    "tw-break-words tw-text-sm tw-font-medium tw-text-normal",
                    !included && "tw-opacity-60"
                  )}
                >
                  {provider.displayName}
                </span>
                <DestinationIcon destination={providerDestination(provider)} />
              </span>
              <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-1">
                <span className="tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
                  {getSubLine()}
                </span>
                <ProviderVerificationStatus result={group.verification} />
              </div>
            </div>
            {/* 点击与键盘事件不外抛，避免开关误触卡片折叠。https://github.com/ItsDalk-Lane/Scribe/issues/69 */}
            <div
              className="tw-flex tw-shrink-0 tw-items-center"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <SettingSwitch
                checked={included}
                aria-label={t("Include {displayName} models in model selectors", {
                  displayName: provider.displayName,
                })}
                title={t("Include {displayName} models in model selectors", {
                  displayName: provider.displayName,
                })}
                onCheckedChange={(next) => toggleProviderModels(next)}
              />
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="tw-shrink-0"
              aria-label={t("Configure {displayName}", { displayName: provider.displayName })}
              title={t("Edit key")}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onConfigure();
              }}
            >
              <Settings2 className="tw-size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="tw-shrink-0 tw-text-muted hover:tw-text-error group-[]/settings:hover:!tw-text-error"
              aria-label={t("Remove {displayName}", { displayName: provider.displayName })}
              title={t("Remove")}
              onKeyDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
            >
              <Trash2 className="tw-size-4" />
            </Button>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent className="tw-overflow-hidden tw-transition-all tw-duration-200 data-[state=open]:tw-animate-in data-[state=closed]:tw-animate-out data-[state=closed]:tw-fade-out-0 data-[state=open]:tw-fade-in-0 data-[state=closed]:tw-slide-out-to-top-1 data-[state=open]:tw-slide-in-from-top-1">
          {models.length > 0 && (
            <div className="tw-flex tw-flex-col tw-pb-2">
              {models.map((model) => (
                <ModelRow
                  key={model.configuredModelId}
                  model={model}
                  onRemove={safeAsyncHandler(() =>
                    handleRemoveModel(model.configuredModelId, model.info.displayName)
                  )}
                  onEdit={onEditModel ? () => onEditModel(model.configuredModelId) : undefined}
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

const ModelRow: React.FC<{
  model: ConfiguredModel;
  onRemove: () => void;
  onEdit?: () => void;
}> = ({ model, onRemove, onEdit }) => {
  return (
    <div
      role="listitem"
      data-testid={`byok-model-${model.configuredModelId}`}
      className={cn(
        "tw-group tw-relative tw-flex tw-items-center tw-gap-2",
        "tw-px-3 tw-py-1.5 tw-pl-10 tw-text-sm tw-text-normal",
        "tw-transition-colors hover:tw-bg-modifier-hover"
      )}
    >
      <span className="tw-flex tw-min-w-0 tw-flex-1 tw-flex-wrap tw-items-center tw-gap-2 tw-break-words">
        <span>{model.info.displayName}</span>
        <ModelStatusBadge status={model.info.status} />
        {formatContextWindow(model.info.limits?.context) && (
          <span className="tw-shrink-0 tw-rounded tw-border tw-border-solid tw-border-border tw-bg-secondary tw-px-1.5 tw-text-ui-smaller tw-leading-5 tw-text-muted">
            {formatContextWindow(model.info.limits?.context)}
          </span>
        )}
        <ModelModalityIcons info={model.info} iconSize={13} />
      </span>
      {onEdit && (
        <Button
          variant="ghost"
          size="icon"
          className={cn(
            "tw-size-7 tw-shrink-0 tw-text-muted hover:tw-text-normal",
            "tw-opacity-0 tw-transition-opacity group-hover:tw-opacity-100",
            "focus-visible:tw-opacity-100 focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
          )}
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          aria-label={t("Configure {displayName}", { displayName: model.info.displayName })}
          tabIndex={0}
        >
          <Pencil className="tw-size-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        className={cn(
          "tw-size-7 tw-shrink-0 tw-text-muted hover:tw-text-error group-[]/settings:hover:!tw-text-error",
          "tw-opacity-0 tw-transition-opacity group-hover:tw-opacity-100",
          "focus-visible:tw-opacity-100 focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
        )}
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        aria-label={t("Remove {displayName}", { displayName: model.info.displayName })}
        tabIndex={0}
      >
        <XIcon className="tw-size-4" />
      </Button>
    </div>
  );
};
