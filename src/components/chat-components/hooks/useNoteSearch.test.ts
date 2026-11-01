import { renderHook } from "@testing-library/react";
import { TFile } from "obsidian";
import { settingsStore } from "@/settings/model";
import { notesAtom } from "@/state/vaultDataAtoms";
import { useNoteSearch } from "./useNoteSearch";

describe("useNoteSearch", () => {
  describe("useNoteSearch()", () => {
    it("offers Markdown and PDF notes to the agent composer", () => {
      const files = ["Research.md", "Research.pdf"].map((path) =>
        Object.assign(new TFile(), {
          path,
          extension: path.split(".").pop(),
          basename: "Research",
          stat: { ctime: 0, mtime: 0, size: 1 },
        })
      );
      settingsStore.set(notesAtom, files);
      const { result } = renderHook(() => useNoteSearch("Research", {}, null));
      expect(result.current.map((option) => option.file.path)).toEqual([
        "Research.md",
        "Research.pdf",
      ]);
    });
  });
});
