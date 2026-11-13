import { WebSearchOutcomeUnknown } from "@/agentMode/sdk/webSearchRouter";
import { compile } from "@earendil-works/pi-schema";
import type { McpServerManager } from "@/agentMode/mcp/McpServerManager";
import { buildMcpAgentTool } from "@/agentMode/mcp/mcpTools";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import { NATIVE_PERMISSION_OPTIONS } from "@/agentMode/sdk/nativeToolDefinition";
import type { WebSearchMcpSelection } from "@/settings/webSearchProvider";
import { isRecord } from "@/utils/obsidianInternals";

export async function searchWithMcp(
  manager: McpServerManager | null,
  context: NativeToolContext,
  selection: WebSearchMcpSelection,
  id: string,
  query: string,
  signal: AbortSignal
): Promise<{ text: string } | { failure: string }> {
  signal.throwIfAborted();
  const { serverId, toolName, queryParameter } = selection;
  const unavailable = { failure: "The selected MCP search tool is unavailable." };
  const server = manager?.listEnabledServers().find((entry) => entry.id === serverId);
  if (
    !manager ||
    !server ||
    manager.getState(serverId)?.status !== "connected" ||
    server.disabledTools?.includes(toolName)
  )
    return unavailable;
  const definition = manager.getTools(serverId).find((entry) => entry.name === toolName);
  if (!definition) return unavailable;

  const tool = buildMcpAgentTool(server, definition, manager, true);
  if (context.allowedTools && !context.allowedTools.includes(tool.name))
    throw new Error("The child agent cannot use the selected MCP search tool.");
  context.assertCanExecute?.(tool.name);

  const args = { [queryParameter]: query };
  const invalid = { failure: "The selected MCP search tool cannot accept the configured query." };
  try {
    const { properties } = definition.inputSchema;
    if (
      !isRecord(properties) ||
      !Object.hasOwn(properties, queryParameter) ||
      !compile(tool.parameters).check(args)
    )
      return invalid;
  } catch {
    return invalid;
  }

  if (!server.autoApprovedTools?.includes(toolName)) {
    const decision = await context.requestPermission({
      sessionId: context.sessionId,
      requester: context.requester,
      toolCall: {
        toolCallId: id,
        title: tool.name,
        kind: "execute",
        vendorToolName: toolName,
        mcpServer: server.name,
        rawInput: args,
      },
      options: [...NATIVE_PERMISSION_OPTIONS],
      signal,
    });
    signal.throwIfAborted();
    if (decision.outcome.outcome !== "selected" || decision.outcome.optionId !== "allow_once")
      throw new Error("MCP search permission denied.");
  }

  context.assertCanExecute?.(tool.name);
  // 仅批准请求时显示的服务器与工具定义，配置变化后不能用旧批准派发。https://github.com/ItsDalk-Lane/Scribe/issues/70
  if (
    !manager.listEnabledServers().includes(server) ||
    !manager.getTools(serverId).includes(definition) ||
    manager.getState(serverId)?.status !== "connected"
  )
    throw new Error("The MCP search configuration changed before dispatch.");
  const result = await tool.execute(id, args, signal);
  signal.throwIfAborted();
  const details = isRecord(result.details) ? result.details : {};
  if (result.isError) {
    const status = isRecord(details.execution) ? details.execution.status : undefined;
    // 远端结果未知时停止，不能把可能已经执行的调用当作失败并触发下一次搜索。https://github.com/ItsDalk-Lane/Scribe/issues/70
    if (status !== "failed" && status !== "not_started")
      throw new WebSearchOutcomeUnknown("The MCP search outcome is unknown.");
    return { failure: "The selected MCP search tool reported a failure." };
  }

  const remoteContent = isRecord(details.mcpResult) ? details.mcpResult.content : undefined;
  const text = Array.isArray(remoteContent)
    ? remoteContent.flatMap((part: unknown) => {
        if (!isRecord(part)) return [];
        if (part.type === "text" && typeof part.text === "string") return [part.text];
        if (part.type === "resource_link" && typeof part.uri === "string") return [part.uri];
        return [];
      })
    : [];
  if (result.structuredContent !== undefined) text.push(JSON.stringify(result.structuredContent));
  return { text: text.join("\n\n") || "The MCP search returned no text or links." };
}
