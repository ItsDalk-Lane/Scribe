import { logWarn } from "@/logger";
import { sha256 } from "@/utils/hash";
import type { App } from "obsidian";
import {
  hasPendingMcpServers,
  type AgentExtensionGroup,
  type AgentExtensionRuntimeSnapshot,
} from "./extensionInventory";

// Reopening an extension page compares the configuration-derived fingerprint with the saved one and
// answers from the stored check when they match, so the backend check runs only for a changed
// configuration (and for an explicit refresh); the saved view is restored before the configuration
// scan finishes, so the page paints the previous answer instead of a loading state.
// https://github.com/ItsDalk-Lane/Scribe/issues/3
const MAX_CACHE_ENTRIES = 20;
const MAX_CACHED_VIEWS = 8;
const STORAGE_KEY = "scribe:extension-check-cache:v1";

export type ExtensionCheckRuntimeState = "not_started" | "checked" | "partial" | "error";

// The last answer a page displayed for one backend and scope, saved so a later open can paint it
// while the configuration scan re-derives the fingerprint.
// https://github.com/ItsDalk-Lane/Scribe/issues/3
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

interface PersistedCache {
  checks: Record<string, AgentExtensionRuntimeSnapshot>;
  views: Record<string, ExtensionCheckView>;
}

const checks = new Map<string, AgentExtensionRuntimeSnapshot>();
const views = new Map<string, ExtensionCheckView>();
let hydrated = false;

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
  app: App | null | undefined,
  key: string
): AgentExtensionRuntimeSnapshot | null {
  hydrate(app);
  return checks.get(key) ?? null;
}

// A snapshot that still shows a connecting server is an in-flight answer, never a cached one.
// https://github.com/ItsDalk-Lane/Scribe/issues/3
export function storeCachedExtensionCheck(
  app: App | null | undefined,
  key: string,
  runtime: AgentExtensionRuntimeSnapshot
): void {
  if (hasPendingMcpServers(runtime)) return;
  hydrate(app);
  evict(checks, MAX_CACHE_ENTRIES, key);
  checks.set(key, runtime);
  persist(app);
}

export function readCachedExtensionView(
  app: App | null | undefined,
  identity: string
): ExtensionCheckView | null {
  hydrate(app);
  return views.get(identity) ?? null;
}

export function storeCachedExtensionView(
  app: App | null | undefined,
  identity: string,
  view: ExtensionCheckView
): void {
  hydrate(app);
  evict(views, MAX_CACHED_VIEWS, identity);
  views.set(identity, view);
  persist(app);
}

export function resetExtensionCheckCacheForTests(): void {
  checks.clear();
  views.clear();
  hydrated = false;
}

function evict<T>(cache: Map<string, T>, limit: number, incoming: string): void {
  cache.delete(incoming);
  while (cache.size >= limit) {
    const oldest = cache.keys().next();
    if (oldest.done) return;
    cache.delete(oldest.value);
  }
}

function localStorageApp(app: App | null | undefined): App | null {
  return app &&
    typeof app.loadLocalStorage === "function" &&
    typeof app.saveLocalStorage === "function"
    ? app
    : null;
}

function hydrate(app: App | null | undefined): void {
  if (hydrated) return;
  hydrated = true;
  const store = localStorageApp(app);
  if (!store) return;
  try {
    const raw: unknown = store.loadLocalStorage(STORAGE_KEY);
    if (!raw || typeof raw !== "object") return;
    const persisted = raw as Partial<PersistedCache>;
    for (const [key, runtime] of Object.entries(persisted.checks ?? {})) {
      if (key && runtime && typeof runtime === "object") checks.set(key, runtime);
    }
    for (const [key, view] of Object.entries(persisted.views ?? {})) {
      if (key && view && Array.isArray(view.groups)) views.set(key, view);
    }
  } catch (error) {
    logWarn("Could not restore cached extension checks", error);
  }
}

function persist(app: App | null | undefined): void {
  const store = localStorageApp(app);
  if (!store) return;
  try {
    store.saveLocalStorage(STORAGE_KEY, {
      checks: Object.fromEntries(checks),
      views: Object.fromEntries(views),
    } satisfies PersistedCache);
  } catch (error) {
    logWarn("Could not save cached extension checks", error);
  }
}
