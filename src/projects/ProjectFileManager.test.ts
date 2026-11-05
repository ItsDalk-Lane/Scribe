import { App, type TAbstractFile, type TFile, Vault } from "obsidian";
import { ProjectConfig } from "@/aiParams";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import {
  getCachedProjectRecords,
  isPendingFileWrite,
  updateCachedProjectRecords,
  upsertCachedProjectRecord,
} from "@/projects/state";
import { mockTFile, mockTFolder } from "@/__tests__/mockObsidian";
import { loadAllProjects } from "@/projects/projectUtils";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ scribeFolder: "vault-scribe" })),
  updateSetting: jest.fn(),
}));

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
  logError: jest.fn(),
  logInfo: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ...jest.requireActual<typeof import("@/utils")>("@/utils"),
  ensureFolderExists: jest.fn(async () => {}),
}));

function makeConfig(
  overrides: { id: string; name: string } & Partial<ProjectConfig>
): ProjectConfig {
  return {
    systemPrompt: "",
    contextSource: {},
    created: 0,
    UsageTimestamps: 0,
    ...overrides,
  };
}

function seedProject(config: ProjectConfig, folderName: string): void {
  upsertCachedProjectRecord({
    project: config,
    filePath: `vault-scribe/projects/${folderName}/project.md`,
    folderName,
  });
}

interface TestVault {
  app: App;
  vault: jest.Mocked<Vault>;
  frontmatter: Record<string, unknown>;
}

function makeTestVault(options: { existingPaths?: string[] } = {}): TestVault {
  const frontmatter: Record<string, unknown> = {};
  const vault = {
    create: jest.fn(async (path: string) => mockTFile({ path })),
    getAbstractFileByPath: jest.fn(() => null),
    adapter: {
      exists: jest.fn(async (path: string) => options.existingPaths?.includes(path) ?? false),
    },
  } as unknown as jest.Mocked<Vault>;
  const app = {
    vault,
    fileManager: {
      processFrontMatter: jest.fn(
        async (_file: unknown, update: (value: Record<string, unknown>) => void) =>
          update(frontmatter)
      ),
      trashFile: jest.fn(async () => {}),
    },
  } as unknown as App;
  return { app, vault, frontmatter };
}

function resetSingleton() {
  (ProjectFileManager as unknown as Record<string, unknown>)["instance"] = undefined;
}

function diskVault(root: string) {
  const trash = join(root, "trash");
  mkdirSync(trash);
  const failures = new Set<string>();
  const trashed: string[] = [];
  const fileFor = (path: string) => {
    const name = posix.basename(path);
    return mockTFile({ path, name, basename: name.replace(/\.[^/.]+$/, ""), extension: "md" });
  };
  const find = (path: string): TAbstractFile | null => {
    const absolute = join(root, path);
    if (!existsSync(absolute)) return null;
    if (!statSync(absolute).isDirectory()) return fileFor(path);
    return mockTFolder({
      path,
      name: posix.basename(path),
      children: readdirSync(absolute).flatMap((name) => {
        const child = find(posix.join(path, name));
        return child ? [child] : [];
      }),
    });
  };
  const app = {
    vault: {
      getAbstractFileByPath: find,
      read: async (file: TFile) => readFileSync(join(root, file.path), "utf8"),
      create: async (path: string, content: string) => {
        writeFileSync(join(root, path), content, { flag: "wx" });
        return fileFor(path);
      },
      adapter: { exists: async (path: string) => existsSync(join(root, path)) },
    },
    metadataCache: { getFileCache: () => null },
    fileManager: {
      processFrontMatter: async (file: TFile, update: (value: Record<string, unknown>) => void) => {
        const path = join(root, file.path);
        const body = readFileSync(path, "utf8");
        const frontmatter: Record<string, unknown> = {};
        update(frontmatter);
        writeFileSync(path, `---\n${JSON.stringify(frontmatter)}\n---\n${body}`);
      },
      trashFile: async (file: TAbstractFile) => {
        if (failures.has(file.path)) throw new Error(`Cannot trash ${file.path}`);
        renameSync(join(root, file.path), join(trash, `${trashed.length}-${file.name}`));
        trashed.push(file.path);
      },
    },
  } as unknown as App;
  return { app, failures, trash, trashed };
}

