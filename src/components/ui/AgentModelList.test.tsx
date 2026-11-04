import { AgentModelList } from "@/components/ui/AgentModelList";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

describe("AgentModelList", () => {
  describe("AgentModelList()", () => {
    const rows = [
      { id: "a", label: "Shared name", wireId: "first", enabled: true },
      {
        id: "b",
        label: "Shared name",
        wireId: "second",
        description: "Another entry",
        enabled: true,
      },
      { id: "c", label: "Third model", wireId: "third", enabled: false },
      { id: "d", label: "Fourth model", wireId: "fourth", enabled: false },
    ];
    it("shows every reported entry under one disclosure, including same-name models and disabled models", () => {
      const toggle = jest.fn();
      render(<AgentModelList rows={rows} onToggle={toggle} agentName="Scribe" />);
      expect(screen.queryByText("first")).toBeNull();
      fireEvent.click(screen.getByRole("button", { name: /Visible models/ }));
      expect(screen.getAllByRole("switch")).toHaveLength(4);
      expect(screen.getAllByText("Shared name")).toHaveLength(2);
      expect(screen.getByText("Another entry")).toBeTruthy();
      expect(screen.getAllByRole("button", { expanded: true })).toHaveLength(1);
      fireEvent.click(screen.getByRole("switch", { name: /Third model/ }));
      expect(toggle).toHaveBeenCalledWith("c", true);
    });
    it("searches by the model code without changing the full count or selecting another default", () => {
      render(<AgentModelList rows={rows} onToggle={jest.fn()} agentName="Scribe" defaultOpen />);
      fireEvent.change(screen.getByPlaceholderText("Search Scribe models…"), {
        target: { value: "second" },
      });
      expect(screen.getByText("2 enabled / 4 models")).toBeTruthy();
      expect(screen.getByText("second")).toBeTruthy();
      expect(screen.queryByText("Default")).toBeNull();
    });
    it("shows an empty report and a fully disabled list without inventing fallback models", () => {
      const { rerender } = render(
        <AgentModelList rows={[]} onToggle={jest.fn()} agentName="Scribe" defaultOpen />
      );
      expect(screen.queryByRole("switch")).toBeNull();
      expect(screen.getByText(/No chat models configured/)).toBeTruthy();
      rerender(
        <AgentModelList
          rows={rows.map((row) => ({ ...row, enabled: false }))}
          onToggle={jest.fn()}
          agentName="Scribe"
          defaultOpen
        />
      );
      expect(screen.getByText("Enable at least one model to start a new chat.")).toBeTruthy();
      expect(screen.queryByText("Default")).toBeNull();
    });
  });
});
