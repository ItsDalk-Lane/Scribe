import type { JsonValue } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { compile } from "@earendil-works/pi-schema";

import type { McpServerManager } from "./McpServerManager";
import type { DeferredMcpToolRegistry } from "./deferredMcpTools";
import type { McpServerConfig, McpToolContentPart, McpToolInfo } from "./types";

export const MCP_TOOL_NAME_PREFIX = "mcp__";

export function buildMcpToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_NAME_PREFIX}${serverName}__${toolName}`;
}

export interface McpToolsBundle {
  tools: AgentTool[];
  autoApprovedTools: ReadonlySet<string>;
}

export interface McpToolsDeferredSelection {
  registry: DeferredMcpToolRegistry;
  selectedNames: readonly string[];
}

const EMPTY_AUTO_APPROVED: ReadonlySet<string> = Object.freeze(new Set<string>());
const EMPTY_MCP_TOOLS = Object.freeze([]) as unknown as AgentTool[];

export function createMcpTools(
  manager: McpServerManager,
  deferred?: McpToolsDeferredSelection
): McpToolsBundle {
  if (deferred) return createDeferredSelectedTools(deferred);
  const tools: AgentTool[] = [];
  const autoApproved = new Set<string>();
  for (const server of manager.listEnabledServers()) {
    for (const tool of manager.getTools(server.id)) {
      if (server.disabledTools?.includes(tool.name)) continue;
      const name = buildMcpToolName(server.name, tool.name);
      tools.push(buildMcpAgentTool(server, tool, manager));
      if (server.autoApprovedTools?.includes(tool.name)) autoApproved.add(name);
    }
  }
  return { tools, autoApprovedTools: autoApproved.size > 0 ? autoApproved : EMPTY_AUTO_APPROVED };
}

// 延迟模式下只注册模型已通过 tool_search 选中的工具，未选中的定义不进入请求。https://github.com/ItsDalk-Lane/Scribe/issues/65
function createDeferredSelectedTools({
  registry,
  selectedNames,
}: McpToolsDeferredSelection): McpToolsBundle {
  const tools: AgentTool[] = [];
  const autoApproved = new Set<string>();
  for (const name of selectedNames) {
    const entry = registry.find(name);
    if (!entry) continue;
    tools.push(registry.buildTool(entry));
    if (entry.autoApproved) autoApproved.add(entry.qualifiedName);
  }
  return {
    tools: tools.length > 0 ? tools : EMPTY_MCP_TOOLS,
    autoApprovedTools: autoApproved.size > 0 ? autoApproved : EMPTY_AUTO_APPROVED,
  };
}

export function normalizeMcpInputSchema(
  inputSchema: Record<string, unknown> | undefined
): Record<string, unknown> {
  return inputSchema && Object.keys(inputSchema).length > 0
    ? inputSchema
    : { type: "object", properties: {} };
}

export function buildMcpAgentTool(
  server: McpServerConfig,
  tool: McpToolInfo,
  manager: McpServerManager
): AgentTool {
  const inputSchema = normalizeMcpInputSchema(tool.inputSchema);
  let checkArgs: ((args: unknown) => boolean) | null = null;
  try {
    checkArgs = compile(inputSchema).check;
  } catch {
    checkArgs = null;
  }
  return {
    name: buildMcpToolName(server.name, tool.name),
    label: tool.name,
    description: tool.description ?? tool.name,
    parameters: inputSchema,
    async execute(_toolCallId, args, signal): Promise<AgentToolResult> {
      signal?.throwIfAborted();
      if (checkArgs && !checkArgs(args)) throw new Error(`Invalid arguments for ${tool.name}.`);
      let result;
      try {
        result = await manager.callTool(
          server.id,
          tool.name,
          args as Record<string, unknown>,
          signal
        );
      } catch (error) {
        return {
          content: [{ type: "text", text: error instanceof Error ? error.message : String(error) }],
          details: undefined,
          isError: true,
        };
      }
      return {
        content:
          result.content.length === 0 && result.structuredContent !== undefined
            ? [{ type: "text", text: JSON.stringify(result.structuredContent) }]
            : mapMcpContent(result.content),
        // MCP结果已通过SDK的JSON协议边界；保留其完整元信息供展示与重开，不重新解释数值。https://github.com/ItsDalk-Lane/Scribe/issues/52
        details: { mcpResult: result as unknown as JsonValue },
        isError: result.isError === true,
      };
    },
  };
}

function mapMcpContent(content: readonly McpToolContentPart[]): AgentToolResult["content"] {
  const mapped: AgentToolResult["content"] = [];
  for (const part of content ?? []) {
    if (part.type === "text" && typeof part.text === "string") {
      mapped.push({ type: "text", text: part.text });
    } else if (part.type === "image" && typeof part.data === "string") {
      mapped.push({
        type: "image",
        data: part.data,
        mimeType: part.mimeType ?? "image/png",
      });
    } else {
      mapped.push({ type: "text", text: JSON.stringify(part) });
    }
  }
  return mapped.length > 0 ? mapped : [{ type: "text", text: "(empty result)" }];
}
