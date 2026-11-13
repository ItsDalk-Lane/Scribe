import { WebSearchSetting } from "@/settings/v2/components/ui/WebSearchSetting";
import { getDeepSeekSearchCredential } from "@/settings/webSearchProvider";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { AgentStepLimitSetting } from "@/settings/v2/components/ui/AgentStepLimitSetting";
import { SubagentLimitSettings } from "@/settings/v2/components/ui/SubagentLimitSettings";
import { SkillCatalogBudgetSettings } from "@/settings/v2/components/ui/SkillCatalogBudgetSettings";
import { updateAgentModeBackendFields } from "@/settings/model";
import { t } from "@/lib/i18n";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import { DEFAULT_OPEN_AREA, DEFAULT_SUBAGENT_LIMITS, SEND_SHORTCUT } from "@/constants";
import { useApp } from "@/context";
import { openAgentsFile, writeAgentsFile } from "@/instructions/agentsFile";
import { useAgentsFileDraft } from "@/instructions/useAgentsFileDraft";
import { logError } from "@/logger";
import { debounce } from "@/utils/debounce";
import { setSettings, updateSetting, useSettingsValue } from "@/settings/model";
import { clearDeviceUnlock } from "@/services/deviceUnlockStore";
import { VaultInstructionsSetting } from "@/settings/v2/components/VaultInstructionsSetting";
import { Notice } from "obsidian";
import React, { useEffect, useMemo, useRef } from "react";

const LazyWebSearchSources = React.lazy(() =>
  import("@/agentMode").then((module) => ({ default: module.WebSearchSourcesPanel }))
);

