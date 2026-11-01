import type { AgentExtensionItem, AgentExtensionKind } from "./extensionInventory";

export type AgentExtensionScope = { kind: "user" } | { kind: "project"; cwd: string };
export type AgentPluginInstallationScope = "user" | "project" | "local";

export interface AgentExtensionTarget {
  path: string;
  format: "markdown" | "json";
  keyPath?: readonly (string | number)[];
  scope: AgentExtensionScope;
  disabled?: boolean;
}

export interface AgentExtensionCapabilities {
  edit: boolean;
  delete: boolean;
  toggle: boolean;
  update?: boolean;
}

export interface AgentExtensionDetails {
  item: AgentExtensionItem;
  revision: string;
  content?: string;
  config?: Record<string, unknown>;
  hookEvents?: readonly string[];
}

export interface AgentExtensionDraft {
  kind: AgentExtensionKind;
  scope: AgentExtensionScope;
  name: string;
  content?: string;
  config?: Record<string, unknown>;
  original?: AgentExtensionDetails;
}

export interface AgentExtensionImport {
  kind: AgentExtensionKind;
  scope: AgentExtensionScope;
  content: string;
}

export interface AgentPluginAction {
  action: "install" | "update" | "uninstall";
  scope: AgentExtensionScope;
  plugin: string;
  local?: boolean;
  marketplace?: string;
  installationScope?: AgentPluginInstallationScope;
}

export interface AgentMarketplace {
  name: string;
  source: string;
  plugins: readonly { id: string; name: string; description?: string }[];
}

export interface AgentMcpConnectionResult {
  status: "connected" | "failed" | "needs-auth" | "pending";
  toolCount?: number;
  message?: string;
}

export interface AgentExtensionManager {
  list(
    kind: AgentExtensionKind,
    scope: AgentExtensionScope
  ): Promise<readonly AgentExtensionItem[]>;
  details(item: AgentExtensionItem): Promise<AgentExtensionDetails>;
  save(draft: AgentExtensionDraft): Promise<void>;
  toggle(details: AgentExtensionDetails, enabled: boolean): Promise<void>;
  delete(details: AgentExtensionDetails): Promise<void>;
  import(input: AgentExtensionImport): Promise<void>;
  pluginAction(input: AgentPluginAction): Promise<void>;
  marketplaces(): Promise<readonly AgentMarketplace[]>;
  testConnection(draft: AgentExtensionDraft): Promise<AgentMcpConnectionResult>;
}
