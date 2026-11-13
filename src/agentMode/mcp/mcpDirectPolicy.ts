import { sha256 } from "@/utils/hash";
import type { McpServerConfig, McpToolInfo } from "./types";

export interface McpWebSearchTarget {
  serverId: string;
  toolName: string;
}

export function isAdvertisedMcpWebSearch(
  server: Pick<McpServerConfig, "name" | "description">,
  tool: McpToolInfo
): boolean {
  const labels = [server.name, server.description, tool.name, tool.description];
  return labels.some((label) => {
    const words = (label ?? "")
      .normalize("NFKC")
      .replace(/([a-z])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, " ");
    return (
      (/\bsearch(?:es|ing)?\b/.test(words) && /\b(?:web|internet|online|engine)\b/.test(words)) ||
      /\b(?:websearch|internetsearch|serp)\b|网页搜索|网络搜索|联网搜索|搜索引擎/.test(words)
    );
  });
}

export function mcpDirectToolFingerprint(server: McpServerConfig, tool: McpToolInfo): string {
  return sha256(
    JSON.stringify([
      server.id,
      server.name,
      server.description,
      server.type,
      server.type === "stdio"
        ? [server.command, server.args, server.env]
        : [server.url, server.headers],
      server.secretRefs,
      tool.name,
      tool.description,
      tool.inputSchema,
    ])
  );
}

export function canCallMcpToolDirectly(
  server: McpServerConfig,
  tool: McpToolInfo,
  reserved?: McpWebSearchTarget
): boolean {
  // 名称和说明可漏报网页搜索；只有用户确认过的当前工具定义可直接调用。https://github.com/ItsDalk-Lane/Scribe/issues/70
  return (
    !(reserved?.serverId === server.id && reserved.toolName === tool.name) &&
    !isAdvertisedMcpWebSearch(server, tool) &&
    !!server.directToolApprovals &&
    Object.hasOwn(server.directToolApprovals, tool.name) &&
    server.directToolApprovals[tool.name] === mcpDirectToolFingerprint(server, tool)
  );
}
