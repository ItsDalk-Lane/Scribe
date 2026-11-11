export type McpToolLoadingMode = "auto" | "always" | "off";

const MCP_TOOL_LOADING_MODES: readonly McpToolLoadingMode[] = ["auto", "always", "off"];

export function isMcpToolLoadingMode(value: unknown): value is McpToolLoadingMode {
  return typeof value === "string" && (MCP_TOOL_LOADING_MODES as readonly string[]).includes(value);
}

export const DEFAULT_MCP_TOOL_LOADING_THRESHOLD_CHARS = 4000;

export type McpToolRegistration = "full" | "deferred";

export interface McpToolLoadingSettings {
  mcpToolLoading?: McpToolLoadingMode;
  mcpToolLoadingThresholdChars?: number;
}

export function resolveMcpToolRegistration(
  mode: McpToolLoadingMode,
  thresholdChars: number,
  estimatedChars: number
): McpToolRegistration {
  if (mode === "off") return "full";
  if (mode === "always") return "deferred";
  return estimatedChars > thresholdChars ? "deferred" : "full";
}
