import { App, FuzzySuggestModal, TFolder } from "obsidian";
import { t } from "@/lib/i18n";
import { extractAppIgnoreSettings } from "@/search/searchUtils";

export class FolderSearchModal extends FuzzySuggestModal<string> {
  constructor(
    app: App,
    private onChooseFolder: (folder: string) => void,
    private options: { includeRoot?: boolean; forWorkspace?: boolean } = {}
  ) {
    super(app);
  }

  getItems(): string[] {
    const folderSet = new Set<string>();
    const ignoredFolders = extractAppIgnoreSettings(this.app);

    if (this.options.includeRoot) folderSet.add("");
    this.app.vault.getAllLoadedFiles().forEach((file) => {
      if (!(file instanceof TFolder) || file.path === "/" || !file.path) return;
      const folder = file.path;
      if (ignoredFolders.some((ignored) => folder === ignored || folder.startsWith(ignored + "/")))
        return;
      if (
        this.options.forWorkspace &&
        [".scribe", this.app.vault.configDir].some(
          (root) => folder === root || folder.startsWith(root + "/")
        )
      )
        return;
      folderSet.add(folder);
    });
    return Array.from(folderSet);
  }

  getItemText(tag: string): string {
    return tag || t("Vault root");
  }

  onChooseItem(folder: string, evt: MouseEvent | KeyboardEvent) {
    this.onChooseFolder(folder);
  }
}
