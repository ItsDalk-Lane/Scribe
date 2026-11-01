import React from "react";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export interface SkillEditorFormProps {
  initialName?: string;
  initialDescription?: string;
  initialBody?: string;
  readonlyName?: boolean;
  loading?: boolean;
  saving?: boolean;
  error?: string;
  onSave: (name: string, description: string, body: string) => void;
  onCancel: () => void;
}

export function SkillEditorForm({
  initialName = "",
  initialDescription = "",
  initialBody = "",
  readonlyName,
  loading,
  saving,
  error,
  onSave,
  onCancel,
}: SkillEditorFormProps) {
  const [name, setName] = React.useState(initialName);
  const [description, setDescription] = React.useState(initialDescription);
  const [body, setBody] = React.useState(initialBody);
  return (
    <form
      className="tw-group/settings tw-flex tw-flex-col tw-gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        onSave(name, description, body);
      }}
    >
      {loading ? (
        <p role="status">{t("Loading…")}</p>
      ) : (
        <>
          <label className="tw-flex tw-flex-col tw-gap-2 tw-text-sm tw-font-medium">
            {t("Name")}
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              disabled={readonlyName || saving}
              required
              placeholder="my-skill"
            />
          </label>
          <label className="tw-flex tw-flex-col tw-gap-2 tw-text-sm tw-font-medium">
            {t("Description")}
            <Input
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              disabled={saving}
              required
            />
          </label>
          <label className="tw-flex tw-flex-col tw-gap-2 tw-text-sm tw-font-medium">
            {t("Instructions")}
            <Textarea
              className="tw-min-h-64 tw-font-normal tw-leading-relaxed"
              value={body}
              onChange={(event) => setBody(event.target.value)}
              disabled={saving}
              required
            />
          </label>
        </>
      )}
      {error && (
        <p role="alert" className="tw-text-sm tw-text-error">
          {error}
        </p>
      )}
      <div className="tw-group/extension-actions tw-flex tw-justify-end tw-gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button
          type="submit"
          disabled={loading || saving || !name.trim() || !description.trim() || !body.trim()}
        >
          {saving ? t("Saving…") : t("Save")}
        </Button>
      </div>
    </form>
  );
}
