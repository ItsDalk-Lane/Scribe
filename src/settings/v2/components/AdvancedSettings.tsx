import { t } from "@/lib/i18n";
import { DebuggingSupportSection } from "@/settings/v2/components/DebuggingSupportSection";
import { KeyStorageSection } from "@/settings/v2/components/KeyStorageSection";
import { useApp } from "@/context";
import { getScribeSaveData } from "@/settings/scribeSaveData";
import { KeychainService } from "@/services/keychainService";
import {
  refreshLastPersistedSettings,
  releaseLegacyCredentialHold,
  runPersistenceTransaction,
  suppressNextPersistOnce,
} from "@/services/settingsPersistence";
import { logError } from "@/logger";
import {
  type ScribeSettings,
  setSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Notice } from "obsidian";
import React, { useCallback, useEffect, useState } from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

const DESKTOP_UNAVAILABLE_FRAME_LOG_PATH = "(the agent activity log is desktop-only)";

export const AdvancedSettings: React.FC = () => {
  const app = useApp();
  const settings = useSettingsValue();
  const [forgetting, setForgetting] = useState(false);
  const [frameLogPath, setFrameLogPath] = useState(() => t(DESKTOP_UNAVAILABLE_FRAME_LOG_PATH));

  useEffect(() => {
    if (!isDesktopRuntime()) return;

    let cancelled = false;
    void import("@/agentMode").then(({ acpFrameSink }) => {
      if (!cancelled) {
        setFrameLogPath(acpFrameSink.getPath());
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  const keychainAvailable = KeychainService.getInstance().isAvailable();

  const handleOpenFrameLog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      new Notice(t("The agent activity log is available on desktop only."));
      return;
    }
    try {
      const { acpFrameSink } = await import("@/agentMode");
      await acpFrameSink.open();
      setFrameLogPath(acpFrameSink.getPath());
    } catch {
      new Notice(t("Failed to open the agent activity log."));
    }
  }, []);

  const handleClearFrameLog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      new Notice(t("The agent activity log is available on desktop only."));
      return;
    }
    try {
      const { acpFrameSink } = await import("@/agentMode");
      await acpFrameSink.clear();
      setFrameLogPath(acpFrameSink.getPath());
      new Notice(t("Agent activity log cleared."));
    } catch {
      new Notice(t("Failed to clear the agent activity log."));
    }
  }, []);

  const handleForgetAllSecrets = useCallback(async () => {
    if (forgetting) return;

    const confirmed = await new Promise<boolean>((resolve) => {
      new ConfirmModal(
        app,
        () => resolve(true),
        t(
          "This removes Scribe API keys for this vault from the Obsidian Keychain, data.json, and memory. You may need to enter them again. Existing credential backups may remain; review them separately."
        ),
        t("⚠️ Forget All Secrets"),
        t("Remove"),
        t("Cancel"),
        () => resolve(false)
      ).open();
    });
    if (!confirmed) return;

    setForgetting(true);
    try {
      const keychain = KeychainService.getInstance();
      const saveData = getScribeSaveData(app);

      await runPersistenceTransaction(() =>
        keychain.forgetAllSecrets(
          async (data) => {
            await saveData(data);
            releaseLegacyCredentialHold();
          },
          (nextSettings) => {
            refreshLastPersistedSettings(nextSettings as ScribeSettings);
            suppressNextPersistOnce();
            setSettings(nextSettings);
          }
        )
      );
    } catch (error) {
      logError("Failed to forget secrets.", error);
      new Notice(
        t(
          "Failed to remove API keys. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
        )
      );
    } finally {
      setForgetting(false);
    }
  }, [app, forgetting]);

  return (
    <div className="tw-space-y-4">
      <KeyStorageSection
        keychainAvailable={keychainAvailable}
        forgetting={forgetting}
        onForget={safeAsyncHandler(handleForgetAllSecrets)}
      />

      <DebuggingSupportSection
        debug={settings.debug}
        onDebugChange={(checked) => updateSetting("debug", checked)}
        frameLogEnabled={settings.agentMode.debugFullFrames}
        onFrameLogChange={(checked) => {
          setSettings((cur) => ({
            agentMode: { ...cur.agentMode, debugFullFrames: checked },
          }));
        }}
        frameLogPath={frameLogPath}
        onOpenFrameLog={safeAsyncHandler(handleOpenFrameLog)}
        onClearFrameLog={safeAsyncHandler(handleClearFrameLog)}
      />
    </div>
  );
};
