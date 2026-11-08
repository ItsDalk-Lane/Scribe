import { v4 as uuidv4 } from "uuid";
import { isSensitiveKey } from "@/services/settingsSecretTransforms";

import type { McpSecretRef, McpSecretScope } from "./types";

export interface McpSecretStorePort {
  setSecret(id: string, value: string): Promise<void>;
  deleteSecret(id: string): Promise<void>;
  withSecret<T>(id: string, execute: (plaintext: string) => Promise<T>): Promise<T>;
  getStatus(id: string): "missing" | "locked" | "available" | "unavailable";
}

const SECRET_SCOPES: readonly McpSecretScope[] = ["env", "headers"];

export function mcpSecretId(serverId: string, scope: McpSecretScope, key: string): string {
  return `mcp:${serverId}:${scope}:${key}`;
}

export interface McpSecretSplitResult {
  env?: Record<string, string>;
  headers?: Record<string, string>;
  secretRefs?: McpSecretRef[];
}

export async function persistMcpSecretEntries(
  store: McpSecretStorePort,
  serverId: string,
  draft: { env?: Record<string, string>; headers?: Record<string, string> },
  previousRefs: readonly McpSecretRef[] = []
): Promise<McpSecretSplitResult> {
  const inline: { env?: Record<string, string>; headers?: Record<string, string> } = {};
  const refs: McpSecretRef[] = [];
  for (const scope of SECRET_SCOPES) {
    const entries = draft[scope] ?? {};
    const previousForScope = new Map(
      previousRefs.filter((ref) => ref.scope === scope).map((ref) => [ref.key, ref])
    );
    for (const [key, value] of Object.entries(entries)) {
      if (!isSensitiveKey(key)) {
        if (value.length === 0) continue;
        (inline[scope] ??= {})[key] = value;
        continue;
      }
      if (value.length === 0) {
        const previous = previousForScope.get(key);
        if (previous) refs.push(previous);
        continue;
      }
      const baseId = mcpSecretId(serverId, scope, key);
      const secretId = previousForScope.has(key) ? `${baseId}:${uuidv4()}` : baseId;
      await store.setSecret(secretId, value);
      refs.push({ scope, key, secretId });
    }
  }
  return {
    ...(inline.env ? { env: inline.env } : {}),
    ...(inline.headers ? { headers: inline.headers } : {}),
    ...(refs.length > 0 ? { secretRefs: refs } : {}),
  };
}

export async function deleteUnusedMcpSecretEntries(
  store: McpSecretStorePort,
  previousRefs: readonly McpSecretRef[],
  nextRefs: readonly McpSecretRef[]
): Promise<void> {
  const retained = new Set(nextRefs.map((ref) => ref.secretId));
  for (const ref of previousRefs) {
    if (!retained.has(ref.secretId)) await store.deleteSecret(ref.secretId);
  }
}

export async function resolveMcpValues(
  store: McpSecretStorePort,
  server: {
    env?: Record<string, string>;
    headers?: Record<string, string>;
    secretRefs?: McpSecretRef[];
  }
): Promise<{ env: Record<string, string>; headers: Record<string, string> }> {
  const env: Record<string, string> = { ...(server.env ?? {}) };
  const headers: Record<string, string> = { ...(server.headers ?? {}) };
  for (const ref of server.secretRefs ?? []) {
    const target = ref.scope === "env" ? env : headers;
    target[ref.key] = await store.withSecret(ref.secretId, async (plaintext) => plaintext);
  }
  return { env, headers };
}
