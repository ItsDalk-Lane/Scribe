import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { logError } from "@/logger";
import { createPluginRoot } from "@/utils/react/createPluginRoot";
import { App, Modal } from "obsidian";
import React from "react";
import { Root } from "react-dom/client";
import { DESCRIPTION_MAX, NAME_MAX, NAME_RE } from "@/agentMode/skills/skillFormat";
import type { Skill } from "@/agentMode/skills/types";

export interface PropertiesFormValues {
  name: string;
  description: string;
  disableAutoInvocation: boolean;
  hideFromSlashMenu: boolean;
}

export interface PropertiesSaveRequest {
  nameChanged: boolean;
  newName: string;
  patch: {
    description: string;
    disableModelInvocation: boolean | undefined;
    userInvocable: boolean | undefined;
  };
}

export type PropertiesSaveOutcome = "close" | "stay" | "collision";

export interface PropertiesModalBodyProps {
  skill: Skill;
  skillsFolderRel: string;
  collisionError: boolean;
  saving: boolean;
  onCancel: () => void;
  onSave: (req: PropertiesSaveRequest) => void;
}

export const PropertiesModalBody: React.FC<PropertiesModalBodyProps> = ({
  skill,
  skillsFolderRel,
  collisionError,
  saving,
  onCancel,
  onSave,
}) => {
  const [values, setValues] = React.useState<PropertiesFormValues>(() =>
    computeInitialFormValues(skill)
  );

  const folder = skillsFolderRel.replace(/\/+$/, "");
  const nameError = validateNameField(values.name);
  const descriptionError = validateDescriptionField(values.description);

  const hasError = nameError !== null || descriptionError !== null;
  const canSave = !hasError && !saving;

  const handleSave = (): void => {
    if (!canSave) return;
    const nameChanged = values.name !== skill.name;
    onSave({
      nameChanged,
      newName: values.name,
      patch: {
        description: values.description,
        disableModelInvocation: values.disableAutoInvocation ? true : undefined,
        userInvocable: values.hideFromSlashMenu ? false : undefined,
      },
    });
  };

  return (
    <div className="tw-group/settings tw-flex tw-max-h-[70vh] tw-flex-col">
      <div className="tw-mb-3 tw-text-ui-small tw-text-muted">
        {t("Writes to")}{" "}
        <code className="tw-font-mono tw-text-ui-smaller">
          {folder}/{skill.name}/SKILL.md
        </code>
      </div>

      <div className="tw-flex-1 tw-overflow-y-auto tw-pr-1">
        <div className="tw-flex tw-flex-col tw-gap-4">
          <Field>
            <FieldLabel htmlFor="properties-name">{t("Name")}</FieldLabel>
            <Input
              id="properties-name"
              type="text"
              value={values.name}
              onChange={(e) => setValues((v) => ({ ...v, name: e.target.value }))}
              aria-invalid={nameError !== null || collisionError}
              autoComplete="off"
              spellCheck={false}
            />
            {nameError !== null ? (
              <FieldError>{nameError}</FieldError>
            ) : collisionError ? (
              <FieldError>
                {t("A skill named “")}
                {values.name}
                {t("” already exists.")}
              </FieldError>
            ) : (
              <FieldHelp>
                {t("Lowercase, hyphenated. This is what users type after")}{" "}
                <code className="tw-font-mono">/</code> {t("in chat.")}
              </FieldHelp>
            )}
          </Field>

          <Field>
            <FieldLabel htmlFor="properties-description">{t("Description")}</FieldLabel>
            <Textarea
              id="properties-description"
              value={values.description}
              onChange={(e) => setValues((v) => ({ ...v, description: e.target.value }))}
              aria-invalid={descriptionError !== null}
              spellCheck={true}
              className="tw-border-border tw-text-sm"
            />
            <div className="tw-mt-0.5 tw-flex tw-items-center tw-justify-between">
              {descriptionError !== null ? <FieldError>{descriptionError}</FieldError> : <span />}
              <span
                className={cn(
                  "tw-font-mono tw-text-[11px] tw-text-faint",
                  values.description.length > DESCRIPTION_MAX && "tw-text-error"
                )}
              >
                {values.description.length} / {DESCRIPTION_MAX}
              </span>
            </div>
          </Field>

          <FieldHelp>{t("Skills use this chat's model and permissions.")}</FieldHelp>

          <label className="tw-flex tw-cursor-pointer tw-items-start tw-gap-2.5">
            <Checkbox
              checked={values.disableAutoInvocation}
              onCheckedChange={(checked) =>
                setValues((v) => ({ ...v, disableAutoInvocation: checked === true }))
              }
              className="tw-mt-0.5"
            />
            <span className="tw-flex tw-flex-col tw-gap-0.5">
              <span className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-normal">
                {t("Don't let the model invoke this on its own")}
              </span>
            </span>
          </label>

          <label className="tw-flex tw-cursor-pointer tw-items-start tw-gap-2.5">
            <Checkbox
              checked={values.hideFromSlashMenu}
              onCheckedChange={(checked) =>
                setValues((v) => ({ ...v, hideFromSlashMenu: checked === true }))
              }
              className="tw-mt-0.5"
            />
            <span className="tw-flex tw-flex-col tw-gap-0.5">
              <span className="tw-flex tw-items-center tw-gap-2 tw-text-sm tw-text-normal">
                {t("Hide from slash menu")}
              </span>
            </span>
          </label>
        </div>
      </div>

      <div className="tw-group/extension-actions tw-mt-4 tw-flex tw-justify-end tw-gap-2 tw-border-t tw-border-solid tw-border-border tw-pt-3">
        <Button variant="secondary" onClick={onCancel} disabled={saving}>
          {t("Cancel")}
        </Button>
        <Button variant="default" onClick={handleSave} disabled={!canSave}>
          {t("Save")}
        </Button>
      </div>
    </div>
  );
};

