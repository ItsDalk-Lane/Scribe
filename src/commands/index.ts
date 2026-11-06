import { t } from "@/lib/i18n";
import { logFileManager } from "@/logFileManager";
import { logError } from "@/logger";
import ChatModelManager from "@/LLMProviders/chatModelManager";

import { CustomCommandSettingsModal } from "@/commands/CustomCommandSettingsModal";
import { EMPTY_COMMAND } from "@/commands/constants";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { getCachedCustomCommands } from "@/commands/state";
import { CustomCommand } from "@/commands/type";
import {
  QUICK_COMMAND_SYSTEM_PROMPT,
  appendIncludeNoteContextPlaceholders,
} from "@/commands/quickCommandPrompts";
import { CustomCommandChatModal } from "@/commands/CustomCommandChatModal";
import { ApplyCustomCommandModal } from "@/components/modals/ApplyCustomCommandModal";
import type ScribePlugin from "@/main";
import { getVaultCharacterCount } from "@/search/searchUtils";
import { WebSelectedTextContext } from "@/types/message";
import { isSourceModeOn } from "@/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { Editor, MarkdownView, Notice } from "obsidian";
import { v4 as uuidv4 } from "uuid";
import { COMMAND_IDS, COMMAND_ICONS, COMMAND_NAMES, CommandId } from "@/constants";
import { attachSelection } from "@/selection/selectionStore";
import { editorSelectionReport, webSelectionReport } from "@/selection/selectionWatcher";

function addCommand(plugin: ScribePlugin, id: CommandId, callback: () => void | Promise<void>) {
  plugin.addCommand({
    id,
    name: t(COMMAND_NAMES[id]),
    icon: COMMAND_ICONS[id],
    callback: () => {
      const result = callback();
      if (result instanceof Promise) {
        result.catch((err) => logError(`Command ${id} failed`, err));
      }
    },
  });
}

function addEditorCommand(
  plugin: ScribePlugin,
  id: CommandId,
  callback: (editor: Editor) => void | Promise<void>
) {
  plugin.addCommand({
    id,
    name: t(COMMAND_NAMES[id]),
    icon: COMMAND_ICONS[id],
    editorCallback: (editor) => {
      const result = callback(editor);
      if (result instanceof Promise) {
        result.catch((err) => logError(`Editor command ${id} failed`, err));
      }
    },
  });
}

function addCheckCommand(
  plugin: ScribePlugin,
  id: CommandId,
  callback: (checking: boolean) => boolean | void
) {
  plugin.addCommand({
    id,
    name: t(COMMAND_NAMES[id]),
    icon: COMMAND_ICONS[id],
    checkCallback: callback,
  });
}

