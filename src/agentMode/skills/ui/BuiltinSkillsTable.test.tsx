import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { Bot } from "lucide-react";
import { BuiltinSkillsTable, type BuiltinSkillsTableProps } from "./BuiltinSkillsTable";

function props(): BuiltinSkillsTableProps {
  return {
    skills: [
      {
        name: "obsidian-markdown",
        description: "Create Obsidian notes",
        content: "# Obsidian Markdown",
      },
    ],
    agents: [{ id: "claude", displayName: "Claude", Icon: Bot }],
    availableAgents: ["claude"],
  };
}

describe("BuiltinSkillsTable", () => {
  describe("BuiltinSkillsTable()", () => {
    it("shows built-in skills as always enabled and read-only without editable switches", () => {
      render(<BuiltinSkillsTable {...props()} />);
      expect(screen.getByText("Always enabled")).toBeTruthy();
      expect(screen.getByText("Read-only")).toBeTruthy();
      expect(screen.queryByRole("switch")).toBeNull();
      expect(screen.queryByRole("button", { name: /disable/i })).toBeNull();
    });
    it("shows the real unavailable reason without claiming a skill is loaded", () => {
      render(
        <BuiltinSkillsTable
          {...props()}
          unavailableReasons={{ "obsidian-markdown": "A user-owned file occupies this name." }}
        />
      );
      expect(screen.getByText("A user-owned file occupies this name.")).toBeTruthy();
      expect(screen.queryByText("Always enabled")).toBeNull();
      expect(screen.queryByText("Loaded")).toBeNull();
    });
    it("prompts setup when Claude has not been installed", () => {
      render(<BuiltinSkillsTable {...props()} availableAgents={[]} />);
      expect(screen.getByText("Set up Claude Code to use this skill.")).toBeTruthy();
    });
    it("opens a read-only content preview", () => {
      render(<BuiltinSkillsTable {...props()} />);
      fireEvent.click(screen.getByRole("button", { name: "View obsidian-markdown (read-only)" }));
      expect(screen.getByLabelText("obsidian-markdown content (read-only)").textContent).toBe(
        "# Obsidian Markdown"
      );
    });
  });
});
