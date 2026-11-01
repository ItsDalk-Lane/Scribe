import { renderHook } from "@testing-library/react";
import { TFile } from "obsidian";
import { settingsStore } from "@/settings/model";
import { notesAtom } from "@/state/vaultDataAtoms";
import { useAtMentionSearch } from "./useAtMentionSearch";

jest.mock("./useOpenWebTabs", () => ({ useOpenWebTabs: () => [] }));
jest.mock("./useActiveWebTabState", () => ({
  useActiveWebTabState: () => ({ activeWebTabForMentions: null }),
}));
jest.mock("./useAllFolders", () => ({ useAllFolders: () => [] }));

describe("useAtMentionSearch", () => {
  describe("useAtMentionSearch()", () => {
    it.each([
      { isAgentMode: true, mode: "category" as const, query: "Research" },
      { isAgentMode: false, mode: "category" as const, query: "Research" },
      { isAgentMode: true, mode: "search" as const, query: "" },
      { isAgentMode: false, mode: "search" as const, query: "" },
    ])(
      "offers PDFs in $mode search only when Agent Chat is $isAgentMode",
      ({ isAgentMode, mode, query }) => {
        const files = ["Research.md", "Research.pdf"].map((path) =>
          Object.assign(new TFile(), {
            path,
            extension: path.split(".").pop(),
            basename: "Research",
            stat: { ctime: 0, mtime: 0, size: 1 },
          })
        );
        settingsStore.set(notesAtom, files);
        const { result } = renderHook(() =>
          useAtMentionSearch(query, mode, "notes", [], null, isAgentMode)
        );
        expect(result.current.map((option) => option.subtitle)).toEqual(
          isAgentMode ? ["Research.md", "Research.pdf"] : ["Research.md"]
        );
      }
    );
  });
});
