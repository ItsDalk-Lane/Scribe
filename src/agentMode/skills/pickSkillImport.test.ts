import { pickSkillImport } from "@/agentMode/skills/pickSkillImport";

jest.mock("electron", () => ({ webUtils: { getPathForFile: jest.fn() } }), { virtual: true });
const electron = jest.requireMock<{ webUtils?: { getPathForFile: jest.Mock } }>("electron");

describe("pickSkillImport", () => {
  describe("pickSkillImport()", () => {
    let clickSpy: jest.SpyInstance;
    beforeEach(() => {
      clickSpy = jest.spyOn(HTMLInputElement.prototype, "click").mockImplementation(() => {});
      electron.webUtils = { getPathForFile: jest.fn() };
    });
    afterEach(() => {
      clickSpy.mockRestore();
      document.body.replaceChildren();
    });

    function select(files: File[]): HTMLInputElement {
      const input = document.querySelector<HTMLInputElement>("input[type=file]");
      if (!input) throw new Error("Picker was not opened");
      Object.defineProperty(input, "files", { value: files });
      input.dispatchEvent(new Event("change"));
      return input;
    }

    it("opens a native ZIP picker and returns the Electron file path", async () => {
      electron.webUtils!.getPathForFile.mockReturnValue("/imports/shared.zip");
      const result = pickSkillImport("zip", document);
      expect(document.querySelector<HTMLInputElement>("input")?.accept).toBe(".zip");
      const input = select([new File(["zip"], "shared.zip")]);
      await expect(result).resolves.toBe("/imports/shared.zip");
      expect(document.body.contains(input)).toBe(false);
    });

    it("reconstructs the selected folder from a nested file without copying selected files", async () => {
      electron.webUtils!.getPathForFile.mockReturnValue("/imports/review/references/guide.md");
      const file = new File(["body"], "guide.md");
      Object.defineProperty(file, "webkitRelativePath", { value: "review/references/guide.md" });
      const result = pickSkillImport("folder", document);
      expect(document.querySelector("input")?.hasAttribute("webkitdirectory")).toBe(true);
      select([file]);
      await expect(result).resolves.toBe("/imports/review");
    });

    it("supports older installers only when the newer path API is absent", async () => {
      electron.webUtils = undefined;
      const file = new File(["zip"], "shared.zip");
      Object.defineProperty(file, "path", { value: "/imports/shared.zip" });
      const result = pickSkillImport("zip", document);
      select([file]);
      await expect(result).resolves.toBe("/imports/shared.zip");
    });

    it("returns null when cancelled and removes the input", async () => {
      const result = pickSkillImport("zip", document);
      document.querySelector("input")!.dispatchEvent(new Event("cancel"));
      await expect(result).resolves.toBeNull();
      expect(document.querySelector("input")).toBeNull();
    });

    it("rejects missing physical paths and empty folders with a recoverable error", async () => {
      electron.webUtils!.getPathForFile.mockReturnValue("");
      let result = pickSkillImport("zip", document);
      select([new File(["zip"], "shared.zip")]);
      await expect(result).rejects.toThrow();
      result = pickSkillImport("folder", document);
      select([]);
      await expect(result).rejects.toThrow();
      expect(document.querySelector("input")).toBeNull();
    });
  });
});
