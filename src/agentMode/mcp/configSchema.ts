import { v4 as uuidv4 } from "uuid";

import {
  DEFAULT_MCP_TIMEOUT_SECONDS,
  MCP_LONG_RUNNING_TIMEOUT_SECONDS,
  MCP_SERVER_TYPES,
  type McpSecretRef,
  type McpSecretScope,
  type McpServerConfig,
  type McpServerType,
  type McpSettingsSection,
} from "./types";

export const EMPTY_MCP_SECTION: McpSettingsSection = Object.freeze({
  servers: [],
});

export function isMcpServerType(value: unknown): value is McpServerType {
  return typeof value === "string" && (MCP_SERVER_TYPES as readonly string[]).includes(value);
}

export function isValidMcpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
}

function sanitizeStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string"
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

function sanitizeStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items = value.filter((item): item is string => typeof item === "string" && !!item);
  return items.length > 0 ? items : undefined;
}

export function sanitizeTimeoutSeconds(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 ? value : undefined;
}

export function sanitizeMcpServer(raw: unknown): McpServerConfig | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  const id = asNonEmptyString(record.id);
  const name = asNonEmptyString(record.name);
  if (!id || !name) return null;
  const type = isMcpServerType(record.type) ? record.type : inferMcpServerType(record);
  const url = asNonEmptyString(record.url);
  const command = asNonEmptyString(record.command);
  return {
    id,
    name,
    type,
    description: asNonEmptyString(record.description),
    ...(type === "stdio" && command ? { command } : {}),
    ...(type === "stdio" ? { args: sanitizeStringArray(record.args) } : {}),
    ...(type === "stdio" ? { env: sanitizeStringRecord(record.env) } : {}),
    ...(type !== "stdio" && url && isValidMcpUrl(url) ? { url } : {}),
    ...(type !== "stdio" ? { headers: sanitizeStringRecord(record.headers) } : {}),
    timeoutSeconds: sanitizeTimeoutSeconds(record.timeoutSeconds),
    longRunning: record.longRunning === true,
    isActive: record.isActive === true,
    disabledTools: sanitizeStringArray(record.disabledTools),
    autoApprovedTools: sanitizeStringArray(record.autoApprovedTools),
    tags: sanitizeStringArray(record.tags),
    sortOrder:
      typeof record.sortOrder === "number" && Number.isSafeInteger(record.sortOrder)
        ? record.sortOrder
        : undefined,
    secretRefs: sanitizeSecretRefs(record.secretRefs),
    createdAt: asNonEmptyString(record.createdAt) ?? new Date().toISOString(),
    updatedAt: asNonEmptyString(record.updatedAt) ?? new Date().toISOString(),
  };
}

function sanitizeSecretRefs(value: unknown): McpServerConfig["secretRefs"] {
  if (!Array.isArray(value)) return undefined;
  const refs = value
    .filter(
      (item): item is { scope: "env" | "headers"; key: string; secretId: string } =>
        !!item &&
        typeof item === "object" &&
        ((item as Record<string, unknown>).scope === "env" ||
          (item as Record<string, unknown>).scope === "headers") &&
        typeof (item as Record<string, unknown>).key === "string" &&
        typeof (item as Record<string, unknown>).secretId === "string"
    )
    .map((item) => ({ scope: item.scope, key: item.key, secretId: item.secretId }));
  return refs.length > 0 ? refs : undefined;
}

export function sanitizeMcpSection(raw: unknown): McpSettingsSection {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...EMPTY_MCP_SECTION };
  const serversRaw = (raw as Record<string, unknown>).servers;
  if (!Array.isArray(serversRaw)) return { ...EMPTY_MCP_SECTION };
  const seen = new Set<string>();
  const servers: McpServerConfig[] = [];
  for (const entry of serversRaw) {
    const server = sanitizeMcpServer(entry);
    if (!server || seen.has(server.id)) continue;
    seen.add(server.id);
    servers.push(server);
  }
  return { servers };
}

export function createMcpServerConfig(input: {
  name: string;
  type: McpServerType;
  sortOrder?: number;
}): McpServerConfig {
  const now = new Date().toISOString();
  return {
    id: uuidv4(),
    name: input.name,
    type: input.type,
    isActive: false,
    ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
    createdAt: now,
    updatedAt: now,
  };
}

export function parseKeyValueLines(text: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    result[trimmed.slice(0, separator).trim()] = trimmed.slice(separator + 1).trim();
  }
  return result;
}

