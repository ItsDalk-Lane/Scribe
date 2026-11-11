import React, { useState } from "react";
import { t } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SettingSwitch } from "@/components/ui/setting-switch";

export interface SubagentEditorValue {
  name: string;
  description: string;
  instructions: string;
  enabled: boolean;
}

export interface SubagentEditorFormProps {
  initialValue?: SubagentEditorValue;
  onSave: (value: SubagentEditorValue) => Promise<void>;
  onCancel: () => void;
}

export function SubagentEditorForm({ initialValue, onSave, onCancel }: SubagentEditorFormProps) {
  const [name, setName] = useState(initialValue?.name ?? "");
  const [description, setDescription] = useState(initialValue?.description ?? "");
  const [instructions, setInstructions] = useState(initialValue?.instructions ?? "");
  const [enabled, setEnabled] = useState(initialValue?.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (saving || !name.trim() || !description.trim() || !instructions.trim()) return;
    setSaving(true);
    setError("");
    try {
      await onSave({ name: name.trim(), description: description.trim(), instructions, enabled });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="tw-flex tw-flex-col tw-gap-4" onSubmit={(event) => void submit(event)}>
      <label className="tw-flex tw-flex-col tw-gap-2 tw-text-sm">
        {t("Name")}
        <Input
          value={name}
          onChange={(event) => setName(event.target.value)}
          disabled={saving}
          required
        />
      </label>
      <label className="tw-flex tw-flex-col tw-gap-2 tw-text-sm">
        {t("Description")}
        <Input
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          disabled={saving}
          required
        />
      </label>
      <label className="tw-flex tw-flex-col tw-gap-2 tw-text-sm">
        {t("Instructions")}
        <Textarea
          className="tw-min-h-48 tw-leading-relaxed"
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          disabled={saving}
          required
        />
      </label>
      <label className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-sm">
        {t("Enabled")}
        <SettingSwitch
          aria-label={t("Enabled")}
          checked={enabled}
          onCheckedChange={setEnabled}
          disabled={saving}
        />
      </label>
      <p className="tw-m-0 tw-text-ui-smaller tw-text-muted">
        {t("Subagents use the current chat model and permission policy.")}
      </p>
      {error && (
        <p role="alert" className="tw-m-0 tw-text-sm tw-text-error">
          {error}
        </p>
      )}
      <div className="tw-flex tw-justify-end tw-gap-2">
        <Button type="button" variant="ghost" onClick={onCancel} disabled={saving}>
          {t("Cancel")}
        </Button>
        <Button
          type="submit"
          disabled={saving || !name.trim() || !description.trim() || !instructions.trim()}
        >
          {t(saving ? "Saving…" : "Save")}
        </Button>
      </div>
    </form>
  );
}
