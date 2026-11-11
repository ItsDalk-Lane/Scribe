import type { App } from "obsidian";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import type { StartupMigrationItem } from "@/services/startupMigration";

export class ProjectRegister {
  private readonly manager: ProjectFileManager;

  constructor(app: App) {
    this.manager = ProjectFileManager.getInstance(app);
  }
  initialize(): Promise<StartupMigrationItem | null> {
    return this.manager.initialize();
  }
  cleanup(): void {}
}
