import { t } from "@/lib/i18n";
import {
  chatBackendPickerAtom,
  capabilitiesFromConfiguredInfo,
  mapProviderTypeToChatModelProvider,
  providerRequiresApiKey,
  resolveChatModelSelectionId,
} from "@/modelManagement";
import { getModelKeyFromModel, settingsStore } from "@/settings/model";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { useAtomValue } from "jotai";
import React from "react";

export interface ChatModelPickerOverride {
  models: ModelSelectorEntry[];
  value: string;
  onChange: (modelKey: string) => void;
}

const NOOP = () => {};

const EMPTY_ENTRY: ModelSelectorEntry = {
  name: "__chat_no_models__",
  provider: "",
  get displayName() {
    return t("No models — configure one in Models");
  },
  enabled: true,
  get _disabledReason() {
    return t("Add a model");
  },
};
const EMPTY_ENTRY_KEY = getModelKeyFromModel(EMPTY_ENTRY);

// 稳定排序保持同组内的配置顺序，组间按显示名排列。https://github.com/ItsDalk-Lane/Scribe/issues/69
function byGroupLabel(a: ModelSelectorEntry, b: ModelSelectorEntry): number {
  const aGroup = a._group ?? "";
  const bGroup = b._group ?? "";
  return aGroup === bGroup ? 0 : aGroup < bGroup ? -1 : 1;
}

export function useChatModelPicker(params: {
  value: string | undefined;
  fallbackToFirst?: boolean;
  onChange: (configuredModelId: string) => void;
}): ChatModelPickerOverride {
  const { value, onChange, fallbackToFirst = true } = params;
  const entries = useAtomValue(chatBackendPickerAtom, { store: settingsStore });
  const { models, byModelKey, idToModelKey } = React.useMemo(() => {
    const models: ModelSelectorEntry[] = [];
    const byModelKey = new Map<string, string>();
    const idToModelKey = new Map<string, string>();
    for (const entry of entries) {
      if (entry.state !== "ok") continue;
      const { configuredModel, provider, configuredModelId } = entry;
      const capabilities = capabilitiesFromConfiguredInfo(configuredModel.info);
      const needsKey = providerRequiresApiKey(provider) && !provider.apiKeyRef;
      const modelEntry: ModelSelectorEntry = {
        name: configuredModelId,
        provider: mapProviderTypeToChatModelProvider(provider),
        displayName: configuredModel.info.displayName || configuredModel.info.id,
        enabled: true,
        capabilities,
        _group: provider.displayName,
        _disabledReason: needsKey ? t("Add API key") : undefined,
      };
      const modelKey = getModelKeyFromModel(modelEntry);
      models.push(modelEntry);
      byModelKey.set(modelKey, configuredModelId);
      idToModelKey.set(configuredModelId, modelKey);
    }
    // 分组头只在相邻同名组渲染一次，这里预先按供应商排序保证组内连续。https://github.com/ItsDalk-Lane/Scribe/issues/69
    models.sort(byGroupLabel);
    return { models, byModelKey, idToModelKey };
  }, [entries]);

  const resolvedValue = React.useMemo(() => {
    const resolvedId = resolveChatModelSelectionId(entries, value, fallbackToFirst);
    return (resolvedId && idToModelKey.get(resolvedId)) || "";
  }, [entries, value, idToModelKey, fallbackToFirst]);

  const handleChange = React.useCallback(
    (modelKey: string) => {
      const id = byModelKey.get(modelKey);
      if (id) onChange(id);
    },
    [byModelKey, onChange]
  );

  if (models.length === 0) {
    return { models: [EMPTY_ENTRY], value: EMPTY_ENTRY_KEY, onChange: NOOP };
  }

  return {
    models,
    value: resolvedValue,
    onChange: handleChange,
  };
}
