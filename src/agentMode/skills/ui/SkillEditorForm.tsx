import React from "react";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export interface SkillEditorFormProps {
  initialContent: string;
  value?: string;
  showActions?: boolean;
  saving?: boolean;
  error?: string;
  onChange?: (content: string) => void;
  onSave: (content: string) => void;
  onCancel: () => void;
}

export function SkillEditorForm({
  initialContent,
  value,
  showActions = true,
  saving,
  error,
  onChange,
  onSave,
  onCancel,
}: SkillEditorFormProps) {
  const [content, setContent] = React.useState(initialContent);
  return (
    <form
      className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!saving) onSave(value ?? content);
      }}
    >
      <Textarea
        aria-label={t("File contents")}
        className="tw-min-h-80 tw-flex-1 tw-resize-none tw-rounded-none tw-border-0 tw-bg-transparent tw-font-mono tw-text-ui-small tw-leading-relaxed focus-visible:tw-ring-0"
        value={value ?? content}
        onChange={(event) => {
          setContent(event.target.value);
          onChange?.(event.target.value);
        }}
        disabled={saving}
        spellCheck={false}
      />
      {error && (
        <p role="alert" className="tw-m-0 tw-text-ui-small tw-text-error">
          {error}
        </p>
      )}
      {showActions && (
        <div className="tw-flex tw-shrink-0 tw-justify-end tw-gap-2 tw-px-3 tw-pb-3">
          <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button type="submit" disabled={saving || !(value ?? content).trim()}>
            {saving ? t("Saving…") : t("Save")}
          </Button>
        </div>
      )}
    </form>
  );
}
