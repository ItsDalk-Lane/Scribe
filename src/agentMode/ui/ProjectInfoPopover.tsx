import { t } from "@/lib/i18n";
import { revealProjectFolder } from "@/agentMode/ui/AgentProjectRowActions";
import type { AgentTodoListEntry } from "@/agentMode/session/types";
import { ProjectConfig } from "@/aiParams";
import { AddProjectModal } from "@/components/modals/project/AddProjectModal";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { openAgentsFile } from "@/instructions/agentsFile";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { validateProjectWorkspace } from "@/projects/projectWorkspace";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  ChevronRight,
  FolderSearch,
  List,
  Settings,
} from "lucide-react";
import { App, Notice, TFile, TFolder } from "obsidian";
import React, { memo, useEffect, useState } from "react";

const HIDDEN_BASENAMES = new Set(["agents.md"]);

const BADGE_CLASSES: Record<string, string> = {
  pdf: "tw-bg-project-red tw-text-project-red",
  md: "tw-bg-project-blue tw-text-project-blue",
  html: "tw-bg-project-orange tw-text-project-orange",
  png: "tw-bg-project-green tw-text-project-green",
};

function FileBadge({ ext }: { ext: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "tw-flex tw-h-4 tw-w-7 tw-shrink-0 tw-items-center tw-justify-center tw-rounded tw-text-smallest tw-font-bold tw-uppercase",
        BADGE_CLASSES[ext] ?? "tw-bg-secondary tw-text-muted"
      )}
    >
      {ext.slice(0, 4) || t("file")}
    </span>
  );
}

interface ProgressSectionProps {
  todoList: AgentTodoListEntry[] | null;
}

