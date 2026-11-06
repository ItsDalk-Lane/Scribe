import {
  captureInstructionFiles,
  ensureAgentsFile,
  openAgentsFile,
  readAgentsFile,
  restoreInstructionFiles,
  writeAgentsFile,
} from "@/instructions/agentsFile";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { FileSystemAdapter, type App } from "obsidian";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("@/utils/openWithSystemDefault", () => ({
  openWithSystemDefault: jest.fn(async () => {}),
}));

describe("agentsFile", () => {
  let root: string;
  let app: App;
  const folder = ".Hidden Research";
  const instructionPath = `${folder}/AGENTS.md`;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "scribe-instructions-"));
    mkdirSync(join(root, folder));
    const adapter = new (FileSystemAdapter as unknown as new (root: string) => FileSystemAdapter)(
      root
    );
    Object.assign(adapter, {
      exists: async (path: string) => existsSync(join(root, path)),
      stat: async (path: string) => {
        if (!existsSync(join(root, path))) return null;
        const value = statSync(join(root, path));
        return {
          type: value.isDirectory() ? "folder" : "file",
          ctime: value.ctimeMs,
          mtime: value.mtimeMs,
          size: value.size,
        };
      },
      read: async (path: string) => readFileSync(join(root, path), "utf8"),
      write: async (path: string, content: string) => {
        writeFileSync(join(root, path), content);
      },
      process: async (path: string, update: (content: string) => string) => {
        const text = update(readFileSync(join(root, path), "utf8"));
        writeFileSync(join(root, path), text);
        return text;
      },
    });
    app = {
      vault: { adapter, configDir: ".config", getAbstractFileByPath: () => null },
      workspace: { getLeaf: jest.fn() },
    } as unknown as App;
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
    jest.clearAllMocks();
  });
  describe("readAgentsFile()", () => {
    it("reads workspace instructions even when Obsidian does not index their hidden folder", async () => {
      writeFileSync(join(root, instructionPath), "User instructions\n");
      expect(await readAgentsFile(app, folder)).toBe("User instructions\n");
    });
    it("rejects an instruction file that links outside the vault", async () => {
      const external = mkdtempSync(join(tmpdir(), "scribe-external-instructions-"));
      try {
        writeFileSync(join(external, "AGENTS.md"), "External private text");
        symlinkSync(join(external, "AGENTS.md"), join(root, instructionPath));
        await expect(readAgentsFile(app, folder)).rejects.toThrow();
      } finally {
        rmSync(external, { recursive: true, force: true });
      }
    });
  });
  describe("writeAgentsFile()", () => {
    it("saves matching hidden instructions and preserves a newer external edit", async () => {
      writeFileSync(join(root, instructionPath), "Original");
      await writeAgentsFile(app, folder, "Updated", "Original");
      expect(readFileSync(join(root, instructionPath), "utf8")).toBe("Updated");
      writeFileSync(join(root, instructionPath), "External update");
      await expect(writeAgentsFile(app, folder, "Draft", "Updated")).rejects.toThrow();
      expect(readFileSync(join(root, instructionPath), "utf8")).toBe("External update");
    });
    it("refuses a new save if another operation creates the instruction file first", async () => {
      const exists = app.vault.adapter.exists;
      let checks = 0;
      app.vault.adapter.exists = async (path) => {
        checks += 1;
        if (checks === 2) writeFileSync(join(root, instructionPath), "External creation");
        return exists(path);
      };
      await expect(writeAgentsFile(app, folder, "Draft", "")).rejects.toThrow();
      expect(readFileSync(join(root, instructionPath), "utf8")).toBe("External creation");
    });
    it("creates a missing hidden instruction file from an empty baseline without a vault file object", async () => {
      await writeAgentsFile(app, folder, "New instructions", "");
      expect(readFileSync(join(root, instructionPath), "utf8")).toBe("New instructions");
    });
  });
  describe("ensureAgentsFile()", () => {
    it("creates a hidden instruction file once and never rewrites its existing text", async () => {
      await ensureAgentsFile(app, folder, "Original");
      await ensureAgentsFile(app, folder, "Replacement");
      expect(readFileSync(join(root, instructionPath), "utf8")).toBe("Original");
    });
  });
  describe("captureInstructionFiles()", () => {
    it("captures the exact hidden instruction file for save recovery", async () => {
      writeFileSync(join(root, instructionPath), "Original\n");
      expect(await captureInstructionFiles(app, folder)).toEqual({ agents: "Original\n" });
    });
  });
  describe("restoreInstructionFiles()", () => {
    it("restores its own hidden draft while preserving a later external edit", async () => {
      writeFileSync(join(root, instructionPath), "Draft");
      await restoreInstructionFiles(app, folder, { agents: "Original" }, "Draft");
      expect(readFileSync(join(root, instructionPath), "utf8")).toBe("Original");
      writeFileSync(join(root, instructionPath), "External update");
      await expect(
        restoreInstructionFiles(app, folder, { agents: "Original" }, "Draft")
      ).rejects.toThrow();
      expect(readFileSync(join(root, instructionPath), "utf8")).toBe("External update");
    });
  });
  describe("openAgentsFile()", () => {
    it("opens hidden workspace instructions with the system application", async () => {
      writeFileSync(join(root, instructionPath), "Original");
      await openAgentsFile(app, folder);
      expect(openWithSystemDefault).toHaveBeenCalledWith(join(root, instructionPath));
      expect(app.workspace.getLeaf).not.toHaveBeenCalled();
    });
  });
});
