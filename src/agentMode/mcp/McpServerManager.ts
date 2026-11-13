import type { App } from "obsidian";

import { logError } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { SecretStore } from "@/services/secretStore";
import { sha256 } from "@/utils/hash";

import { effectiveTimeoutSeconds, mcpServerConnectionFingerprint } from "./configSchema";
import { canCallMcpToolDirectly, type McpWebSearchTarget } from "./mcpDirectPolicy";
import { resolveMcpValues } from "./secretRefs";
import {
  type McpServerConfig,
  type McpServerState,
  type McpServerStatus,
  type McpToolCallResult,
  type McpToolInfo,
} from "./types";

export interface McpConnectionInput {
  server: McpServerConfig;
  env: Record<string, string>;
  headers: Record<string, string>;
  clientInfo: { name: string; version: string };
  onUnexpectedClose(reason: string): void;
  onToolsChanged?(): void;
}

export interface McpConnectionInstance {
  start(): Promise<{ version?: string; tools: readonly McpToolInfo[] }>;
  listTools?(): Promise<readonly McpToolInfo[]>;
  callTool(
    name: string,
    args: Record<string, unknown> | undefined,
    timeoutSeconds: number,
    resetTimeoutOnProgress: boolean,
    signal?: AbortSignal
  ): Promise<McpToolCallResult>;
  close(): Promise<void>;
}

export type McpConnectionFactory = (
  input: McpConnectionInput
) => McpConnectionInstance | Promise<McpConnectionInstance>;

export interface McpServerManagerOptions {
  getWebSearchSelection?(): McpWebSearchTarget | undefined;
  getServerConfiguration?(serverId: string): McpServerConfig | undefined;
  createConnection: McpConnectionFactory;
  resolveValues(
    server: McpServerConfig
  ): Promise<{ env: Record<string, string>; headers: Record<string, string> }>;
  clientInfo: { name: string; version: string };
}

interface McpServerEntry {
  config: McpServerConfig;
  fingerprint: string;
  catalogSignature?: string;
  connection: McpConnectionInstance | null;
  state: McpServerState;
  epoch: number;
}

const MAX_ERROR_MESSAGE_LENGTH = 300;

const EMPTY_TOOLS: readonly McpToolInfo[] = Object.freeze([]);

export class McpToolCallError extends Error {
  constructor(
    readonly outcome: "not_started" | "outcome_unknown",
    message: string
  ) {
    super(message);
    this.name = "McpToolCallError";
  }
}

export class McpServerManager {
  private readonly entries = new Map<string, McpServerEntry>();
  private readonly listeners = new Set<() => void>();
  private readonly toolCache = new Map<string, readonly McpToolInfo[]>();
  private queue: Promise<void> = Promise.resolve();
  private revisionValue = 0;
  private disposed = false;

  constructor(private readonly options: McpServerManagerOptions) {}

  async setServers(servers: readonly McpServerConfig[]): Promise<void> {
    if (this.disposed) return;
    await this.enqueue(() => this.reconcile(servers));
  }

  async shutdown(): Promise<void> {
    this.disposed = true;
    await this.enqueue(async () => {
      for (const entry of this.entries.values()) await this.closeConnection(entry);
    });
  }

  getRevision(): number {
    return this.revisionValue;
  }

  signature(): string {
    const parts: unknown[] = [];
    for (const entry of this.entries.values()) {
      parts.push([
        entry.config.id,
        entry.config.name,
        entry.fingerprint,
        entry.state.status,
        entry.state.version ?? null,
        entry.state.toolCount,
        entry.catalogSignature,
        entry.config.description,
        entry.config.directToolApprovals,
      ]);
    }
    return JSON.stringify(parts);
  }

  getState(serverId: string): McpServerState | undefined {
    return this.entries.get(serverId)?.state;
  }

  listStates(): readonly McpServerState[] {
    return [...this.entries.values()].map((entry) => ({ ...entry.state }));
  }

