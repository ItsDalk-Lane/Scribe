import { t } from "@/lib/i18n";
import type { InstallState } from "@/agentMode/session/types";

export function claudeUpdateDetail(state: InstallState): string {
  if (state.kind === "incompatible" && state.source === "custom") {
    return t(
      "Update the binary at the saved path, or clear the override to use an auto-detected installation."
    );
  }
  return t("Update it with the install command below, then reopen this dialog.");
}
