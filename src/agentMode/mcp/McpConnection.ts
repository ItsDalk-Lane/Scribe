import { RequestRedactor } from "@/LLMProviders/requestRedaction";
import { isSensitiveKey } from "@/services/settingsSecretTransforms";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import {
  getDefaultEnvironment,
  StdioClientTransport,
} from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { ToolListChangedNotificationSchema } from "@modelcontextprotocol/sdk/types.js";

import type { McpConnectionInput, McpConnectionInstance } from "./McpServerManager";
import { effectiveTimeoutSeconds } from "./configSchema";
import { loadDesktopStreamingFetch } from "@/utils/desktopStreamingFetch";
import {
  MCP_LONG_RUNNING_TIMEOUT_SECONDS,
  type McpToolCallResult,
  type McpToolInfo,
} from "./types";

export class McpSdkConnection implements McpConnectionInstance {
  private client: Client | null = null;
  private closing = false;

  constructor(private readonly input: McpConnectionInput) {}

  async start(): Promise<{ version?: string; tools: readonly McpToolInfo[] }> {
    const { server, clientInfo } = this.input;
    const timeoutMs = effectiveTimeoutSeconds(server) * 1000;
    const client = new Client(
      { name: clientInfo.name, version: clientInfo.version },
      { capabilities: {} }
    );
    const transport = this.createTransport();
    this.client = client;
    client.onclose = () => {
      if (this.closing) return;
      this.client = null;
      this.input.onUnexpectedClose("The server connection closed unexpectedly.");
    };
    if (server.type === "sse") {
      client.onerror = (error) => {
        if (!this.closing && error instanceof SseError) this.input.onUnexpectedClose(error.message);
      };
    }
    // 远端目录通知只触发完整刷新，不能沿用旧工具定义或忽略未完成分页。https://github.com/ItsDalk-Lane/Scribe/issues/71
    client.setNotificationHandler(ToolListChangedNotificationSchema, () => {
      if (this.client === client && !this.closing) this.input.onToolsChanged?.();
    });
    await client.connect(transport, { timeout: timeoutMs });
    const version = client.getServerVersion()?.version;
    return { ...(version ? { version } : {}), tools: await this.listTools() };
  }

  async listTools(): Promise<readonly McpToolInfo[]> {
    const client = this.client;
    if (!client) throw new Error("The server is not connected.");
    const timeoutMs = effectiveTimeoutSeconds(this.input.server) * 1000;
    const tools: McpToolInfo[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const listing = await client.listTools(cursor ? { cursor } : {}, { timeout: timeoutMs });
      tools.push(
        ...listing.tools.map((tool) => ({
          name: tool.name,
          ...(tool.description ? { description: tool.description } : {}),
          inputSchema: { ...(tool.inputSchema ?? {}) },
        }))
      );
      cursor = listing.nextCursor;
      // 重复游标会让发现一直等待，也无法形成可用的完整目录。https://github.com/ItsDalk-Lane/Scribe/issues/71
      if (cursor && cursors.has(cursor)) throw new Error("The MCP tool list repeated a cursor.");
      if (cursor) cursors.add(cursor);
    } while (cursor);
    return tools;
  }

  async callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    timeoutSeconds: number,
    resetTimeoutOnProgress: boolean,
    signal?: AbortSignal
  ): Promise<McpToolCallResult> {
    const client = this.client;
    if (!client) throw new Error("The server is not connected.");
    const redactor = new RequestRedactor(
      Object.entries({ ...this.input.env, ...this.input.headers })
        .filter(
          ([key]) =>
            isSensitiveKey(key) || this.input.server.secretRefs?.some((ref) => ref.key === key)
        )
        .map(([, value]) => value)
    );
    try {
      const result = await client.callTool({ name, arguments: args ?? {} }, undefined, {
        timeout: timeoutSeconds * 1000,
        signal,
        resetTimeoutOnProgress,
        ...(resetTimeoutOnProgress
          ? {
              onprogress: () => undefined,
              maxTotalTimeout: MCP_LONG_RUNNING_TIMEOUT_SECONDS * 1000,
            }
          : {}),
      });
      const content = Array.isArray(result.content) ? result.content : [];
      // 工具返回的结构与元信息必须完整保留，并遮盖连接凭据，避免保存和展示绕过请求脱敏。https://github.com/ItsDalk-Lane/Scribe/issues/52
      return redactor.structured({ ...result, content, isError: result.isError === true });
    } catch (error) {
      throw redactor.error(error);
    }
  }

  async close(): Promise<void> {
    this.closing = true;
    const client = this.client;
    this.client = null;
    if (!client) return;
    await client.close().catch(() => undefined);
  }

  private createTransport(): Transport {
    const { server, env, headers } = this.input;
    if (server.type === "stdio") {
      return new StdioClientTransport({
        command: server.command ?? "",
        args: server.args ?? [],
        env: { ...getDefaultEnvironment(), ...env },
      });
    }
    const url = new URL(server.url ?? "");
    const fetchRemote = loadDesktopStreamingFetch();
    if (server.type === "sse") {
      return new SSEClientTransport(url, {
        fetch: fetchRemote,
        eventSourceInit: {
          fetch: (fetchInput, fetchInit) => {
            const requestHeaders = new Headers(fetchInit?.headers);
            for (const [key, value] of Object.entries(headers)) requestHeaders.set(key, value);
            return fetchRemote(fetchInput, {
              ...fetchInit,
              headers: requestHeaders,
            });
          },
        },
        requestInit: { headers },
      });
    }
    return new StreamableHTTPClientTransport(url, { fetch: fetchRemote, requestInit: { headers } });
  }
}