  getTools(serverId: string): readonly McpToolInfo[] {
    const entry = this.entries.get(serverId);
    if (!entry) return EMPTY_TOOLS;
    return this.toolCache.get(serverId) ?? EMPTY_TOOLS;
  }

  listEnabledServers(): readonly McpServerConfig[] {
    return [...this.entries.values()]
      .filter((entry) => entry.config.isActive)
      .map((entry) => entry.config);
  }

  listServerStatuses(): readonly {
    name: string;
    status: McpServerStatus;
    toolCount: number;
  }[] {
    return [...this.entries.values()].map((entry) => ({
      name: entry.config.name,
      status: entry.state.status,
      toolCount: entry.state.toolCount,
    }));
  }

  callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown> | undefined,
    signal?: AbortSignal
  ): Promise<McpToolCallResult> {
    return this.dispatchTool(serverId, name, args, signal, false);
  }

  callWebSearchTool(
    serverId: string,
    name: string,
    args: Record<string, unknown> | undefined,
    signal?: AbortSignal
  ): Promise<McpToolCallResult> {
    return this.dispatchTool(serverId, name, args, signal, true);
  }

  private async dispatchTool(
    serverId: string,
    name: string,
    args: Record<string, unknown> | undefined,
    signal: AbortSignal | undefined,
    viaWebSearch: boolean
  ): Promise<McpToolCallResult> {
    // 开始卸载即停止派发，不能等异步连接清理走到此服务器。https://github.com/ItsDalk-Lane/Scribe/issues/71
    if (this.disposed)
      throw new McpToolCallError("not_started", "The MCP server manager is shutting down.");
    // 工具目录或取消状态可在等待批准期间改变，派发前必须核对当前资格。https://github.com/ItsDalk-Lane/Scribe/issues/70
    if (signal?.aborted)
      throw new McpToolCallError("not_started", "The MCP request was cancelled before dispatch.");
    const entry = this.entries.get(serverId);
    if (!entry)
      throw new McpToolCallError("not_started", `MCP server ${serverId} is not configured.`);
    if (!entry.config.isActive || entry.state.status !== "connected" || !entry.connection)
      throw new McpToolCallError(
        "not_started",
        `MCP server "${entry.config.name}" is not connected (status: ${entry.state.status}${
          entry.state.lastError ? `: ${entry.state.lastError}` : ""
        }).`
      );
    if (entry.config.disabledTools?.includes(name))
      throw new McpToolCallError(
        "not_started",
        `MCP tool "${name}" is disabled on "${entry.config.name}".`
      );
    const tool = this.getTools(serverId).find((candidate) => candidate.name === name);
    if (!tool)
      throw new McpToolCallError(
        "not_started",
        `MCP tool "${name}" was not discovered on "${entry.config.name}".`
      );
    const config = this.options.getServerConfiguration
      ? this.options.getServerConfiguration(serverId)
      : entry.config;
    // 设置写入和服务重连不同步，派发须同时核对已保存配置与当前连接。https://github.com/ItsDalk-Lane/Scribe/issues/70
    if (
      !config ||
      config.name !== entry.config.name ||
      mcpServerConnectionFingerprint(config) !== entry.fingerprint
    )
      throw new McpToolCallError(
        "not_started",
        "The MCP server configuration changed before dispatch."
      );
    const selected = this.options.getWebSearchSelection?.();
    if (viaWebSearch) {
      if (selected?.serverId !== serverId || selected.toolName !== name)
        throw new McpToolCallError(
          "not_started",
          "This MCP tool is not the configured web search source."
        );
    } else if (!canCallMcpToolDirectly(config, tool, selected)) {
      throw new McpToolCallError(
        "not_started",
        "Direct MCP call blocked. Use web_search for web searches. Other tools require non-search confirmation in MCP settings."
      );
    }
    try {
      return await entry.connection.callTool(
        name,
        args,
        effectiveTimeoutSeconds(entry.config),
        entry.config.longRunning === true,
        signal
      );
    } catch (error) {
      // 连接错误不能证明远端副作用未发生，禁止把取消或断线当作安全重试依据。https://github.com/ItsDalk-Lane/Scribe/issues/70
      throw new McpToolCallError(
        "outcome_unknown",
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private notify(): void {
    this.revisionValue++;
    for (const listener of this.listeners) listener();
  }

  private async reconcile(servers: readonly McpServerConfig[]): Promise<void> {
    const nextIds = new Set(servers.map((server) => server.id));
    for (const [id, entry] of [...this.entries]) {
      if (nextIds.has(id)) continue;
      await this.closeConnection(entry);
      this.entries.delete(id);
      this.toolCache.delete(id);
    }
    for (const server of servers) {
      const fingerprint = mcpServerConnectionFingerprint(server);
      const entry = this.entries.get(server.id);
      if (!server.isActive) {
        if (entry) await this.closeConnection(entry);
        this.entries.set(server.id, {
          config: server,
          fingerprint,
          connection: null,
          epoch: 0,
          state: { serverId: server.id, status: "disabled", toolCount: 0 },
        });
        this.toolCache.delete(server.id);
        continue;
      }
      if (entry && entry.fingerprint === fingerprint && entry.state.status !== "error") {
        entry.config = server;
        continue;
      }
      await this.startEntry(server, fingerprint);
    }
    this.notify();
  }

  private async startEntry(server: McpServerConfig, fingerprint: string): Promise<void> {
    const previous = this.entries.get(server.id);
    if (previous) await this.closeConnection(previous);
    const epoch = (previous?.epoch ?? 0) + 1;
    const entry: McpServerEntry = {
      config: server,
      fingerprint,
      connection: null,
      epoch,
      state: { serverId: server.id, status: "connecting", toolCount: 0 },
    };
    this.entries.set(server.id, entry);
    this.toolCache.delete(server.id);
    this.notify();
    void this.connectEntry(entry, epoch);
  }

  private async connectEntry(entry: McpServerEntry, epoch: number): Promise<void> {
    let ready = false;
    let refreshing = false;
    let catalogChanged = false;
    const refreshCatalog = async () => {
      const connection = entry.connection;
      if (!ready || refreshing || !connection?.listTools) return;
      refreshing = true;
      // 通知到达即撤回旧定义，连续通知只发布最后一次完整目录。https://github.com/ItsDalk-Lane/Scribe/issues/71
      this.toolCache.delete(entry.config.id);
      entry.catalogSignature = undefined;
      entry.state = { ...entry.state, status: "connecting", lastError: undefined, toolCount: 0 };
      this.notify();
      try {
        do {
          catalogChanged = false;
          try {
            const tools = await connection.listTools();
            if (!this.isCurrentEntry(entry, epoch)) return;
            if (!catalogChanged) this.publishCatalog(entry, tools);
          } catch (error) {
            if (!this.isCurrentEntry(entry, epoch)) return;
            if (!catalogChanged) {
              entry.state = { ...entry.state, status: "error", lastError: truncateError(error) };
              this.notify();
            }
          }
        } while (catalogChanged && this.isCurrentEntry(entry, epoch));
      } finally {
        refreshing = false;
      }
    };
    try {
      const { env, headers } = await this.options.resolveValues(entry.config);
      if (!this.isCurrentEntry(entry, epoch)) return;
      const connection = await this.options.createConnection({
        server: entry.config,
        env,
        headers,
        clientInfo: this.options.clientInfo,
        onToolsChanged: () => {
          if (!this.isCurrentEntry(entry, epoch)) return;
          catalogChanged = true;
          void refreshCatalog();
        },
        onUnexpectedClose: (reason) => {
          if (!this.isCurrentEntry(entry, epoch)) return;
          void this.closeConnection(entry);
          entry.state = {
            ...entry.state,
            status: "error",
            lastError: truncateError(reason),
            toolCount: 0,
          };
          this.notify();
        },
      });
      if (!this.isCurrentEntry(entry, epoch)) {
        await connection.close().catch(() => undefined);
        return;
      }
      entry.connection = connection;
      const started = await connection.start();
      if (!this.isCurrentEntry(entry, epoch)) return;
      if (started.version) entry.state = { ...entry.state, version: started.version };
      ready = true;
      // 初次发现期间收到变化通知时，初次列表也可能已经过期。https://github.com/ItsDalk-Lane/Scribe/issues/71
      if (catalogChanged && connection.listTools) await refreshCatalog();
      else this.publishCatalog(entry, started.tools);
    } catch (error) {
      if (!this.isCurrentEntry(entry, epoch)) return;
      const closing = this.closeConnection(entry);
      entry.state = {
        ...entry.state,
        status: "error",
        lastError: truncateError(error),
        toolCount: 0,
      };
      this.notify();
      await closing;
    }
  }

  private publishCatalog(entry: McpServerEntry, tools: readonly McpToolInfo[]): void {
    // 远端工具数量和服务版本都可能没变，实际声明指纹用于识别目录变化。https://github.com/ItsDalk-Lane/Scribe/issues/71
    entry.catalogSignature = sha256(JSON.stringify(tools));
    entry.state = {
      ...entry.state,
      status: "connected",
      lastError: undefined,
      toolCount: tools.length,
    };
    this.toolCache.set(entry.config.id, tools);
    this.notify();
  }

  private isCurrentEntry(entry: McpServerEntry, epoch: number): boolean {
    return !this.disposed && this.entries.get(entry.config.id) === entry && entry.epoch === epoch;
  }

  private async closeConnection(entry: McpServerEntry): Promise<void> {
    entry.epoch++;
    const connection = entry.connection;
    entry.connection = null;
    entry.catalogSignature = undefined;
    entry.state = { serverId: entry.config.id, status: "disabled", toolCount: 0 };
    this.toolCache.delete(entry.config.id);
    if (!connection) return;
    await connection.close().catch(() => undefined);
  }
}

function truncateError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().replace(/\s+/g, " ");
  return normalized.length > MAX_ERROR_MESSAGE_LENGTH
    ? `${normalized.slice(0, MAX_ERROR_MESSAGE_LENGTH)}…`
    : normalized;
}

const MANAGERS = new WeakMap<App, McpServerManager>();

export function getMcpServerManager(app: App): McpServerManager | null {
  return MANAGERS.get(app) ?? null;
}

export function initializeMcpServerManager(
  app: App,
  plugin: { manifest?: { version?: string }; register(callback: () => void): void }
): McpServerManager {
  const existing = MANAGERS.get(app);
  if (existing) return existing;
  const manager = new McpServerManager({
    getWebSearchSelection: () => getSettings().agentMode?.webSearch?.mcp,
    getServerConfiguration: (id) => getSettings().mcp?.servers.find((server) => server.id === id),
    createConnection: (input) =>
      import("./McpConnection").then((module) => new module.McpSdkConnection(input)),
    resolveValues: (server) => resolveMcpValues(SecretStore.getInstance(app), server),
    clientInfo: { name: "Scribe", version: plugin.manifest?.version ?? "0.0.0" },
  });
  MANAGERS.set(app, manager);
  const sync = (): void => {
    manager
      .setServers(getSettings().mcp?.servers ?? [])
      .catch((error) => logError("[MCP] server reconcile failed", error));
  };
  sync();
  const unsubscribe = subscribeToSettingsChange((previous, next) => {
    if (previous.mcp !== next.mcp) sync();
  });
  plugin.register(() => {
    unsubscribe();
    if (MANAGERS.get(app) === manager) MANAGERS.delete(app);
    void manager.shutdown().catch((error) => logError("[MCP] shutdown failed", error));
  });
  return manager;
}
