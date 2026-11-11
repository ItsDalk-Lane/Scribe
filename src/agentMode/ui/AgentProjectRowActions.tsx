import { t } from "@/lib/i18n";
import { ProjectConfig } from "@/aiParams";
import { AddProjectModal } from "@/components/modals/project/AddProjectModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { validateProjectWorkspace } from "@/projects/projectWorkspace";
import { getCachedProjectRecordById } from "@/projects/state";
import { FolderSearch, Pencil, Trash2 } from "lucide-react";
import { App, Notice, TFolder } from "obsidian";
import React, { memo } from "react";

export async function revealProjectFolder(app: App, project: ProjectConfig): Promise<void> {
  const record = getCachedProjectRecordById(project.id);
  const folderPath = record?.project.workspacePath;
  if (folderPath === undefined) return;
  try {
    await validateProjectWorkspace(app, folderPath);
  } catch (error) {
    logError("无法打开项目工作文件夹。", error);
    new Notice(String(error));
    return;
  }
  const folder =
    folderPath === ""
      ? app.vault.getRoot()
      : folderPath
        ? app.vault.getAbstractFileByPath(folderPath)
        : null;
  if (folder instanceof TFolder) {
    const fileExplorer = (
      app as unknown as {
        internalPlugins?: {
          getPluginById?: (
            id: string
          ) =>
            | { enabled?: boolean; instance?: { revealInFolder?: (folder: TFolder) => void } }
            | undefined;
        };
      }
    ).internalPlugins?.getPluginById?.("file-explorer");
    if (fileExplorer?.enabled && fileExplorer.instance?.revealInFolder) {
      fileExplorer.instance.revealInFolder(folder);
      return;
    }
  }
  new Notice(
    t("Can't reveal \"{p0}\" — its folder isn't visible in the file explorer.", {
      p0: project.name,
    })
  );
}

interface AgentProjectRowActionsProps {
  app: App;
  project: ProjectConfig;
  onDeleted?: (projectId: string) => void;
}

export const AgentProjectRowActions = memo(
  ({ app, project, onDeleted }: AgentProjectRowActionsProps): React.ReactElement => {
    const handleEdit = () => {
      new AddProjectModal(
        app,
        async (next, baseline) => {
          await ProjectFileManager.getInstance(app).updateProject(project.id, next, baseline);
        },
        project
      ).open();
    };

    const handleDelete = () => {
      new ConfirmModal(
        app,
        async () => {
          try {
            await ProjectFileManager.getInstance(app).deleteProject(project.id);
            onDeleted?.(project.id);
          } catch (e) {
            logError("[AgentProjectRowActions] deleteProject failed", e);
            new Notice(t('Failed to delete project "{p0}".', { p0: project.name }));
          }
        },
        t(
          'Delete project "{p0}"? Only its Scribe configuration will be removed. The workspace, AGENTS.md, and all notes will stay where they are.',
          { p0: project.name }
        ),
        t("Delete project"),
        t("Delete"),
        t("Cancel")
      ).open();
    };

    return (
      <div className="tw-flex tw-items-center tw-gap-1.5">
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("Reveal {p0} in vault", { p0: project.name })}
          title={t("Reveal in vault")}
          className="tw-size-5 tw-p-0"
          onClick={(e) => {
            e.stopPropagation();
            void revealProjectFolder(app, project);
          }}
        >
          <FolderSearch className="tw-size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("Edit project {p0}", { p0: project.name })}
          title={t("Edit project")}
          className="tw-size-5 tw-p-0"
          onClick={(e) => {
            e.stopPropagation();
            handleEdit();
          }}
        >
          <Pencil className="tw-size-3.5" />
        </Button>
        <Button
          size="sm"
          variant="ghost"
          aria-label={t("Delete project {p0}", { p0: project.name })}
          title={t("Delete")}
          className="tw-size-5 tw-p-0 tw-text-error hover:tw-text-error"
          onClick={(e) => {
            e.stopPropagation();
            handleDelete();
          }}
        >
          <Trash2 className="tw-size-3.5" />
        </Button>
      </div>
    );
  }
);

AgentProjectRowActions.displayName = "AgentProjectRowActions";
