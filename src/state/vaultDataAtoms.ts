import { atom } from "jotai";
import { App, TFile, TFolder, TAbstractFile } from "obsidian";
import { debounce } from "@/utils/debounce";
import { settingsStore } from "@/settings/model";
import { isAllowedFileForNoteContext } from "@/utils";
import { logInfo } from "@/logger";

const VAULT_DEBOUNCE_DELAY = 250;

export const notesAtom = atom<TFile[]>([]);
export const foldersAtom = atom<TFolder[]>([]);

export class VaultDataManager {
  private static instance: VaultDataManager | null = null;
  private initialized = false;
  private app: App | null = null;

  private constructor() {}

  public static getInstance(): VaultDataManager {
    if (!VaultDataManager.instance) {
      VaultDataManager.instance = new VaultDataManager();
    }
    return VaultDataManager.instance;
  }

  public initialize(app: App): void {
    if (this.initialized) {
      logInfo("VaultDataManager: Already initialized, skipping");
      return;
    }

    if (!app?.vault) {
      logInfo("VaultDataManager: app.vault not available, deferring initialization");
      return;
    }

    this.app = app;

    logInfo("VaultDataManager: Initializing with vault event listeners");

    this.refreshNotes();
    this.refreshFolders();

    app.vault.on("create", this.handleFileCreate);
    app.vault.on("delete", this.handleFileDelete);
    app.vault.on("rename", this.handleFileRename);

    this.initialized = true;
  }

  private handleFileCreate = (file: TAbstractFile): void => {
    if (file instanceof TFile) {
      if (isAllowedFileForNoteContext(file)) {
        this.debouncedRefreshNotes();
      }
    } else if (file instanceof TFolder) {
      this.debouncedRefreshFolders();
    }
  };

  private handleFileDelete = (file: TAbstractFile): void => {
    if (file instanceof TFile) {
      if (isAllowedFileForNoteContext(file)) {
        this.debouncedRefreshNotes();
      }
    } else if (file instanceof TFolder) {
      this.debouncedRefreshFolders();
    }
  };

  private handleFileRename = (file: TAbstractFile, _oldPath: string): void => {
    if (file instanceof TFile) {
      if (isAllowedFileForNoteContext(file)) {
        this.debouncedRefreshNotes();
      }
    } else if (file instanceof TFolder) {
      this.debouncedRefreshFolders();
    }
  };

  private debouncedRefreshNotes = debounce(() => this.refreshNotes(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  private debouncedRefreshFolders = debounce(() => this.refreshFolders(), VAULT_DEBOUNCE_DELAY, {
    leading: true,
    trailing: true,
  });

  private refreshNotes = (): void => {
    if (!this.app?.vault) return;

    const allFiles = this.app.vault.getFiles();
    const newFiles = allFiles.filter(
      (file): file is TFile => file instanceof TFile && isAllowedFileForNoteContext(file)
    );

    settingsStore.set(notesAtom, newFiles);
  };

  private refreshFolders = (): void => {
    if (!this.app?.vault) return;

    const newFolders = this.app.vault
      .getAllLoadedFiles()
      .filter((file: TAbstractFile): file is TFolder => file instanceof TFolder);

    settingsStore.set(foldersAtom, newFolders);
  };

  public cleanup(): void {
    if (!this.initialized) {
      return;
    }

    logInfo("VaultDataManager: Cleaning up event listeners");

    this.debouncedRefreshNotes.cancel();
    this.debouncedRefreshFolders.cancel();

    if (this.app?.vault) {
      this.app.vault.off("create", this.handleFileCreate);
      this.app.vault.off("delete", this.handleFileDelete);
      this.app.vault.off("rename", this.handleFileRename);
    }

    this.initialized = false;
  }

  public unload(): void {
    this.cleanup();
  }
}
