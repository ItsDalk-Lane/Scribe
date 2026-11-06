import { FolderSearchModal } from "@/components/modals/FolderSearchModal";
import { mockTFolder, mockTFile } from "@/__tests__/mockObsidian";
import type { App } from "obsidian";

jest.mock("@/search/searchUtils", () => ({ extractAppIgnoreSettings: () => ["Ignored"] }));

function picker(onChoose = jest.fn()) {
  const app = {
    vault: {
      configDir: ".custom-config",
      getAllLoadedFiles: () => [
        mockTFolder({ path: "Empty" }),
        mockTFolder({ path: "Ignored" }),
        mockTFolder({ path: ".scribe" }),
        mockTFolder({ path: ".custom-config" }),
        mockTFile({ path: "note.md" }),
      ],
    },
  } as unknown as App;
  return new FolderSearchModal(app, onChoose, { includeRoot: true, forWorkspace: true });
}

describe("FolderSearchModal", () => {
  describe("FolderSearchModal", () => {
    describe("getItems()", () => {
      it("offers the vault root and empty folders while omitting ignored and plugin directories", () => {
        expect(picker().getItems()).toEqual(["", "Empty"]);
      });
    });
    describe("getItemText()", () => {
      it("labels the vault root and keeps a folder's readable path", () => {
        expect(picker().getItemText("")).toBe("Vault root");
        expect(picker().getItemText("Empty")).toBe("Empty");
      });
    });
    describe("onChooseItem()", () => {
      it("reports an explicitly selected vault root without replacing it with a default", () => {
        const chosen = jest.fn();
        picker(chosen).onChooseItem("", new MouseEvent("click"));
        expect(chosen).toHaveBeenCalledWith("");
      });
    });
  });
});
