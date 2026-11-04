import { type BackendDescriptor } from "@/agentMode";
import { AgentModelList } from "@/components/ui/AgentModelList";
import { logError } from "@/logger";
import {
  backendsAtom,
  configuredModelsAtom,
  providersAtom,
  useModelManagement,
  type AgentType,
} from "@/modelManagement";
import { settingsStore } from "@/settings/model";
import { useAtomValue } from "jotai";
import React from "react";
import { partitionCandidates, partitionChatCandidates, toRow } from "./configuredModelGrouping";

interface ConfiguredModelEnableListProps {
  descriptor: BackendDescriptor;
}

const EMPTY_ENABLED: readonly string[] = Object.freeze([]);

export const ConfiguredModelEnableList: React.FC<ConfiguredModelEnableListProps> = ({
  descriptor,
}) => {
  const api = useModelManagement();
  const agentType = descriptor.id as AgentType;

  const configuredModels = useAtomValue(configuredModelsAtom, { store: settingsStore });
  const providers = useAtomValue(providersAtom, { store: settingsStore });
  const backends = useAtomValue(backendsAtom, { store: settingsStore });

  const enabledIds = React.useMemo(() => {
    const list =
      backends[agentType]?.enabledModels ??
      (agentType === "native" ? backends.chat?.enabledModels : undefined) ??
      EMPTY_ENABLED;
    return new Set(list);
  }, [backends, agentType]);

  const partition = React.useMemo(
    () =>
      agentType === "native"
        ? partitionChatCandidates(configuredModels, providers, enabledIds)
        : partitionCandidates(configuredModels, providers, enabledIds, agentType),
    [configuredModels, providers, enabledIds, agentType]
  );

  const rows = React.useMemo(
    () =>
      (agentType === "native" ? partition.byokCandidates : partition.agentOriginCandidates).map(
        toRow
      ),
    [partition, agentType]
  );

  const handleToggle = React.useCallback(
    (id: string, enabled: boolean) => {
      const run =
        agentType === "native"
          ? api.backendConfigRegistry.setEnabledModels(
              "native",
              enabled
                ? [...new Set([...enabledIds, id])]
                : [...enabledIds].filter((existing) => existing !== id)
            )
          : enabled
            ? api.backendConfigRegistry.enableModel(agentType, id)
            : api.backendConfigRegistry.disableModel(agentType, id);
      run.catch((err) => logError(`[AgentMode] toggle model ${id} for ${agentType} failed`, err));
    },
    [api, agentType, enabledIds]
  );

  return <AgentModelList rows={rows} onToggle={handleToggle} agentName={descriptor.displayName} />;
};
