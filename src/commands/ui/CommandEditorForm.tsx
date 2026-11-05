import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
import React, { useState } from "react";
import { COMPACT_COMMAND_NAME } from "@/commands/compactCommand";
import { CommandModelSelect, type CommandModelSelectProps } from "./CommandModelSelect";
import { CustomPromptSyntaxInstruction } from "@/components/CustomPromptSyntaxInstruction";
import type { CustomCommand } from "@/commands/type";

type FormErrors = {
  title?: string;
  content?: string;
};

export interface CommandEditorFormProps {
  command: CustomCommand;
  modelOptions: CommandModelSelectProps["options"];
  validateName: (name: string) => string | null;
  onConfirm: (command: CustomCommand) => void;
  onCancel: () => void;
  saving?: boolean;
  error?: string;
}

export function CommandEditorForm({
  command: initialCommand,
  modelOptions,
  validateName,
  onConfirm,
  onCancel,
  saving = false,
  error,
}: CommandEditorFormProps) {
  const [command, setCommand] = useState(initialCommand);
  const [errors, setErrors] = useState<FormErrors>({});

  const handleUpdate = (field: keyof CustomCommand, value: CustomCommand[keyof CustomCommand]) => {
    setCommand((prev) => ({
      ...prev,
      [field]: value,
    }));
    setErrors((prev) => ({
      ...prev,
      [field]: undefined,
    }));
  };

  const handleSubmit = () => {
    if (saving) return;
    const newErrors: FormErrors = {};

    const nameError = validateName(command.title);
    if (nameError) {
      newErrors.title = nameError;
    }

    if (!command.content.trim()) {
      newErrors.content = t("Prompt is required");
    }

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }

    onConfirm(command);
  };

  return (
    <fieldset
      disabled={saving}
      className="tw-group/settings tw-m-0 tw-flex tw-min-w-0 tw-flex-col tw-gap-4 tw-border-0 tw-p-4"
    >
      <div className="tw-flex tw-flex-col tw-gap-2">
        <Label htmlFor="title">{t("Name")}</Label>
        <Input
          id="title"
          value={command.title}
          onChange={(e) => handleUpdate("title", e.target.value)}
          placeholder={t("Enter command name")}
        />
        {errors.title && <div className="tw-text-sm tw-text-error">{errors.title}</div>}
        {/* 与内建 /compact 同名的指令被斜杠菜单永久遮蔽，提示用户开关为何无效。 https://github.com/ItsDalk-Lane/Scribe/issues/20 */}
        {command.title === COMPACT_COMMAND_NAME && !errors.title && (
          <div className="tw-text-sm tw-text-muted">
            {t(
              "This name matches the built-in /compact command, so this command never appears in the slash menu."
            )}
          </div>
        )}
      </div>

      <div className="tw-flex tw-flex-col tw-gap-2">
        <Label htmlFor="content">{t("Prompt")}</Label>
        <CustomPromptSyntaxInstruction />
        <Textarea
          id="content"
          value={command.content}
          onChange={(e) => handleUpdate("content", e.target.value)}
          placeholder={t("Enter command prompt")}
          className="tw-min-h-[200px]"
        />
        {errors.content && <div className="tw-text-sm tw-text-error">{errors.content}</div>}

        <div className="tw-flex tw-items-center tw-gap-2">
          <Checkbox
            id="enableTemplating"
            checked={command.enableTemplating !== false}
            onCheckedChange={(checked) => handleUpdate("enableTemplating", checked)}
          />
          <Label htmlFor="enableTemplating">{t("Command templating")}</Label>
        </div>
        <p className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
          {t(
            "Fill in variables like {activenote}, {foldername}, or {#tag} in commands. Turn off to send commands exactly as written."
          )}
        </p>
      </div>

      <CommandModelSelect
        value={command.modelKey || ""}
        options={modelOptions}
        onChange={(value) => handleUpdate("modelKey", value)}
      />

      <div className="tw-flex tw-items-center tw-gap-2">
        <Checkbox
          id="showInContextMenu"
          checked={command.showInContextMenu}
          onCheckedChange={(checked) => handleUpdate("showInContextMenu", checked)}
        />
        <Label htmlFor="showInContextMenu">{t("Show in context menu")}</Label>
      </div>

      <div className="tw-flex tw-items-center tw-gap-2">
        <Checkbox
          id="showInSlashMenu"
          checked={command.showInSlashMenu}
          onCheckedChange={(checked) => handleUpdate("showInSlashMenu", checked)}
        />
        <Label htmlFor="showInSlashMenu">{t("Show in slash menu")}</Label>
      </div>

      {error && (
        <div role="alert" className="tw-text-sm tw-text-error">
          {error}
        </div>
      )}

      <div className="tw-group/extension-actions tw-flex tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button variant="default" onClick={handleSubmit} disabled={saving}>
          {saving ? t("Saving…") : t("Save")}
        </Button>
      </div>
    </fieldset>
  );
}
