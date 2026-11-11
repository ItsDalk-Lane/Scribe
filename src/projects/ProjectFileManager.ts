import type { ProjectConfig } from "@/aiParams";
import { logError } from "@/logger";
import {
  getProjectConfigFilePath,
  getProjectsFolder,
  loadAllProjects,
  parseProjectConfigFile,
  sanitizeVaultPathSegment,
  serializeProjectConfig,
} from "@/projects/projectUtils";
import {
  deleteCachedProjectRecordById,
  getCachedProjectRecordById,
  getCachedProjectRecords,
  upsertCachedProjectRecord,
} from "@/projects/state";
import type { ProjectFileRecord } from "@/projects/type";
import { validateProjectWorkspace } from "@/projects/projectWorkspace";
import type { StartupMigrationItem } from "@/services/startupMigration";
import { ensureFolderExists } from "@/utils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";
import { SCRIBE_PROJECT_LAST_USED } from "@/projects/constants";
import { parseDocument } from "yaml";
import type { App } from "obsidian";

export class ProjectFileManager {
  private static instance: ProjectFileManager;
  private readonly projectLastUsedManager = new RecentUsageManager<string>();
  private writeQueue: Promise<unknown> = Promise.resolve();

  private constructor(private readonly app: App) {}

  public static getInstance(app?: App): ProjectFileManager {
    if (!ProjectFileManager.instance) {
      if (!app) throw new Error("App is required for first initialization");
      ProjectFileManager.instance = new ProjectFileManager(app);
    }
    return ProjectFileManager.instance;
  }

  public async initialize(): Promise<StartupMigrationItem | null> {
    await this.fetchProjects();
    return null;
  }

  public fetchProjects(): Promise<ProjectFileRecord[]> {
    return this.enqueue(() => loadAllProjects(this.app));
  }
  public getProjectUsageTimestampsManager(): RecentUsageManager<string> {
    return this.projectLastUsedManager;
  }

