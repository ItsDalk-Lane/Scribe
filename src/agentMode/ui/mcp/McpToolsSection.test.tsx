import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { McpSchemaViewer, McpToolsSection } from "./McpToolsSection";
import type { McpToolInfo } from "@/agentMode/mcp/types";

const tools: McpToolInfo[] = [
  {
    name: "search",
    description: "Find public information",
    inputSchema: {
      type: "object",
      description: "Search request",
      required: ["query"],
      properties: {
        query: { type: "string", description: "Search words" },
        mode: { type: "string", enum: ["brief", "full"] },
      },
    },
  },
  { name: "read", description: "Read a page", inputSchema: { type: "object" } },
];

function mountTools(disabledTools: string[] = []) {
  const onToggleTool = jest.fn();
  const onToggleAutoApprove = jest.fn();
  render(
    <McpToolsSection
      tools={tools}
      disabledTools={disabledTools}
      autoApprovedTools={[]}
      onToggleTool={onToggleTool}
      onToggleAutoApprove={onToggleAutoApprove}
      onToggleDirect={jest.fn()}
    />
  );
  return { onToggleTool, onToggleAutoApprove };
}

describe("McpToolsSection", () => {
  describe("McpToolsSection()", () => {
    it("keeps schemas collapsed until their tool is expanded and shows required fields and enum values", () => {
      mountTools();
      const tool = screen.getByRole("button", { name: /search.*Find public information/ });
      expect(tool.getAttribute("aria-expanded")).toBe("false");
      expect(screen.queryByText("query")).toBeNull();
      fireEvent.click(tool);
      expect(tool.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByText("query")).toBeTruthy();
      expect(screen.getByText("Required")).toBeTruthy();
      expect(screen.getByText("brief")).toBeTruthy();
      fireEvent.click(tool);
      expect(screen.queryByText("query")).toBeNull();
    });

    it("reports tool enablement and auto-approval changes by the tool's actual name", () => {
      const { onToggleTool, onToggleAutoApprove } = mountTools();
      fireEvent.click(screen.getByRole("switch", { name: "Enable search" }));
      fireEvent.click(screen.getByRole("switch", { name: "Auto-approve read" }));
      expect(onToggleTool).toHaveBeenCalledWith("search", false);
      expect(onToggleAutoApprove).toHaveBeenCalledWith("read", true);
    });

    it("prevents automatic approval from being enabled for a disabled tool", () => {
      const { onToggleAutoApprove } = mountTools(["search"]);
      const approval = screen.getByRole("switch", { name: "Auto-approve search" });
      expect(approval.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(approval);
      expect(onToggleAutoApprove).not.toHaveBeenCalled();
    });

    it("keeps direct calls off until confirmation and blocks a managed search tool from opting in", () => {
      const onToggleDirect = jest.fn();
      render(
        <McpToolsSection
          tools={tools}
          disabledTools={[]}
          autoApprovedTools={["read", "search"]}
          directToolStates={new Map([["search", "web-search"]])}
          onToggleTool={jest.fn()}
          onToggleAutoApprove={jest.fn()}
          onToggleDirect={onToggleDirect}
        />
      );
      const read = screen.getByRole("switch", { name: "Allow direct calls for read (non-search)" });
      const search = screen.getByRole("switch", {
        name: "Allow direct calls for search (non-search)",
      });
      expect(read.getAttribute("aria-checked")).toBe("false");
      expect(search.getAttribute("aria-disabled")).toBe("true");
      expect(
        screen.getByText("Confirm this tool does not search the web before allowing direct calls.")
      ).toBeTruthy();
      expect(screen.getByText("Web search tools use the configured search order.")).toBeTruthy();
      fireEvent.click(search);
      expect(onToggleDirect).not.toHaveBeenCalled();
      fireEvent.click(read);
      expect(onToggleDirect).toHaveBeenCalledWith("read", true);
      expect(screen.queryByText("Registered")).toBeNull();
    });

    it("filters tools by name and description and explains an unmatched search", () => {
      mountTools();
      const search = screen.getByPlaceholderText("Search tools…");
      fireEvent.change(search, { target: { value: "public" } });
      expect(screen.getByText("search")).toBeTruthy();
      expect(screen.queryByText("read")).toBeNull();
      fireEvent.change(search, { target: { value: "read" } });
      expect(screen.getByText("read")).toBeTruthy();
      expect(screen.queryByText("search")).toBeNull();
      fireEvent.change(search, { target: { value: "missing" } });
      expect(screen.getByText("No results.")).toBeTruthy();
    });

    it("prevents tool and approval mutations while their configuration is saving", () => {
      const onToggleTool = jest.fn();
      const onToggleAutoApprove = jest.fn();
      render(
        <McpToolsSection
          tools={tools}
          disabled
          disabledTools={[]}
          autoApprovedTools={[]}
          onToggleTool={onToggleTool}
          onToggleAutoApprove={onToggleAutoApprove}
          onToggleDirect={jest.fn()}
        />
      );
      fireEvent.click(screen.getByRole("switch", { name: "Enable search" }));
      fireEvent.click(screen.getByRole("switch", { name: "Auto-approve search" }));
      expect(onToggleTool).not.toHaveBeenCalled();
      expect(onToggleAutoApprove).not.toHaveBeenCalled();
    });

    it("explains how to load tools when no server tools have been discovered", () => {
      render(
        <McpToolsSection
          tools={[]}
          disabledTools={[]}
          autoApprovedTools={[]}
          onToggleTool={jest.fn()}
          onToggleAutoApprove={jest.fn()}
          onToggleDirect={jest.fn()}
        />
      );
      expect(
        screen.getByText("No tools available. Save and enable the server to load its tools.")
      ).toBeTruthy();
    });

    it("marks only enabled, confirmed tools as deferred when deferred loading is active https://github.com/ItsDalk-Lane/Scribe/issues/65", () => {
      render(
        <McpToolsSection
          tools={tools}
          disabledTools={[]}
          autoApprovedTools={[]}
          directToolStates={new Map([["read", "approved"]])}
          deferred
          onToggleTool={jest.fn()}
          onToggleAutoApprove={jest.fn()}
          onToggleDirect={jest.fn()}
        />
      );
      expect(screen.getAllByText("Deferred")).toHaveLength(1);
      expect(screen.getByText(/Deferred loading is active/)).toBeTruthy();
    });

    it("marks enabled, confirmed tools as fully registered when deferred loading is off https://github.com/ItsDalk-Lane/Scribe/issues/65", () => {
      render(
        <McpToolsSection
          tools={tools}
          disabledTools={["read"]}
          autoApprovedTools={[]}
          directToolStates={
            new Map([
              ["search", "approved"],
              ["read", "approved"],
            ])
          }
          deferred={false}
          onToggleTool={jest.fn()}
          onToggleAutoApprove={jest.fn()}
          onToggleDirect={jest.fn()}
        />
      );
      expect(screen.getAllByText("Registered")).toHaveLength(1);
      expect(screen.queryByText("Deferred")).toBeNull();
    });
  });

  describe("McpSchemaViewer()", () => {
    it("shows the root schema description exactly once", () => {
      render(<McpSchemaViewer schema={tools[0].inputSchema} />);
      expect(screen.getAllByText("Search request")).toHaveLength(1);
    });

    it("shows the type and contents of array properties", () => {
      render(
        <McpSchemaViewer
          schema={{
            type: "array",
            items: { type: "object", properties: { title: { type: "string" } } },
          }}
        />
      );
      expect(screen.getByText("array")).toBeTruthy();
      expect(screen.getByText("Items")).toBeTruthy();
      expect(screen.getByText("title")).toBeTruthy();
    });
  });
});
