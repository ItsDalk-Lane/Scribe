import { t } from "@/lib/i18n";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingDisclosure } from "@/components/ui/setting-disclosure";
import { SettingSection } from "@/components/ui/setting-section";
import { DEFAULT_OPEN_AREA, SEND_SHORTCUT } from "@/constants";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { openAgentsFile, writeAgentsFile } from "@/instructions/agentsFile";
import { useAgentsFileDraft } from "@/instructions/useAgentsFileDraft";
import { logError } from "@/logger";
import { debounce } from "@/utils/debounce";
import { ensureScribeSubfolders } from "@/settings/scribeFolder";
import {
  applyScribeRootChange,
  scribeRootContainsNotes,
  findScribeRootFileConflict,
} from "@/settings/scribeRootChange";
import { updateSetting, useSettingsValue, validateScribeFolder } from "@/settings/model";
import { ScribeFolderChangeNotice } from "@/settings/v2/components/ScribeFolderChangeNotice";
import { VaultInstructionsSetting } from "@/settings/v2/components/VaultInstructionsSetting";
import { ChatAutosaveSetting } from "@/settings/v2/components/ui/ChatAutosaveSetting";
import { formatDateTime } from "@/utils";
import { revealFolderInExplorer } from "@/utils/revealFolderInExplorer";
import { Folder, Loader2 } from "lucide-react";
import { Notice } from "obsidian";
import React, { useEffect, useMemo, useRef, useState } from "react";

interface BasicSettingsProps {
  section?: "general" | "instructions" | "saving";
}

