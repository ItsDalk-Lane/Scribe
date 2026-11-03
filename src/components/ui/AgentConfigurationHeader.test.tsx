import { AgentConfigurationHeader } from "@/components/ui/AgentConfigurationHeader";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentConfigurationHeader", () => {
  describe("AgentConfigurationHeader()", () => {
    it("keeps the label, search, and actions on one row below the agent tabs", () => {
      const search = jest.fn();
      render(
        <AgentConfigurationHeader
          agents={[{ id: "claude", label: "Claude Code" }]}
          selectedAgent="claude"
          query=""
          onQueryChange={search}
          searchPlaceholder="Search skills"
          count={6}
          label="Skills"
          actions={<button type="button">New</button>}
        />
      );
      expect(screen.getByRole("tab", { name: "Claude Code" }).getAttribute("aria-selected")).toBe(
        "true"
      );
      fireEvent.change(screen.getByPlaceholderText("Search skills"), {
        target: { value: "notes" },
      });
      expect(search).toHaveBeenCalledWith("notes");
      const label = screen.getByText("Skills");
      expect(label.parentElement?.contains(screen.getByRole("button", { name: "New" }))).toBe(true);
      expect(label.parentElement?.contains(screen.getByPlaceholderText("Search skills"))).toBe(
        true
      );
      expect(screen.queryByRole("combobox")).toBeNull();
      expect(screen.queryByRole("heading")).toBeNull();
    });

    it("allows another agent tab to be selected without adding agents itself", () => {
      const selectAgent = jest.fn();
      render(
        <AgentConfigurationHeader
          agents={[
            { id: "claude", label: "Claude Code" },
            { id: "test", label: "Test agent" },
          ]}
          selectedAgent="claude"
          onSelectAgent={selectAgent}
        />
      );
      fireEvent.click(screen.getByRole("tab", { name: "Test agent" }));
      expect(selectAgent).toHaveBeenCalledWith("test");
      expect(screen.queryByRole("combobox")).toBeNull();
    });
  });
});
