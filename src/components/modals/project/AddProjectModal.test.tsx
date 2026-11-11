import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const getCachedProjectRecordById = jest.fn((): ProjectFileRecord | undefined => undefined);
jest.mock("@/projects/state", () => ({
  getCachedProjectRecordById: () => getCachedProjectRecordById(),
}));

const mockFetchProjects = jest.fn<Promise<ProjectFileRecord[]>, []>();
const mockModalRender = jest.fn<void, [React.ReactElement<AddProjectModalContentProps>]>();
jest.mock("@/projects/ProjectFileManager", () => ({
  ProjectFileManager: { getInstance: () => ({ fetchProjects: mockFetchProjects }) },
}));
jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: () => ({ render: mockModalRender, unmount: jest.fn() }),
}));

const readAgentsFile = jest.fn(async (): Promise<string> => "");
const agentsFileIsUninitialized = jest.fn(async (): Promise<boolean> => true);
const captureInstructionFiles = jest.fn(
  async (_app: unknown, _folder: string): Promise<InstructionFilesSnapshot> => ({
    agents: null,
  })
);
const restoreInstructionFiles = jest.fn(
  async (
    _app: unknown,
    _folder: string,
    _snapshot: InstructionFilesSnapshot,
    _written: string
  ): Promise<void> => {}
);
const writeAgentsFile = jest.fn(
  async (_app: unknown, _folder: string, _content: string, _expected?: string): Promise<void> => {}
);
jest.mock("@/instructions/agentsFile", () => ({
  readAgentsFile: () => readAgentsFile(),
  agentsFileIsUninitialized: () => agentsFileIsUninitialized(),
  captureInstructionFiles: (app: unknown, folder: string) => captureInstructionFiles(app, folder),
  restoreInstructionFiles: (
    app: unknown,
    folder: string,
    snapshot: InstructionFilesSnapshot,
    written: string
  ) => restoreInstructionFiles(app, folder, snapshot, written),
  writeAgentsFile: (app: unknown, folder: string, content: string, expected?: string) =>
    writeAgentsFile(app, folder, content, expected),
}));

/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- module mocks must keep
   the mocked hooks' exported names. */
