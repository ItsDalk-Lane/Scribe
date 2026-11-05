import { t } from "@/lib/i18n";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { App } from "obsidian";

export class ResetSettingsConfirmModal extends ConfirmModal {
  constructor(app: App, onConfirm: () => void | Promise<void>) {
    super(
      app,
      onConfirm,
      t(
        'Resetting settings will restore the default values. API keys are not cleared by this action — use "Delete All Keys" in About → API key storage if you also want to remove them. Are you sure you want to continue?'
      ),
      t("Reset Settings")
    );
  }
}
