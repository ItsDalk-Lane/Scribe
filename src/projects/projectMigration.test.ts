import type { App } from "obsidian";
import { ensureProjectsMigratedIfNeeded } from "./projectMigration";
import { getSettings, updateSetting } from "@/settings/model";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/lib/i18n", () => ({ t: (key: string) => key }));

jest.mock("@/projects/legacyAgentsResidue", () => ({
  reconcileLegacyAgentsResidue: jest.fn(async () => undefined),
}));

jest.mock("@/projects/projectUtils", () => ({
  getProjectsFolder: () => "copilot/projects",
  getProjectsUnsupportedFolder: () => "copilot/projects/unsupported",
  getProjectConfigFilePath: (folderName: string, projectsFolder: string) =>
    `${projectsFolder}/${folderName}/project.md`,
  scanAllProjectConfigFiles: jest.fn(async () => []),
  readFrontmatterFieldFromFile: jest.fn(async () => ""),
  writeProjectFrontmatter: jest.fn(async () => undefined),
  ensureProjectFrontmatter: jest.fn(async () => undefined),
}));

jest.mock("@/projects/state", () => ({
  addPendingFileWrite: jest.fn(),
  removePendingFileWrite: jest.fn(),
}));

jest.mock("@/utils", () => ({
  ensureFolderExists: jest.fn(async () => {
    throw new Error("vault is read-only");
  }),
  stripFrontmatter: jest.fn((content: string) => content),
}));

jest.mock("@/utils/vaultAdapterUtils", () => ({ trashFile: jest.fn() }));

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(),
  updateSetting: jest.fn(),
}));

describe("projectMigration", () => {
  describe("ensureProjectsMigratedIfNeeded()", () => {
    it("keeps a project in settings when neither the vault file nor its backup can be written", async () => {
      const project = { id: "p1", name: "Alpha", systemPrompt: "keep me" };
      const app = {
        vault: {
          getAbstractFileByPath: jest.fn(() => null),
          adapter: { exists: jest.fn(async () => false) },
          create: jest.fn(),
        },
        metadataCache: { getFileCache: jest.fn() },
      } as unknown as App;
      jest.mocked(getSettings).mockReturnValue({ projectList: [project] } as never);

      await ensureProjectsMigratedIfNeeded(app);

      expect(updateSetting).toHaveBeenCalledWith("projectList", [project]);
    });
  });
});
