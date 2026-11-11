import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { PasswordInput } from "@/components/ui/password-input";
import { t } from "@/lib/i18n";
import React from "react";

export interface ProviderCredentialFieldProps {
  label: string;
  value: string;
  hasSavedKey: boolean;
  clearRequested: boolean;
  required: boolean;
  editableExisting: boolean;
  saving: boolean;
  placeholder?: string;
  onChange: (value: string) => void;
  onClear: () => void;
}

export function ProviderCredentialField({
  label,
  value,
  hasSavedKey,
  clearRequested,
  required,
  editableExisting,
  saving,
  placeholder,
  onChange,
  onClear,
}: ProviderCredentialFieldProps) {
  const saved = hasSavedKey && !clearRequested;
  return (
    <FormField label={label} required={required}>
      <div className="tw-flex tw-gap-2">
        <PasswordInput
          className="tw-flex-1"
          value={value}
          disabled={saving}
          onChange={onChange}
          placeholder={
            saved
              ? t("Saved key — leave blank to keep it")
              : (placeholder ?? t("Paste your API key"))
          }
        />
        {editableExisting && !clearRequested && (hasSavedKey || value.length > 0) && (
          <Button
            variant="destructive"
            onClick={onClear}
            data-testid="api-key-clear"
            disabled={saving}
          >
            {t("Clear")}
          </Button>
        )}
      </div>
      {saved && !value && (
        <div className="tw-text-ui-smaller tw-leading-relaxed tw-text-muted">{t("Saved key")}</div>
      )}
      {clearRequested && (
        <div className="tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
          {t("The saved key will be removed when you save.")}
        </div>
      )}
      {required && !value.trim() && !saved && (
        <div className="tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
          {t("An API key is required for this provider.")}
        </div>
      )}
    </FormField>
  );
}
