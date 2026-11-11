import type { ScribeSettings } from "@/settings/model";

export function isAgentBackendEnabled(settings: ScribeSettings, backendId: string): boolean {
  const backends = settings.agentMode?.backends as
    | Record<string, { enabled?: boolean } | undefined>
    | undefined;
  // 原生代理不再有总开关，旧停用值不能让聊天失去恢复入口。https://github.com/ItsDalk-Lane/Scribe/issues/31
  return backendId === "native" || backends?.[backendId]?.enabled !== false;
}
