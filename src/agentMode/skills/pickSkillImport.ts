import { t } from "@/lib/i18n";
import { requireNodeModule } from "@/utils/desktopRuntime";

interface SkillPickerElectron {
  webUtils?: { getPathForFile: (file: File) => string };
}

function selectedImportPath(kind: "folder" | "zip" | "md", file: File): string {
  const electron = requireNodeModule<SkillPickerElectron>("electron");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const absolute = electron.webUtils?.getPathForFile
    ? electron.webUtils.getPathForFile(file)
    : (file as File & { path?: string }).path;
  if (!absolute || !path.isAbsolute(absolute)) {
    throw new Error(t("The selected file has no accessible local path. Try choosing it again."));
  }
  if (kind !== "folder") return absolute;
  const relative = file.webkitRelativePath?.split("/");
  if (
    !relative ||
    relative.length < 2 ||
    relative.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(t("Could not determine the selected skill folder."));
  }
  return path.resolve(absolute, ...relative.slice(1).map(() => ".."));
}

export function pickSkillImport(
  kind: "folder" | "zip" | "md",
  ownerDocument: Document
): Promise<string | null> {
  return new Promise((resolve, reject) => {
    const input = ownerDocument.body.createEl("input", { attr: { type: "file" } });
    input.hidden = true;
    if (kind === "folder") input.setAttribute("webkitdirectory", "");
    else input.accept = kind === "zip" ? ".zip" : ".md";
    const cleanup = (): void => {
      input.removeEventListener("change", changed);
      input.removeEventListener("cancel", cancelled);
      input.remove();
    };
    const changed = (): void => {
      try {
        const file = input.files?.[0];
        if (!file) throw new Error(t("The selected folder does not contain any files."));
        resolve(selectedImportPath(kind, file));
      } catch (error) {
        reject(error instanceof Error ? error : new Error(t("Could not open the skill picker.")));
      } finally {
        cleanup();
      }
    };
    const cancelled = (): void => {
      cleanup();
      resolve(null);
    };
    input.addEventListener("change", changed, { once: true });
    input.addEventListener("cancel", cancelled, { once: true });
    try {
      input.click();
    } catch (error) {
      cleanup();
      reject(error instanceof Error ? error : new Error(t("Could not open the skill picker.")));
    }
  });
}
