import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { PasswordInput } from "@/components/ui/password-input";
import { t } from "@/lib/i18n";
import React, { useState } from "react";

export interface SecretUnlockFormProps {
  creating: boolean;
  onSubmit: (password: string) => Promise<void>;
  onCancel: () => void;
  onReset: () => Promise<void>;
}

export function SecretUnlockForm({
  creating,
  onSubmit,
  onCancel,
  onReset,
}: SecretUnlockFormProps): React.ReactElement {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    if (busy) return;
    if (creating && password.length < 12) {
      setError(t("Use at least 12 characters for your master password."));
      return;
    }
    if (creating && password !== confirmation) {
      setError(t("The passwords do not match."));
      return;
    }
    setBusy(true);
    setError("");
    try {
      await onSubmit(password);
      setPassword("");
      setConfirmation("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("Could not unlock the saved keys."));
    } finally {
      setBusy(false);
    }
  };
  const reset = async (): Promise<void> => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await onReset();
    } catch {
      setError(t("Could not reset the saved keys. Please retry."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="tw-flex tw-flex-col tw-gap-4"
      onSubmit={(event) => {
        void submit(event);
      }}
    >
      <p className="tw-text-ui-small tw-text-muted">
        {t(
          creating
            ? "Set a master password to encrypt your service keys. Scribe does not save this password. If you forget it, you will need to reset the saved keys and enter them again."
            : "Unlock your saved service keys for this vault. They stay locked until a request needs them, and your password is never saved."
        )}
      </p>
      <FormField label={t("Master password")}>
        <PasswordInput
          ariaLabel={t("Master password")}
          value={password}
          onChange={setPassword}
          disabled={busy}
        />
      </FormField>
      {creating && (
        <FormField label={t("Confirm master password")}>
          <PasswordInput
            ariaLabel={t("Confirm master password")}
            value={confirmation}
            onChange={setConfirmation}
            disabled={busy}
          />
        </FormField>
      )}
      {error && (
        <p role="alert" className="tw-text-ui-small tw-text-error">
          {error}
        </p>
      )}
      <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
        {!creating && (
          <Button
            type="button"
            variant="destructive"
            disabled={busy}
            onClick={() => {
              void reset();
            }}
          >
            {t("Reset saved keys")}
          </Button>
        )}
        <Button type="button" variant="ghost" disabled={busy} onClick={onCancel}>
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={busy || !password}>
          {t(creating ? "Set password" : "Unlock")}
        </Button>
      </div>
    </form>
  );
}
