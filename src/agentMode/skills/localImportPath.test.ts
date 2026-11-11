import { droppedSkillImportPath, resolveLocalImportPath } from "@/agentMode/skills/localImportPath";

jest.mock("electron", () => ({ webUtils: { getPathForFile: jest.fn() } }), { virtual: true });
const electron = jest.requireMock<{ webUtils?: { getPathForFile: jest.Mock } }>("electron");

interface FakeDataTransferItem {
  kind: string;
  getAsFile: () => File | null;
}
function makeFileItem(file: File | null): FakeDataTransferItem {
  return { kind: file ? "file" : "string", getAsFile: () => file };
}
function makeDataTransfer(items: FakeDataTransferItem[], files: File[] = []): DataTransfer {
  return { items, files } as unknown as DataTransfer;
}

describe("localImportPath", () => {
  describe("resolveLocalImportPath()", () => {
    beforeEach(() => {
      electron.webUtils = { getPathForFile: jest.fn() };
    });
    it("returns the Electron-resolved absolute path for a picked or dropped file", () => {
      electron.webUtils!.getPathForFile.mockReturnValue("/imports/review-notes");
      const file = new File(["skill"], "review-notes");
      expect(resolveLocalImportPath(file)).toBe("/imports/review-notes");
      expect(electron.webUtils!.getPathForFile).toHaveBeenCalledWith(file);
    });
    it("falls back to the legacy file path property when webUtils is unavailable", () => {
      electron.webUtils = undefined;
      const file = new File(["skill"], "review-notes");
      Object.defineProperty(file, "path", { value: "/imports/review-notes" });
      expect(resolveLocalImportPath(file)).toBe("/imports/review-notes");
    });
    it("returns null instead of a relative or missing path", () => {
      electron.webUtils!.getPathForFile.mockReturnValue("review-notes/SKILL.md");
      expect(resolveLocalImportPath(new File(["skill"], "review-notes"))).toBeNull();
      electron.webUtils!.getPathForFile.mockReturnValue("");
      expect(resolveLocalImportPath(new File(["skill"], "review-notes"))).toBeNull();
    });
  });
  describe("droppedSkillImportPath()", () => {
    beforeEach(() => {
      electron.webUtils = { getPathForFile: jest.fn() };
    });
    it("resolves the first dropped file item to its local path for folders and ZIP archives alike", () => {
      electron.webUtils!.getPathForFile.mockImplementation((file: File) => `/imports/${file.name}`);
      const zip = new File(["zip"], "review-notes.zip");
      const transfer = makeDataTransfer([
        makeFileItem(new File(["note"], "readme.txt")),
        makeFileItem(zip),
      ]);
      expect(droppedSkillImportPath(transfer)).toBe("/imports/readme.txt");
      const folder = new File([], "review-notes");
      expect(droppedSkillImportPath(makeDataTransfer([makeFileItem(folder)]))).toBe(
        "/imports/review-notes"
      );
    });
    it("falls back to the plain file list when no file item is exposed", () => {
      electron.webUtils!.getPathForFile.mockReturnValue("/imports/shared.zip");
      const transfer = makeDataTransfer([], [new File(["zip"], "shared.zip")]);
      expect(droppedSkillImportPath(transfer)).toBe("/imports/shared.zip");
    });
    it("throws a recoverable error when nothing droppable is present", () => {
      expect(() => droppedSkillImportPath(makeDataTransfer([]))).toThrow();
      expect(() => droppedSkillImportPath(makeDataTransfer([makeFileItem(null)]))).toThrow();
      expect(() => droppedSkillImportPath(null)).toThrow();
    });
    it("throws when the dropped item has no accessible local path", () => {
      electron.webUtils!.getPathForFile.mockReturnValue("shared.zip");
      expect(() =>
        droppedSkillImportPath(makeDataTransfer([makeFileItem(new File(["zip"], "shared.zip"))]))
      ).toThrow();
    });
  });
});
