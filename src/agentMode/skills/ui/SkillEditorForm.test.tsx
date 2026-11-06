import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { SkillEditorForm } from "@/agentMode/skills/ui/SkillEditorForm";

const content =
  "---\nname: review-notes\ndescription: Review\nfuture-number: 9007199254740993123456789\n---\nRead the note";

describe("SkillEditorForm", () => {
  describe("SkillEditorForm()", () => {
    it("edits and submits the complete file without rewriting any metadata", () => {
      const onSave = jest.fn();
      render(<SkillEditorForm initialContent={content} onSave={onSave} onCancel={jest.fn()} />);
      const edited = content.replace("Read the note", "Read every note");
      fireEvent.change(screen.getByLabelText("File contents"), { target: { value: edited } });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(edited);
      expect(screen.queryByLabelText("Name")).toBeNull();
      expect(screen.queryByLabelText("Author")).toBeNull();
    });
    it("retains the complete draft when saving fails and disables repeat saves while pending", () => {
      const props = { initialContent: content, onSave: jest.fn(), onCancel: jest.fn() };
      const view = render(<SkillEditorForm {...props} error="The file changed outside Scribe" />);
      expect(screen.getByRole("alert").textContent).toContain("The file changed");
      expect(screen.getByLabelText<HTMLTextAreaElement>("File contents").value).toBe(content);
      view.rerender(<SkillEditorForm {...props} saving />);
      expect(screen.getByLabelText("File contents").hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "Saving…" }).hasAttribute("disabled")).toBe(true);
    });
  });
});
