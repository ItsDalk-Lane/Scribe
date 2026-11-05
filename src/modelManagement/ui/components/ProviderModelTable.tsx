import { t } from "@/lib/i18n";
import { ProviderVerificationStatus } from "@/modelManagement/ui/components/ProviderVerificationStatus";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { DestinationIcon } from "@/components/ui/DestinationIcon";
import { providerDestination } from "@/modelManagement/providers/providerDestination";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import { useModelManagement } from "@/modelManagement/ui/ModelManagementContext";
import { providerRequiresApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import { ChevronRight, MoreVertical, Settings2, Trash2, XIcon } from "lucide-react";
import { Notice } from "obsidian";
import React, { useRef, useState } from "react";
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
  emptyMessage?: React.ReactNode;
}

export const ProviderModelTable: React.FC<ProviderModelTableProps> = ({
  groups,
  onConfigure,
  onRemove,
  emptyMessage,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

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
    <div
      ref={containerRef}
      className="tw-group/settings tw-flex tw-w-full tw-flex-col tw-gap-3"
      role="list"
    >
      {groups.map((group) => (
        <ProviderCard
          key={group.provider.providerId}
          group={group}
          onConfigure={() => onConfigure(group.provider.providerId)}
          onRemove={() => onRemove(group.provider.providerId)}
          containerRef={containerRef}
        />
      ))}
    </div>
  );
};

interface ProviderCardProps {
  group: ProviderModelGroup;
  onConfigure: () => void;
  onRemove: () => void;
  containerRef: React.RefObject<HTMLDivElement>;
}

const ProviderCard: React.FC<ProviderCardProps> = ({
  group,
  onConfigure,
  onRemove,
  containerRef,
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
            <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-1">
              <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
                <span className="tw-break-words tw-text-sm tw-font-medium tw-text-normal">
                  {provider.displayName}
                </span>
                <DestinationIcon destination={providerDestination(provider)} />
              </span>
              <span className="tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
                {getSubLine()}
              </span>
            </div>
            <div className="tw-flex-1" />
            <ProviderVerificationStatus result={group.verification} />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={(e) => e.stopPropagation()}
                  aria-label={t("More actions for {displayName}", {
                    displayName: provider.displayName,
                  })}
                  className="tw-shrink-0"
                >
                  <MoreVertical className="tw-size-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" container={containerRef.current}>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onConfigure();
                  }}
                >
                  <Settings2 className="tw-mr-2 tw-size-4" />
                  {t("Edit key")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemove();
                  }}
                  className="tw-text-error"
                >
                  <Trash2 className="tw-mr-2 tw-size-4" />
                  {t("Remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
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
                />
              ))}
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
};

const ModelRow: React.FC<{ model: ConfiguredModel; onRemove: () => void }> = ({
  model,
  onRemove,
}) => {
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
      <span className="tw-min-w-0 tw-flex-1 tw-break-words">{model.info.displayName}</span>
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