export const BasicSettings: React.FC<BasicSettingsProps> = ({ section = "general" }) => {
  const app = useApp();
  const settings = useSettingsValue();
  const [isChecking, setIsChecking] = useState(false);
  const [templateOpen, setTemplateOpen] = useState(false);
  const [conversationNoteName, setConversationNoteName] = useState(
    settings.defaultConversationNoteName || "{$date}_{$time}__{$topic}"
  );

  const persistedRoot = settings.scribeFolder;
  const [folderDraft, setFolderDraft] = useState(persistedRoot);

  useEffect(() => {
    /* eslint-disable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- resync the draft when the persisted root changes underneath us (e.g. Reset Settings or a completed change) */
    setFolderDraft(persistedRoot);
    /* eslint-enable @eslint-react/hooks-extra/no-direct-set-state-in-use-effect -- resume checking after persisted-root synchronization */
  }, [persistedRoot]);

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

  const applyFolderChange = () => {
    const validation = validateScribeFolder(folderDraft, app.vault.configDir);
    if (!validation.ok) {
      new Notice(t("Invalid Scribe folder: {reason}", { reason: validation.reason }), 5000);
      return;
    }
    const folder = validation.folder;
    if (folder === persistedRoot) {
      new Notice(t("That's already the Scribe folder."), 3000);
      return;
    }
    const conflict = findScribeRootFileConflict(app, folder);
    if (conflict) {
      new Notice(
        t(
          '"{conflict}" is an existing file, so "{folder}" can\'t be used as a folder. Choose another location.',
          { conflict: conflict, folder: folder }
        ),
        8000
      );
      return;
    }
    const containsMarkdown = scribeRootContainsNotes(app, folder);
    new ConfirmModal(
      app,
      () => {
        void applyScribeRootChange(app, folder)
          .then(() => ensureScribeSubfolders(app.vault, { scribeFolder: folder }))
          .then(
            () => new Notice(t('Scribe folder changed to "{folder}".', { folder: folder }), 4000)
          )
          .catch(
            () => new Notice(t("Failed to change the Scribe folder. Check the Scribe log."), 5000)
          );
      },
      <ScribeFolderChangeNotice
        oldRoot={persistedRoot}
        newRoot={folder}
        containsMarkdown={containsMarkdown}
      />,
      "",
      containsMarkdown ? t("Use folder") : t("Change folder"),
      t("Cancel"),
      () => setFolderDraft(persistedRoot)
    ).open();
  };

  const applyCustomNoteFormat = () => {
    setIsChecking(true);

    try {
      const format = conversationNoteName || "{$date}_{$time}__{$topic}";
      const requiredVars = ["{$date}", "{$time}", "{$topic}"];
      const missingVars = requiredVars.filter((v) => !format.includes(v));

      if (missingVars.length > 0) {
        new Notice(
          t("Error: Missing required variables: {value0}", { value0: missingVars.join(", ") }),
          4000
        );
        return;
      }

      const illegalChars = /[\\/:*?"<>|]/;
      const formatWithoutVars = format
        .replace(/\{\$date}/g, "")
        .replace(/\{\$time}/g, "")
        .replace(/\{\$topic}/g, "");

      if (illegalChars.test(formatWithoutVars)) {
        new Notice(t('Error: Format contains illegal characters (\\/:*?"<>|)'), 4000);
        return;
      }

      const { fileName: timestampFileName } = formatDateTime(new Date());
      const firstTenWords = "test topic name";

      const customFileName = format
        .replace("{$topic}", firstTenWords.slice(0, 100).replace(/\s+/g, "_"))
        .replace("{$date}", timestampFileName.split("_")[0])
        .replace("{$time}", timestampFileName.split("_")[1]);

      updateSetting("defaultConversationNoteName", format);
      setConversationNoteName(format);
      new Notice(
        t("Format applied successfully! Example: {customFileName}", {
          customFileName: customFileName,
        }),
        4000
      );
    } catch (error) {
      new Notice(
        t("Error applying format: {value0}", {
          value0: error instanceof Error ? error.message : String(error),
        }),
        4000
      );
    } finally {
      setIsChecking(false);
    }
  };

  return (
    <div className="tw-space-y-4">
      {section === "general" && (
        <SettingSection label={t("General")}>
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
            type="custom"
            title={t("Scribe folder location")}
            description={t(
              "Where Scribe keeps chats, commands, skills, and projects. Its other folders live inside this one."
            )}
          >
            <div className="tw-flex tw-items-center tw-gap-2">
              <Input
                type="text"
                value={folderDraft}
                onChange={(e) => setFolderDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    applyFolderChange();
                  }
                }}
                placeholder="scribe"
                className="tw-w-full sm:tw-w-[160px]"
                aria-label={t("Scribe folder")}
              />
              <Button
                variant="secondary"
                onClick={applyFolderChange}
                aria-label={t("Apply Scribe folder")}
              >
                {t("Apply")}
              </Button>
              <Button
                variant="secondary"
                size="icon"
                onClick={() => revealFolderInExplorer(app, settings.scribeFolder)}
                aria-label={t("Open Scribe folder")}
                title={t("Open Scribe folder")}
              >
                <Folder className="tw-size-4" />
              </Button>
            </div>
          </SettingItem>
        </SettingSection>
      )}

      {section === "instructions" && (
        <SettingSection label={t("Custom instructions")}>
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
      )}

      {section === "saving" && (
        <SettingSection label={t("Saving chats")}>
          <ChatAutosaveSetting
            checked={settings.autosaveChat}
            onCheckedChange={(checked) => updateSetting("autosaveChat", checked)}
          />

          <Collapsible open={templateOpen} onOpenChange={setTemplateOpen}>
            <CollapsibleTrigger asChild>
              <SettingDisclosure open={templateOpen} />
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SettingItem
                type="custom"
                title={t("Chat note name template")}
                description={
                  <div className="tw-flex tw-items-start tw-gap-1.5 ">
                    <span className="tw-leading-none">
                      {t("Customize the names of saved chat notes.")}
                    </span>
                    <HelpTooltip
                      content={
                        <div className="tw-flex tw-max-w-96 tw-flex-col tw-gap-2 tw-py-4">
                          <div className="tw-text-sm tw-font-medium tw-text-accent">
                            {t(
                              "Note: All the following variables must be included in the template."
                            )}
                          </div>
                          <div>
                            <div className="tw-text-sm tw-font-medium tw-text-muted">
                              {t("Available variables:")}
                            </div>
                            <ul className="tw-pl-4 tw-text-sm tw-text-muted">
                              <li>
                                <strong>{"{$date}"}</strong>
                                {t(": Date in YYYYMMDD format")}
                              </li>
                              <li>
                                <strong>{"{$time}"}</strong>
                                {t(": Time in HHMMSS format")}
                              </li>
                              <li>
                                <strong>{"{$topic}"}</strong>
                                {t(": Chat topic")}
                              </li>
                            </ul>
                            <i className="tw-mt-2 tw-text-sm tw-text-muted">
                              {t("Example: ")}
                              {"{$date}_{$time}__{$topic}"}{" "}
                              {t(" → 20250114_153232__polish_this_article_[[Readme]]")}
                            </i>
                          </div>
                        </div>
                      }
                    />
                  </div>
                }
              >
                <div className="tw-flex tw-w-[320px] tw-items-center tw-gap-1.5">
                  <Input
                    type="text"
                    className={cn(
                      "tw-min-w-[80px] tw-grow tw-transition-all tw-duration-200",
                      isChecking ? "tw-w-[80px]" : "tw-w-[120px]"
                    )}
                    placeholder="{$date}_{$time}__{$topic}"
                    value={conversationNoteName}
                    onChange={(e) => setConversationNoteName(e.target.value)}
                    disabled={isChecking}
                  />

                  <Button
                    onClick={() => applyCustomNoteFormat()}
                    disabled={isChecking}
                    variant="secondary"
                  >
                    {isChecking ? (
                      <>
                        <Loader2 className="tw-mr-2 tw-size-4 tw-animate-spin" />
                        {t("Apply")}
                      </>
                    ) : (
                      t("Apply")
                    )}
                  </Button>
                </div>
              </SettingItem>
            </CollapsibleContent>
          </Collapsible>
        </SettingSection>
      )}
    </div>
  );
};
