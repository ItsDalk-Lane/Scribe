import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SubagentEditorForm } from "./SubagentEditorForm";

describe("SubagentEditorForm", () => {
  describe("SubagentEditorForm()", () => {
    it("saves a named enabled subagent with its purpose and instructions", async () => {
      const save = jest.fn(async () => {});
      render(<SubagentEditorForm onSave={save} onCancel={() => {}} />);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Reviewer" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Review notes" } });
      fireEvent.change(screen.getByLabelText("Instructions"), {
        target: { value: "Check facts." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await waitFor(() =>
        expect(save).toHaveBeenCalledWith({
          name: "Reviewer",
          description: "Review notes",
          instructions: "Check facts.",
          enabled: true,
        })
      );
    });
    it("keeps the complete draft and shows the reason when saving fails", async () => {
      render(
        <SubagentEditorForm
          initialValue={{
            name: "Reviewer",
            description: "Review notes",
            instructions: "Check facts.",
            enabled: false,
          }}
          onSave={async () => {
            throw new Error("Disk is full");
          }}
          onCancel={() => {}}
        />
      );
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect((await screen.findByRole("alert")).textContent).toBe("Disk is full");
      expect(screen.getByLabelText<HTMLTextAreaElement>("Instructions").value).toBe("Check facts.");
      expect(screen.getByRole("switch", { name: "Enabled" }).getAttribute("aria-checked")).toBe(
        "false"
      );
    });
    it("disables empty required fields and lets the user cancel without saving", () => {
      const save = jest.fn(async () => {}),
        cancel = jest.fn();
      render(<SubagentEditorForm onSave={save} onCancel={cancel} />);
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(cancel).toHaveBeenCalledTimes(1);
      expect(save).not.toHaveBeenCalled();
    });
  });
});
