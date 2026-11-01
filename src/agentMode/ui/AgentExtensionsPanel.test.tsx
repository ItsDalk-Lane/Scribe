import { AgentExtensionsPanel } from "@/agentMode/ui/AgentExtensionsPanel";
import { fireEvent, render, screen, within } from "@testing-library/react";
import React from "react";

describe("AgentExtensionsPanel", () => {
  describe("AgentExtensionsPanel()", () => {
    it("groups plugin entries by their recorded owner and allows management only for user entries (https://github.com/ItsDalk-Lane/Scribe/issues/1)", () => {
      const open = jest.fn(),
        toggle = jest.fn(),
        remove = jest.fn();
      const personal = {
        id: "personal",
        name: "personal",
        source: "user" as const,
        enabled: true,
        availability: "loaded" as const,
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
      expect(screen.getByRole("heading", { name: /Installed/ })).toBeTruthy();
      const fixed = screen.getByRole("article", { name: "fixed" });
      expect(within(fixed).queryByRole("switch")).toBeNull();
      expect(
        within(fixed).getByRole("img", { name: "Its plugin is not enabled in this scope." })
      ).toBeTruthy();
      expect(within(fixed).queryByRole("button", { name: /Delete|Edit/ })).toBeNull();
      fireEvent.click(screen.getByRole("switch", { name: "Enable personal" }));
      expect(toggle).toHaveBeenCalledWith(personal, false);
      fireEvent.click(screen.getByRole("button", { name: "Delete personal" }));
      expect(remove).toHaveBeenCalledWith(personal);
      fireEvent.click(
        within(screen.getByRole("article", { name: "personal" })).getByRole("button", {
          name: "personal",
        })
      );
      expect(open).toHaveBeenCalledWith(personal);
    });
    it("shows a plugin's version beside its name without opening the details view", () => {
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
              kind: "plugin",
              status: "partial",
              warnings: [],
              items: [
                {
                  id: "notes@community",
                  name: "notes",
                  source: "user",
                  version: "1.4.0",
                  enabled: true,
                  availability: "loaded",
                  capabilities: { edit: false, delete: true, toggle: true },
                },
              ],
            },
          ]}
        />
      );
      const item = within(screen.getByRole("article", { name: "notes" }));
      expect(item.getByText("1.4.0")).toBeTruthy();
    });
    it.each<[boolean, string]>([
      [true, "Availability could not be confirmed. Check again."],
      [false, "This item is disabled in the current configuration."],
    ])(
      "labels a linked skill as read-only instead of built-in when enabled is %s (https://github.com/ItsDalk-Lane/Scribe/issues/1)",
      (enabled, reason) => {
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
        expect(item.queryByText("Read-only; manage at its source")).toBeNull();
        expect(item.queryByRole("switch")).toBeNull();
        expect(item.getByRole("img", { name: reason })).toBeTruthy();
        expect(item.queryByRole("button", { name: /Delete|Edit/ })).toBeNull();
      }
    );
    it("does not equate discovered or unreported entries with successfully loaded extensions (https://github.com/ItsDalk-Lane/Scribe/issues/1)", () => {
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
                {
                  id: "a",
                  name: "a",
                  source: "user",
                  capabilities: { edit: false, delete: false, toggle: true },
                },
                {
                  id: "b",
                  name: "b",
                  source: "user",
                  availability: "failed",
                  capabilities: { edit: false, delete: false, toggle: true },
                },
                {
                  id: "c",
                  name: "c",
                  source: "plugin",
                  parentPluginId: "docs",
                  readOnly: true,
                  availability: "connected",
                  toolCount: 3,
                },
              ],
            },
          ]}
        />
      );
      expect(screen.queryByText("Discovered; loading not checked")).toBeNull();
      expect(screen.queryByText("Connection failed")).toBeNull();
      expect(screen.queryByText("Connected · 3 tools")).toBeNull();
      expect(screen.getByRole("switch", { name: "Enable a" }).getAttribute("aria-disabled")).toBe(
        "true"
      );
      const failed = screen.getByRole("article", { name: "b" });
      expect(within(failed).queryByRole("switch")).toBeNull();
      expect(
        within(failed).getByRole("img", {
          name: "Resolve the loading error before enabling this item.",
        })
      ).toBeTruthy();
      const loaded = screen.getByRole("article", { name: "c" });
      expect(within(loaded).queryByRole("switch")).toBeNull();
      expect(within(loaded).queryByRole("img")).toBeNull();
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
