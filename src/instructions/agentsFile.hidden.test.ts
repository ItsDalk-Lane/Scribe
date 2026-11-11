import {
  captureInstructionFiles,
  ensureAgentsFile,
  openAgentsFile,
  readAgentsFile,
  restoreInstructionFiles,
  writeAgentsFile,
} from "@/instructions/agentsFile";
import { openWithSystemDefault } from "@/utils/openWithSystemDefault";
import { FileSystemAdapter, TFile, type App } from "obsidian";
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

  function indexInstruction(path: string): void {
    const file = new (TFile as unknown as new (path: string) => TFile)(path);
    app.vault.getAbstractFileByPath = (requested) => (requested === path ? file : null);
    app.vault.read = (cached) => app.vault.adapter.read(cached.path);
    app.vault.modify = (cached, text) => app.vault.adapter.write(cached.path, text);
    app.vault.process = (cached, update) => app.vault.adapter.process(cached.path, update);
  }

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
    it("validates the actual file boundary even when Obsidian indexes the instruction file https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const external = mkdtempSync(join(tmpdir(), "scribe-instructions-other-"));
      try {
        const cached = new (TFile as unknown as new (path: string) => TFile)(instructionPath);
        app.vault.getAbstractFileByPath = () => cached;
        app.vault.read = jest.fn(async () => "Fixture text outside this vault");
        writeFileSync(join(external, "AGENTS.md"), "Fixture text outside this vault");
        symlinkSync(join(external, "AGENTS.md"), join(root, instructionPath));
        await expect(readAgentsFile(app, folder)).rejects.toThrow("不能通过链接指向库外");
        expect(app.vault.read).not.toHaveBeenCalled();
      } finally {
        rmSync(external, { recursive: true, force: true });
      }
    });
  });
  describe("writeAgentsFile()", () => {
    it("saves ordinary indexed rules through both editing entries https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      indexInstruction("AGENTS.md");
      writeFileSync(join(root, "AGENTS.md"), "Original");
      await writeAgentsFile(app, "", "Vault settings draft");
      expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("Vault settings draft");
      await writeAgentsFile(app, "", "Checked draft", "Vault settings draft");
      expect(readFileSync(join(root, "AGENTS.md"), "utf8")).toBe("Checked draft");
    });

    it("rejects a cached instruction path whose target is outside the vault https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const outside = mkdtempSync(join(tmpdir(), "scribe-other-vault-"));
      try {
        const externalPath = join(outside, "AGENTS.md");
        writeFileSync(externalPath, "Original");
        symlinkSync(externalPath, join(root, instructionPath));
        indexInstruction(instructionPath);
        await expect(writeAgentsFile(app, folder, "Draft", "Original")).rejects.toThrow(
          "不能通过链接指向库外"
        );
        expect(readFileSync(externalPath, "utf8")).toBe("Original");
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

    it("rechecks the vault settings target after its asynchronous comparison read https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const outside = mkdtempSync(join(tmpdir(), "scribe-other-vault-"));
      try {
        const externalPath = join(outside, "AGENTS.md");
        const vaultPath = join(root, "AGENTS.md");
        writeFileSync(externalPath, "Other vault rules");
        writeFileSync(vaultPath, "Original");
        indexInstruction("AGENTS.md");
        app.vault.read = async (cached) => {
          const original = await app.vault.adapter.read(cached.path);
          rmSync(vaultPath);
          symlinkSync(externalPath, vaultPath);
          return original;
        };
        await expect(writeAgentsFile(app, "", "Vault settings draft")).rejects.toThrow(
          "不能通过链接指向库外"
        );
        expect(readFileSync(externalPath, "utf8")).toBe("Other vault rules");
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

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
    it("rejects a cached recovery target outside the vault even when its contents match https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const outside = mkdtempSync(join(tmpdir(), "scribe-other-vault-"));
      try {
        const externalPath = join(outside, "AGENTS.md");
        writeFileSync(externalPath, "Draft");
        symlinkSync(externalPath, join(root, instructionPath));
        indexInstruction(instructionPath);
        await expect(
          restoreInstructionFiles(app, folder, { agents: "Original" }, "Draft")
        ).rejects.toThrow("不能通过链接指向库外");
        expect(readFileSync(externalPath, "utf8")).toBe("Draft");
      } finally {
        rmSync(outside, { recursive: true, force: true });
      }
    });

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
