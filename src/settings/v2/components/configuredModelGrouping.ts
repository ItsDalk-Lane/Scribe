import { t } from "@/lib/i18n";
import type { ModelEnableGroup, ModelEnableRow } from "@/components/ui/ModelEnableList";
import {
  providerDestination,
  isChatModelInfo,
  capabilitiesFromConfiguredInfo,
  type ConfiguredModel,
  type Provider,
} from "@/modelManagement";

export interface Candidate {
  configuredModel: ConfiguredModel;
  provider: Provider;
  enabled: boolean;
}

export interface CandidatePartition {
  byokCandidates: Candidate[];
  agentOriginCandidates: Candidate[];
}

export function partitionCandidates(
  configuredModels: readonly ConfiguredModel[],
  providers: Readonly<Record<string, Provider>>,
  enabledIds: ReadonlySet<string>,
  agentType: string
): CandidatePartition {
  const byokCandidates: Candidate[] = [];
  const agentOriginCandidates: Candidate[] = [];
  for (const configuredModel of configuredModels) {
    const provider = providers[configuredModel.providerId];
    if (!provider) continue;
    const candidate: Candidate = {
      configuredModel,
      provider,
      enabled: enabledIds.has(configuredModel.configuredModelId),
    };
    const origin = provider.origin;
    if (origin.kind === "agent") {
      if (origin.agentType === agentType) agentOriginCandidates.push(candidate);
      continue;
    }
  }
  return { byokCandidates, agentOriginCandidates };
}

export function partitionChatCandidates(
  configuredModels: readonly ConfiguredModel[],
  providers: Readonly<Record<string, Provider>>,
  enabledIds: ReadonlySet<string>
): CandidatePartition {
  const byokCandidates: Candidate[] = [];
  for (const configuredModel of configuredModels) {
    if (!isChatModelInfo(configuredModel.info)) continue;
    const provider = providers[configuredModel.providerId];
    if (!provider) continue;
    if (provider.origin.kind === "agent") continue;
    byokCandidates.push({
      configuredModel,
      provider,
      enabled: enabledIds.has(configuredModel.configuredModelId),
    });
  }
  return { byokCandidates, agentOriginCandidates: [] };
}

export function toRow(candidate: Candidate): ModelEnableRow {
  const { configuredModel, enabled } = candidate;
  const { displayName, id, description } = configuredModel.info;
  return {
    id: configuredModel.configuredModelId,
    label: displayName || id,
    description: description || undefined,
    wireId: id,
    enabled,
    capabilities: capabilitiesFromConfiguredInfo(configuredModel.info),
  };
}

export function rowMatches(row: ModelEnableRow, q: string): boolean {
  if (!q) return true;
  return (
    row.label.toLowerCase().includes(q) ||
    row.id.toLowerCase().includes(q) ||
    (row.wireId?.toLowerCase().includes(q) ?? false) ||
    (row.description?.toLowerCase().includes(q) ?? false)
  );
}

type OriginKind = Provider["origin"]["kind"];

function originBadgeLabel(kind: OriginKind): string {
  switch (kind) {
    case "byok":
      return t("BYOK");
    case "agent":
      return t("Agent Provided");
  }
}

interface OriginGroup {
  group: ModelEnableGroup;
  kind: OriginKind;
}

export function buildModelEnableGroups(
  partition: CandidatePartition,
  query: string
): ModelEnableGroup[] {
  const q = query.trim().toLowerCase();
  const out: OriginGroup[] = [];

  const byProvider = new Map<
    string,
    { provider: Provider; kind: OriginKind; rows: ModelEnableRow[] }
  >();
  for (const candidate of partition.byokCandidates) {
    const row = toRow(candidate);
    if (!rowMatches(row, q)) continue;
    const key = candidate.provider.providerId;
    const bucket = byProvider.get(key);
    if (bucket) bucket.rows.push(row);
    else
      byProvider.set(key, {
        provider: candidate.provider,
        kind: candidate.provider.origin.kind,
        rows: [row],
      });
  }
  for (const [key, { provider, kind, rows }] of byProvider) {
    const label = provider.displayName;
    const destination = providerDestination(provider);
    out.push({ group: { key: `byok:${key}`, label, destination, rows }, kind });
  }

  const bySubGroup = new Map<string, { label: string; rows: ModelEnableRow[] }>();
  for (const candidate of partition.agentOriginCandidates) {
    const label = candidate.provider.displayName;
    const row = toRow(candidate);
    if (!rowMatches(row, q)) continue;
    const bucket = bySubGroup.get(label);
    if (bucket) bucket.rows.push(row);
    else bySubGroup.set(label, { label, rows: [row] });
  }
  for (const [label, { rows }] of bySubGroup) {
    out.push({ group: { key: `agent:${label}`, label, rows }, kind: "agent" });
  }

  const mixed = new Set(out.map((o) => o.kind)).size > 1;
  for (const o of out) {
    if (mixed) o.group.badge = originBadgeLabel(o.kind);
  }
  return out.map((o) => o.group);
}
