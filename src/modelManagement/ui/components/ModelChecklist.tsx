import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import { ModelChecklistRow } from "@/modelManagement/ui/components/ModelChecklistRow";
import { orderCatalogModels } from "@/modelManagement/ui/utils/orderCatalogModels";
import { Loader2, XCircle } from "lucide-react";
import React, { useMemo, useState } from "react";

export interface ModelChecklistProps {
  availableModels: readonly ModelInfo[];
  selected: ReadonlySet<string>;
  onToggle: (id: string, next: boolean) => void;
  onAddId: (id: string) => void;
  onRemoveId?: (id: string) => void;
  modelInputHint?: string;
  fetching?: boolean;
  fetchError?: string | null;
  customIds?: ReadonlySet<string>;
}

export const ModelChecklist: React.FC<ModelChecklistProps> = ({
  availableModels,
  selected,
  onToggle,
  onAddId,
  onRemoveId,
  modelInputHint,
  fetching,
  fetchError,
  customIds,
}) => {
  const [manualId, setManualId] = useState("");
  const [query, setQuery] = useState("");

  const filtered = useMemo<readonly ModelInfo[]>(() => {
    const needle = query?.trim().toLowerCase();
    const all = needle
      ? availableModels.filter(
          (m) => m.displayName.toLowerCase().includes(needle) || m.id.toLowerCase().includes(needle)
        )
      : availableModels;
    return orderCatalogModels(all, selected, customIds);
  }, [availableModels, query, selected, customIds]);

  const checkedCount = filtered.reduce((n, m) => (selected.has(m.id) ? n + 1 : n), 0);

  const handleManualAdd = (): void => {
    const id = manualId.trim();
    if (!id) return;
    onAddId(id);
    setManualId("");
  };

  return (
    <div className="tw-group/settings tw-flex tw-flex-col tw-gap-2">
      <FormField label={t("Model ID")}>
        <div className="tw-flex tw-gap-2">
          <Input
            className="tw-flex-1"
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                handleManualAdd();
              }
            }}
            placeholder={modelInputHint ? t(modelInputHint) : t("Enter a model ID")}
            data-testid="model-checklist-manual-input"
          />
          <Button variant="secondary" onClick={handleManualAdd} disabled={!manualId.trim()}>
            {t("Add")}
          </Button>
        </div>
      </FormField>

      <SearchBar value={query} onChange={setQuery} placeholder={t("Search available models…")} />

      {fetching && (
        <div className="tw-flex tw-items-center tw-gap-2 tw-text-xs tw-text-muted">
          <Loader2 className="tw-size-3.5 tw-shrink-0 tw-animate-spin" />
          <span>{t("Loading models…")}</span>
        </div>
      )}

      {fetchError && (
        <div className="tw-flex tw-items-center tw-gap-1.5 tw-text-xs tw-text-error">
          <XCircle className="tw-size-3.5 tw-shrink-0" />
          <span>{fetchError}</span>
        </div>
      )}

      {filtered.length > 0 ? (
        <div
          className="tw-flex tw-flex-col tw-rounded-md tw-border tw-border-solid tw-border-border"
          role={"list"}
          data-testid={"model-checklist"}
        >
          {filtered.map((model, index) => (
            <ModelChecklistRow
              key={model.id}
              model={model}
              checked={selected.has(model.id)}
              onToggle={onToggle}
              isLastChecked={index === checkedCount - 1 && checkedCount < filtered.length}
              removable={onRemoveId !== undefined && customIds?.has(model.id) === true}
              onRemoveId={onRemoveId}
            />
          ))}
        </div>
      ) : (
        <div
          className={cn(
            "tw-rounded-md tw-border tw-border-dashed tw-border-border tw-p-4",
            "tw-text-center tw-text-sm tw-text-muted"
          )}
          data-testid={"model-checklist-empty"}
        >
          {fetching
            ? t("Loading models…")
            : query.trim()
              ? t("No models match the current filters.")
              : t("No models discovered — enter a model ID above or fetch models.")}
        </div>
      )}
    </div>
  );
};
