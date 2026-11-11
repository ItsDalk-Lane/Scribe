import { normalizeProjectWorkspace, validateProjectWorkspace } from "@/projects/projectWorkspace";
import { FileSystemAdapter, type App } from "obsidian";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("projectWorkspace", () => {
  describe("normalizeProjectWorkspace()", () => {
    it("normalizes a vault-relative directory and preserves an explicitly selected vault root", () => {
      expect(normalizeProjectWorkspace("Research\\Empty/", ".config")).toBe("Research/Empty");
      expect(normalizeProjectWorkspace("", ".config")).toBe("");
    });
    it.each(["../outside", "/outside", "C:\\outside", ".scribe", ".config/secret"])(
      "rejects the unsafe workspace %s",
      (path) => {
        expect(() => normalizeProjectWorkspace(path, ".config")).toThrow();
      }
    );
  });
  describe("validateProjectWorkspace()", () => {
    let root: string;
    let app: App;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "scribe-workspace-"));
      const adapter = new (FileSystemAdapter as unknown as new (root: string) => FileSystemAdapter)(
        root
      );
      app = { vault: { adapter, configDir: ".config" } } as unknown as App;
    });
    afterEach(() => rmSync(root, { recursive: true, force: true }));
    it("accepts an existing empty folder and the vault root", async () => {
      mkdirSync(join(root, "Empty"));
      await expect(validateProjectWorkspace(app, "Empty")).resolves.toBe("Empty");
      await expect(validateProjectWorkspace(app, "")).resolves.toBe("");
    });
    it("allows a missing default folder but rejects a missing explicitly selected folder", async () => {
      await expect(validateProjectWorkspace(app, "New", true)).resolves.toBe("New");
      await expect(validateProjectWorkspace(app, "New")).rejects.toThrow();
    });
    it("rejects an alias into plugin data even when its real target remains inside the vault", async () => {
      mkdirSync(join(root, ".scribe"));
      symlinkSync(join(root, ".scribe"), join(root, "Alias"));
      await expect(validateProjectWorkspace(app, "Alias")).rejects.toThrow();
    });
    it("rejects a dangling folder link instead of following its missing target", async () => {
      symlinkSync(join(root, "Missing"), join(root, "Alias"));
      await expect(validateProjectWorkspace(app, "Alias", true)).rejects.toThrow();
    });
  });
});
