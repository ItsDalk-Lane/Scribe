import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { SegmentedControl } from "@/components/ui/segmented-control";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ModelManagementProvider,
  useModelManagement,
} from "@/modelManagement/ui/ModelManagementContext";
import type { ModelManagementApi } from "@/modelManagement/createModelManagement";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import {
  buildModelInfoPatch,
  formStateFromCatalogDefault,
  formStateFromInfo,
  hasCostConfig,
  parseLimitInput,
  type ModelCapabilityFormState,
} from "@/modelManagement/ui/utils/modelConfigForm";
import { ReactModal } from "@/components/modals/ReactModal";
import { Badge } from "@/components/ui/badge";
import {
  AudioLines,
  ChevronDown,
  FileText,
  Image,
  Loader2,
  Plus,
  RefreshCw,
  Text,
  Video,
} from "lucide-react";
import { Notice, type App } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";

const INPUT_MODALITY_OPTIONS = ["text", "image", "pdf", "video", "audio"] as const;
const OUTPUT_MODALITY_OPTIONS = ["text", "image", "audio", "video"] as const;
const MODALITY_ICONS = { text: Text, image: Image, pdf: FileText, video: Video, audio: AudioLines };
const MODALITY_LABELS = {
  text: "Text",
  image: "Image",
  pdf: "PDF",
  video: "Video",
  audio: "Audio",
};

const CONTEXT_PRESETS = ["64K", "128K", "200K", "256K", "512K", "1M"] as const;
const OUTPUT_PRESETS = ["8K", "16K", "32K", "64K", "128K", "256K"] as const;
const INPUT_PRESETS = CONTEXT_PRESETS;

export interface ModelConfigModalOptions {
  provider: Provider;
  configuredModel: ConfiguredModel;
  api: ModelManagementApi;
  onSaved?: () => void;
}

export class ModelConfigModal extends ReactModal {
  constructor(
    app: App,
    private readonly opts: ModelConfigModalOptions
  ) {
    super(app);
  }

  onOpen(): void {
    this.modalEl.addClasses(["tw-flex", "tw-max-h-[85vh]", "tw-flex-col"]);
    this.contentEl.addClasses([
      "tw-flex",
      "tw-min-h-0",
      "tw-flex-1",
      "tw-flex-col",
      "tw-overflow-hidden",
    ]);
    super.onOpen();
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <ModelManagementProvider api={this.opts.api}>
        <ModelConfigForm
          provider={this.opts.provider}
          configuredModel={this.opts.configuredModel}
          onClose={close}
          onSaved={this.opts.onSaved}
        />
      </ModelManagementProvider>
    );
  }
}

interface ModelConfigFormProps {
  provider: Provider;
  configuredModel: ConfiguredModel;
  onClose: () => void;
  onSaved?: () => void;
}

