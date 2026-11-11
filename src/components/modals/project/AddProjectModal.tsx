import { t } from "@/lib/i18n";
import { ProjectConfig } from "@/aiParams";
import { useApp } from "@/context";
import { ContextManageModal } from "@/components/modals/project/context-manage-modal";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ProjectContextSourceEditor } from "@/components/project/ProjectContextSourceEditor";
import {
  captureInstructionFiles,
  readAgentsFile,
  restoreInstructionFiles,
  writeAgentsFile,
} from "@/instructions/agentsFile";
import { logError } from "@/logger";
import { ProjectInstructionsField } from "@/instructions/ProjectInstructionsField";
import { validateProjectWorkspace } from "@/projects/projectWorkspace";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getCachedProjectRecordById } from "@/projects/state";
import { err2String } from "@/utils";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal, Notice } from "obsidian";
import React, { useEffect, useMemo, useState } from "react";
import { Root } from "react-dom/client";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

export interface AddProjectModalContentProps {
  initialProject: ProjectConfig;
  onSave: (project: ProjectConfig) => Promise<void>;
  onCancel: () => void;
  popoverContainer?: HTMLElement | null;
}

export function AddProjectModalContent({
  initialProject,
  onSave,
  onCancel,
  popoverContainer,
}: AddProjectModalContentProps) {
  const app = useApp();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [touched, setTouched] = useState({
    name: false,
    inclusions: false,
  });

  const [formData, setFormData] = useState<ProjectConfig>(() => ({ ...initialProject }));

  const record = useMemo(() => getCachedProjectRecordById(initialProject.id), [initialProject.id]);
  const instructionsFolder = useMemo(() => record?.project.workspacePath ?? null, [record]);
  const [instructions, setInstructions] = useState<string | null>(null);
  const [originalInstructions, setOriginalInstructions] = useState<string | null>(null);
  useEffect(() => {
    if (instructionsFolder === null) return;
    let cancelled = false;
    void validateProjectWorkspace(app, instructionsFolder)
      .then(() => readAgentsFile(app, instructionsFolder))
      .then((content) => {
        if (cancelled) return;
        setOriginalInstructions(content);
        setInstructions(content);
      })
      .catch((error) => {
        logError(t("Failed to read project instructions."), error);
      });
    return () => {
      cancelled = true;
    };
  }, [app, instructionsFolder]);

  const handleEditProjectContext = (projectDraft: ProjectConfig) => {
    const modal = new ContextManageModal(
      app,
      (updatedProject: ProjectConfig) => {
        setFormData((prev) => ({
          ...prev,
          contextSource: {
            ...prev.contextSource,
            inclusions: updatedProject.contextSource?.inclusions,
            exclusions: updatedProject.contextSource?.exclusions,
            webUrls: updatedProject.contextSource?.webUrls,
            youtubeUrls: updatedProject.contextSource?.youtubeUrls,
          },
        }));
      },
      projectDraft
    );
    modal.open();
  };

  const isFormValid = () => Boolean(formData.name);

  const handleInputChange = (
    field: string,
    value: string | number | string[] | Record<string, unknown>
  ) => {
    setFormData((prev) => {
      if (Array.isArray(value) && value.every((item) => typeof item === "string")) {
        value = value.map((item) => item.trim()).filter(Boolean);
      }

      if (field.includes(".")) {
        const [parent, child] = field.split(".");
        const parentKey = parent as keyof typeof prev;
        const parentValue = prev[parentKey];

        if (typeof parentValue === "object" && parentValue !== null) {
          return {
            ...prev,
            [parent]: {
              ...parentValue,
              [child]: value,
            },
          };
        }
      }
      return {
        ...prev,
        [field]: value,
      };
    });
  };

  const handleContextChange = (patch: Partial<NonNullable<ProjectConfig["contextSource"]>>) => {
    setFormData((prev) => ({
      ...prev,
      contextSource: { ...prev.contextSource, ...patch },
    }));
  };

  const handleSave = async () => {
    const trimmedName = formData.name?.trim() ?? "";
    const saveData = {
      ...formData,
      name: trimmedName,
    };

    if (!saveData.name) {
      setTouched((prev) => ({ ...prev, name: true }));
      new Notice(t("Please fill in all required fields"));
      return;
    }

    const instructionEdit =
      instructionsFolder !== null && instructions !== null && instructions !== originalInstructions
        ? { folder: instructionsFolder, text: instructions }
        : null;

    try {
      setIsSubmitting(true);
      if (instructionEdit) await validateProjectWorkspace(app, instructionEdit.folder);
      if (
        instructionEdit &&
        (await readAgentsFile(app, instructionEdit.folder)) !== originalInstructions
      ) {
        throw new Error(
          "项目说明已被其他窗口或同步更新。请先复制当前草稿，再重新打开项目核对后保存。"
        );
      }
      const before = instructionEdit
        ? await captureInstructionFiles(app, instructionEdit.folder)
        : null;
      if (instructionEdit) {
        await writeAgentsFile(
          app,
          instructionEdit.folder,
          instructionEdit.text,
          originalInstructions ?? ""
        );
      }
      try {
        await onSave(saveData);
      } catch (e) {
        if (instructionEdit && before) {
          await restoreInstructionFiles(app, instructionEdit.folder, before, instructionEdit.text);
          if (before.agents === null) {
            setOriginalInstructions(instructionEdit.text);
            throw new Error(`${err2String(e)} 新建的说明文件已保留，核对项目设置后可以重试。`);
          }
        }
        throw e;
      }
    } catch (e) {
      new Notice(err2String(e));
      setTouched((prev) => ({
        ...prev,
        name: true,
      }));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="tw-flex tw-h-full tw-flex-col">
      <div className="tw-shrink-0 tw-px-4 tw-pb-2 tw-pt-4">
        <div className="tw-text-xl tw-font-bold tw-text-normal">{t("Edit project")}</div>
        <p className="tw-mt-1 tw-text-sm tw-text-muted">
          {t("Configure your project settings and context sources")}
        </p>
      </div>

      <ScrollArea className="tw-min-h-0 tw-flex-1">
        <div className="tw-flex tw-flex-col tw-gap-6 tw-p-4">
          <div className="tw-rounded-lg tw-border tw-border-border tw-p-4 tw-bg-secondary/50">
            <h3 className="tw-mb-3 tw-text-sm tw-font-medium tw-text-normal">{t("Basic info")}</h3>
            <div className="tw-flex tw-flex-col tw-gap-3">
              <FormField
                label={t("Project name")}
                required
                error={touched.name && !formData.name}
                errorMessage={t("Project name is required")}
              >
                <Input
                  type="text"
                  value={formData.name}
                  onChange={(e) => handleInputChange("name", e.target.value)}
                  onBlur={() => setTouched((prev) => ({ ...prev, name: true }))}
                  className="tw-w-full"
                />
              </FormField>

              <FormField
                label={t("Description")}
                description={t("Briefly describe the purpose and goals of the project")}
              >
                <Input
                  type="text"
                  value={formData.description}
                  onChange={(e) => handleInputChange("description", e.target.value)}
                  className="tw-w-full"
                />
              </FormField>

              {instructionsFolder !== null && (
                <FormField
                  label={t("Project workspace")}
                  description={t("Renaming the project does not move this folder.")}
                >
                  <div className="tw-text-sm tw-text-muted">
                    {instructionsFolder || t("Vault root")}
                  </div>
                </FormField>
              )}

              {instructions !== null && (
                <ProjectInstructionsField value={instructions} onChange={setInstructions} />
              )}
            </div>
          </div>

          <div className="tw-rounded-lg tw-border tw-border-border tw-p-4 tw-bg-secondary/50">
            <h3 className="tw-mb-3 tw-text-sm tw-font-medium tw-text-normal">
              {t("Context sources")}
            </h3>
            <ProjectContextSourceEditor
              contextSource={formData.contextSource}
              onChange={handleContextChange}
              onManage={() => handleEditProjectContext(formData)}
              popoverContainer={popoverContainer}
              droppable={false}
              solidManageButton
              showHelperText
            />
          </div>
        </div>
      </ScrollArea>

      <div className="tw-shrink-0 tw-border-t tw-border-border tw-px-4 tw-py-3">
        <div className="tw-flex tw-items-center tw-justify-end tw-gap-2">
          <Button variant="ghost" onClick={onCancel} disabled={isSubmitting}>
            {t("Cancel")}
          </Button>
          <Button onClick={safeAsyncHandler(handleSave)} disabled={isSubmitting || !isFormValid()}>
            {isSubmitting ? t("Saving...") : t("Save")}
          </Button>
        </div>
      </div>
    </div>
  );
}

export class AddProjectModal extends Modal {
  private root: Root | null = null;
  private opened = false;

  constructor(
    app: App,
    private onSave: (project: ProjectConfig, baseline: ProjectConfig) => Promise<void>,
    private initialProject: ProjectConfig
  ) {
    super(app);
  }

  onOpen() {
    const { contentEl, modalEl } = this;

    modalEl.addClass("!tw-max-h-[85vh]", "tw-min-w-[50vw]");

    this.root = createPluginRoot(contentEl, this.app);

    this.opened = true;
    void ProjectFileManager.getInstance(this.app)
      .fetchProjects()
      .then((records) => {
        if (!this.opened) return;
        const latest = records.find((record) => record.project.id === this.initialProject.id);
        if (!latest) throw new Error("项目已被删除，请重新打开项目列表。");
        const handleSave = async (project: ProjectConfig) => {
          await this.onSave(project, latest.project);
          this.close();
        };
        this.root?.render(
          <AddProjectModalContent
            initialProject={latest.project}
            onSave={handleSave}
            onCancel={() => this.close()}
            popoverContainer={contentEl}
          />
        );
      })
      .catch((error) => {
        if (!this.opened) return;
        logError("无法重新读取项目配置。", error);
        new Notice(err2String(error));
        this.close();
      });
  }

  onClose() {
    this.opened = false;
    this.root?.unmount();
    this.root = null;
  }
}
