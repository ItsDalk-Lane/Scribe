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
    runtimeItems: [
      {
        id: "runtime:obsidian-markdown",
        name: "obsidian-markdown",
        kind: "skill",
        source: "runtime",
        availability: "loaded",
      },
    ],
  };
}

describe("BuiltinSkillsTable", () => {
  describe("BuiltinSkillsTable()", () => {
    it("shows a confirmed built-in skill with a locked enabled switch", () => {
      render(<BuiltinSkillsTable {...props()} />);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("true");
      expect(screen.getByRole("switch").getAttribute("aria-disabled")).toBe("true");
      expect(screen.queryByText("Always enabled")).toBeNull();
      expect(screen.queryByText("Read-only")).toBeNull();
    });
    it("shows the real unavailable reason without claiming a skill is loaded", () => {
      render(
        <BuiltinSkillsTable
          {...props()}
          unavailableReasons={{ "obsidian-markdown": "A user-owned file occupies this name." }}
        />
      );
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      expect(screen.getByRole("switch").getAttribute("aria-disabled")).toBe("true");
      expect(screen.getByTitle("A user-owned file occupies this name.")).toBeTruthy();
      expect(screen.queryByText("Always enabled")).toBeNull();
      expect(screen.queryByText("Loaded")).toBeNull();
    });
    it("keeps an unavailable built-in skill locked off when Claude has not been installed", () => {
      render(<BuiltinSkillsTable {...props()} availableAgents={[]} />);
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      expect(screen.getByTitle("Set up Claude Code to use this skill.")).toBeTruthy();
    });
    it("does not claim a built-in skill loaded when there is no runtime evidence", () => {
      render(<BuiltinSkillsTable {...props()} runtimeItems={undefined} />);
      expect(screen.getByRole("switch").getAttribute("aria-disabled")).toBe("true");
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      expect(screen.queryByText("Always enabled")).toBeNull();
    });
    it("does not attribute a same-named external skill's loaded result to the built-in file", () => {
      render(
        <BuiltinSkillsTable
          {...props()}
          skills={props().skills.map((skill) => ({
            ...skill,
            filePath: "/vault/scribe/skills/obsidian-markdown/SKILL.md",
          }))}
          runtimeItems={[
            {
              id: "external",
              name: "obsidian-markdown",
              source: "project",
              location: "/external/obsidian-markdown/SKILL.md",
              availability: "loaded",
            },
          ]}
        />
      );
      expect(screen.getByRole("switch").getAttribute("aria-checked")).toBe("false");
      expect(screen.getByRole("switch").getAttribute("aria-disabled")).toBe("true");
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
