import type { FileSystemAdapter } from "obsidian";
import { requireNodeModule } from "@/utils/desktopRuntime";

const WRITE_LOCKS = new Map<string, Promise<void>>();

export async function withNativeWriteLock<T>(key: string, operation: () => Promise<T>): Promise<T> {
  const previous = WRITE_LOCKS.get(key);
  let unlock!: () => void;
  const current = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  WRITE_LOCKS.set(key, current);
  try {
    if (previous) await previous;
    return await operation();
  } finally {
    unlock();
    if (WRITE_LOCKS.get(key) === current) WRITE_LOCKS.delete(key);
  }
}

export async function resolveNativeVaultPath(
  adapter: FileSystemAdapter,
  requested: string,
  allowMissing = false
): Promise<string> {
  const vaultBase = adapter.getBasePath();
  const path = requireNodeModule<typeof import("node:path")>("path");
  const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
  const root = await fs.realpath(vaultBase);
  const absolute = path.resolve(vaultBase, requested.replace(/\\/g, "/"));
  const lexical = path.relative(vaultBase, absolute);
  if (path.isAbsolute(lexical) || lexical === ".." || lexical.startsWith(`..${path.sep}`)) {
    throw new Error("The path must stay inside the current vault.");
  }
  let candidate = absolute;
  const missing: string[] = [];
  while (true) {
    try {
      const real = path.join(await fs.realpath(candidate), ...missing);
      const relative = path.relative(root, real);
      if (path.isAbsolute(relative) || relative === ".." || relative.startsWith(`..${path.sep}`)) {
        throw new Error("The path must stay inside the current vault, including symbolic links.");
      }
      return relative.split(path.sep).join("/");
    } catch (error) {
      if (!allowMissing || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw error;
      missing.unshift(path.basename(candidate));
      candidate = parent;
    }
  }
}
