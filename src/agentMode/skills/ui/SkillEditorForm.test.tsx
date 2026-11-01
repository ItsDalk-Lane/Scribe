import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SkillEditorForm } from "./SkillEditorForm";

describe("SkillEditorForm", () => {
  describe("SkillEditorForm()", () => {
    it("submits a new skill's name, description, and instructions", () => {
      const onSave = jest.fn();
      render(<SkillEditorForm onSave={onSave} onCancel={jest.fn()} />);
      fireEvent.change(screen.getByLabelText("Name"), { target: { value: "review-notes" } });
      fireEvent.change(screen.getByLabelText("Description"), { target: { value: "Review notes" } });
      fireEvent.change(screen.getByLabelText("Instructions"), {
        target: { value: "Read the note and summarize it." },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(
        "review-notes",
        "Review notes",
        "Read the note and summarize it."
      );
    });
    it("keeps an existing name read-only and shows a failed save without losing content", () => {
      render(
        <SkillEditorForm
          initialName="review-notes"
          initialDescription="Review"
          initialBody="Instructions"
          readonlyName
          error="Could not save"
          onSave={jest.fn()}
          onCancel={jest.fn()}
        />
      );
      expect(screen.getByLabelText("Name").hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("alert").textContent).toBe("Could not save");
      expect(screen.getByLabelText<HTMLTextAreaElement>("Instructions").value).toBe("Instructions");
    });
  });
});
