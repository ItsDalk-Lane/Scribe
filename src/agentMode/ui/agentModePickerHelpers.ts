import { App } from "obsidian";
import type { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import type { BackendId, BackendState } from "@/agentMode/session/types";
import type { AgentModePickerOverride } from "./useAgentModePicker";
import { handlePickerSwitchError } from "./agentModelPickerHelpers";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { t } from "@/lib/i18n";

interface ModeActiveContext {
  activeBackendId: BackendId | null;
  activeMode: BackendState["mode"];
  activeChatUIState: AgentChatUIState | null;
}

function collectModeActiveContext(manager: AgentSessionManager): ModeActiveContext {
  const activeSession = manager.getActiveSession();
  const activeChatUIState = manager.getActiveChatUIState();
  const activeBackendId = activeSession?.backendId ?? null;
  const activeState = activeSession?.getState() ?? null;
  return {
    activeBackendId,
    activeMode: activeState?.mode ?? null,
    activeChatUIState,
  };
}

// 完全模式免确认执行所有操作，切入前必须经一次知情确认；下拉选择与 Shift+Tab 循环都汇聚到该 onChange。
// https://github.com/ItsDalk-Lane/Scribe/issues/38
function confirmFullModeSwitch(app: App, onConfirm: () => void): void {
  new ConfirmModal(
    app,
    onConfirm,
    t(
      "In Full mode the agent runs every action without asking, including:\n- system commands\n- writes outside the vault\n- changes to the Obsidian config folder\nUse it only when you trust the task."
    ),
    t("Switch to Full mode"),
    t("Switch to Full")
  ).open();
}

export function buildAgentModePicker(args: {
  manager: AgentSessionManager | null;
  app: App | null;
}): AgentModePickerOverride | null {
  const { manager, app } = args;
  if (!manager) return null;
  const ctx = collectModeActiveContext(manager);
  const { activeBackendId, activeMode, activeChatUIState } = ctx;
  if (!activeBackendId || !activeMode) return null;
  return {
    options: activeMode.options,
    value: activeMode.current,
    disabled: activeChatUIState?.canSwitchMode() === false,
    onChange: (value) => {
      const spec = activeMode.apply[value];
      if (!spec) return;
      const applyMode = () => {
        manager.applyMode(activeBackendId, value, spec).catch((err) => {
          handlePickerSwitchError(err, "mode");
        });
      };
      if (value === "full" && activeMode.current !== "full") {
        if (!app) return;
        confirmFullModeSwitch(app, applyMode);
        return;
      }
      applyMode();
    },
  };
}
