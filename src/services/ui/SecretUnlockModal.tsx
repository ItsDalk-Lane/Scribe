import type { App } from "obsidian";
import { ReactModal } from "@/components/modals/ReactModal";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { t } from "@/lib/i18n";
import type { SecretUnlockRequest } from "@/services/secretStore";
import { SecretUnlockForm } from "@/services/ui/SecretUnlockForm";
import React from "react";

class SecretUnlockModal extends ReactModal {
  private completed = false;
  private readonly abort = () => this.close();
  constructor(
    app: App,
    private readonly request: SecretUnlockRequest,
    private readonly settled: () => void
  ) {
    super(app, t(request.creating ? "Set master password" : "Unlock service keys"));
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <SecretUnlockForm
        creating={this.request.creating}
        onCancel={close}
        onSubmit={async (password) => {
          await this.request.submit(password);
          this.completed = true;
          close();
        }}
        onReset={async () => {
          const confirmed = await new Promise<boolean>((resolve) => {
            new ConfirmModal(
              this.app,
              () => resolve(true),
              t(
                "This permanently removes the service keys saved by the new storage system. Other files and the old system keychain are kept. You will need to enter your service keys again."
              ),
              t("Reset saved keys?"),
              t("Reset"),
              t("Cancel"),
              () => resolve(false)
            ).open();
          });
          if (!confirmed) return;
          await this.request.reset();
          close();
        }}
      />
    );
  }

  onOpen(): void {
    if (this.request.signal.aborted) {
      this.close();
      return;
    }
    this.request.signal.addEventListener("abort", this.abort, { once: true });
    super.onOpen();
  }

  onClose(): void {
    this.request.signal.removeEventListener("abort", this.abort);
    if (!this.completed) this.request.cancel();
    super.onClose();
    this.settled();
  }
}

export function requestSecretUnlock(app: App, request: SecretUnlockRequest): Promise<void> {
  return new Promise<void>((resolve) => {
    new SecretUnlockModal(app, request, resolve).open();
  });
}
