import type { App } from "obsidian";
import type { Skill } from "@/agentMode/skills/types";
import type { SkillEditorFormProps } from "./SkillEditorForm";
import { waitFor } from "@testing-library/react";

const mockRender = jest.fn();
const mockUnmount = jest.fn();
const mockClose = jest.fn();
const mockRead = jest.fn();
const mockNotice = jest.fn();
jest.mock("obsidian", () => ({
  Notice: function (message: string) {
    mockNotice(message);
  },
  Modal: class {
    app: App;
    titleEl = { setText: jest.fn() };
    contentEl = document.createElement("div");
    close = mockClose;
    constructor(app: App) {
      this.app = app;
    }
  },
}));
jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: () => ({ render: mockRender, unmount: mockUnmount }),
}));
jest.mock("@/agentMode/skills/SkillManager", () => ({
  SkillManager: { getInstance: () => ({ readContent: mockRead }) },
}));
import { SkillEditorModal } from "./SkillEditorModal";

function form(): SkillEditorFormProps {
  return mockRender.mock.calls[mockRender.mock.calls.length - 1][0].props as SkillEditorFormProps;
}

describe("SkillEditorModal", () => {
  describe("SkillEditorModal", () => {
    beforeEach(() => jest.clearAllMocks());
    describe("onOpen()", () => {
      it("saves a new skill from the native modal and closes after success", async () => {
        const onSave = jest.fn().mockResolvedValue({ ok: true });
        const modal = new SkillEditorModal({} as App, { onSave });
        modal.onOpen();
        form().onSave("review-notes", "Review notes", "Read the notes");
        await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
        expect(onSave).toHaveBeenCalledWith(
          "review-notes",
          expect.stringContaining('name: "review-notes"')
        );
        expect(onSave.mock.calls[0][1]).toContain("Read the notes");
      });
      it("preserves unknown metadata while editing instructions in an existing skill", async () => {
        mockRead.mockResolvedValue(
          "---\nname: review-notes\ndescription: Old description\ncustom-field: keep\n---\nOld instructions"
        );
        const onSave = jest.fn().mockResolvedValue({ ok: true });
        const modal = new SkillEditorModal({} as App, {
          skill: { name: "review-notes", filePath: "/skills/review-notes/SKILL.md" } as Skill,
          onSave,
        });
        modal.onOpen();
        await waitFor(() => expect(form().initialBody).toBe("Old instructions"));
        form().onSave("review-notes", "New description", "Updated instructions");
        await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
        expect(onSave.mock.calls[0][1]).toContain("custom-field: keep");
        expect(onSave.mock.calls[0][1]).toContain("Updated instructions");
      });
      it("closes after saving with a sync warning and tells the user how to retry without creating a duplicate", async () => {
        const onSave = jest
          .fn()
          .mockResolvedValue({ ok: true, warning: "Cannot create the agent link" });
        const modal = new SkillEditorModal({} as App, { onSave });
        modal.onOpen();
        form().onSave("review-notes", "Review notes", "Read the notes");
        await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
        expect(mockNotice).toHaveBeenCalledWith(
          "Skill saved, but syncing with the agent failed: Cannot create the agent link. Reopen Skills after fixing the problem to retry."
        );
        expect(onSave).toHaveBeenCalledTimes(1);
      });
      it("keeps the modal open and shows a save failure", async () => {
        const modal = new SkillEditorModal({} as App, {
          onSave: jest.fn().mockResolvedValue({
            ok: false,
            code: "collision",
            message: "A skill with this name exists",
          }),
        });
        modal.onOpen();
        form().onSave("review-notes", "Review", "Instructions");
        await waitFor(() => expect(form().error).toBe("A skill with this name exists"));
        expect(mockClose).not.toHaveBeenCalled();
      });
    });
    describe("onClose()", () => {
      it("unmounts the editor when the native modal closes", () => {
        const modal = new SkillEditorModal({} as App, { onSave: jest.fn() });
        modal.onOpen();
        modal.onClose();
        expect(mockUnmount).toHaveBeenCalledTimes(1);
      });
    });
  });
});
