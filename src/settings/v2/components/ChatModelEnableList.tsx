import { t } from "@/lib/i18n";
import { ModelEnableList, type ModelEnableGroup } from "@/components/ui/ModelEnableList";
import { logError } from "@/logger";
import {
  backendsAtom,
  configuredModelsAtom,
  providersAtom,
  useModelManagement,
} from "@/modelManagement";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import React from "react";
import { buildModelEnableGroups, partitionChatCandidates } from "./configuredModelGrouping";

const EMPTY_ENABLED: readonly string[] = Object.freeze([]);

export const ChatModelEnableList: React.FC = () => {
  const api = useModelManagement();

  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });
  const providers = useAtomValue(providersAtom, { store: settingsStore });
  const backends = useAtomValue(backendsAtom, { store: settingsStore });

  const [query, setQuery] = React.useState("");

  const enabledIds = React.useMemo(
    () => new Set(backends.chat?.enabledModels ?? EMPTY_ENABLED),
    [backends]
  );

  const partition = React.useMemo(
    () => partitionChatCandidates(configuredModels, providers, enabledIds),
    [configuredModels, providers, enabledIds]
  );

  const groups = React.useMemo<ModelEnableGroup[]>(
    () => buildModelEnableGroups(partition, query),
    [partition, query]
  );

  const handleToggle = React.useCallback(
    (id: string, enabled: boolean) => {
      const run = enabled
        ? api.backendConfigRegistry.enableModel("chat", id)
        : api.backendConfigRegistry.disableModel("chat", id);
      run.catch((err) => logError(`[QuickTools] toggle model ${id} failed`, err));
    },
    [api]
  );

  const emptyState = (
    <span>
      {t("No matching chat models. Check your search or add one under ")}
      <span className="tw-font-medium">{t("Models and providers")}</span>
      {t(" to use it in Quick tools.")}
    </span>
  );

  return (
    <ModelEnableList
      groups={groups}
      onToggle={handleToggle}
      query={query}
      onQueryChange={setQuery}
      searchPlaceholder={t("Search quick-tool models…")}
      emptyState={emptyState}
    />
  );
};
