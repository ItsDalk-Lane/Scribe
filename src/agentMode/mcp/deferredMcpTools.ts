import type { AgentTool } from "@earendil-works/pi-agent-core";

import { canCallMcpToolDirectly, type McpWebSearchTarget } from "./mcpDirectPolicy";
import type { McpServerManager } from "./McpServerManager";
import {
  assertUniqueMcpToolNames,
  buildMcpAgentTool,
  buildMcpToolName,
  normalizeMcpInputSchema,
} from "./mcpTools";
import {
  DEFAULT_MCP_TOOL_LOADING_THRESHOLD_CHARS,
  resolveMcpToolRegistration,
  type McpToolLoadingSettings,
} from "./toolLoadingPolicy";
import type { McpServerConfig, McpToolInfo } from "./types";

export interface DeferredMcpToolEntry {
  readonly qualifiedName: string;
  readonly serverId: string;
  readonly serverName: string;
  readonly toolName: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly autoApproved: boolean;
}

export interface DeferredToolSearchResult {
  readonly entries: readonly DeferredMcpToolEntry[];
  readonly truncated: boolean;
}

const CATALOG_DESCRIPTION_MAX_CHARS = 120;

export class DeferredMcpToolRegistry {
  private constructor(
    private readonly manager: McpServerManager,
    private readonly serversById: ReadonlyMap<string, McpServerConfig>,
    private readonly entries: readonly DeferredMcpToolEntry[]
  ) {}

  static fromManager(
    manager: McpServerManager,
    reserved?: McpWebSearchTarget
  ): DeferredMcpToolRegistry {
    const serversById = new Map<string, McpServerConfig>();
    const entries: DeferredMcpToolEntry[] = [];
    for (const server of manager.listEnabledServers()) {
      serversById.set(server.id, server);
      for (const tool of manager.getTools(server.id)) {
        // 搜索由统一入口按优先级派发，目录不能同时提供绕过入口。https://github.com/ItsDalk-Lane/Scribe/issues/65
        if (
          server.disabledTools?.includes(tool.name) ||
          !canCallMcpToolDirectly(server, tool, reserved)
        )
          continue;
        entries.push({
          qualifiedName: buildMcpToolName(server.name, tool.name),
          serverId: server.id,
          serverName: server.name,
          toolName: tool.name,
          description: tool.description ?? tool.name,
          inputSchema: normalizeMcpInputSchema(tool.inputSchema),
          autoApproved: server.autoApprovedTools?.includes(tool.name) === true,
        });
      }
    }
    assertUniqueMcpToolNames(entries.map((entry) => entry.qualifiedName));
    return new DeferredMcpToolRegistry(manager, serversById, entries);
  }

  list(): readonly DeferredMcpToolEntry[] {
    return this.entries;
  }

  find(qualifiedName: string): DeferredMcpToolEntry | undefined {
    return this.entries.find((entry) => entry.qualifiedName === qualifiedName);
  }

  search(query: string, limit: number): DeferredToolSearchResult {
    const tokens = query
      .trim()
      .toLowerCase()
      .split(/\s+/)
      .filter((token) => token.length > 0);
    if (tokens.length === 0) return { entries: [], truncated: false };
    const matched = this.entries.filter((entry) => {
      const haystack =
        `${entry.qualifiedName} ${entry.toolName} ${entry.serverName} ${entry.description}`.toLowerCase();
      return tokens.every((token) => haystack.includes(token));
    });
    return { entries: matched.slice(0, limit), truncated: matched.length > limit };
  }

  catalogLines(): readonly string[] {
    return this.entries.map(
      (entry) => `${entry.qualifiedName} — ${collapseDescription(entry.description)}`
    );
  }

  estimateDefinitionChars(): number {
    return this.entries.reduce((total, entry) => {
      const definition = JSON.stringify({
        name: entry.qualifiedName,
        description: entry.description,
        parameters: entry.inputSchema,
      });
      return total + definition.length;
    }, 0);
  }

  buildTool(entry: DeferredMcpToolEntry): AgentTool {
    const server = this.serversById.get(entry.serverId);
    if (!server)
      throw new Error(`The deferred tool's server left the registry: ${entry.qualifiedName}`);
    const tool: McpToolInfo = {
      name: entry.toolName,
      description: entry.description,
      inputSchema: entry.inputSchema,
    };
    return buildMcpAgentTool(server, tool, this.manager);
  }
}

function collapseDescription(description: string): string {
  const collapsed = description.replace(/\s+/g, " ").trim();
  return collapsed.length > CATALOG_DESCRIPTION_MAX_CHARS
    ? `${collapsed.slice(0, CATALOG_DESCRIPTION_MAX_CHARS - 1)}…`
    : collapsed;
}

// 注册、目录与设置 UI 共用同一延迟判定，避免三处阈值口径漂移。https://github.com/ItsDalk-Lane/Scribe/issues/65
export function resolveMcpLoadingState(
  manager: McpServerManager,
  settings: McpToolLoadingSettings,
  reserved?: McpWebSearchTarget
): "full" | "deferred" {
  const mode = settings.mcpToolLoading ?? "auto";
  if (mode === "off") return "full";
  const registry = DeferredMcpToolRegistry.fromManager(manager, reserved);
  const thresholdChars =
    settings.mcpToolLoadingThresholdChars ?? DEFAULT_MCP_TOOL_LOADING_THRESHOLD_CHARS;
  return resolveMcpToolRegistration(mode, thresholdChars, registry.estimateDefinitionChars());
}

// 目录只列简短说明，完整工具按需选取，避免未使用工具占满请求上下文。https://github.com/ItsDalk-Lane/Scribe/issues/65
export function buildMcpToolCatalogBlock(registry: DeferredMcpToolRegistry): string | null {
  const lines = registry.catalogLines();
  if (lines.length === 0) return null;
  return [
    "<mcp_tool_catalog>",
    "The following MCP tools are deferred and not fully loaded. When none of the registered tools fits a step, scan this catalog and register what you need with the tool_search tool (select:<qualified name>); a registered tool stays callable in later turns.",
    "",
    ...lines,
    "",
    "</mcp_tool_catalog>",
  ].join("\n");
}
