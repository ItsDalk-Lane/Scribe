import { getMcpServerManager } from "@/agentMode/mcp/McpServerManager";
import type { McpServerConfig, McpServerState, McpToolInfo } from "@/agentMode/mcp/types";
import { useApp } from "@/context";
import { getSettings, setSettings } from "@/settings/model";
import {
  persistSettingsWithinTransaction,
  runPersistenceTransaction,
} from "@/services/settingsPersistence";
import { getScribeSaveData } from "@/settings/scribeSaveData";
import type { App } from "obsidian";
import { useCallback, useSyncExternalStore } from "react";

const EMPTY_TOOLS: readonly McpToolInfo[] = Object.freeze([]);

const DISABLED_STATE: McpServerState = Object.freeze({
  serverId: "",
  status: "disabled",
  toolCount: 0,
});

export async function writeMcpServers(
  app: App,
  update: (servers: McpServerConfig[]) => McpServerConfig[]
): Promise<void> {
  await runPersistenceTransaction(async () => {
    const current = getSettings();
    const mcp = { ...current.mcp, servers: update([...current.mcp.servers]) };
    const saveData = getScribeSaveData(app);
    for (;;) {
      const source = getSettings();
      await persistSettingsWithinTransaction({ ...source, mcp }, saveData);
      if (getSettings() === source) break;
    }
    setSettings({ mcp });
  });
}

function useMcpManagerEpoch(): number {
  const app = useApp();
  const manager = getMcpServerManager(app);
  const subscribe = useCallback(
    (onStoreChange: () => void) => manager?.subscribe(onStoreChange) ?? (() => undefined),
    [manager]
  );
  return useSyncExternalStore(subscribe, () => manager?.getRevision() ?? 0);
}

export interface McpServerRuntime {
  state: McpServerState;
  tools: readonly McpToolInfo[];
}

export function useMcpServerRuntime(serverId: string | null): McpServerRuntime {
  useMcpManagerEpoch();
  const app = useApp();
  const manager = getMcpServerManager(app);
  if (!serverId || !manager) {
    return { state: { ...DISABLED_STATE, serverId: serverId ?? "" }, tools: EMPTY_TOOLS };
  }
  const state = manager.getState(serverId);
  return {
    state: state ?? { ...DISABLED_STATE, serverId },
    tools: manager.getTools(serverId),
  };
}

export interface McpServerView {
  server: McpServerConfig;
  state: McpServerState;
}

export function useMcpServerViews(servers: readonly McpServerConfig[]): McpServerView[] {
  useMcpManagerEpoch();
  const app = useApp();
  const manager = getMcpServerManager(app);
  return servers.map((server) => ({
    server,
    state: manager?.getState(server.id) ?? { ...DISABLED_STATE, serverId: server.id },
  }));
}