function ProgressSection({ todoList }: ProgressSectionProps) {
  if (!todoList || todoList.length === 0) return null;
  const done = todoList.filter((t) => t.status === "completed").length;
  return (
    <div className="tw-px-3 tw-py-2.5">
      <div className="tw-mb-1.5 tw-flex tw-items-baseline tw-justify-between">
        <span className="tw-text-ui-smaller tw-font-semibold tw-text-faint">{t("Progress")}</span>
        <span className="tw-text-ui-smaller tw-text-faint">
          {done}/{todoList.length}
        </span>
      </div>
      <ul className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-gap-1 tw-p-0">
        {todoList.map((todo, i) => (
          // eslint-disable-next-line @eslint-react/no-array-index-key -- entries are positional and may share content
          <li key={`todo-${i}`} className="tw-flex tw-items-center tw-gap-2">
            <span
              aria-hidden="true"
              className={cn(
                "tw-flex tw-size-5 tw-shrink-0 tw-items-center tw-justify-center tw-rounded-full tw-text-xs tw-font-semibold",
                todo.status === "completed"
                  ? "tw-bg-interactive-accent tw-text-on-accent"
                  : todo.status === "in_progress"
                    ? "tw-border-[1.5px] tw-border-solid tw-border-interactive-accent tw-text-accent"
                    : "tw-border-[1.5px] tw-border-solid tw-border-border tw-text-faint"
              )}
            >
              {todo.status === "completed" ? <Check className="tw-size-3" /> : i + 1}
            </span>
            <span
              className={cn(
                "tw-min-w-0 tw-truncate tw-text-ui-small",
                todo.status === "completed" ? "tw-text-faint tw-line-through" : "tw-text-normal"
              )}
              title={todo.content}
            >
              {todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface ProjectFileEntry {
  path: string;
  name: string;
  extension: string;
}

export interface ProjectFilesListProps {
  files: readonly ProjectFileEntry[];
  workspacePath?: string;
  onOpenInstructions: () => void;
  onOpenFile: (path: string) => void;
  onReveal: () => void;
}

export function ProjectFilesList({
  files,
  workspacePath,
  onOpenInstructions,
  onOpenFile,
  onReveal,
}: ProjectFilesListProps) {
  const [outputsOpen, setOutputsOpen] = useState(false);

  return (
    <div className="tw-px-3 tw-py-2.5">
      {workspacePath !== undefined && (
        <div className="tw-mb-2 tw-break-words tw-text-ui-smaller tw-text-muted">
          {t("Project workspace")}: {workspacePath || t("Vault root")}
        </div>
      )}
      <div className="tw-mb-1 tw-flex tw-items-center tw-justify-between">
        <span className="tw-text-ui-smaller tw-font-semibold tw-text-faint">
          {t("Project files")}
        </span>
        <Button
          variant="ghost2"
          size="icon"
          aria-label={t("Reveal project files in vault")}
          className="tw-size-5 tw-text-faint hover:tw-text-normal"
          onClick={onReveal}
        >
          <FolderSearch className="tw-size-3.5" />
        </Button>
      </div>

      <div
        role="button"
        tabIndex={0}
        className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded tw-p-1 hover:tw-bg-secondary"
        onClick={onOpenInstructions}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") onOpenInstructions();
        }}
      >
        <FileBadge ext="md" />
        <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small">AGENTS.md</span>
        <ArrowUpRight aria-hidden="true" className="tw-size-3.5 tw-shrink-0 tw-text-faint" />
      </div>

      {files.map((file) => (
        <div
          key={file.path}
          role="button"
          tabIndex={0}
          className="tw-flex tw-cursor-pointer tw-items-center tw-gap-2 tw-rounded tw-p-1 hover:tw-bg-secondary"
          onClick={() => onOpenFile(file.path)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") onOpenFile(file.path);
          }}
        >
          <FileBadge ext={file.extension.toLowerCase()} />
          <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small" title={file.name}>
            {file.name}
          </span>
        </div>
      ))}

      <div
        role="button"
        tabIndex={0}
        className="tw-flex tw-cursor-pointer tw-items-center tw-gap-1 tw-rounded tw-p-1 tw-text-muted hover:tw-bg-secondary"
        onClick={() => setOutputsOpen((v) => !v)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") setOutputsOpen((v) => !v);
        }}
        aria-expanded={outputsOpen}
      >
        {outputsOpen ? (
          <ChevronDown className="tw-size-3.5" aria-hidden="true" />
        ) : (
          <ChevronRight className="tw-size-3.5" aria-hidden="true" />
        )}
        <span className="tw-text-ui-small tw-font-medium">{t("Outputs")}</span>
        <span className="tw-text-ui-smaller tw-text-faint">(0)</span>
      </div>
      {outputsOpen && (
        <div className="tw-py-1 tw-pl-6 tw-text-ui-smaller tw-text-faint">
          {t("No outputs yet")}
        </div>
      )}
    </div>
  );
}

interface ProjectFilesSectionProps {
  app: App;
  project: ProjectConfig;
  onClose: () => void;
}

const EMPTY_PROJECT_FILES: readonly TFile[] = Object.freeze([]);

function ProjectFilesSection({ app, project, onClose }: ProjectFilesSectionProps) {
  const [files, setFiles] = useState<readonly TFile[]>(EMPTY_PROJECT_FILES);
  useEffect(() => {
    let cancelled = false;
    const folderPath = project.workspacePath;
    if (folderPath === undefined) return;
    void validateProjectWorkspace(app, folderPath)
      .then(() => {
        if (cancelled) return;
        const folder =
          folderPath === "" ? app.vault.getRoot() : app.vault.getAbstractFileByPath(folderPath);
        setFiles(
          folder instanceof TFolder
            ? folder.children
                .filter(
                  (child): child is TFile =>
                    child instanceof TFile &&
                    !child.name.startsWith(".") &&
                    !HIDDEN_BASENAMES.has(child.name.toLowerCase())
                )
                .sort((a, b) => a.name.localeCompare(b.name))
            : EMPTY_PROJECT_FILES
        );
      })
      .catch((error) => {
        if (cancelled) return;
        setFiles(EMPTY_PROJECT_FILES);
        logError("无法读取项目工作文件夹。", error);
      });
    return () => {
      cancelled = true;
    };
  }, [app, project.workspacePath]);

  const handleOpenFile = (path: string) => {
    if (project.workspacePath === undefined) return;
    const file = files.find((candidate) => candidate.path === path);
    if (!file) return;
    onClose();
    void validateProjectWorkspace(app, project.workspacePath)
      .then(() => app.workspace.getLeaf(false).openFile(file))
      .catch((err) => logError("[ProjectInfoPopover] openFile failed", err));
  };

  const handleOpenProjectInstructions = () => {
    const record = getCachedProjectRecordById(project.id);
    if (!record) return;
    onClose();
    if (record.project.workspacePath === undefined) return;
    const workspacePath = record.project.workspacePath;
    void validateProjectWorkspace(app, workspacePath)
      .then(() => openAgentsFile(app, workspacePath))
      .catch((error) => {
        logError("[ProjectInfoPopover] Failed to open project AGENTS.md", error);
        new Notice(t("Failed to open project AGENTS.md."));
      });
  };

  return (
    <ProjectFilesList
      files={files}
      workspacePath={project.workspacePath}
      onOpenInstructions={handleOpenProjectInstructions}
      onOpenFile={handleOpenFile}
      onReveal={() => {
        onClose();
        void revealProjectFolder(app, project);
      }}
    />
  );
}

interface ProjectInfoPopoverProps {
  app: App;
  project: ProjectConfig;
  todoList: AgentTodoListEntry[] | null;
  container?: HTMLElement | null;
}

export const ProjectInfoPopover = memo(
  ({ app, project, todoList, container }: ProjectInfoPopoverProps) => {
    const [open, setOpen] = useState(false);

    const handleEdit = () => {
      setOpen(false);
      new AddProjectModal(
        app,
        async (next, baseline) => {
          try {
            await ProjectFileManager.getInstance(app).updateProject(project.id, next, baseline);
          } catch (e) {
            logError("[ProjectInfoPopover] updateProject failed", e);
            throw e;
          }
        },
        project
      ).open();
    };

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost2"
            size="icon"
            aria-label={t("Project info for {p0}", { p0: project.name })}
            className="tw-size-7 tw-text-muted hover:tw-text-normal"
          >
            <List className="tw-size-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          container={container}
          className="tw-w-72 tw-p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="tw-flex tw-items-center tw-gap-1 tw-px-3 tw-py-2.5">
            <span
              className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-ui-small tw-font-semibold"
              title={project.name}
            >
              {project.name}
            </span>
            <Button
              variant="ghost2"
              size="icon"
              aria-label={t("Edit project {p0}", { p0: project.name })}
              className="tw-size-6 tw-text-muted hover:tw-text-normal"
              onClick={handleEdit}
            >
              <Settings className="tw-size-3.5" />
            </Button>
            <Button
              variant="ghost2"
              size="icon"
              aria-label={t("Reveal project folder in vault")}
              className="tw-size-6 tw-text-muted hover:tw-text-normal"
              onClick={() => {
                setOpen(false);
                void revealProjectFolder(app, project);
              }}
            >
              <FolderSearch className="tw-size-3.5" />
            </Button>
          </div>
          <ProgressSection todoList={todoList} />
          <ProjectFilesSection app={app} project={project} onClose={() => setOpen(false)} />
        </PopoverContent>
      </Popover>
    );
  }
);

ProjectInfoPopover.displayName = "ProjectInfoPopover";
