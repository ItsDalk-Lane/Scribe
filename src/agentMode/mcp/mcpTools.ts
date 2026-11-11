import type { JsonValue } from "@earendil-works/pi-ai";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { compile } from "@earendil-works/pi-schema";

import { McpToolCallError, type McpServerManager } from "@/agentMode/mcp/McpServerManager";
import { withToolExecution } from "@/utils/toolResultProjection";
import type { DeferredMcpToolRegistry } from "./deferredMcpTools";
import type { McpServerConfig, McpToolContentPart, McpToolInfo } from "./types";

export const MCP_TOOL_NAME_PREFIX = "mcp__";

export function buildMcpToolName(serverName: string, toolName: string): string {
  return `${MCP_TOOL_NAME_PREFIX}${serverName}__${toolName}`;
}

export function assertUniqueMcpToolNames(names: readonly string[]): void {
  const seen = new Set<string>();
  for (const name of names) {
    // 组件中的双下划线可造成同名，不能让模型目录与实际处理器绑定到不同服务器。https://github.com/ItsDalk-Lane/Scribe/issues/70
    if (seen.has(name)) throw new Error(`Duplicate MCP tool name: ${name}`);
    seen.add(name);
  }
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
  assertUniqueMcpToolNames(tools.map((tool) => tool.name));
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
  assertUniqueMcpToolNames(tools.map((tool) => tool.name));
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
    executionMode: "sequential",
    replay: "never",
    async execute(_toolCallId, args, signal): Promise<AgentToolResult> {
      let dispatchAttempted = false;
      let result;
      try {
        signal?.throwIfAborted();
        if (checkArgs && !checkArgs(args)) throw new Error(`Invalid arguments for ${tool.name}.`);
        dispatchAttempted = true;
        result = await manager.callTool(
          server.id,
          tool.name,
          args as Record<string, unknown>,
          signal
        );
      } catch (error) {
        // 只有派发前的明确拒绝可安全重试，传输异常不能证明远端没有执行。https://github.com/ItsDalk-Lane/Scribe/issues/70
        const status =
          error instanceof McpToolCallError
            ? error.outcome
            : dispatchAttempted
              ? "outcome_unknown"
              : "not_started";
        return withToolExecution(
          {
            content: [
              { type: "text", text: error instanceof Error ? error.message : String(error) },
            ],
            details: undefined,
            isError: true,
          },
          {
            status,
            retry: status === "not_started" ? "safe" : "verify_before_retry",
            complete: false,
          }
        );
      }
      const content =
        result.content.length > 0 || result.structuredContent === undefined
          ? mapMcpContent(result.content)
          : [];
      // 结构化正文也是公开结果，混合返回时不能丢失；私有元信息仅留在原始结果中。https://github.com/ItsDalk-Lane/Scribe/issues/70
      if (result.structuredContent !== undefined)
        content.push({
          type: "text",
          text: `<mcp_structured_content>\n${JSON.stringify(result.structuredContent)}\n</mcp_structured_content>`,
        });
      return withToolExecution(
        {
          content,
          ...(result.structuredContent !== undefined
            ? { structuredContent: result.structuredContent as JsonValue }
            : {}),
          // MCP结果已通过SDK的JSON协议边界；保留其完整元信息供展示与重开，不重新解释数值。https://github.com/ItsDalk-Lane/Scribe/issues/52
          details: { mcpResult: result as unknown as JsonValue },
          isError: result.isError === true,
        },
        {
          status: result.isError ? "failed" : "completed",
          retry: result.isError ? "verify_before_retry" : "never",
          complete: result.isError !== true,
        }
      );
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
