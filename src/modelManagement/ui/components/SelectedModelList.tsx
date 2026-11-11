import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import { ModelChecklistRow } from "@/modelManagement/ui/components/ModelChecklistRow";
import { orderCatalogModels } from "@/modelManagement/ui/utils/orderCatalogModels";
import React, { useMemo } from "react";

export interface SelectedModelListProps {
  availableModels: readonly ModelInfo[];
  selected: ReadonlySet<string>;
  onToggle: (id: string, next: boolean) => void;
  onEdit?: (model: ModelInfo) => void;
}

export const SelectedModelList: React.FC<SelectedModelListProps> = ({
  availableModels,
  selected,
  onToggle,
  onEdit,
}) => {
  const selectedModels = useMemo<readonly ModelInfo[]>(
    () =>
      orderCatalogModels(
        availableModels.filter((model) => selected.has(model.id)),
        selected
      ),
    [availableModels, selected]
  );

  if (selectedModels.length === 0) {
    return (
      <div
        className={cn(
          "tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-4",
          "tw-text-center tw-text-sm tw-text-muted"
        )}
        data-testid={"selected-model-list-empty"}
      >
        {t("No models added")}
      </div>
    );
  }

  return (
    <div
      className="tw-flex tw-flex-col tw-rounded-md tw-border tw-border-solid tw-border-border"
      role={"list"}
      data-testid={"selected-model-list"}
    >
      {selectedModels.map((model) => (
        <ModelChecklistRow
          key={model.id}
          model={model}
          checked
          onToggle={onToggle}
          onEdit={onEdit}
        />
      ))}
    </div>
  );
};
