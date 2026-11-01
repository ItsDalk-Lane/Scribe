import React from "react";

import { SelectedTextContext, WebTabContext } from "@/types/message";
import { TFile } from "obsidian";
import { ChatContextMenu } from "./ChatContextMenu";

interface ContextControlProps {
  contextNotes: TFile[];
  includeActiveNote: boolean;
  activeNote: TFile | null;
  includeActiveWebTab: boolean;
  activeWebTab: WebTabContext | null;
  contextFolders: string[];
  contextWebTabs: WebTabContext[];
  selectedTextContexts?: SelectedTextContext[];

  onRemoveFromContext: (category: string, data: string) => void;
}

export const ContextControl: React.FC<ContextControlProps> = ({
  contextNotes,
  includeActiveNote,
  activeNote,
  includeActiveWebTab,
  activeWebTab,
  contextFolders,
  contextWebTabs,
  selectedTextContexts,
  onRemoveFromContext,
}) => {
  return (
    <ChatContextMenu
      includeActiveNote={includeActiveNote}
      currentActiveFile={activeNote}
      includeActiveWebTab={includeActiveWebTab}
      activeWebTab={activeWebTab}
      contextNotes={contextNotes}
      onRemoveContext={onRemoveFromContext}
      contextFolders={contextFolders}
      contextWebTabs={contextWebTabs}
      selectedTextContexts={selectedTextContexts}
    />
  );
};
