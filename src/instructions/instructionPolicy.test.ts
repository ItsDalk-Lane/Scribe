import type { App } from "obsidian";
import { EMPTY_PROJECT_CONFIG } from "@/projects/constants";
import { getCachedProjectRecordById } from "@/projects/state";
import { readAgentsFile } from "@/instructions/agentsFile";
import {
  buildInstructionPromptState,
  renderInstructionPrompt,
} from "@/instructions/instructionPolicy";

jest.mock("@/instructions/agentsFile", () => ({ readAgentsFile: jest.fn() }));
jest.mock("@/projects/state", () => ({ getCachedProjectRecordById: jest.fn() }));

const app = {} as App;

describe("instructionPolicy", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .mocked(readAgentsFile)
      .mockImplementation(async (_app, folder) =>
        folder ? "Current workspace rules" : "Current vault rules"
      );
    jest.mocked(getCachedProjectRecordById).mockReturnValue(undefined);
  });

  describe("buildInstructionPromptState()", () => {
    it("uses the project configuration saved during the rule-file reads https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const record = {
        project: {
          ...EMPTY_PROJECT_CONFIG,
          id: "project",
          workspacePath: "Research",
          systemPrompt: "Earlier project configuration",
        },
        folderName: "project",
        filePath: ".scribe/projects/project/project.md",
      };
      const getProject = jest.mocked(getCachedProjectRecordById);
      getProject.mockReturnValue(record);
      jest.mocked(readAgentsFile).mockImplementation(async (_app, folder) => {
        if (folder)
          getProject.mockReturnValue({
            ...record,
            project: { ...record.project, systemPrompt: "Saved project configuration" },
          });
        return "Current file rules";
      });
      const state = await buildInstructionPromptState(app, "Defaults", {
        projectId: "project",
        workspacePath: "Research",
      });
      expect(state.sections.project_instructions).toContain("Saved project configuration");
      expect(state.sections.project_instructions).not.toContain("Earlier project configuration");
    });

    it("rejects a project workspace move during an implicitly scoped rule read https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
      const record = {
        project: { ...EMPTY_PROJECT_CONFIG, id: "project", workspacePath: "Research" },
        folderName: "project",
        filePath: ".scribe/projects/project/project.md",
      };
      const getProject = jest.mocked(getCachedProjectRecordById);
      getProject.mockReturnValue(record);
      jest.mocked(readAgentsFile).mockImplementation(async (_app, folder) => {
        if (folder)
          getProject.mockReturnValue({
            ...record,
            project: { ...record.project, workspacePath: "Moved" },
          });
        return "Earlier workspace file rules";
      });
      await expect(
        buildInstructionPromptState(app, "Defaults", { projectId: "project" })
      ).rejects.toThrow("项目工作位置已改变");
    });

    it("declares current request, project, vault and application precedence while preserving each instruction source", async () => {
      jest.mocked(getCachedProjectRecordById).mockReturnValue({
        project: {
          ...EMPTY_PROJECT_CONFIG,
          id: "project",
          workspacePath: "Research",
          systemPrompt: "Project configuration rules",
        },
        folderName: "project",
        filePath: ".scribe/projects/project/project.md",
      });
      const state = await buildInstructionPromptState(app, "Application defaults", {
        projectId: "project",
      });
      expect(state.content).toContain("Application defaults");
      expect(state.content).toContain(
        "current user request > project instructions > vault instructions > application defaults"
      );
      expect(state.content).toContain("does not change tool permissions");
      expect(state.sections).toEqual({
        vault_instructions: "<vault_instructions>\nCurrent vault rules\n</vault_instructions>",
        project_instructions:
          "<project_instructions>\nProject configuration rules\n</project_instructions>",
        working_directory_instructions:
          "<working_directory_instructions>\nCurrent workspace rules\n</working_directory_instructions>",
      });
      expect(jest.mocked(readAgentsFile).mock.calls.map(([, folder]) => folder)).toEqual([
        "",
        "Research",
      ]);
    });

    it("reads only vault instructions for a global request and emits null sections for removed sources", async () => {
      jest.mocked(readAgentsFile).mockResolvedValue("");
      const state = await buildInstructionPromptState(app, "Defaults");
      expect(state.sections).toEqual({
        vault_instructions: null,
        project_instructions: null,
        working_directory_instructions: null,
      });
      expect(readAgentsFile).toHaveBeenCalledTimes(1);
      expect(getCachedProjectRecordById).not.toHaveBeenCalled();
    });

    it("uses an explicitly resolved workspace and refreshes changed file contents on each request", async () => {
      await buildInstructionPromptState(app, "Defaults", { workspacePath: "Selected" });
      jest
        .mocked(readAgentsFile)
        .mockImplementation(async (_app, folder) => (folder ? "Updated rules" : "Updated vault"));
      const state = await buildInstructionPromptState(app, "Defaults", {
        workspacePath: "Selected",
      });
      expect(state.sections.working_directory_instructions).toContain("Updated rules");
      expect(state.sections.vault_instructions).toContain("Updated vault");
    });

    it("starts vault and workspace reads together without waiting for the first file to finish", async () => {
      let completeVaultRead!: (text: string) => void;
      const vaultRead = new Promise<string>((resolve) => {
        completeVaultRead = resolve;
      });
      jest
        .mocked(readAgentsFile)
        .mockImplementation(async (_app, folder) => (folder ? "Workspace rules" : vaultRead));
      const pending = buildInstructionPromptState(app, "Defaults", { workspacePath: "Selected" });
      const startedFolders = jest.mocked(readAgentsFile).mock.calls.map(([, folder]) => folder);
      completeVaultRead("Vault rules");
      const state = await pending;
      expect(startedFolders).toEqual(["", "Selected"]);
      expect(state.sections.vault_instructions).toContain("Vault rules");
      expect(state.sections.working_directory_instructions).toContain("Workspace rules");
    });

    it("rejects unreadable rules instead of reporting their removal", async () => {
      jest.mocked(readAgentsFile).mockRejectedValue(new Error("Temporarily unreadable"));
      await expect(buildInstructionPromptState(app, "Defaults")).rejects.toThrow(
        "Temporarily unreadable"
      );
    });
  });

  describe("renderInstructionPrompt()", () => {
    it("renders the base followed by named sections in their declared order and omits removed sections", () => {
      expect(
        renderInstructionPrompt({
          content: "Base",
          sections: { vault: "Vault", project: null, workspace: "Workspace" },
        })
      ).toBe("Base\n\nVault\n\nWorkspace");
    });
  });
});