export class PropertiesModal extends Modal {
  private root: Root | null = null;
  private collisionError = false;
  private saving = false;

  constructor(
    app: App,
    private readonly skill: Skill,
    private readonly skillsFolderRel: string,
    private readonly onSaveCallback: (
      req: PropertiesSaveRequest
    ) => Promise<PropertiesSaveOutcome> | PropertiesSaveOutcome
  ) {
    super(app);
    // @ts-expect-error — setTitle exists on Modal but is missing from @types/obsidian.
    this.setTitle(t("Properties · {p0}", { p0: skill.name }));
  }

  onOpen(): void {
    this.root = createPluginRoot(this.contentEl, this.app);
    this.renderBody();
  }

  onClose(): void {
    this.root?.unmount();
    this.root = null;
  }

  private renderBody(): void {
    this.root?.render(
      <PropertiesModalBody
        key={this.skill.dirPath}
        skill={this.skill}
        skillsFolderRel={this.skillsFolderRel}
        collisionError={this.collisionError}
        saving={this.saving}
        onCancel={() => this.close()}
        onSave={(req) => {
          void this.handleSave(req);
        }}
      />
    );
  }

  private async handleSave(req: PropertiesSaveRequest): Promise<void> {
    this.saving = true;
    this.collisionError = false;
    this.renderBody();
    try {
      const outcome = await this.onSaveCallback(req);
      if (outcome === "close") {
        this.close();
        return;
      }
      this.saving = false;
      this.collisionError = outcome === "collision";
      this.renderBody();
    } catch (err) {
      logError("PropertiesModal save failed", err);
      this.saving = false;
      this.renderBody();
    }
  }
}

const Field: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="tw-flex tw-flex-col tw-gap-1">{children}</div>
);

const FieldLabel: React.FC<{ htmlFor: string; children: React.ReactNode }> = ({
  htmlFor,
  children,
}) => (
  <label
    htmlFor={htmlFor}
    className="tw-flex tw-items-center tw-gap-2 tw-text-ui-small tw-font-medium tw-text-normal"
  >
    {children}
  </label>
);

const FieldHelp: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="tw-text-ui-smaller tw-leading-relaxed tw-text-muted">{children}</div>
);

const FieldError: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <div className="tw-text-ui-smaller tw-leading-relaxed tw-text-error">{children}</div>
);

function computeInitialFormValues(skill: Skill): PropertiesFormValues {
  return {
    name: skill.name,
    description: skill.description,
    disableAutoInvocation: skill.disableModelInvocation === true,
    hideFromSlashMenu: skill.userInvocable === false,
  };
}

function validateNameField(name: string): string | null {
  if (name.length === 0) return t("Name is required.");
  if (name.length > NAME_MAX) return t("Name must be at most {p0} characters.", { p0: NAME_MAX });
  if (!NAME_RE.test(name)) {
    return t(
      "Lowercase a–z, 0–9, and hyphens only — no leading, trailing, or consecutive hyphens."
    );
  }
  return null;
}

function validateDescriptionField(description: string): string | null {
  if (description.trim().length === 0) return t("Description is required.");
  if (description.length > DESCRIPTION_MAX) {
    return t("Description must be at most {p0} characters.", { p0: DESCRIPTION_MAX });
  }
  return null;
}
