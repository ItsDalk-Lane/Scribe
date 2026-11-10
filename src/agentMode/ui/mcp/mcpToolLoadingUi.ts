import { resolveMcpLoadingState } from "@/agentMode/mcp/deferredMcpTools";
import { getMcpServerManager } from "@/agentMode/mcp/McpServerManager";
import type { McpToolLoadingMode } from "@/agentMode/mcp/toolLoadingPolicy";
import { getSettings, setSettings } from "@/settings/model";
import type { App } from "obsidian";

export function setMcpToolLoadingMode(mode: McpToolLoadingMode): void {
  setSettings((current) => ({ agentMode: { ...current.agentMode, mcpToolLoading: mode } }));
}

export function setMcpToolLoadingThresholdChars(chars: number): void {
  setSettings((current) => ({
    agentMode: { ...current.agentMode, mcpToolLoadingThresholdChars: chars },
  }));
}

export function isDeferredMcpLoadingActive(app: App): boolean {
  const manager = getMcpServerManager(app);
  if (!manager) return false;
  return resolveMcpLoadingState(manager, getSettings().agentMode) === "deferred";
}
