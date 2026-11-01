import type { App, TAbstractFile } from "obsidian";
import { TFile, TFolder } from "obsidian";
import { settingsStore } from "@/settings/model";
import { foldersAtom, notesAtom, VaultDataManager } from "./vaultDataAtoms";

function vaultFile(path: string): TFile {
  return Object.assign(new TFile(), { path, extension: path.split(".").pop() });
}

function vaultApp(files: TFile[], folders: TFolder[]) {
  const listeners = new Map<string, (file: TAbstractFile) => void>();
  const app = {
    vault: {
      getFiles: () => files,
      getAllLoadedFiles: () => [...files, ...folders],
      on: (event: string, listener: (file: TAbstractFile) => void) =>
        listeners.set(event, listener),
      off: (event: string) => listeners.delete(event),
    },
  } as unknown as App;
  return { app, listeners };
}

describe("vaultDataAtoms", () => {
  describe("VaultDataManager", () => {
    afterEach(() => VaultDataManager.getInstance().cleanup());

    describe("getInstance()", () => {
      it("shares one vault candidate manager", () => {
        expect(VaultDataManager.getInstance()).toBe(VaultDataManager.getInstance());
      });
    });

    describe("initialize()", () => {
      it("loads note and folder candidates and includes a newly created note", () => {
        const note = vaultFile("Plan.md");
        const pdf = vaultFile("Paper.pdf");
        const image = vaultFile("Screenshot.png");
        const folder = Object.assign(new TFolder(), { path: "Research" });
        const files = [note, pdf, image];
        const { app, listeners } = vaultApp(files, [folder]);
        VaultDataManager.getInstance().initialize(app);
        expect(settingsStore.get(notesAtom)).toEqual([note, pdf]);
        expect(settingsStore.get(foldersAtom)).toEqual([folder]);
        const added = vaultFile("Results.md");
        files.push(added);
        listeners.get("create")!(added);
        expect(settingsStore.get(notesAtom)).toEqual([note, pdf, added]);
      });
    });

    describe("cleanup()", () => {
      it("removes listeners and allows a different vault to initialize", () => {
        const first = vaultApp([vaultFile("First.md")], []);
        const manager = VaultDataManager.getInstance();
        manager.initialize(first.app);
        manager.cleanup();
        expect(first.listeners.size).toBe(0);
        const second = vaultApp([vaultFile("Second.md")], []);
        manager.initialize(second.app);
        expect(settingsStore.get(notesAtom).map((file) => file.path)).toEqual(["Second.md"]);
      });
    });

    describe("unload()", () => {
      it("releases the active vault listeners", () => {
        const { app, listeners } = vaultApp([], []);
        const manager = VaultDataManager.getInstance();
        manager.initialize(app);
        manager.unload();
        expect(listeners.size).toBe(0);
      });
    });
  });
});
