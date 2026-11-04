import React from "react";
import { SettingItem } from "@/components/ui/setting-item";
import type { NativeBackendSettings } from "@/settings/model";
import type { EnabledModelEntry } from "@/agentMode/session/types";
import { t } from "@/lib/i18n";

export interface NativeSettingsFormProps {
  settings: NativeBackendSettings;
  models: readonly EnabledModelEntry[];
  onChange: (patch: Partial<NativeBackendSettings>) => void;
}

export function NativeSettingsForm({ settings, models, onChange }: NativeSettingsFormProps) {
  const selectedModelId = settings.defaultModel?.baseModelId ?? "";
  const options = [
    { value: "", label: t("Use the chat default model") },
    ...models.map((model) => ({ value: model.baseModelId, label: model.name })),
  ];
  if (selectedModelId && !models.some((model) => model.baseModelId === selectedModelId)) {
    options.push({
      value: selectedModelId,
      label: t("Unavailable model: {id}", { id: selectedModelId }),
    });
  }
  return (
    <>
      <SettingItem
        type="select"
        title={t("Default model")}
        value={selectedModelId}
        options={options}
        onChange={(baseModelId) =>
          onChange({ defaultModel: baseModelId ? { baseModelId, effort: null } : null })
        }
      />
      <SettingItem
        type="select"
        title={t("Default permission mode")}
        value={settings.defaultMode ?? "default"}
        options={[
          { value: "default", label: t("Ask before acting") },
          { value: "plan", label: t("Plan first") },
          { value: "auto", label: t("Automatically allow note edits") },
        ]}
        onChange={(value) => {
          if (value === "default" || value === "plan" || value === "auto")
            onChange({ defaultMode: value });
        }}
      />
      <SettingItem
        type="number"
        title={t("Maximum steps per turn")}
        description={t("Choose 1–1000 steps. Send another message to continue after the limit.")}
        value={settings.maxSteps ?? 50}
        onChange={(value) => {
          const maxSteps = Number(value);
          if (Number.isInteger(maxSteps) && maxSteps >= 1 && maxSteps <= 1000)
            onChange({ maxSteps });
        }}
      />
    </>
  );
}
