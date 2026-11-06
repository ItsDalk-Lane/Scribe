import { type App, FileSystemAdapter } from "obsidian";
import { DEFAULT_SCRIBE_FOLDER } from "@/constants";
import { requireNodeModule } from "@/utils/desktopRuntime";

export function getScribeDataPath(app: App): string {
  if (!(app.vault.adapter instanceof FileSystemAdapter)) {
    throw new Error("The native agent requires a desktop vault.");
  }
  const path = requireNodeModule<typeof import("node:path")>("path");
  return path.join(app.vault.adapter.getBasePath(), DEFAULT_SCRIBE_FOLDER);
}
