import type { App } from "obsidian";

import { logError } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { SecretStore } from "@/services/secretStore";

import { effectiveTimeoutSeconds, mcpServerConnectionFingerprint } from "./configSchema";
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
}

export interface McpConnectionInstance {
  start(): Promise<{ version?: string; tools: readonly McpToolInfo[] }>;
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
  createConnection: McpConnectionFactory;
  resolveValues(
    server: McpServerConfig
  ): Promise<{ env: Record<string, string>; headers: Record<string, string> }>;
  clientInfo: { name: string; version: string };
}

interface McpServerEntry {
  config: McpServerConfig;
  fingerprint: string;
  connection: McpConnectionInstance | null;
  state: McpServerState;
  epoch: number;
}

const MAX_ERROR_MESSAGE_LENGTH = 300;

const EMPTY_TOOLS: readonly McpToolInfo[] = Object.freeze([]);

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
        entry.config.name,
        entry.fingerprint,
        entry.state.status,
        entry.state.version ?? null,
        entry.state.toolCount,
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

  async callTool(
    serverId: string,
    name: string,
    args: Record<string, unknown> | undefined,
    signal?: AbortSignal
  ): Promise<McpToolCallResult> {
    const entry = this.entries.get(serverId);
    if (!entry) throw new Error(`MCP server ${serverId} is not configured.`);
    if (entry.state.status !== "connected" || !entry.connection)
      throw new Error(
        `MCP server "${entry.config.name}" is not connected (status: ${entry.state.status}${
          entry.state.lastError ? `: ${entry.state.lastError}` : ""
        }).`
      );
    return entry.connection.callTool(
      name,
      args,
      effectiveTimeoutSeconds(entry.config),
      entry.config.longRunning === true,
      signal
    );
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
    try {
      const { env, headers } = await this.options.resolveValues(entry.config);
      if (!this.isCurrentEntry(entry, epoch)) return;
      const connection = await this.options.createConnection({
        server: entry.config,
        env,
        headers,
        clientInfo: this.options.clientInfo,
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
      entry.state = {
        ...entry.state,
        status: "connected",
        lastError: undefined,
        ...(started.version ? { version: started.version } : {}),
        toolCount: started.tools.length,
      };
      this.toolCache.set(entry.config.id, started.tools);
      this.notify();
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

  private isCurrentEntry(entry: McpServerEntry, epoch: number): boolean {
    return !this.disposed && this.entries.get(entry.config.id) === entry && entry.epoch === epoch;
  }

  private async closeConnection(entry: McpServerEntry): Promise<void> {
    entry.epoch++;
    const connection = entry.connection;
    entry.connection = null;
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
