import type { App } from "obsidian";
import { scribeAppDataDir, getVaultId } from "@/utils/appPaths";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";

const LEGACY_PDF_CACHE_DIR = ".scribe/pdf-cache";

export async function clearLegacyCaches(app: App): Promise<boolean> {
  const { adapter } = app.vault;
  let cleared = false;
  if (await adapter.exists(LEGACY_PDF_CACHE_DIR)) {
    await adapter.rmdir(LEGACY_PDF_CACHE_DIR, true);
    cleared = true;
  }

  if (!isDesktopRuntime()) return cleared;
  const fs = requireNodeModule<typeof import("node:fs")>("fs");
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const contextCacheDir = path.join(
    scribeAppDataDir(os.homedir()),
    "vaults",
    getVaultId(app),
    "context-cache"
  );
  try {
    await fs.promises.lstat(contextCacheDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return cleared;
    throw error;
  }
  await fs.promises.rm(contextCacheDir, { recursive: true, force: true });
  return true;
}
