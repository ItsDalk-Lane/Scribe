import { logWarn } from "@/logger";
import { matchSystemRoots } from "@/search/searchUtils";
import { getScribeSaveData } from "@/settings/scribeSaveData";
import {
  type ScribeSettings,
  getSettings,
  normalizeRootFolders,
  setSettings,
  validateScribeFolder,
} from "@/settings/model";
import {
  persistSettingsWithinTransaction,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import type { App } from "obsidian";
import { normalizePath, TFile } from "obsidian";

function buildRootPatch(
  current: Pick<ScribeSettings, "scribeFolder" | "scribeRootHistory">,
  folder: string
): Pick<ScribeSettings, "scribeFolder" | "scribeRootHistory"> {
  return {
    scribeRootHistory: normalizeRootFolders([
      ...current.scribeRootHistory,
      current.scribeFolder,
      folder,
    ]),
    scribeFolder: folder,
  };
}

export function scribeRootContainsNotes(app: App, folder: string): boolean {
  const root = normalizePath(folder).replace(/\/+$/, "");
  if (root.length === 0) return false;
  return app.vault.getMarkdownFiles().some((file) => matchSystemRoots(file.path, [root]));
}

export function findScribeRootFileConflict(app: App, folder: string): string | null {
  const root = normalizePath(folder).replace(/\/+$/, "");
  if (root.length === 0) return null;
  let prefix = "";
  for (const segment of root.split("/")) {
    prefix = prefix ? `${prefix}/${segment}` : segment;
    if (app.vault.getAbstractFileByPath(prefix) instanceof TFile) {
      return prefix;
    }
  }
  return null;
}

export async function applyScribeRootChange(app: App, newRoot: string): Promise<void> {
  const validation = validateScribeFolder(newRoot, app.vault.configDir);
  if (!validation.ok) {
    logWarn("Scribe root change rejected an invalid folder value.", validation.reason);
    return;
  }
  const folder = validation.folder;
  const saveData = getScribeSaveData(app);

  await runPersistenceTransaction(async () => {
    const previous = getSettings();
    const target: ScribeSettings = { ...previous, ...buildRootPatch(previous, folder) };
    await persistSettingsWithinTransaction(target, saveData, previous);

    const fresh = getSettings();
    const merged: ScribeSettings = { ...fresh, ...buildRootPatch(fresh, folder) };
    if (JSON.stringify(merged) !== JSON.stringify(target)) {
      try {
        await persistSettingsWithinTransaction(merged, saveData, target);
      } catch (reconcileError) {
        logWarn(
          "Scribe root change: reconcile save for a concurrent edit failed; " +
            "it stays in memory and lands with the next save.",
          reconcileError
        );
      }
    }

    suppressNextPersistOnce();
    setSettings((current) => buildRootPatch(current, folder));
  });
}
