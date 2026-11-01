import type { CopilotSettings } from "@/settings/model";
import { capabilitiesFromConfiguredInfo } from "@/modelManagement";
import type { EnabledModelEntry } from "@/agentMode/session/types";

const EMPTY_ENABLED_ENTRIES: readonly EnabledModelEntry[] = Object.freeze([]);

export type WireDecode = (wireId: string) => { selection: { baseModelId: string } };

export function agentOriginEnabledModelEntries(
  settings: CopilotSettings,
  agentType: "claude",
  wireDecode: WireDecode
): readonly EnabledModelEntry[] {
  const enabledIds = settings.backends[agentType]?.enabledModels ?? [];
  if (enabledIds.length === 0) return EMPTY_ENABLED_ENTRIES;

  const enabled = new Set(enabledIds);
  const entries: EnabledModelEntry[] = [];
  for (const configuredModel of settings.configuredModels) {
    if (!enabled.has(configuredModel.configuredModelId)) continue;
    const origin = settings.providers?.[configuredModel.providerId]?.origin;
    if (origin?.kind !== "agent" || origin.agentType !== agentType) continue;
    entries.push({
      baseModelId: wireDecode(configuredModel.info.id).selection.baseModelId,
      name: configuredModel.info.displayName || configuredModel.info.id,
      description: configuredModel.info.description,
      credentialState: "ok",
      capabilities: capabilitiesFromConfiguredInfo(configuredModel.info),
    });
  }

  return entries.length === 0 ? EMPTY_ENABLED_ENTRIES : entries;
}
