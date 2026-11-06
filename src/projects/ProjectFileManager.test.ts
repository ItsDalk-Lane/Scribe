import type { ProjectConfig } from "@/aiParams";
import { serializeProjectConfig } from "@/projects/projectUtils";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecords, updateCachedProjectRecords } from "@/projects/state";
import { FileSystemAdapter, type App } from "obsidian";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  rmdirSync,
  statSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

jest.mock("@/logger", () => ({ logWarn: jest.fn(), logError: jest.fn(), logInfo: jest.fn() }));
jest.mock("@/settings/scribeFolder", () => ({
  getEffectiveProjectsFolder: () => ".scribe/projects",
}));

function project(overrides: Partial<ProjectConfig> = {}): ProjectConfig {
  return {
    id: "research-id",
    name: "Research",
    systemPrompt: "",
    description: "",
    contextSource: { inclusions: "", exclusions: "", webUrls: "", youtubeUrls: "" },
    created: 1,
    UsageTimestamps: 1,
    ...overrides,
  };
}

function diskApp(root: string): App {
  const adapter = new (FileSystemAdapter as unknown as new (root: string) => FileSystemAdapter)(
    root
  );
  Object.assign(adapter, {
    exists: async (path: string) => existsSync(join(root, path)),
    mkdir: async (path: string) => {
      mkdirSync(join(root, path));
    },
    read: async (path: string) => readFileSync(join(root, path), "utf8"),
    write: async (path: string, content: string) => {
      writeFileSync(join(root, path), content);
    },
    rename: async (from: string, to: string) => {
      renameSync(join(root, from), join(root, to));
    },
    remove: async (path: string) => {
      unlinkSync(join(root, path));
    },
    rmdir: async (path: string) => {
      rmdirSync(join(root, path));
    },
    stat: async (path: string) => {
      if (!existsSync(join(root, path))) return null;
      const result = statSync(join(root, path));
      return {
        type: result.isDirectory() ? "folder" : "file",
        ctime: result.ctimeMs,
        mtime: result.mtimeMs,
        size: result.size,
      };
    },
    list: async (path: string) => {
      const entries = readdirSync(join(root, path));
      return {
        files: entries
          .filter((name) => statSync(join(root, path, name)).isFile())
          .map((name) => `${path}/${name}`),
        folders: entries
          .filter((name) => statSync(join(root, path, name)).isDirectory())
          .map((name) => `${path}/${name}`),
      };
    },
  });
  return {
    vault: { adapter, configDir: ".custom-config", getAbstractFileByPath: () => null },
    metadataCache: { getFileCache: () => null },
  } as unknown as App;
}