const mockApp = { vault: {} };
jest.mock("@/context", () => ({ useApp: () => mockApp }));
jest.mock("@/projects/projectWorkspace", () => ({
  validateProjectWorkspace: jest.fn(async (_app: unknown, path: string) => path),
}));
jest.mock("@/utils", () => ({
  ...jest.requireActual<Record<string, unknown>>("@/utils"),
  randomUUID: () => "new-project-id",
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */

import {
  AddProjectModal,
  AddProjectModalContent,
  type AddProjectModalContentProps,
} from "@/components/modals/project/AddProjectModal";
import type { App } from "obsidian";
import type { ProjectConfig } from "@/aiParams";
import type { ProjectFileRecord } from "@/projects/type";
import type { InstructionFilesSnapshot } from "@/instructions/agentsFile";

const PROJECT = {
  id: "proj-1",
  name: "My Research",
  workspacePath: "Research Workspace",
  description: "",
  systemPrompt: "Cite only #verified notes.",
  contextSource: { inclusions: "", exclusions: "", webUrls: "", youtubeUrls: "" },
} as unknown as ProjectConfig;

const PROJECT_FOLDER = "Research Workspace";

function renderModal(overrides: Partial<AddProjectModalContentProps> = {}) {
  const onSave = overrides.onSave ?? jest.fn().mockResolvedValue(undefined);
  render(
    <AddProjectModalContent
      initialProject={PROJECT}
      onSave={onSave}
      onCancel={jest.fn()}
      {...overrides}
    />
  );
  return { onSave };
}

function findInstructionsBox(): Promise<HTMLTextAreaElement> {
  return screen.findByLabelText<HTMLTextAreaElement>("Project instructions");
}

describe("AddProjectModal", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    readAgentsFile.mockResolvedValue("");
    agentsFileIsUninitialized.mockResolvedValue(true);
    captureInstructionFiles.mockResolvedValue({ agents: null });
    writeAgentsFile.mockResolvedValue(undefined);
    getCachedProjectRecordById.mockReturnValue({
      folderName: "proj-1",
      filePath: `${PROJECT_FOLDER}/project.md`,
      project: PROJECT,
    });
  });

  describe("AddProjectModal", () => {
    describe("onOpen()", () => {
      it("rereads hidden configuration before rendering an editor and saves against that opened baseline", async () => {
        const latest = { ...PROJECT, name: "External name" };
        mockFetchProjects.mockResolvedValue([
          { project: latest, filePath: ".scribe/projects/proj-1/project.md", folderName: "proj-1" },
        ]);
        const save = jest.fn(async () => {});
        const modal = new AddProjectModal({} as App, save, PROJECT);
        AddProjectModal.prototype.onOpen.call(modal);
        await waitFor(() => expect(mockModalRender).toHaveBeenCalledTimes(1));
        const props = mockModalRender.mock.calls[0][0].props;
        expect(props.initialProject).toBe(latest);
        const next = { ...latest, name: "Draft" };
        await props.onSave(next);
        expect(save).toHaveBeenCalledWith(next, latest);
        AddProjectModal.prototype.onClose.call(modal);
      });
      it("does not render an editor for a project deleted outside the plugin", async () => {
        mockFetchProjects.mockResolvedValue([]);
        const modal = new AddProjectModal({} as App, jest.fn(), PROJECT);
        AddProjectModal.prototype.onOpen.call(modal);
        await waitFor(() => expect(modal.close).toHaveBeenCalled());
        expect(mockModalRender).not.toHaveBeenCalled();
        AddProjectModal.prototype.onClose.call(modal);
      });
    });
  });

  describe("AddProjectModalContent", () => {
    it("reads the workspace instruction file without importing configuration-body instructions", async () => {
      renderModal();

      expect((await findInstructionsBox()).value).toBe("");
    });

    it("writes nothing while the dialog is merely open, so Cancel leaves the project untouched", async () => {
      renderModal();
      await findInstructionsBox();

      expect(writeAgentsFile).not.toHaveBeenCalled();
    });

    it("writes instructions into the selected workspace when saved", async () => {
      const { onSave } = renderModal();
      fireEvent.change(await findInstructionsBox(), { target: { value: "New rules" } });

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() =>
        expect(writeAgentsFile).toHaveBeenCalledWith(
          expect.anything(),
          PROJECT_FOLDER,
          "New rules",
          ""
        )
      );
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ workspacePath: PROJECT_FOLDER })
      );
    });

    it("keeps an empty instruction file empty when saving unrelated fields", async () => {
      readAgentsFile.mockResolvedValue("");
      agentsFileIsUninitialized.mockResolvedValue(false);
      const { onSave } = renderModal();

      expect((await findInstructionsBox()).value).toBe("");

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: "Cite only #verified notes." })
      );
    });

    it("preserves unrelated configuration when workspace instructions are unchanged", async () => {
      readAgentsFile.mockResolvedValue("Rules the user wrote directly.");
      agentsFileIsUninitialized.mockResolvedValue(false);
      const { onSave } = renderModal();
      await findInstructionsBox();

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ systemPrompt: "Cite only #verified notes." })
      );
    });

    it("restores the folder's instruction files when the project update is rejected", async () => {
      readAgentsFile.mockResolvedValue("Old rules");
      agentsFileIsUninitialized.mockResolvedValue(false);
      const snapshot = { agents: "Old rules" };
      captureInstructionFiles.mockResolvedValue(snapshot);
      const onSave = jest.fn().mockRejectedValue(new Error("A project with that name exists"));
      renderModal({ onSave });
      fireEvent.change(await findInstructionsBox(), { target: { value: "New rules" } });

      fireEvent.click(screen.getByText("Save"));

      await waitFor(() =>
        expect(restoreInstructionFiles).toHaveBeenCalledWith(
          expect.anything(),
          PROJECT_FOLDER,
          snapshot,
          "New rules"
        )
      );
    });

    it("preserves external instruction changes when saving unrelated project fields", async () => {
      readAgentsFile.mockResolvedValue("Original rules");
      agentsFileIsUninitialized.mockResolvedValue(false);
      const { onSave } = renderModal();
      await findInstructionsBox();
      readAgentsFile.mockResolvedValue("Synced rules");
      fireEvent.click(screen.getByText("Save"));
      await waitFor(() => expect(onSave).toHaveBeenCalled());
      expect(writeAgentsFile).not.toHaveBeenCalled();
    });

    it("retains the draft and refuses saving when external instructions changed", async () => {
      readAgentsFile.mockResolvedValue("Original rules");
      agentsFileIsUninitialized.mockResolvedValue(false);
      const { onSave } = renderModal();
      fireEvent.change(await findInstructionsBox(), { target: { value: "Draft rules" } });
      readAgentsFile.mockResolvedValue("Synced rules");
      fireEvent.click(screen.getByText("Save"));
      await waitFor(() => expect(readAgentsFile).toHaveBeenCalledTimes(2));
      expect(writeAgentsFile).not.toHaveBeenCalled();
      expect(onSave).not.toHaveBeenCalled();
      expect((await findInstructionsBox()).value).toBe("Draft rules");
    });

    it("allows retry after a failed project save retained the newly created instructions", async () => {
      const onSave = jest
        .fn()
        .mockRejectedValueOnce(new Error("name conflict"))
        .mockResolvedValue(undefined);
      writeAgentsFile.mockImplementationOnce(async (_app, _folder, content) => {
        readAgentsFile.mockResolvedValue(content);
      });
      renderModal({ onSave });
      fireEvent.change(await findInstructionsBox(), { target: { value: "Draft rules" } });
      fireEvent.click(screen.getByText("Save"));
      await waitFor(() => expect(restoreInstructionFiles).toHaveBeenCalled());
      fireEvent.click(screen.getByText("Save"));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(2));
      expect((await findInstructionsBox()).value).toBe("Draft rules");
    });

    it("retains the edited name and keeps the editor open when saving reports an external conflict", async () => {
      const onSave = jest.fn().mockRejectedValue(new Error("External conflict"));
      const onCancel = jest.fn();
      renderModal({ onSave, onCancel });
      await findInstructionsBox();
      const input = screen.getByDisplayValue(PROJECT.name);
      fireEvent.change(input, { target: { value: "Draft name" } });
      fireEvent.click(screen.getByText("Save"));
      await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
      await waitFor(() =>
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false)
      );
      expect((input as HTMLInputElement).value).toBe("Draft name");
      expect(onCancel).not.toHaveBeenCalled();
    });

    it("offers no instruction field for a project that has no folder record", async () => {
      getCachedProjectRecordById.mockReturnValue(undefined);
      renderModal();

      await waitFor(() => expect(screen.getByText("Edit project")).toBeTruthy());
      expect(screen.queryByLabelText("Project instructions")).toBeNull();
      expect(readAgentsFile).not.toHaveBeenCalled();
    });
  });
});
