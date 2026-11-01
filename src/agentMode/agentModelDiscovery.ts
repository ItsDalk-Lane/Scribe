import { logError, logInfo } from "@/logger";
import type CopilotPlugin from "@/main";
import type { AgentType, ModelManagementApi, ProviderType } from "@/modelManagement";
import {
  listBackendDescriptors,
  type AgentSessionManager,
  type BackendDescriptor,
  type BackendId,
} from "@/agentMode";

const PROVIDER_TYPE_BY_AGENT: Record<AgentType, ProviderType> = {
  claude: "anthropic",
};

export function wireAgentModelDiscovery(
  plugin: CopilotPlugin,
  manager: AgentSessionManager
): () => void {
  const lastEnrolled = new Map<BackendId, string>();
  const inFlight = new Map<BackendId, Promise<void>>();
  let disposed = false;

  const runForBackend = (descriptor: BackendDescriptor): void => {
    const catalog = manager.getCachedModelCatalog(descriptor.id);
    const reported = reportedModels(catalog);
    if (reported === null) return;

    const signature = reported
      .map((r) => `${r.wireId}\t${r.name}\t${r.description ?? ""}`)
      .join("\n");
    if (lastEnrolled.get(descriptor.id) === signature) return;

    const prior = inFlight.get(descriptor.id) ?? Promise.resolve();
    const run = prior
      .catch(() => undefined)
      .then(async () => {
        if (disposed) return;
        await enrollBackend(plugin.modelManagement, descriptor, reported);
        lastEnrolled.set(descriptor.id, signature);
      })
      .catch((err) => {
        logError(`[AgentMode] model discovery enroll failed for ${descriptor.id}`, err);
      })
      .finally(() => {
        if (inFlight.get(descriptor.id) === run) inFlight.delete(descriptor.id);
      });
    inFlight.set(descriptor.id, run);
  };

  const onCacheUpdate = (): void => {
    if (disposed) return;
    for (const descriptor of listBackendDescriptors()) {
      runForBackend(descriptor);
    }
  };

  const unsubscribe = manager.subscribeModelCache(onCacheUpdate);
  onCacheUpdate();

  return () => {
    disposed = true;
    unsubscribe();
  };
}

async function enrollBackend(
  api: ModelManagementApi,
  descriptor: BackendDescriptor,
  reported: readonly ReportedModel[]
): Promise<void> {
  const agentType = descriptor.id as AgentType;
  const wireModelIds = reported.map((r) => r.wireId);

  const fallbackDisplayNames: Record<string, string> = {};
  const fallbackDescriptions: Record<string, string> = {};
  for (const r of reported) {
    if (r.name) fallbackDisplayNames[r.wireId] = r.name;
    if (r.description) fallbackDescriptions[r.wireId] = r.description;
  }

  if (wireModelIds.length === 0) {
    logInfo(
      `[AgentMode] model discovery: empty model list for ${agentType} — ` +
        `skipping enroll/sync (transient or fully-suppressed probe)`
    );
    return;
  }

  const existing = api.providerRegistry
    .listByOrigin("agent")
    .find((p) => p.origin.kind === "agent" && p.origin.agentType === agentType);

  if (existing) {
    await api.setup.agent.syncAgentModels({
      agentType,
      wireModelIds,
      fallbackDisplayNames,
      fallbackDescriptions,
    });
    return;
  }

  const result = await api.setup.agent.registerAgentProvider({
    agentType,
    providerType: PROVIDER_TYPE_BY_AGENT[agentType],
    displayName: descriptor.displayName,
    apiKey: null,
    wireModelIds,
    fallbackDisplayNames,
    fallbackDescriptions,
  });

  logInfo(
    `[AgentMode] model discovery: first enrollment for ${agentType} — ` +
      `${result.configuredModelIds.length} model(s) configured, ` +
      `${result.configuredModelIds.length} enabled`
  );
}

interface ReportedModel {
  wireId: string;
  name: string;
  description?: string;
}

function reportedModels(
  catalog: ReturnType<AgentSessionManager["getCachedModelCatalog"]>
): ReportedModel[] | null {
  if (!catalog?.availableModels) return null;
  return catalog.availableModels.map((m) => ({
    wireId: m.baseModelId,
    name: m.name,
    description: m.description,
  }));
}