export function formatKeyValueLines(record: Record<string, string> | undefined): string {
  if (!record) return "";
  return Object.entries(record)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

export function formatSecretAwareKeyValueLines(
  inline: Record<string, string> | undefined,
  refs: readonly McpSecretRef[] | undefined,
  scope: McpSecretScope
): string {
  const lines = Object.entries(inline ?? {}).map(([key, value]) => `${key}=${value}`);
  for (const ref of refs ?? []) {
    if (ref.scope !== scope || inline?.[ref.key] !== undefined) continue;
    lines.push(`${ref.key}=`);
  }
  return lines.join("\n");
}

export function parseArgLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function formatArgLines(args: string[] | undefined): string {
  return (args ?? []).join("\n");
}

export function inferMcpServerType(record: Record<string, unknown>): McpServerType {
  if (typeof record.command === "string" && record.command.trim()) return "stdio";
  const url =
    typeof record.url === "string"
      ? record.url
      : typeof record.baseUrl === "string"
        ? record.baseUrl
        : "";
  if (/\/mcp\/?$/i.test(url)) return "streamableHttp";
  if (url.trim()) return "sse";
  return "stdio";
}

export interface McpServerImportIssue {
  serverName: string;
  reason: "duplicate-name" | "invalid-url" | "missing-endpoint";
}

export interface McpServersImportResult {
  servers: McpServerConfig[];
  issues: McpServerImportIssue[];
}

export function parseMcpServersImportJson(text: string): McpServersImportResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON.");
  }
  const root =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : undefined;
  const serversRaw =
    root &&
    root.mcpServers &&
    typeof root.mcpServers === "object" &&
    !Array.isArray(root.mcpServers)
      ? (root.mcpServers as Record<string, unknown>)
      : root;
  if (!serversRaw || typeof serversRaw !== "object" || Array.isArray(serversRaw))
    throw new Error('Expected a "mcpServers" object.');
  const servers: McpServerConfig[] = [];
  const issues: McpServerImportIssue[] = [];
  const seenNames = new Set<string>();
  const now = new Date().toISOString();
  for (const [name, raw] of Object.entries(serversRaw)) {
    const record =
      raw && typeof raw === "object" && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
    const resolvedName = asNonEmptyString(record.name) ?? name;
    const type =
      isMcpServerType(record.type) || record.type === "http"
        ? normalizeImportedType(record.type)
        : inferMcpServerType(record);
    if (seenNames.has(resolvedName)) {
      issues.push({ serverName: resolvedName, reason: "duplicate-name" });
      continue;
    }
    if (type === "stdio") {
      if (!asNonEmptyString(record.command)) {
        issues.push({ serverName: resolvedName, reason: "missing-endpoint" });
        continue;
      }
    } else {
      const url = asNonEmptyString(record.url) ?? asNonEmptyString(record.baseUrl);
      if (!url || !isValidMcpUrl(url)) {
        issues.push({ serverName: resolvedName, reason: "invalid-url" });
        continue;
      }
    }
    seenNames.add(resolvedName);
    const server = sanitizeMcpServer({
      id: uuidv4(),
      name: resolvedName,
      type,
      description: record.description,
      command: record.command,
      args: record.args,
      env: record.env,
      url: record.url ?? record.baseUrl,
      headers: record.headers,
      timeoutSeconds: sanitizeTimeoutSeconds(record.timeout),
      longRunning: record.longRunning,
      isActive: false,
      tags: record.tags,
      createdAt: now,
      updatedAt: now,
    });
    if (server) servers.push(server);
  }
  return { servers, issues };
}

function normalizeImportedType(value: string): McpServerType {
  if (value === "sse") return "sse";
  if (value === "stdio") return "stdio";
  return "streamableHttp";
}

export function exportMcpServersJson(servers: readonly McpServerConfig[]): string {
  const mcpServers: Record<string, Record<string, unknown>> = {};
  for (const server of servers) {
    const entry: Record<string, unknown> = { type: server.type };
    if (server.description) entry.description = server.description;
    if (server.type === "stdio") {
      if (server.command) entry.command = server.command;
      if (server.args?.length) entry.args = server.args;
      if (server.env && Object.keys(server.env).length > 0) entry.env = server.env;
    } else {
      if (server.url) entry.url = server.url;
      if (server.headers && Object.keys(server.headers).length > 0) entry.headers = server.headers;
    }
    if (server.timeoutSeconds) entry.timeout = server.timeoutSeconds;
    if (server.longRunning) entry.longRunning = true;
    if (server.tags?.length) entry.tags = server.tags;
    mcpServers[server.name] = entry;
  }
  return JSON.stringify({ mcpServers }, null, 2);
}

export function effectiveTimeoutSeconds(server: McpServerConfig): number {
  const timeout = server.timeoutSeconds ?? DEFAULT_MCP_TIMEOUT_SECONDS;
  return server.longRunning ? Math.min(timeout, MCP_LONG_RUNNING_TIMEOUT_SECONDS) : timeout;
}

export function mcpServerConnectionFingerprint(server: McpServerConfig): string {
  return JSON.stringify([
    server.type,
    server.type === "stdio"
      ? [server.command, server.args, server.env]
      : [server.url, server.headers],
    server.secretRefs ?? [],
    server.isActive,
    server.timeoutSeconds,
    server.longRunning,
    server.disabledTools ?? [],
    server.autoApprovedTools ?? [],
  ]);
}