export const ModelConfigForm: React.FC<ModelConfigFormProps> = ({
  provider,
  configuredModel,
  onClose,
  onSaved,
}) => {
  const api = useModelManagement();
  const catalogProviderId =
    provider.origin.kind === "byok" ? provider.origin.catalogProviderId : undefined;

  const [catalogVersion, setCatalogVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const bump = (): void => {
      if (!cancelled) setCatalogVersion((v) => v + 1);
    };
    const unsub = api.catalogService.onChange(bump);
    api.catalogService
      .ensureLoaded()
      .then(bump)
      .catch((err) => logError("[ModelConfigDialog] catalog ensureLoaded failed", err));
    return () => {
      cancelled = true;
      unsub();
    };
  }, [api]);

  const catalogEntry = useMemo<ModelInfo | undefined>(() => {
    void catalogVersion;
    if (!catalogProviderId) return undefined;
    return api.catalogService.getProvider(catalogProviderId)?.models[configuredModel.info.id];
  }, [api, catalogProviderId, configuredModel.info.id, catalogVersion]);

  const [form, setForm] = useState<ModelCapabilityFormState>(() =>
    formStateFromInfo(configuredModel.info)
  );
  const [saving, setSaving] = useState(false);
  const [addingEffort, setAddingEffort] = useState(false);
  const [effortDraft, setEffortDraft] = useState("");
  const patch = (partial: Partial<ModelCapabilityFormState>): void =>
    setForm((current) => ({ ...current, ...partial }));

  const showCost = hasCostConfig(configuredModel.info);

  const handleApplyDefaults = (): void => {
    if (!catalogEntry) {
      new Notice(t("No catalog defaults found for this model."));
      return;
    }
    setForm(formStateFromCatalogDefault(catalogEntry));
  };

  const handleSave = async (): Promise<void> => {
    setSaving(true);
    try {
      await api.configuredModelRegistry.update(configuredModel.configuredModelId, {
        info: buildModelInfoPatch(form),
      });
      onSaved?.();
      onClose();
    } catch (err) {
      logError("[ModelConfigDialog] save failed", err);
      new Notice(t("Failed to save the model configuration."));
      setSaving(false);
    }
  };

  const handleToggleModality = (side: "input" | "output", modality: string): void => {
    if (side === "input") {
      patch({
        inputModalities: form.inputModalities.includes(modality)
          ? form.inputModalities.filter((value) => value !== modality)
          : [...form.inputModalities, modality],
      });
      return;
    }
    patch({
      outputModalities: form.outputModalities.includes(modality)
        ? form.outputModalities.filter((value) => value !== modality)
        : [...form.outputModalities, modality],
    });
  };

  const handleContextPreset = (next: string): void => {
    const partial: Partial<ModelCapabilityFormState> = { contextLimit: next };
    // 输入上限通常与上下文一致：仅当输入上限为空时跟随上下文预设，不覆盖已手填的值。https://github.com/ItsDalk-Lane/Scribe/issues/67
    if (form.inputLimit.trim() === "") partial.inputLimit = next;
    patch(partial);
  };

  const toggleEffort = (value: string): void => {
    patch({
      reasoningEfforts: form.reasoningEfforts.includes(value)
        ? form.reasoningEfforts.filter((entry) => entry !== value)
        : [...form.reasoningEfforts, value],
    });
  };

  const confirmAddEffort = (): void => {
    const name = effortDraft.trim();
    if (name.length === 0) return;
    if (!form.reasoningEfforts.includes(name)) {
      patch({ reasoningEfforts: [...form.reasoningEfforts, name] });
    }
    setEffortDraft("");
    setAddingEffort(false);
  };

  const modalityChips = (side: "input" | "output"): React.ReactElement => {
    const options = side === "input" ? INPUT_MODALITY_OPTIONS : OUTPUT_MODALITY_OPTIONS;
    const selected = side === "input" ? form.inputModalities : form.outputModalities;
    return (
      <div
        className="tw-ml-auto tw-flex tw-flex-row-reverse tw-flex-wrap tw-items-center tw-gap-1.5"
        role="group"
        aria-label={t(side === "input" ? "Input modalities" : "Output modalities")}
      >
        {options.map((modality) => {
          const active = selected.includes(modality);
          const Icon = MODALITY_ICONS[modality];
          return (
            <button
              key={modality}
              type="button"
              aria-pressed={active}
              aria-label={t(MODALITY_LABELS[modality])}
              title={t(MODALITY_LABELS[modality])}
              data-testid={`model-config-modality-${side}-${modality}`}
              disabled={saving}
              onClick={() => handleToggleModality(side, modality)}
              className={cn(
                "tw-rounded-full tw-border tw-border-solid tw-px-2.5 tw-py-0.5 tw-text-xs tw-transition-colors",
                active
                  ? "tw-border-interactive-accent !tw-bg-interactive-accent tw-text-on-accent"
                  : "tw-border-border !tw-bg-transparent tw-text-muted hover:tw-text-normal"
              )}
            >
              <Icon className="tw-size-4" aria-hidden="true" />
            </button>
          );
        })}
      </div>
    );
  };

  const switchRow = (
    label: string,
    checked: boolean,
    onChange: (next: boolean) => void,
    testId: string
  ): React.ReactElement => (
    <label
      dir="ltr"
      className="tw-flex tw-shrink-0 tw-cursor-pointer tw-items-center tw-justify-end tw-gap-1.5"
    >
      <SettingSwitch checked={checked} onCheckedChange={onChange} aria-label={label} />
      <span data-testid={testId}>{label}</span>
    </label>
  );

  const limitCombo = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    presets: readonly string[],
    testId: string
  ): React.ReactElement => (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-1.5">
      <span className="tw-text-ui-smaller tw-text-muted">{label}</span>
      <div className="tw-flex tw-min-w-0">
        <Input
          className={cn(
            "tw-min-w-0 tw-flex-1 tw-rounded-r-none",
            value.trim() !== "" && parseLimitInput(value) === undefined && "tw-border-error"
          )}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          data-testid={testId}
          aria-label={label}
          disabled={saving}
        />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="secondary"
              className="tw-w-8 tw-shrink-0 tw-rounded-l-none tw-border tw-border-l-0 tw-border-solid tw-border-border tw-px-0"
              aria-label={t("Choose a {label} preset", { label })}
              disabled={saving}
              tabIndex={-1}
            >
              <ChevronDown className="tw-size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start">
            {presets.map((preset) => (
              <DropdownMenuItem key={preset} onSelect={() => onChange(preset)}>
                {preset}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );

  const costField = (
    label: string,
    value: string,
    onChange: (next: string) => void,
    testId: string
  ): React.ReactElement => (
    <label className="tw-flex tw-min-w-0 tw-flex-col tw-gap-1">
      <span className="tw-text-ui-smaller tw-text-muted">{label}</span>
      <Input
        className="tw-w-full"
        type="number"
        min={0}
        step={0.01}
        value={value}
        placeholder={t("Not configured")}
        aria-label={label}
        data-testid={testId}
        disabled={saving}
        onChange={(e) => onChange(e.target.value)}
      />
    </label>
  );

  return (
    <div className="tw-group/settings tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-4 tw-overflow-hidden">
      <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-3 tw-border-b tw-border-border tw-px-2 tw-pb-3">
        <div className="tw-flex tw-min-w-0 tw-flex-col">
          <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
            <span className="tw-truncate tw-text-base tw-font-semibold tw-text-normal">
              {t("Model configuration")} · {configuredModel.info.displayName}
            </span>
            {configuredModel.info.status === "deprecated" && (
              <Badge variant="destructive" className="tw-shrink-0 tw-text-ui-smaller">
                {t("Deprecated")}
              </Badge>
            )}
          </span>
          <span className="tw-mt-0.5 tw-text-ui-smaller tw-text-muted">
            {provider.displayName}
            {catalogEntry ? t(" · Auto-filled from the catalog; edit freely.") : ""}
          </span>
        </div>
        <Button
          variant="secondary"
          size="sm"
          className="tw-ml-auto tw-shrink-0 tw-gap-1.5"
          disabled={saving}
          onClick={handleApplyDefaults}
          data-testid="model-config-defaults"
        >
          <RefreshCw className="tw-size-3.5" />
          {t("Defaults")}
        </Button>
      </div>

      <div className="tw-flex tw-min-h-0 tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-6 tw-overflow-y-auto tw-px-2 tw-py-1 tw-@container">
        <div className="tw-flex tw-flex-col">
          <div className="tw-font-medium tw-text-normal">{t("Modalities")}</div>
          <div className="tw-mt-3 tw-flex tw-flex-col tw-gap-2.5">
            <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
              <span className="tw-w-36 tw-shrink-0">{t("Input modalities")}</span>
              {modalityChips("input")}
            </div>
            <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
              <span className="tw-w-36 tw-shrink-0">{t("Output modalities")}</span>
              {modalityChips("output")}
            </div>
          </div>
        </div>

        <div className="tw-flex tw-flex-col">
          <div className="tw-font-medium tw-text-normal">{t("Capability toggles")}</div>
          <div className="tw-mt-3 tw-flex tw-flex-row-reverse tw-flex-wrap tw-gap-3">
            {switchRow(
              t("File"),
              form.attachment,
              (next) => patch({ attachment: next }),
              "model-config-attachment"
            )}
            {switchRow(
              t("Tools"),
              form.toolCall,
              (next) => patch({ toolCall: next }),
              "model-config-tool-call"
            )}
            {switchRow(
              t("Reasoning capability"),
              form.reasoning,
              (next) => patch({ reasoning: next }),
              "model-config-reasoning"
            )}
            {switchRow(
              t("Temperature"),
              form.temperature,
              (next) => patch({ temperature: next }),
              "model-config-temperature"
            )}
            {switchRow(
              t("Structured"),
              form.structuredOutput,
              (next) => patch({ structuredOutput: next }),
              "model-config-structured-output"
            )}
          </div>
          {form.reasoning && (
            <div className="tw-mt-4 tw-flex tw-flex-wrap tw-items-center tw-gap-2">
              <span className="tw-w-36 tw-shrink-0">{t("Reasoning efforts")}</span>
              <div className="tw-ml-auto tw-flex tw-flex-row-reverse tw-flex-wrap tw-items-center tw-gap-1.5">
                {form.reasoningEfforts.map((effort) => (
                  <button
                    key={effort}
                    type="button"
                    aria-pressed="true"
                    data-testid={`model-config-effort-${effort}`}
                    disabled={saving}
                    onClick={() => toggleEffort(effort)}
                    className={cn(
                      "tw-rounded-full tw-border tw-border-solid tw-px-2.5 tw-py-0.5 tw-text-xs tw-transition-colors",
                      "tw-border-interactive-accent !tw-bg-interactive-accent tw-text-on-accent"
                    )}
                  >
                    {effort}
                  </button>
                ))}
                {addingEffort ? (
                  <>
                    <Input
                      className="tw-w-32"
                      type="text"
                      value={effortDraft}
                      autoFocus
                      placeholder={t("Custom effort level")}
                      aria-label={t("Custom effort level")}
                      data-testid="model-config-effort-add-input"
                      onChange={(e) => setEffortDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          confirmAddEffort();
                        }
                      }}
                    />
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={confirmAddEffort}
                      data-testid="model-config-effort-add-confirm"
                    >
                      {t("Confirm")}
                    </Button>
                  </>
                ) : (
                  <button
                    type="button"
                    data-testid="model-config-effort-add"
                    disabled={saving}
                    onClick={() => setAddingEffort(true)}
                    className={cn(
                      "tw-rounded-full tw-border tw-border-dashed tw-px-2.5 tw-py-0.5 tw-text-xs tw-transition-colors",
                      "tw-border-interactive-accent !tw-bg-transparent tw-text-accent hover:!tw-bg-secondary"
                    )}
                  >
                    <Plus className="tw-mr-1 tw-inline tw-size-3" />
                    {t("Add effort level")}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="tw-flex tw-flex-col">
          <div className="tw-font-medium tw-text-normal">{t("Limits")}</div>
          <div className="tw-mt-3 tw-grid tw-grid-cols-1 tw-gap-3 @xs:tw-grid-cols-2 @md:tw-grid-cols-3">
            {limitCombo(
              t("Context window"),
              form.contextLimit,
              (next) => {
                patch({ contextLimit: next });
                handleContextPreset(next);
              },
              CONTEXT_PRESETS,
              "model-config-limit-context"
            )}
            {limitCombo(
              t("Max output"),
              form.outputLimit,
              (next) => patch({ outputLimit: next }),
              OUTPUT_PRESETS,
              "model-config-limit-output"
            )}
            {limitCombo(
              t("Max input"),
              form.inputLimit,
              (next) => patch({ inputLimit: next }),
              INPUT_PRESETS,
              "model-config-limit-input"
            )}
          </div>
        </div>

        {showCost && (
          <div className="tw-flex tw-flex-col">
            <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-3 tw-gap-y-2">
              <div className="tw-font-medium tw-text-normal">
                {t("Cost")}
                <span className="tw-text-ui-smaller tw-font-normal tw-text-muted">
                  {t(" (per million tokens)")}
                </span>
              </div>
              <div className="tw-ml-auto tw-flex tw-min-w-0 tw-flex-wrap tw-items-center tw-gap-2">
                <span className="tw-text-ui-smaller tw-text-muted">{t("Billing currency")}</span>
                <SegmentedControl<"USD" | "CNY">
                  aria-label={t("Billing currency")}
                  className="tw-max-w-full [&>button]:!tw-h-auto [&>button]:tw-min-w-0 [&>button]:tw-flex-1 [&>button]:!tw-whitespace-normal"
                  value={form.costCurrency}
                  disabled={saving}
                  options={[
                    { value: "USD" as const, label: t("USD (United States dollar)") },
                    { value: "CNY" as const, label: t("CNY (Chinese yuan)") },
                  ]}
                  onChange={(next) => patch({ costCurrency: next })}
                />
              </div>
            </div>
            <div className="tw-mt-3 tw-grid tw-grid-cols-2 tw-gap-2.5 sm:tw-grid-cols-4">
              {costField(
                t("Input"),
                form.costInput,
                (next) => patch({ costInput: next }),
                "model-config-cost-input"
              )}
              {costField(
                t("Output"),
                form.costOutput,
                (next) => patch({ costOutput: next }),
                "model-config-cost-output"
              )}
              {costField(
                t("Cache read"),
                form.costCacheRead,
                (next) => patch({ costCacheRead: next }),
                "model-config-cost-cache-read"
              )}
              {costField(
                t("Cache write"),
                form.costCacheWrite,
                (next) => patch({ costCacheWrite: next }),
                "model-config-cost-cache-write"
              )}
            </div>
          </div>
        )}

        {form.temperature && (
          <div className="tw-flex tw-flex-col">
            <div className="tw-font-medium tw-text-normal">{t("Temperature")}</div>
            <div className="tw-mt-3 tw-flex tw-flex-wrap tw-items-center tw-gap-x-3 tw-gap-y-2">
              <span className="tw-min-w-0 tw-flex-1">
                {t("Default temperature")}{" "}
                <span className="tw-text-ui-smaller tw-text-muted">
                  {t("Range 0 – 2; leave empty to follow the provider default.")}
                </span>
              </span>
              <Input
                className="tw-ml-auto tw-w-36 tw-max-w-full"
                type="number"
                min={0}
                max={2}
                step={0.1}
                value={form.temperatureValue}
                placeholder={t("Follow provider default")}
                aria-label={t("Default temperature")}
                data-testid="model-config-temperature-value"
                onChange={(e) => patch({ temperatureValue: e.target.value })}
              />
            </div>
          </div>
        )}
      </div>

      <div className="tw-flex tw-shrink-0 tw-flex-wrap tw-items-center tw-gap-3 tw-px-2">
        <span className="tw-text-ui-smaller tw-text-muted">
          {t(
            "Saving writes to this model only; the catalog cache and other models stay unchanged."
          )}
        </span>
        <span className="tw-ml-auto tw-flex tw-gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button
            variant="default"
            onClick={safeAsyncHandler(handleSave)}
            disabled={saving}
            data-testid="model-config-save"
          >
            {saving ? <Loader2 className="tw-size-4 tw-animate-spin" /> : t("Save")}
          </Button>
        </span>
      </div>
    </div>
  );
};
