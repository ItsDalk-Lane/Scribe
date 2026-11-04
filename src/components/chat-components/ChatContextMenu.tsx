import { TFile } from "obsidian";
import React from "react";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import {
  ContextNoteBadge,
  ContextActiveNoteBadge,
  ContextActiveWebTabBadge,
  ContextWebTabBadge,
  ContextFolderBadge,
  ContextSelectedTextBadge,
} from "@/components/chat-components/ContextBadges";
import { SelectedTextContext, WebTabContext } from "@/types/message";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { openFileInTab } from "@/utils/openVaultPath";
import { mergeWebTabContexts } from "@/utils/urlNormalization";

const EMPTY_SELECTED_TEXT_CONTEXTS: SelectedTextContext[] = [];

interface ChatContextMenuProps {
  includeActiveNote: boolean;
  currentActiveFile: TFile | null;
  includeActiveWebTab: boolean;
  activeWebTab: WebTabContext | null;
  contextNotes: TFile[];
  contextFolders: string[];
  contextWebTabs: WebTabContext[];
  selectedTextContexts?: SelectedTextContext[];
  onRemoveContext: (category: string, data: string) => void;
}

export const ChatContextMenu: React.FC<ChatContextMenuProps> = ({
  includeActiveNote,
  currentActiveFile,
  includeActiveWebTab,
  activeWebTab,
  contextNotes,
  contextFolders,
  contextWebTabs,
  selectedTextContexts = EMPTY_SELECTED_TEXT_CONTEXTS,
  onRemoveContext,
}) => {
  const app = useApp();
  const handleBadgeClick = (file: TFile) => {
    void openFileInTab(app, file).catch((error: unknown) => logError("openFile failed", error));
  };

  const uniqueNotes = React.useMemo(() => {
    const notesMap = new Map(contextNotes.map((note) => [note.path, note]));
    return Array.from(notesMap.values());
  }, [contextNotes]);

  const uniqueWebTabs = React.useMemo(() => mergeWebTabContexts(contextWebTabs), [contextWebTabs]);

  const activeNoteVisible = includeActiveNote && Boolean(currentActiveFile);
  const activeWebTabVisible = includeActiveWebTab && Boolean(activeWebTab) && isDesktopRuntime();

  const hasContext =
    uniqueNotes.length > 0 ||
    selectedTextContexts.length > 0 ||
    contextFolders.length > 0 ||
    uniqueWebTabs.length > 0 ||
    activeNoteVisible ||
    activeWebTabVisible;

  if (!hasContext) {
    return null;
  }

  return (
    <div className="tw-flex tw-w-full tw-items-start tw-gap-1">
      <div className="tw-flex tw-flex-1 tw-flex-wrap tw-gap-1">
        {activeNoteVisible && currentActiveFile && (
          <ContextActiveNoteBadge
            currentActiveFile={currentActiveFile}
            onRemove={() => onRemoveContext("activeNote", "")}
            onClick={() => handleBadgeClick(currentActiveFile)}
          />
        )}
        {activeWebTabVisible && activeWebTab && (
          <ContextActiveWebTabBadge
            activeWebTab={activeWebTab}
            onRemove={() => onRemoveContext("activeWebTab", "")}
          />
        )}
        {uniqueNotes.map((note) => (
          <ContextNoteBadge
            key={note.path}
            note={note}
            onRemove={() => onRemoveContext("notes", note.path)}
            onClick={() => handleBadgeClick(note)}
          />
        ))}

        {contextFolders.map((folder) => (
          <ContextFolderBadge
            key={folder}
            folder={folder}
            onRemove={() => onRemoveContext("folders", folder)}
          />
        ))}
        {uniqueWebTabs.map((webTab) => (
          <ContextWebTabBadge
            key={webTab.url}
            webTab={webTab}
            onRemove={() => onRemoveContext("webTabs", webTab.url)}
          />
        ))}
        {selectedTextContexts.map((selectedText) => (
          <ContextSelectedTextBadge
            key={selectedText.id}
            selectedText={selectedText}
            onRemove={() => onRemoveContext("selectedText", selectedText.id)}
          />
        ))}
      </div>
    </div>
  );
};
