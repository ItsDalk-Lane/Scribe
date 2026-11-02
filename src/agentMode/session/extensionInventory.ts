export type AgentExtensionKind = "skill" | "mcp" | "plugin" | "command" | "hook" | "subagent";

export interface AgentPluginInstallation {
  scope: "user" | "project" | "local";
  path: string;
  projectPath?: string;
  version?: string;
  available?: boolean;
}

export interface AgentExtensionItem {
  id: string;
  name: string;
  description?: string;
  version?: string;
  installations?: readonly AgentPluginInstallation[];
  unavailableReason?: string;
  canEnable?: boolean;
  canDisable?: boolean;
  hookIdentity?: {
    event: string;
    matcher?: string;
    commandHash: string;
    type?: string;
    source?: string;
  };
  source: "user" | "project" | "plugin" | "runtime";
  enabled?: boolean;
  location?: string;
  runtimeName?: string;
  availability?: AgentExtensionAvailability;
  toolCount?: number;
  kind?: AgentExtensionKind;
  parentPluginId?: string;
  installationScope?: import("./extensionManagement").AgentPluginInstallationScope;
  builtin?: boolean;
  readOnly?: boolean;
  target?: import("./extensionManagement").AgentExtensionTarget;
  capabilities?: import("./extensionManagement").AgentExtensionCapabilities;
}

export interface AgentExtensionGroup {
  kind: AgentExtensionKind;
  status: "partial" | "unavailable";
  items: readonly AgentExtensionItem[];
  warnings: readonly string[];
}

export type AgentExtensionAvailability =
  | "loaded"
  | "loaded_with_errors"
  | "manual_only"
  | "not_loaded"
  | "not_listed"
  | "connected"
  | "failed"
  | "needs-auth"
  | "pending"
  | "unconfirmed"
  | "disabled";

export interface AgentExtensionRuntimeSnapshot {
  hooks?:
    | readonly {
        event: string;
        matcher?: string;
        source?: string;
        pluginName?: string;
        type?: string;
        commandHash?: string;
        disabled?: boolean;
      }[]
    | null;
  hooksDisabled?: boolean;
  checkErrors?: readonly string[];
  subagents?: readonly { name: string; description?: string; model?: string }[] | null;
  commands: readonly string[] | null;
  builtinCommands?: readonly string[];
  skills: readonly string[] | null;
  disabledSkills?: readonly string[];
  manualSkills?: readonly string[];
  pluginErrorCount?: number;
  plugins: readonly { name: string; path: string }[] | null;
  failedPlugins: readonly { name: string; path?: string }[] | null;
  mcpServers:
    | readonly {
        name: string;
        status: "connected" | "failed" | "needs-auth" | "pending" | "unconfirmed" | "disabled";
        toolCount?: number;
      }[]
    | null;
}

export function hasPendingMcpServers(runtime: AgentExtensionRuntimeSnapshot): boolean {
  return runtime.mcpServers?.some((server) => server.status === "pending") ?? false;
}

// A pending status means the remote server never finished dialing in within the settle window,
// so the terminal snapshot records it as unconfirmed instead of eternally connecting.
// https://github.com/ItsDalk-Lane/Scribe/issues/3
export function markPendingMcpServersUnconfirmed(
  runtime: AgentExtensionRuntimeSnapshot
): AgentExtensionRuntimeSnapshot {
  if (!runtime.mcpServers?.some((server) => server.status === "pending")) return runtime;
  return {
    ...runtime,
    mcpServers: runtime.mcpServers.map((server) =>
      server.status === "pending" ? { ...server, status: "unconfirmed" } : server
    ),
  };
}
