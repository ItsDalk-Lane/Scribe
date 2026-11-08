export type McpServerType = "stdio" | "sse" | "streamableHttp";

export const MCP_SERVER_TYPES: readonly McpServerType[] = Object.freeze([
  "stdio",
  "sse",
  "streamableHttp",
]);

export type McpSecretScope = "env" | "headers";

export interface McpSecretRef {
  scope: McpSecretScope;
  key: string;
  secretId: string;
}

export interface McpServerConfig {
  id: string;
  name: string;
  type: McpServerType;
  description?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  timeoutSeconds?: number;
  longRunning?: boolean;
  isActive: boolean;
  disabledTools?: string[];
  autoApprovedTools?: string[];
  tags?: string[];
  sortOrder?: number;
  secretRefs?: McpSecretRef[];
  createdAt: string;
  updatedAt: string;
}

export type McpServerStatus = "connected" | "connecting" | "error" | "disabled";

export interface McpServerState {
  serverId: string;
  status: McpServerStatus;
  lastError?: string;
  version?: string;
  toolCount: number;
}

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

export interface McpToolContentPart {
  type: string;
  text?: string;
  data?: string;
  mimeType?: string;
}

export interface McpToolCallResult {
  content: McpToolContentPart[];
  isError?: boolean;
}

export const EMPTY_MCP_SERVERS: readonly McpServerConfig[] = Object.freeze([]);

export interface McpSettingsSection {
  servers: McpServerConfig[];
}

export const DEFAULT_MCP_TIMEOUT_SECONDS = 60;
export const MCP_LONG_RUNNING_TIMEOUT_SECONDS = 600;
