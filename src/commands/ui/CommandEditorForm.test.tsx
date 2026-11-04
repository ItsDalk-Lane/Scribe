import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { CommandEditorForm, type CommandEditorFormProps } from "./CommandEditorForm";
import { EMPTY_COMMAND } from "@/commands/constants";

const props: CommandEditorFormProps = {
  command: { ...EMPTY_COMMAND, title: "Review", content: "Review the selected text" },
  modelOptions: [{ value: "review-model", label: "Review model" }],
  validateName: () => null,
  onConfirm: jest.fn(),
  onCancel: jest.fn(),
};

describe("CommandEditorForm", () => {
  describe("CommandEditorForm()", () => {
    it("submits changed fields and retains unrelated command settings", () => {
      const onConfirm = jest.fn();
      render(<CommandEditorForm {...props} onConfirm={onConfirm} />);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Edited review" } });
      fireEvent.change(screen.getByLabelText("Model (optional)"), {
        target: { value: "review-model" },
      });
      fireEvent.click(screen.getByRole("checkbox", { name: "Show in context menu" }));
      fireEvent.click(screen.getByRole("checkbox", { name: "Show in slash menu" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onConfirm).toHaveBeenCalledWith({
        ...props.command,
        title: "Edited review",
        modelKey: "review-model",
        showInContextMenu: false,
        showInSlashMenu: false,
      });
    });
    it("keeps invalid content in the editor and reports validation failures", () => {
      const onConfirm = jest.fn();
      render(
        <CommandEditorForm
          {...props}
          validateName={() => "Name already exists"}
          onConfirm={onConfirm}
        />
      );
      fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "  " } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(screen.getByText("Name already exists")).not.toBeNull();
      expect(screen.getByText("Prompt is required")).not.toBeNull();
      expect(onConfirm).not.toHaveBeenCalled();
    });
    it("preserves a draft when a save error arrives and offers cancellation", () => {
      const onCancel = jest.fn();
      const { rerender } = render(<CommandEditorForm {...props} onCancel={onCancel} />);
      fireEvent.change(screen.getByLabelText("Prompt"), { target: { value: "Unsaved draft" } });
      rerender(<CommandEditorForm {...props} error="Could not save" onCancel={onCancel} />);
      expect(screen.getByRole("alert").textContent).toBe("Could not save");
      expect(screen.getByLabelText<HTMLTextAreaElement>("Prompt").value).toBe("Unsaved draft");
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(onCancel).toHaveBeenCalledTimes(1);
    });
    it("prevents another submission while saving", () => {
      const onConfirm = jest.fn();
      render(<CommandEditorForm {...props} saving onConfirm={onConfirm} />);
      fireEvent.click(screen.getByRole("button", { name: "Saving…" }));
      expect(onConfirm).not.toHaveBeenCalled();
      expect(screen.getByLabelText("Prompt").closest("fieldset")?.disabled).toBe(true);
    });
    it("explains why a command named compact can never appear in the slash menu (https://github.com/ItsDalk-Lane/Scribe/issues/20)", () => {
      render(<CommandEditorForm {...props} />);
      expect(
        screen.queryByText(
          "This name matches the built-in /compact command, so this command never appears in the slash menu."
        )
      ).toBeNull();
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "compact" } });
      expect(
        screen.getByText(
          "This name matches the built-in /compact command, so this command never appears in the slash menu."
        )
      ).not.toBeNull();
    });
  });
});
