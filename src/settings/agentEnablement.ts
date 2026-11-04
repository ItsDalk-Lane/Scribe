import type { ScribeSettings } from "@/settings/model";

export function isAgentBackendEnabled(settings: ScribeSettings, backendId: string): boolean {
  const backends = settings.agentMode?.backends as
    | Record<string, { enabled?: boolean } | undefined>
    | undefined;
  return backends?.[backendId]?.enabled !== false;
}