describe("ProjectFileManager", () => {
  describe("ProjectFileManager", () => {
    let root: string;
    let app: App;
    let manager: ProjectFileManager;
    beforeEach(() => {
      root = mkdtempSync(join(tmpdir(), "scribe-projects-"));
      app = diskApp(root);
      (ProjectFileManager as unknown as { instance?: ProjectFileManager }).instance = undefined;
      updateCachedProjectRecords([]);
      manager = ProjectFileManager.getInstance(app);
    });
    afterEach(() => {
      rmSync(root, { recursive: true, force: true });
      updateCachedProjectRecords([]);
    });

    describe("getInstance()", () => {
      it("returns the same initialized project manager", () => {
        expect(ProjectFileManager.getInstance()).toBe(manager);
      });
    });
    describe("createProject()", () => {
      it("stores hidden configuration by id and creates a separate default workspace", async () => {
        const record = await manager.createProject(project());
        expect(record.filePath).toBe(".scribe/projects/research-id/project.md");
        expect(record.project.workspacePath).toBe("Research");
        expect(statSync(join(root, "Research")).isDirectory()).toBe(true);
        expect(readdirSync(join(root, "Research"))).toEqual([]);
        expect(getCachedProjectRecords()).toEqual([record]);
      });
      it("uses an explicitly selected existing empty folder without adding a project subfolder", async () => {
        mkdirSync(join(root, "Existing"));
        const record = await manager.createProject(project({ workspacePath: "Existing" }));
        expect(record.project.workspacePath).toBe("Existing");
        expect(readdirSync(join(root, "Existing"))).toEqual([]);
        expect(existsSync(join(root, "Research"))).toBe(false);
      });
      it("accepts the vault root as an explicitly selected workspace", async () => {
        const record = await manager.createProject(project({ workspacePath: "" }));
        expect(record.project.workspacePath).toBe("");
        expect(existsSync(join(root, "Research"))).toBe(false);
      });
      it("does not reuse an existing default folder or touch its notes", async () => {
        mkdirSync(join(root, "Research"));
        writeFileSync(join(root, "Research", "note.md"), "keep");
        await expect(manager.createProject(project())).rejects.toThrow("已存在");
        expect(readFileSync(join(root, "Research", "note.md"), "utf8")).toBe("keep");
        expect(getCachedProjectRecords()).toEqual([]);
      });
      it("rejects a workspace symlink that points outside the vault", async () => {
        const external = mkdtempSync(join(tmpdir(), "scribe-external-"));
        try {
          symlinkSync(external, join(root, "External"));
          await expect(
            manager.createProject(project({ workspacePath: "External" }))
          ).rejects.toThrow();
          expect(readdirSync(external)).toEqual([]);
        } finally {
          rmSync(external, { recursive: true, force: true });
        }
      });
      it("removes its newly created empty workspace after configuration save fails so retry can succeed", async () => {
        jest.spyOn(app.vault.adapter, "write").mockRejectedValueOnce(new Error("disk full"));
        await expect(manager.createProject(project())).rejects.toThrow("disk full");
        expect(existsSync(join(root, "Research"))).toBe(false);
        expect((await manager.createProject(project())).project.workspacePath).toBe("Research");
      });
      it("rejects path traversal and plugin data directories as workspaces", async () => {
        await expect(
          manager.createProject(project({ workspacePath: "../escape" }))
        ).rejects.toThrow();
        await expect(
          manager.createProject(project({ workspacePath: ".scribe" }))
        ).rejects.toThrow();
      });
    });
    describe("updateProject()", () => {
      it("renames only the project label and preserves the workspace and stable configuration path", async () => {
        const original = await manager.createProject(project());
        writeFileSync(join(root, "Research", "AGENTS.md"), "keep instructions");
        const changed = await manager.updateProject(original.project.id, {
          ...original.project,
          name: "Renamed",
        });
        expect(changed.filePath).toBe(original.filePath);
        expect(changed.project.workspacePath).toBe("Research");
        expect(readFileSync(join(root, "Research", "AGENTS.md"), "utf8")).toBe("keep instructions");
        expect(existsSync(join(root, "Renamed"))).toBe(false);
      });
      it("merges an edited field without reverting externally changed fields or unknown metadata", async () => {
        const original = await manager.createProject(project());
        const external = {
          ...original.project,
          description: "External description",
          systemPrompt: "External body\n\n",
          contextSource: { ...original.project.contextSource, inclusions: "External/" },
        };
        writeFileSync(
          join(root, original.filePath),
          serializeProjectConfig(external).replace("\n---", "\nfuture: {keep: true}\n---")
        );
        const changed = await manager.updateProject(original.project.id, {
          ...original.project,
          name: "Renamed",
        });
        expect(changed.project).toEqual({ ...external, name: "Renamed" });
        expect(readFileSync(join(root, original.filePath), "utf8")).toContain(
          "future: { keep: true }"
        );
      });
      it("keeps an editor's opened baseline after the visible project list has refreshed", async () => {
        const original = await manager.createProject(project());
        const external = serializeProjectConfig({ ...original.project, name: "External" });
        writeFileSync(join(root, original.filePath), external);
        await manager.fetchProjects();
        await expect(
          manager.updateProject(
            original.project.id,
            { ...original.project, name: "Draft" },
            original.project
          )
        ).rejects.toThrow("其他");
        expect(readFileSync(join(root, original.filePath), "utf8")).toBe(external);
      });
      it("does not recreate configuration deleted while an editor was open", async () => {
        const original = await manager.createProject(project());
        unlinkSync(join(root, original.filePath));
        await expect(
          manager.updateProject(original.project.id, { ...original.project, name: "Draft" })
        ).rejects.toThrow("删除");
        expect(getCachedProjectRecords()).toEqual([]);
        expect(existsSync(join(root, original.filePath))).toBe(false);
      });
      it("rejects a conflicting field edit and publishes the external value without changing the file", async () => {
        const original = await manager.createProject(project());
        const external = serializeProjectConfig({ ...original.project, name: "External" });
        writeFileSync(join(root, original.filePath), external);
        await expect(
          manager.updateProject(original.project.id, { ...original.project, name: "Draft" })
        ).rejects.toThrow("其他");
        expect(readFileSync(join(root, original.filePath), "utf8")).toBe(external);
        expect(getCachedProjectRecords()[0].project.name).toBe("External");
      });
    });
    describe("deleteProject()", () => {
      it("removes only hidden configuration and preserves all workspace files", async () => {
        const record = await manager.createProject(project());
        writeFileSync(join(root, "Research", "AGENTS.md"), "keep");
        await manager.deleteProject(record.project.id);
        expect(existsSync(join(root, record.filePath))).toBe(false);
        expect(readFileSync(join(root, "Research", "AGENTS.md"), "utf8")).toBe("keep");
        expect(getCachedProjectRecords()).toEqual([]);
      });
      it("forgets externally deleted configuration without deleting workspace notes", async () => {
        const record = await manager.createProject(project());
        writeFileSync(join(root, "Research", "note.md"), "keep note");
        unlinkSync(join(root, record.filePath));
        await manager.deleteProject(record.project.id);
        expect(getCachedProjectRecords()).toEqual([]);
        expect(readFileSync(join(root, "Research", "note.md"), "utf8")).toBe("keep note");
      });
    });
    describe("initialize()", () => {
      it("loads newly saved projects through the adapter without a vault file index", async () => {
        const record = await manager.createProject(project());
        updateCachedProjectRecords([]);
        await manager.initialize();
        expect(getCachedProjectRecords()).toEqual([record]);
      });
    });
    describe("fetchProjects()", () => {
      it("ignores old folders and configurations that lack an explicit workspace", async () => {
        mkdirSync(join(root, "Scribe", "projects", "old"), { recursive: true });
        const old = "---\nscribe-project-id: old\nscribe-project-name: Old\n---\nOld instructions";
        writeFileSync(join(root, "Scribe", "projects", "old", "project.md"), old);
        mkdirSync(join(root, ".scribe", "projects", "old"), { recursive: true });
        writeFileSync(join(root, ".scribe", "projects", "old", "project.md"), old);
        expect(await manager.fetchProjects()).toEqual([]);
        expect(readFileSync(join(root, "Scribe", "projects", "old", "project.md"), "utf8")).toBe(
          old
        );
      });
      it("reads hidden project configuration without rewriting it", async () => {
        const record = await manager.createProject(project());
        expect(await manager.fetchProjects()).toEqual([record]);
      });
      it("publishes external names and removes deleted hidden projects on refresh", async () => {
        const record = await manager.createProject(project());
        writeFileSync(
          join(root, record.filePath),
          serializeProjectConfig({ ...record.project, name: "External" })
        );
        await manager.fetchProjects();
        expect(getCachedProjectRecords()[0].project.name).toBe("External");
        unlinkSync(join(root, record.filePath));
        await manager.fetchProjects();
        expect(getCachedProjectRecords()).toEqual([]);
      });
    });
    describe("touchProjectLastUsed()", () => {
      it("persists project usage without changing workspace or instructions", async () => {
        const record = await manager.createProject(project());
        await manager.touchProjectLastUsed(record.project.id);
        expect((await manager.fetchProjects())[0].project.UsageTimestamps).toBeGreaterThan(1);
      });
      it("patches only usage while preserving external metadata and the exact body", async () => {
        const record = await manager.createProject(project());
        const external = {
          ...record.project,
          name: "External",
          description: "Changed outside",
          systemPrompt: "\nExternal body\r\n\r\n",
          contextSource: { ...record.project.contextSource, inclusions: "New/" },
        };
        writeFileSync(
          join(root, record.filePath),
          serializeProjectConfig(external).replace("\n---", "\nfuture: {keep: true}\n---")
        );
        await manager.touchProjectLastUsed(record.project.id);
        const saved = (await manager.fetchProjects())[0].project;
        expect({ ...saved, UsageTimestamps: external.UsageTimestamps }).toEqual(external);
        expect(saved.UsageTimestamps).toBeGreaterThan(1);
        expect(readFileSync(join(root, record.filePath), "utf8")).toContain("future:");
      });
      it("forgets an externally deleted project and never recreates its configuration", async () => {
        const record = await manager.createProject(project());
        unlinkSync(join(root, record.filePath));
        await manager.touchProjectLastUsed(record.project.id);
        expect(getCachedProjectRecords()).toEqual([]);
        expect(existsSync(join(root, record.filePath))).toBe(false);
      });
    });
    describe("getProjectUsageTimestampsManager()", () => {
      it("keeps the same usage tracker for a manager", () => {
        expect(manager.getProjectUsageTimestampsManager()).toBe(
          manager.getProjectUsageTimestampsManager()
        );
      });
    });
  });
});