export const BasicSettings: React.FC = () => {
  const app = useApp();
  const settings = useSettingsValue();
  const [vaultInstructions, setVaultInstructions] = useAgentsFileDraft(app, "");

  const instructionSaveFailed = useRef(false);
  const saveVaultInstructions = useMemo(() => {
    let queue: Promise<boolean> = Promise.resolve(true);
    const enqueue = (next: string): Promise<boolean> => {
      queue = queue.then(() =>
        writeAgentsFile(app, "", next)
          .then(() => {
            instructionSaveFailed.current = false;
            return true;
          })
          .catch((error) => {
            logError("Failed to save vault instructions.", error);
            new Notice(t("Failed to save AGENTS.md."));
            instructionSaveFailed.current = true;
            return false;
          })
      );
      return queue;
    };
    return debounce(enqueue, 1000);
  }, [app]);
  useEffect(() => () => void saveVaultInstructions.flush(), [saveVaultInstructions]);

  const handleOpenVaultInstructions = async () => {
    if (instructionSaveFailed.current && vaultInstructions !== null) {
      void saveVaultInstructions(vaultInstructions);
    }
    if ((await saveVaultInstructions.flush()) === false) return;
    (app as unknown as { setting: { close: () => void } }).setting.close();
    try {
      await openAgentsFile(app, "");
    } catch (error) {
      logError("Failed to open vault AGENTS.md.", error);
      new Notice(error instanceof Error ? error.message : t("Failed to open AGENTS.md."));
    }
  };

  return (
    <div className="tw-space-y-4">
      <SettingSection>
        <SettingItem
          type="select"
          title={t("Open plugin in")}
          description={t("Choose where to open the plugin.")}
          value={settings.defaultOpenArea}
          onChange={(value) => updateSetting("defaultOpenArea", value as DEFAULT_OPEN_AREA)}
          options={[
            { label: t("Sidebar view"), value: DEFAULT_OPEN_AREA.VIEW },
            { label: t("Editor"), value: DEFAULT_OPEN_AREA.EDITOR },
          ]}
        />

        <SettingItem
          type="select"
          title={t("Send shortcut")}
          description={
            <div className="tw-flex tw-items-center tw-gap-1.5">
              <span className="tw-leading-none">{t("Keyboard shortcut to send messages.")}</span>
              <HelpTooltip
                content={
                  <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                    <div className="tw-text-xs tw-text-muted">
                      {t("If your selected shortcut doesn't work, check")}{" "}
                      <strong>{t("Obsidian → Hotkeys")}</strong>{" "}
                      {t(" to see if another command is using the same key combination.")}
                    </div>
                  </div>
                }
              />
            </div>
          }
          value={settings.defaultSendShortcut}
          onChange={(value) => updateSetting("defaultSendShortcut", value as SEND_SHORTCUT)}
          options={[
            { label: "Enter", value: SEND_SHORTCUT.ENTER },
            { label: "Shift + Enter", value: SEND_SHORTCUT.SHIFT_ENTER },
          ]}
        />

        <SettingItem
          type="switch"
          title={t("Auto-attach active note")}
          description={t(
            "Attach the note open in the editor to each new chat. With this off, add it from Add context or with @ when you need it."
          )}
          checked={settings.autoAttachActiveNote}
          onCheckedChange={(checked) => updateSetting("autoAttachActiveNote", checked)}
        />

        <SettingItem
          type="switch"
          title={t("Remember the master password on this device")}
          description={t(
            "Keep the saved keys unlocked across plugin reloads by storing the master password with this device's system keychain. Turn this off to require the password after every reload. Desktop only."
          )}
          checked={settings.secretsRememberOnDevice}
          onCheckedChange={(checked) => {
            updateSetting("secretsRememberOnDevice", checked);
            if (!checked) void clearDeviceUnlock(app);
          }}
        />

        {isDesktopRuntime() && (
          <WebSearchSetting
            providerId={settings.agentMode.webSearchProviderId}
            providers={Object.values(settings.providers)
              .filter((provider) => getDeepSeekSearchCredential(provider))
              .map(({ providerId, displayName }) => ({ providerId, displayName }))}
            onChange={(webSearchProviderId) =>
              setSettings((current) => ({
                agentMode: { ...current.agentMode, webSearchProviderId },
              }))
            }
          />
        )}
        {isDesktopRuntime() && (
          <React.Suspense fallback={null}>
            <LazyWebSearchSources />
          </React.Suspense>
        )}
        <AgentStepLimitSetting
          maxSteps={settings.agentMode.backends.native?.maxSteps}
          onChange={(maxSteps) => updateAgentModeBackendFields("native", { maxSteps })}
        />
        <SubagentLimitSettings
          values={settings.agentMode.subagents ?? DEFAULT_SUBAGENT_LIMITS}
          onChange={(subagents) =>
            setSettings((current) => ({ agentMode: { ...current.agentMode, subagents } }))
          }
        />
        <SettingItem
          type="select"
          title={t("Open subagent chats in")}
          description={t("Choose where a child agent's chat opens from the child agent list.")}
          value={settings.agentMode.subagentChatOpenArea ?? "right"}
          onChange={(value) =>
            setSettings((current) => ({
              agentMode: {
                ...current.agentMode,
                subagentChatOpenArea: value as "left" | "right" | "floating",
              },
            }))
          }
          options={[
            { label: t("Right sidebar"), value: "right" },
            { label: t("Left sidebar"), value: "left" },
            { label: t("Floating panel"), value: "floating" },
          ]}
        />
        <SkillCatalogBudgetSettings
          percent={settings.agentMode.skills.catalogBudgetPercent}
          maxTokens={settings.agentMode.skills.catalogBudgetMaxTokens}
          onChange={(budget) =>
            setSettings((current) => ({
              agentMode: {
                ...current.agentMode,
                skills: { ...current.agentMode.skills, ...budget },
              },
            }))
          }
        />
      </SettingSection>

      <SettingSection>
        {vaultInstructions !== null && (
          <VaultInstructionsSetting
            value={vaultInstructions}
            onChange={(next) => {
              setVaultInstructions(next);
              void saveVaultInstructions(next);
            }}
            onOpen={() => void handleOpenVaultInstructions()}
          />
        )}
      </SettingSection>
    </div>
  );
};