export function registerCommands(plugin: ScribePlugin) {
  addEditorCommand(plugin, COMMAND_IDS.COUNT_WORD_AND_TOKENS_SELECTION, async (editor: Editor) => {
    const selectedText = editor.getSelection();
    const wordCount = selectedText.split(" ").length;
    const tokenCount = await ChatModelManager.getInstance().countTokens(selectedText);
    new Notice(
      t("Selected text contains {wordCount} words and {tokenCount} tokens.", {
        wordCount: wordCount,
        tokenCount: tokenCount,
      })
    );
  });

  addCommand(plugin, COMMAND_IDS.COUNT_TOTAL_VAULT_TOKENS, async () => {
    try {
      const characterCount = await getVaultCharacterCount(plugin.app);
      const totalTokens = Math.ceil(characterCount / 4);
      new Notice(t("Total tokens in your vault: {totalTokens}", { totalTokens: totalTokens }));
    } catch (error) {
      logError("Error counting tokens: ", error);
      new Notice(t("An error occurred while counting tokens."));
    }
  });

  if (isDesktopRuntime()) {
    addCommand(plugin, COMMAND_IDS.OPEN_AGENT_CHAT_WINDOW, () => {
      void plugin.activateAgentView();
    });
    addCommand(plugin, COMMAND_IDS.TOGGLE_AGENT_CHAT_WINDOW, () => {
      void plugin.toggleAgentView();
    });
    addCommand(plugin, COMMAND_IDS.NEW_AGENT_CHAT, () => {
      void plugin.newAgentChat();
    });
  }

  addCheckCommand(plugin, COMMAND_IDS.TRIGGER_QUICK_COMMAND, (checking: boolean) => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (checking) {
      return !!(!isSourceModeOn(plugin.app) && activeView && activeView.editor);
    }

    if (isSourceModeOn(plugin.app)) {
      new Notice(t("Quick command is not available in source mode."));
      return false;
    }

    if (!activeView || !activeView.editor) {
      new Notice(t("No active editor found."));
      return false;
    }

    const editor = activeView.editor;
    const selectedText = editor.getSelection();

    if (!selectedText.trim()) {
      new Notice(t("Please select some text first. Selected text is required for quick commands."));
      return false;
    }

    const quickCommand: CustomCommand = {
      title: t("Quick Command"),
      content: "",
      showInContextMenu: false,
      showInSlashMenu: false,
      order: 0,
      modelKey: "",
      lastUsedMs: Date.now(),
    };

    const modal = new CustomCommandChatModal(plugin.app, {
      selectedText,
      command: quickCommand,
      systemPrompt: QUICK_COMMAND_SYSTEM_PROMPT,
      behaviorConfig: {
        autoExecuteOnOpen: false,
        hideContentAreaOnIdle: true,
        commandLabel: t("Quick Command"),
        commandIcon: null,
        showIncludeNoteContext: true,
        firstSubmitTransform: (input, includeNoteContext) =>
          appendIncludeNoteContextPlaceholders(input, includeNoteContext),
      },
    });
    modal.open();

    return true;
  });

  addCommand(plugin, COMMAND_IDS.OPEN_LOG_FILE, async () => {
    try {
      await logFileManager.openLogFile();
    } catch (error) {
      logError("Error creating Scribe log file:", error);
      new Notice(t("Failed to create Scribe log file."));
    }
  });

  addCommand(plugin, COMMAND_IDS.CLEAR_LOG_FILE, async () => {
    try {
      await logFileManager.clear();
      new Notice(t("Scribe log cleared."));
    } catch (error) {
      logError("Error clearing Scribe log file:", error);
      new Notice(t("Failed to clear Scribe log file."));
    }
  });

  addEditorCommand(plugin, COMMAND_IDS.ADD_SELECTION_TO_CHAT_CONTEXT, async (editor: Editor) => {
    const file = plugin.app.workspace.getActiveFile();
    if (!file) {
      new Notice(t("No active file"));
      return;
    }

    const report = editorSelectionReport({ editor, file });
    if (!report?.context) {
      new Notice(t("No text selected"));
      return;
    }

    attachSelection(report);

    await plugin.activateChatViewForContext();
  });

  addCommand(plugin, COMMAND_IDS.ADD_WEB_SELECTION_TO_CHAT_CONTEXT, async () => {
    if (!isDesktopRuntime()) {
      new Notice(t("Web selection is only available on desktop"));
      return;
    }

    const { getWebViewerService } =
      await import("@/services/webViewerService/webViewerServiceSingleton");

    try {
      const service = getWebViewerService(plugin.app);
      const leaf = service.getActiveLeaf() ?? service.getLastActiveLeaf();

      if (!leaf) {
        new Notice(t("No active web tab found"));
        return;
      }

      const selectedMarkdown = await service.getSelectedMarkdown(leaf);
      if (!selectedMarkdown.trim()) {
        new Notice(t("No text selected in the web tab"));
        return;
      }

      const pageInfo = service.getPageInfo(leaf);

      const webSelectedTextContext: WebSelectedTextContext = {
        id: uuidv4(),
        content: selectedMarkdown,
        sourceType: "web",
        title: pageInfo.title || "Untitled",
        url: pageInfo.url,
        faviconUrl: pageInfo.faviconUrl || undefined,
      };

      attachSelection(webSelectionReport(webSelectedTextContext));

      await plugin.activateChatViewForContext();
    } catch (error) {
      logError("Error adding web selection to context:", error);
      new Notice(t("Failed to get web selection"));
    }
  });

  addCommand(plugin, COMMAND_IDS.ADD_CUSTOM_COMMAND, async () => {
    const commands = getCachedCustomCommands();
    const newCommand = { ...EMPTY_COMMAND };
    const modal = new CustomCommandSettingsModal(
      plugin.app,
      commands,
      newCommand,
      async (updatedCommand) => {
        await CustomCommandManager.getInstance().createCommand(updatedCommand);
      }
    );
    modal.open();
  });

  addCommand(plugin, COMMAND_IDS.APPLY_CUSTOM_COMMAND, () => {
    const modal = new ApplyCustomCommandModal(plugin.app);
    modal.open();
  });

  addCheckCommand(plugin, COMMAND_IDS.TRIGGER_QUICK_ASK, (checking: boolean) => {
    const activeView = plugin.app.workspace.getActiveViewOfType(MarkdownView);

    if (checking) {
      return !!(!isSourceModeOn(plugin.app) && activeView && activeView.editor);
    }

    if (isSourceModeOn(plugin.app)) {
      new Notice(t("Quick Ask is not available in source mode."));
      return false;
    }

    if (!activeView || !activeView.editor) {
      new Notice(t("No active editor found."));
      return false;
    }

    const view = activeView.editor.cm;
    if (!view) {
      new Notice(t("Could not access CodeMirror editor."));
      return false;
    }

    plugin.quickAskController.show(activeView, view);
    return true;
  });
}
