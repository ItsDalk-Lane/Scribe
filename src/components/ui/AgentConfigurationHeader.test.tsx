import { AgentConfigurationHeader } from "@/components/ui/AgentConfigurationHeader";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentConfigurationHeader", () => {
  describe("AgentConfigurationHeader()", () => {
    it("keeps the agent tabs above source selection and search", () => {
      const selectSource = jest.fn();
      const search = jest.fn();
      render(
        <AgentConfigurationHeader
          agents={[{ id: "claude", label: "Claude Code" }]}
          selectedAgent="claude"
          source="user"
          sources={[
            { value: "user", label: "User" },
            { value: "vault", label: "Current vault" },
          ]}
          onSourceChange={selectSource}
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
      fireEvent.change(screen.getByRole("combobox"), { target: { value: "vault" } });
      expect(selectSource).toHaveBeenCalledWith("vault");
      fireEvent.change(screen.getByPlaceholderText("Search skills"), {
        target: { value: "notes" },
      });
      expect(search).toHaveBeenCalledWith("notes");
      const label = screen.getByText("Skills");
      expect(label.parentElement?.contains(screen.getByRole("button", { name: "New" }))).toBe(true);
      expect(label.parentElement?.contains(screen.getByPlaceholderText("Search skills"))).toBe(
        false
      );
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
