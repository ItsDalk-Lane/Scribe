import { t } from "@/lib/i18n";
import { requireNodeModule } from "@/utils/desktopRuntime";

interface SkillPickerElectron {
  webUtils?: { getPathForFile: (file: File) => string };
}

export function resolveLocalImportPath(file: File): string | null {
  const electron = requireNodeModule<SkillPickerElectron>("electron");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const absolute = electron.webUtils?.getPathForFile
    ? electron.webUtils.getPathForFile(file)
    : (file as File & { path?: string }).path;
  return absolute && path.isAbsolute(absolute) ? absolute : null;
}

export function droppedSkillImportPath(dataTransfer: DataTransfer | null): string {
  const items = dataTransfer?.items ? Array.from(dataTransfer.items) : [];
  const file =
    items.find((item) => item.kind === "file")?.getAsFile?.() ?? dataTransfer?.files?.[0] ?? null;
  if (!file) throw new Error(t("Drop a skill folder or a ZIP archive."));
  const absolute = resolveLocalImportPath(file);
  if (!absolute) {
    throw new Error(t("The dropped item has no accessible local path. Try the import buttons."));
  }
  return absolute;
}