  public createProject(project: ProjectConfig): Promise<ProjectFileRecord> {
    return this.enqueue(async () => {
      const id = project.id.trim();
      if (!/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error("项目标识无效。");
      if (getCachedProjectRecordById(id)) throw new Error("这个项目已经存在。");
      const name = this.validateName(project);
      const selected = project.workspacePath !== undefined;
      const requested = selected ? project.workspacePath! : sanitizeVaultPathSegment(name);
      const workspacePath = await validateProjectWorkspace(this.app, requested, !selected);
      if (!selected && (await this.app.vault.adapter.exists(workspacePath)))
        throw new Error(`同名文件夹“${workspacePath}”已存在。请选择该文件夹，或使用其他项目名称。`);
      const filePath = getProjectConfigFilePath(id);
      if (await this.app.vault.adapter.exists(filePath))
        throw new Error("这个项目的配置已经存在，未覆盖。");
      if (!selected) await this.app.vault.adapter.mkdir(workspacePath);
      try {
        await validateProjectWorkspace(this.app, workspacePath);
        const value: ProjectConfig = {
          ...project,
          id,
          name,
          workspacePath,
          created: project.created > 0 ? project.created : Date.now(),
          UsageTimestamps: project.UsageTimestamps > 0 ? project.UsageTimestamps : 0,
        };
        await assertScribePath(this.app.vault, filePath);
        await ensureFolderExists(this.app.vault, `${getProjectsFolder()}/${id}`);
        await writeVaultFile(this.app.vault, filePath, serializeProjectConfig(value), null);
        const record = { project: value, filePath, folderName: id };
        upsertCachedProjectRecord(record);
        return record;
      } catch (error) {
        if (!selected) {
          try {
            await validateProjectWorkspace(this.app, workspacePath);
            const contents = await this.app.vault.adapter.list(workspacePath);
            if (contents.files.length === 0 && contents.folders.length === 0)
              await this.app.vault.adapter.rmdir(workspacePath, false);
          } catch (cleanupError) {
            logError("未能清理本次创建的空工作文件夹。", cleanupError);
          }
        }
        throw error;
      }
    });
  }

  public updateProject(
    projectId: string,
    nextProject: ProjectConfig,
    baseline = getCachedProjectRecordById(projectId)?.project
  ): Promise<ProjectFileRecord> {
    return this.enqueue(async () => {
      const existing = getCachedProjectRecordById(projectId);
      if (!existing || !baseline) throw new Error("项目已不存在，请重新打开项目列表。");
      if (nextProject.id !== projectId) throw new Error("不能更改项目标识。");
      const latest = await this.readCurrentProject(existing);
      if (!latest) throw new Error("项目已被删除，请重新打开项目列表。");
      upsertCachedProjectRecord(latest.record);
      if (latest.record.project.workspacePath !== baseline.workspacePath)
        throw new Error("项目工作位置已被其他操作更改，草稿仍保留。请重新打开项目后核对修改。");
      const mergeField = (
        before: string | undefined,
        next: string | undefined,
        current: string | undefined
      ): string => {
        if ((next || "") === (before || "")) return current || "";
        if ((current || "") !== (before || "") && (current || "") !== (next || ""))
          throw new Error("项目已被其他操作更改，草稿仍保留。请重新打开项目后核对修改。");
        return next || "";
      };
      const project = {
        ...latest.record.project,
        contextSource: { ...latest.record.project.contextSource },
      };
      for (const key of ["name", "description", "systemPrompt"] as const)
        project[key] = mergeField(baseline[key], nextProject[key], project[key]);
      for (const key of ["inclusions", "exclusions", "webUrls", "youtubeUrls"] as const)
        project.contextSource[key] = mergeField(
          baseline.contextSource[key],
          nextProject.contextSource[key],
          project.contextSource[key]
        );
      project.name = this.validateName(project);
      await writeVaultFile(
        this.app.vault,
        existing.filePath,
        serializeProjectConfig(project, latest.contents),
        latest.contents
      );
      const record = { ...latest.record, project };
      upsertCachedProjectRecord(record);
      return record;
    });
  }

  public deleteProject(projectId: string): Promise<void> {
    return this.enqueue(async () => {
      const existing = getCachedProjectRecordById(projectId);
      if (!existing) return;
      await assertScribePath(this.app.vault, existing.filePath);
      try {
        await this.app.vault.adapter.remove(existing.filePath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      deleteCachedProjectRecordById(projectId);
    });
  }

  public async touchProjectLastUsed(projectId: string): Promise<void> {
    try {
      await this.enqueue(async () => {
        const record = getCachedProjectRecordById(projectId);
        if (!record) return;
        const latest = await this.readCurrentProject(record);
        if (!latest) return;
        upsertCachedProjectRecord(latest.record);
        this.projectLastUsedManager.touch(projectId);
        const timestamp = this.projectLastUsedManager.shouldPersist(
          projectId,
          latest.record.project.UsageTimestamps
        );
        if (timestamp === null) return;
        const project = { ...latest.record.project, UsageTimestamps: timestamp };
        const contents = latest.contents.replace(
          /^(\uFEFF?---\r?\n)([\s\S]*?)(\r?\n---(?:\r?\n|$))/,
          (_match, opening: string, header: string, closing: string) => {
            const document = parseDocument(header);
            if (document.errors.length) throw new Error("项目配置无法读取，未覆盖现有内容。");
            document.set(SCRIBE_PROJECT_LAST_USED, timestamp);
            return opening + document.toString().trimEnd() + closing;
          }
        );
        await writeVaultFile(this.app.vault, record.filePath, contents, latest.contents);
        this.projectLastUsedManager.markPersisted(projectId, project.UsageTimestamps);
        upsertCachedProjectRecord({ ...latest.record, project });
      });
    } catch (error) {
      logError("无法保存项目最近使用时间。", error);
    }
  }

  private async readCurrentProject(record: ProjectFileRecord) {
    await assertScribePath(this.app.vault, record.filePath);
    let contents: string;
    try {
      contents = await this.app.vault.adapter.read(record.filePath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      deleteCachedProjectRecordById(record.project.id);
      return null;
    }
    const current = await parseProjectConfigFile(this.app, record.filePath, contents);
    if (!current) throw new Error("项目配置已被其他操作更改，请重新打开项目列表。");
    return { record: current, contents };
  }

  private validateName(project: ProjectConfig): string {
    const name = project.name.trim();
    if (!name) throw new Error("请填写项目名称。");
    if (
      getCachedProjectRecords().some(
        (record) =>
          record.project.id !== project.id &&
          record.project.name.toLowerCase() === name.toLowerCase()
      )
    )
      throw new Error("已存在同名项目，请换一个名称。");
    return name;
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const pending = this.writeQueue.catch(() => undefined).then(operation);
    this.writeQueue = pending;
    return pending;
  }
}
