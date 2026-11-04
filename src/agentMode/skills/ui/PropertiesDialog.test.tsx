import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  PropertiesModalBody,
  type PropertiesModalBodyProps,
} from "@/agentMode/skills/ui/PropertiesDialog";

function props(): PropertiesModalBodyProps {
  return {
    skill: {
      name: "note-review",
      body: "Review the supplied note.",
      description: "Review a note",
      filePath: "/vault/skills/note-review/SKILL.md",
      dirPath: "/vault/skills/note-review",
      enabledAgents: ["native"],
      location: { kind: "canonical" },
      allowedTools: "Existing metadata",
      model: "Existing metadata",
    },
    skillsFolderRel: "skills",
    collisionError: false,
    saving: false,
    onCancel: jest.fn(),
    onSave: jest.fn(),
  };
}

describe("PropertiesDialog", () => {
  describe("PropertiesModalBody()", () => {
    it("saves native model-invocation and menu choices without offering or overwriting unsupported model and tool overrides", () => {
      const input = props();
      render(<PropertiesModalBody {...input} />);
      expect(screen.queryByRole("textbox", { name: "Allowed tools" })).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Model override" })).toBeNull();
      expect(screen.queryByText("Claude Code only")).toBeNull();
      fireEvent.click(
        screen.getByRole("checkbox", { name: "Don't let the model invoke this on its own" })
      );
      fireEvent.click(screen.getByRole("checkbox", { name: "Hide from slash menu" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(input.onSave).toHaveBeenCalledWith({
        nameChanged: false,
        newName: "note-review",
        patch: { description: "Review a note", disableModelInvocation: true, userInvocable: false },
      });
      expect(input.skill.allowedTools).toBe("Existing metadata");
      expect(input.skill.model).toBe("Existing metadata");
    });
    it("records a valid rename and cancels without sending a save", () => {
      const input = props();
      render(<PropertiesModalBody {...input} />);
      fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
        target: { value: "renamed-review" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(input.onSave).toHaveBeenCalledWith(
        expect.objectContaining({ nameChanged: true, newName: "renamed-review" })
      );
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(input.onCancel).toHaveBeenCalledTimes(1);
    });
    it("blocks an invalid skill name and leaves the save callback untouched", () => {
      const input = props();
      render(<PropertiesModalBody {...input} />);
      fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
        target: { value: "Invalid Name" },
      });
      const save = screen.getByRole("button", { name: "Save" });
      expect(save.hasAttribute("disabled")).toBe(true);
      fireEvent.click(save);
      expect(input.onSave).not.toHaveBeenCalled();
    });
    it("keeps both actions disabled while a save is in progress", () => {
      render(<PropertiesModalBody {...props()} saving />);
      expect(screen.getByRole("button", { name: "Save" }).hasAttribute("disabled")).toBe(true);
      expect(screen.getByRole("button", { name: "Cancel" }).hasAttribute("disabled")).toBe(true);
    });
  });
});
