import { useMemo } from "react";
import { isTextReadableFile } from "@/utils";
import { useAtomValue } from "jotai";
import { TFile } from "obsidian";
import { notesAtom } from "@/state/vaultDataAtoms";
import { settingsStore } from "@/settings/model";

export function useAllNotes(isAgentMode = false): TFile[] {
  const allNotes = useAtomValue(notesAtom, { store: settingsStore });

  return useMemo(
    () =>
      allNotes
        .filter((file) => isAgentMode || isTextReadableFile(file))
        .sort((a, b) => b.stat.ctime - a.stat.ctime),
    [allNotes, isAgentMode]
  );
}
