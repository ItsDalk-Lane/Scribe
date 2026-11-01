import type { ReactElement } from "react";
import type { App } from "obsidian";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { CustomCommandSettingsModal } from "./CustomCommandSettingsModal";
import { EMPTY_COMMAND } from "./constants";

const mockRender = jest.fn<void, [ReactElement]>();
const mockUnmount = jest.fn();
const mockClose = jest.fn();
jest.mock("obsidian", () => ({
  Modal: class {
    app: App;
    contentEl = document.createElement("div");
    setTitle = jest.fn();
    close = mockClose;
    constructor(app: App) {
      this.app = app;
    }
  },
}));
jest.mock("@/utils/react/createPluginRoot", () => ({
  createPluginRoot: () => ({ render: mockRender, unmount: mockUnmount }),
}));
jest.mock("@/commands/customCommandUtils", () => ({ validateCommandName: () => null }));
jest.mock("@/components/CustomPromptSyntaxInstruction", () => ({
  CustomPromptSyntaxInstruction: () => null,
}));
jest.mock("@/hooks/useChatBackendModelOptions", () => ({
  useChatBackendModelOptions: jest.fn(() => ({ options: [], resolveSelectionId: () => undefined })),
}));

describe("CustomCommandSettingsModal", () => {
  describe("CustomCommandSettingsModal", () => {
    beforeEach(() => jest.clearAllMocks());
    describe("onOpen()", () => {
      it("keeps the editor open while saving and closes only after the write succeeds", async () => {
        let finish!: () => void;
        const saved = new Promise<void>((resolve) => {
          finish = resolve;
        });
        const modal = new CustomCommandSettingsModal(
          {} as App,
          [],
          { ...EMPTY_COMMAND, title: "Review", content: "Draft prompt" },
          () => saved
        );
        modal.onOpen();
        render(mockRender.mock.calls[0][0]);
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(mockClose).not.toHaveBeenCalled();
        expect(screen.getByRole<HTMLButtonElement>("button", { name: /Sav/ }).disabled).toBe(true);
        await act(async () => {
          finish();
          await saved;
        });
        expect(mockClose).toHaveBeenCalledTimes(1);
      });
      it("shows a failed save and retains the edited prompt for retry", async () => {
        const failure = Promise.reject(new Error("Cannot write file"));
        void failure.catch(() => {});
        const onSave = jest.fn().mockReturnValueOnce(failure).mockResolvedValue(undefined);
        const modal = new CustomCommandSettingsModal(
          {} as App,
          [],
          { ...EMPTY_COMMAND, title: "Review", content: "Saved prompt" },
          onSave
        );
        modal.onOpen();
        render(mockRender.mock.calls[0][0]);
        fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Draft prompt" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Cannot write file");
        expect(mockClose).not.toHaveBeenCalled();
        expect(screen.getByLabelText<HTMLTextAreaElement>("Prompt").value).toBe("Draft prompt");
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(mockClose).toHaveBeenCalledTimes(1));
        expect(onSave).toHaveBeenLastCalledWith(
          expect.objectContaining({ content: "Draft prompt" })
        );
      });
      it("preserves an unavailable model when another command field is edited", async () => {
        const onSave = jest.fn().mockResolvedValue(undefined);
        const modal = new CustomCommandSettingsModal(
          {} as App,
          [],
          {
            ...EMPTY_COMMAND,
            title: "Review",
            content: "Saved prompt",
            modelKey: "disabled-model",
          },
          onSave
        );
        modal.onOpen();
        render(mockRender.mock.calls[0][0]);
        fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Updated prompt" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
          expect(onSave).toHaveBeenCalledWith(
            expect.objectContaining({ modelKey: "disabled-model", content: "Updated prompt" })
          )
        );
      });
    });
    describe("onClose()", () => {
      it("unmounts the editor when the native modal closes", () => {
        const modal = new CustomCommandSettingsModal({} as App, [], EMPTY_COMMAND, jest.fn());
        modal.onOpen();
        modal.onClose();
        expect(mockUnmount).toHaveBeenCalledTimes(1);
      });
    });
  });
});
