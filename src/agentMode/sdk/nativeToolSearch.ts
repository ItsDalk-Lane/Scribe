import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { defineNativeTool } from "@/agentMode/sdk/nativeToolDefinition";

export const TOOL_SEARCH_TOOL_NAME = "tool_search";

const SELECT_PREFIX = "select:";
const SEARCH_RESULT_LIMIT = 20;
const MISSING_SELECT_NAME_LISTING_LIMIT = 200;

export interface ToolSearchCatalogEntry {
  readonly qualifiedName: string;
  readonly serverName: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly autoApproved: boolean;
}

export interface ToolSearchSearchResult {
  readonly entries: readonly ToolSearchCatalogEntry[];
  readonly truncated: boolean;
}

// 目录端口由后端接线注入（MCP 注册表实现），工具本体不依赖任何具体目录来源。https://github.com/ItsDalk-Lane/Scribe/issues/65
export interface ToolSearchCatalog {
  list(): readonly ToolSearchCatalogEntry[];
  find(qualifiedName: string): ToolSearchCatalogEntry | undefined;
  search(query: string, limit: number): ToolSearchSearchResult;
  buildTool(entry: ToolSearchCatalogEntry): AgentTool;
}

export interface ToolSearchSelections {
  names(this: void): readonly string[];
  select(this: void, qualifiedName: string): void;
}

export interface ToolSearchHooks {
  catalog: ToolSearchCatalog;
  registerTool(tool: AgentTool, autoApproved: boolean): void;
  selections: ToolSearchSelections;
}

const TOOL_SEARCH_PARAMETERS = {
  type: "object",
  properties: {
    query: {
      type: "string",
      description:
        "Keyword search across deferred tool names, descriptions, and server names. Space-separated tokens must all match.",
    },
    select: {
      type: "string",
      description:
        "Exact qualified name of one catalog entry, with or without the 'select:' prefix. Registers the tool so it can be called directly afterwards.",
    },
  },
} as const;

const TOOL_SEARCH_DESCRIPTION =
  "Search and register deferred MCP tools. MCP tools are not all loaded upfront; the available tools are listed as a one-line catalog in the system prompt. " +
  "Call this tool with `query` to search the catalog by keywords, or with `select` and an exact qualified name to register that tool. " +
  "After a select, the registered tool can be called directly from the next model step onward. " +
  "Use this whenever no registered tool fits the task but a catalog entry might.";

export function createToolSearchTool(hooks: ToolSearchHooks): AgentTool {
  return defineNativeTool(
    TOOL_SEARCH_TOOL_NAME,
    "ToolSearch",
    TOOL_SEARCH_DESCRIPTION,
    TOOL_SEARCH_PARAMETERS,
    async (_toolCallId, args): Promise<AgentToolResult> =>
      runToolSearch(hooks, args as Record<string, unknown> | undefined),
    { kind: "read", skillAuthoring: false, executionMode: "sequential" }
  );
}

async function runToolSearch(
  hooks: ToolSearchHooks,
  rawArgs: Record<string, unknown> | undefined
): Promise<AgentToolResult> {
  const args = rawArgs ?? {};
  const query = typeof args.query === "string" ? args.query.trim() : "";
  const selectRaw = typeof args.select === "string" ? args.select.trim() : "";
  const select = stripSelectPrefix(selectRaw);
  if (query && select)
    return errorResult(
      "Pass either query or select in one tool_search call, not both: search with query first, then select the entry you need."
    );
  if (!query && !select)
    return errorResult(
      "Pass a query to search the deferred tool catalog, or select with an exact qualified name from the catalog (for example select:mcp__server__tool)."
    );
  if (select) return selectTool(hooks, select);
  return searchTools(hooks, query);
}

function stripSelectPrefix(value: string): string {
  return value.startsWith(SELECT_PREFIX) ? value.slice(SELECT_PREFIX.length).trim() : value;
}

function selectTool(hooks: ToolSearchHooks, qualifiedName: string): AgentToolResult {
  const entry = hooks.catalog.find(qualifiedName);
  if (!entry)
    return textResult(
      `No deferred tool matches "${qualifiedName}". Available catalog entries:\n${catalogNameListing(hooks.catalog)}`
    );
  if (!hooks.selections.names().includes(entry.qualifiedName)) {
    // 注册可能因实时权限而拒绝，成功前不能记为已选中。https://github.com/ItsDalk-Lane/Scribe/issues/70
    hooks.registerTool(hooks.catalog.buildTool(entry), entry.autoApproved);
    hooks.selections.select(entry.qualifiedName);
  }
  return textResult(selectConfirmation(entry));
}

function searchTools(hooks: ToolSearchHooks, query: string): AgentToolResult {
  const { entries, truncated } = hooks.catalog.search(query, SEARCH_RESULT_LIMIT);
  if (entries.length === 0)
    return errorResult(
      `No deferred tool matches "${query}". Try a broader query, or call tool_search with select and an exact qualified name from the catalog in the system prompt.`
    );
  const lines = entries.map(
    (entry) => `${entry.qualifiedName} — ${entry.description} (server: ${entry.serverName})`
  );
  const truncationNote = truncated
    ? `\n(More tools also matched; showing the first ${SEARCH_RESULT_LIMIT}. Refine the query to narrow the list.)`
    : "";
  return textResult(
    `Matching deferred tools:\n${lines.join("\n")}${truncationNote}\n\nTo use one, call tool_search again with select:<qualified name>; it becomes directly callable once registered.`
  );
}

function catalogNameListing(catalog: ToolSearchCatalog): string {
  const names = catalog.list().map((entry) => entry.qualifiedName);
  if (names.length === 0) return "(the deferred tool catalog is empty)";
  const listing = names.slice(0, MISSING_SELECT_NAME_LISTING_LIMIT).join("\n");
  return names.length > MISSING_SELECT_NAME_LISTING_LIMIT
    ? `${listing}\n… and ${names.length - MISSING_SELECT_NAME_LISTING_LIMIT} more`
    : listing;
}

function selectConfirmation(entry: ToolSearchCatalogEntry): string {
  return [
    `${entry.qualifiedName} is registered and ready to call directly from the next model step (server: ${entry.serverName}).`,
    "",
    `Description: ${entry.description}`,
    "",
    `Parameters (JSON schema):\n${JSON.stringify(entry.inputSchema, null, 2)}`,
  ].join("\n");
}

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

function errorResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }], details: undefined, isError: true };
}
