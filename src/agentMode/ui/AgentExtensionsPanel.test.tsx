import { AgentExtensionsPanel } from "@/agentMode/ui/AgentExtensionsPanel";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

describe("AgentExtensionsPanel", () => {
  describe("AgentExtensionsPanel()", () => {
    it("groups plugin entries by their recorded owner and allows management only for user entries", () => {
      const open = jest.fn(),
        toggle = jest.fn(),
        remove = jest.fn();
      const personal = {
        id: "personal",
        name: "personal",
        source: "user" as const,
        enabled: true,
        capabilities: { edit: true, delete: true, toggle: true },
      };
      render(
        <AgentExtensionsPanel
          agentName="Claude Code"
          loading={false}
          onRefresh={jest.fn()}
          onOpen={open}
          onToggle={toggle}
          onDelete={remove}
          groups={[
            {
              kind: "skill",
              status: "partial",
              warnings: [],
              items: [
                personal,
                {
                  id: "plugin",
                  name: "fixed",
                  source: "plugin",
                  parentPluginId: "docs@local",
                  readOnly: true,
                  enabled: false,
                  availability: "disabled",
                },
              ],
            },
          ]}
        />
      );
      expect(screen.getByRole("heading", { name: /docs@local/ })).toBeTruthy();
      const fixed = screen.getByRole("article", { name: "fixed" });
      expect(within(fixed).queryByRole("switch")).toBeNull();
      expect(within(fixed).queryByRole("button", { name: /Delete|Edit/ })).toBeNull();
      expect(within(fixed).getByText("Disabled with plugin")).toBeTruthy();
      fireEvent.click(screen.getByRole("switch", { name: "Enable personal" }));
      expect(toggle).toHaveBeenCalledWith(personal, false);
      fireEvent.click(screen.getByRole("button", { name: "Delete personal" }));
      expect(remove).toHaveBeenCalledWith(personal);
      fireEvent.click(
        within(screen.getByRole("article", { name: "personal" })).getByRole("button", {
          name: /^personal Discovered/,
        })
      );
      expect(open).toHaveBeenCalledWith(personal);
    });
    it.each([true, false])(
      "labels a linked skill as read-only instead of built-in when enabled is %s",
      (enabled) => {
        render(
          <AgentExtensionsPanel
            agentName="Claude Code"
            loading={false}
            onRefresh={jest.fn()}
            onOpen={jest.fn()}
            onToggle={jest.fn()}
            onDelete={jest.fn()}
            groups={[
              {
                kind: "skill",
                status: "partial",
                warnings: [],
                items: [
                  {
                    id: "/shared/review/SKILL.md",
                    name: "linked-review",
                    source: "project",
                    enabled,
                    readOnly: true,
                    capabilities: { edit: false, delete: false, toggle: false },
                  },
                ],
              },
            ]}
          />
        );
        const item = within(screen.getByRole("article", { name: "linked-review" }));
        expect(item.getByText("Read-only; manage at its source")).toBeTruthy();
        expect(item.queryByRole("switch")).toBeNull();
        expect(item.queryByRole("button", { name: /Delete|Edit/ })).toBeNull();
      }
    );
    it("does not equate discovered or unreported entries with successfully loaded extensions", () => {
      render(
        <AgentExtensionsPanel
          agentName="Claude Code"
          loading={false}
          onRefresh={jest.fn()}
          groups={[
            {
              kind: "mcp",
              status: "partial",
              warnings: [],
              items: [
                { id: "a", name: "a", source: "user" },
                { id: "b", name: "b", source: "user", availability: "failed" },
                { id: "c", name: "c", source: "plugin", availability: "connected", toolCount: 3 },
              ],
            },
          ]}
        />
      );
      expect(screen.getByText("Discovered; loading not checked")).toBeTruthy();
      expect(screen.getByText("Connection failed")).toBeTruthy();
      expect(screen.getByText("a").parentElement).toBe(
        screen.getByText("Discovered; loading not checked").parentElement
      );
      expect(screen.getByText("Connected · 3 tools")).toBeTruthy();
    });
    it("shows loading, failure and an empty subagent list as distinct states", () => {
      const refresh = jest.fn();
      const { rerender } = render(
        <AgentExtensionsPanel agentName="Claude Code" loading groups={null} onRefresh={refresh} />
      );
      expect(screen.getByRole("status")).toBeTruthy();
      rerender(
        <AgentExtensionsPanel
          agentName="Claude Code"
          loading={false}
          groups={null}
          error
          onRefresh={refresh}
        />
      );
      expect(screen.getByRole("alert")).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(refresh).toHaveBeenCalledTimes(1);
      rerender(
        <AgentExtensionsPanel
          agentName="Claude Code"
          loading={false}
          groups={[{ kind: "subagent", status: "partial", warnings: [], items: [] }]}
          onRefresh={refresh}
        />
      );
      expect(screen.getByText("No entries found in the checked sources.")).toBeTruthy();
    });
  });
});
