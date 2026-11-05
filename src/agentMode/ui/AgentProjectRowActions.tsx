import { t } from "@/lib/i18n";
import { ProjectConfig } from "@/aiParams";
import { AddProjectModal } from "@/components/modals/project/AddProjectModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { logError } from "@/logger";
import { getProjectFolderPath } from "@/projects/projectPaths";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import { FolderSearch, Pencil, Trash2 } from "lucide-react";
import { App, Notice, TFolder } from "obsidian";
import React, { memo } from "react";

export function revealProjectFolder(app: App, project: ProjectConfig): void {
  const record = getCachedProjectRecordById(project.id);
  const folderPath = record ? getProjectFolderPath(record.folderName) : null;
  const folder = folderPath ? app.vault.getAbstractFileByPath(folderPath) : null;
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
        async (next) => {
          await ProjectFileManager.getInstance(app).updateProject(project.id, next);
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
          'Delete project "{p0}"? This removes the project configuration; project instructions and other notes stay in the vault. If you create another project with the same name, its existing instructions may be changed when it opens. Save a copy of any instructions you want to keep before recreating the project.',
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
            revealProjectFolder(app, project);
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