describe("ProjectFileManager", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetSingleton();
    updateCachedProjectRecords([]);
  });

  describe("createProject()", () => {
    it("creates project.md in a folder named after the project and caches the new record", async () => {
      const { app, vault, frontmatter } = makeTestVault();
      const manager = ProjectFileManager.getInstance(app);

      const record = await manager.createProject(
        makeConfig({ id: "p1", name: "My Project", systemPrompt: "Cite every source." })
      );

      const filePath = "vault-scribe/projects/My Project/project.md";
      expect(vault.create).toHaveBeenCalledWith(filePath, "Cite every source.");
      expect(frontmatter).toMatchObject({
        "scribe-project-id": "p1",
        "scribe-project-name": "My Project",
      });
      expect(record).toMatchObject({ filePath, folderName: "My Project" });
      expect(getCachedProjectRecords()).toEqual([record]);
      expect(isPendingFileWrite(filePath)).toBe(false);
    });

    it("names the project folder after its id when the name is empty", async () => {
      const { app } = makeTestVault();
      const manager = ProjectFileManager.getInstance(app);

      const record = await manager.createProject(makeConfig({ id: "p1", name: "" }));

      expect(record.folderName).toBe("p1");
    });

    it("rejects a project whose name matches an existing project case-insensitively", async () => {
      seedProject(makeConfig({ id: "existing", name: "My Project" }), "existing");
      const manager = ProjectFileManager.getInstance(makeTestVault().app);

      await expect(
        manager.createProject(makeConfig({ id: "new-project", name: "my project" }))
      ).rejects.toThrow(/already exists/i);
      expect(getCachedProjectRecords()).toHaveLength(1);
    });

    it("rejects a project whose id is already in use", async () => {
      seedProject(makeConfig({ id: "p1", name: "First" }), "First");
      const manager = ProjectFileManager.getInstance(makeTestVault().app);

      await expect(manager.createProject(makeConfig({ id: "p1", name: "Second" }))).rejects.toThrow(
        "Project id already exists: p1"
      );
    });

    it.each([[""], ["   "]])("rejects the blank project id %j", async (id) => {
      const manager = ProjectFileManager.getInstance(makeTestVault().app);

      await expect(manager.createProject(makeConfig({ id, name: "Valid Name" }))).rejects.toThrow(
        /cannot be empty/i
      );
    });

    it("rejects a name whose sanitized folder collides with another project's folder", async () => {
      seedProject(makeConfig({ id: "first", name: "a/b" }), "a_b");
      const { app, vault } = makeTestVault();
      const manager = ProjectFileManager.getInstance(app);

      await expect(
        manager.createProject(makeConfig({ id: "second", name: "a|b" }))
      ).rejects.toThrow(/Folder name collision/);
      expect(vault.create).not.toHaveBeenCalled();
    });

    it("refuses to overwrite a project.md that already exists on disk", async () => {
      const filePath = "vault-scribe/projects/My Project/project.md";
      const { app, vault } = makeTestVault({ existingPaths: [filePath] });
      const manager = ProjectFileManager.getInstance(app);

      await expect(
        manager.createProject(makeConfig({ id: "p1", name: "My Project" }))
      ).rejects.toThrow(/already exists/i);
      expect(vault.create).not.toHaveBeenCalled();
      expect(getCachedProjectRecords()).toEqual([]);
      expect(isPendingFileWrite(filePath)).toBe(false);
    });
  });

  describe("deleteProject()", () => {
    const folder = "vault-scribe/projects/Research";
    const configPath = `${folder}/project.md`;
    const marker = "<!-- scribe:generated-agents-mirror v1 — Auto-generated; do not edit here. -->";
    const projectFile = "---\nscribe-project-id: p1\nscribe-project-name: Research\n---\n";
    let root: string;
    let vault: ReturnType<typeof diskVault>;

    beforeEach(async () => {
      root = mkdtempSync(join(tmpdir(), "scribe-project-delete-"));
      mkdirSync(join(root, folder), { recursive: true });
      writeFileSync(join(root, configPath), projectFile);
      writeFileSync(join(root, folder, "notes.md"), "My own notes.\n");
      writeFileSync(join(root, folder, "CLAUDE.md"), "@AGENTS.md\n");
      vault = diskVault(root);
      await loadAllProjects(vault.app);
      expect(getCachedProjectRecords()).toHaveLength(1);
    });

    afterEach(() => rmSync(root, { recursive: true, force: true }));

    it.each([
      [
        "a user-edited file with a generated marker",
        `${marker}\n\nChanged by the user.\n`,
        "# User notes\n\n@AGENTS.md\n",
      ],
      [
        "an unedited file with a generated marker",
        `${marker}\n\nOriginal instructions.\n`,
        "@AGENTS.md\n",
      ],
      ["a file without a generated marker", "My own project instructions.\n", "My other rules.\n"],
    ])(
      "keeps %s and other user files when removing the project",
      async (_description, content, otherInstructions) => {
        const instructionsPath = join(root, folder, "AGENTS.md");
        writeFileSync(instructionsPath, content);
        writeFileSync(join(root, folder, "CLAUDE.md"), otherInstructions);

        await ProjectFileManager.getInstance(vault.app).deleteProject("p1");

        expect(existsSync(instructionsPath)).toBe(true);
        expect(readFileSync(instructionsPath)).toEqual(Buffer.from(content));
        expect(readFileSync(join(root, folder, "notes.md"), "utf8")).toBe("My own notes.\n");
        expect(readFileSync(join(root, folder, "CLAUDE.md"), "utf8")).toBe(otherInstructions);
        expect(existsSync(join(root, configPath))).toBe(false);
        expect(readFileSync(join(vault.trash, "0-project.md"), "utf8")).toBe(projectFile);
        expect(vault.trashed).toEqual([configPath]);
        expect(getCachedProjectRecords()).toEqual([]);
        expect(isPendingFileWrite(configPath)).toBe(false);
      }
    );

    it("keeps retained instructions when creating another project with the same name", async () => {
      const instructionsPath = join(root, folder, "AGENTS.md");
      const content = `${marker}\n\nUser-edited original.\n`;
      writeFileSync(instructionsPath, content);
      const manager = ProjectFileManager.getInstance(vault.app);

      await manager.deleteProject("p1");
      const created = await manager.createProject(
        makeConfig({ id: "p2", name: "Research", systemPrompt: "New project instructions." })
      );

      expect(created.project.id).toBe("p2");
      expect(readFileSync(instructionsPath)).toEqual(Buffer.from(content));
      expect(readFileSync(join(root, configPath), "utf8")).toContain("New project instructions.");
      expect(readFileSync(join(root, folder, "notes.md"), "utf8")).toBe("My own notes.\n");
    });

    it("removes an empty project folder after moving its configuration to the trash", async () => {
      unlinkSync(join(root, folder, "notes.md"));
      unlinkSync(join(root, folder, "CLAUDE.md"));

      await ProjectFileManager.getInstance(vault.app).deleteProject("p1");

      expect(existsSync(join(root, folder))).toBe(false);
      expect(readFileSync(join(vault.trash, "0-project.md"), "utf8")).toBe(projectFile);
      expect(vault.trashed).toEqual([configPath, folder]);
    });

    it("keeps the project and all files when moving its configuration to the trash fails", async () => {
      const content = `${marker}\n\nUser-edited original.\n`;
      writeFileSync(join(root, folder, "AGENTS.md"), content);
      vault.failures.add(configPath);

      await expect(ProjectFileManager.getInstance(vault.app).deleteProject("p1")).rejects.toThrow(
        `Cannot trash ${configPath}`
      );

      expect(readFileSync(join(root, configPath), "utf8")).toBe(projectFile);
      expect(readFileSync(join(root, folder, "AGENTS.md"), "utf8")).toBe(content);
      expect(readFileSync(join(root, folder, "notes.md"), "utf8")).toBe("My own notes.\n");
      expect(vault.trashed).toEqual([]);
      expect(getCachedProjectRecords().map((record) => record.project.id)).toEqual(["p1"]);
      expect(isPendingFileWrite(configPath)).toBe(false);
    });

    it("keeps a project removed when its now-empty folder cannot be moved to the trash", async () => {
      unlinkSync(join(root, folder, "notes.md"));
      unlinkSync(join(root, folder, "CLAUDE.md"));
      vault.failures.add(folder);

      await expect(
        ProjectFileManager.getInstance(vault.app).deleteProject("p1")
      ).resolves.toBeUndefined();

      expect(existsSync(join(root, folder))).toBe(true);
      expect(readdirSync(join(root, folder))).toEqual([]);
      expect(readFileSync(join(vault.trash, "0-project.md"), "utf8")).toBe(projectFile);
      expect(vault.trashed).toEqual([configPath]);
      expect(getCachedProjectRecords()).toEqual([]);
      expect(isPendingFileWrite(configPath)).toBe(false);
    });
  });
});
