import { sha256 } from "@/utils/hash";
import type { App } from "obsidian";
import {
  hasPendingMcpServers,
  type AgentExtensionGroup,
  type AgentExtensionRuntimeSnapshot,
} from "./extensionInventory";

const MAX_CACHE_ENTRIES = 20;
const MAX_CACHED_VIEWS = 8;

export type ExtensionCheckRuntimeState = "not_started" | "checked" | "partial" | "error";

export interface ExtensionCheckView {
  groups: readonly AgentExtensionGroup[];
  runtimeState: ExtensionCheckRuntimeState;
}

export interface ExtensionCheckCacheScope {
  backendId: string;
  scopeKind: string;
  cwd: string | null;
  vaultBase: string | null;
}

const checks = new Map<string, AgentExtensionRuntimeSnapshot>();
const views = new Map<string, ExtensionCheckView>();

export function extensionCheckCacheKey(
  input: { backendId: string; scopeKind: string; cwd: string | null },
  groups: readonly AgentExtensionGroup[]
): string {
  return sha256(JSON.stringify({ ...input, groups }));
}

export function extensionCheckCacheIdentity(scope: ExtensionCheckCacheScope): string {
  return JSON.stringify([scope.backendId, scope.scopeKind, scope.cwd, scope.vaultBase]);
}

export function readCachedExtensionCheck(
  _app: App | null | undefined,
  key: string
): AgentExtensionRuntimeSnapshot | null {
  return checks.get(key) ?? null;
}

export function storeCachedExtensionCheck(
  _app: App | null | undefined,
  key: string,
  runtime: AgentExtensionRuntimeSnapshot
): void {
  if (hasPendingMcpServers(runtime)) return;
  evict(checks, MAX_CACHE_ENTRIES, key);
  checks.set(key, runtime);
}

export function readCachedExtensionView(
  _app: App | null | undefined,
  identity: string
): ExtensionCheckView | null {
  return views.get(identity) ?? null;
}

export function storeCachedExtensionView(
  _app: App | null | undefined,
  identity: string,
  view: ExtensionCheckView
): void {
  evict(views, MAX_CACHED_VIEWS, identity);
  views.set(identity, view);
}

export function resetExtensionCheckCacheForTests(): void {
  checks.clear();
  views.clear();
}

function evict<T>(cache: Map<string, T>, limit: number, incoming: string): void {
  cache.delete(incoming);
  while (cache.size >= limit) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}
