export type AgentExtensionKind = "skill" | "mcp" | "plugin" | "command" | "hook" | "subagent";

export interface AgentExtensionItem {
  id: string;
  name: string;
  description?: string;
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
  | "disabled";

export interface AgentExtensionRuntimeSnapshot {
  subagents?: readonly { name: string; description?: string; model?: string }[] | null;
  commands: readonly string[] | null;
  skills: readonly string[] | null;
  disabledSkills?: readonly string[];
  manualSkills?: readonly string[];
  pluginErrorCount?: number;
  plugins: readonly { name: string; path: string }[] | null;
  failedPlugins: readonly { name: string; path?: string }[] | null;
  mcpServers:
    | readonly {
        name: string;
        status: "connected" | "failed" | "needs-auth" | "pending" | "disabled";
        toolCount?: number;
      }[]
    | null;
}
