import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { McpServerRow, McpSettingsPanel } from "./McpSettingsPanel";
import type { McpServerConfig } from "@/agentMode/mcp/types";

function server(
  name: string,
  type: McpServerConfig["type"] = "streamableHttp",
  isActive = false
): McpServerConfig {
  return {
    id: name,
    name,
    type,
    isActive,
    url: "https://example.com/mcp",
    command: "npx",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

const mockSettings = {
  agentMode: { mcpToolLoading: "auto" as const },
  mcp: { servers: [] as McpServerConfig[] },
};
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 模拟真实 Hook 导出，名称必须一致 */
jest.mock("@/context", () => ({ useApp: () => ({}) }));
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  useSettingsValue: () => mockSettings,
  setSettings: jest.fn(),
}));
jest.mock("./mcpUiState", () => ({
  useMcpServerViews: (servers: McpServerConfig[]) =>
    servers.map((entry) => ({
      server: entry,
      state: {
        serverId: entry.id,
        status: entry.isActive ? "connected" : "disabled",
        toolCount: 0,
      },
    })),
  writeMcpServers: jest.fn(async () => undefined),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("./McpServerEditorDialog", () => ({
  McpServerEditorModal: class {
    open() {}
  },
}));
jest.mock("./McpJsonImportDialog", () => ({
  McpJsonImportModal: class {
    open() {}
  },
}));

function mountRow() {
  const config = server("search");
  const onEdit = jest.fn();
  const onToggle = jest.fn();
  render(
    <McpServerRow
      server={config}
      state={{ status: "connected", version: "1.2.0" }}
      onEdit={onEdit}
      onToggle={onToggle}
    />
  );
  return { config, onEdit, onToggle };
}

describe("McpSettingsPanel", () => {
  describe("McpServerRow()", () => {
    it("opens a server's details when its row is clicked or activated by keyboard", () => {
      const { onEdit } = mountRow();
      const row = screen.getByRole("button");
      fireEvent.click(row);
      fireEvent.keyDown(row, { key: "Enter" });
      fireEvent.keyDown(row, { key: " " });
      expect(onEdit.mock.calls).toEqual([["search"], ["search"], ["search"]]);
      expect(screen.getByText("1.2.0")).toBeTruthy();
    });

    it("toggles the server without opening details when its switch is clicked", () => {
      const { config, onEdit, onToggle } = mountRow();
      fireEvent.click(screen.getByRole("switch", { name: "Enable search" }));
      expect(onToggle).toHaveBeenCalledWith(config, true);
      expect(onEdit).not.toHaveBeenCalled();
    });

    it.each(["Enter", " "])(
      "toggles the server without opening details when its switch receives %j",
      (key) => {
        const { config, onEdit, onToggle } = mountRow();
        fireEvent.keyDown(screen.getByRole("switch", { name: "Enable search" }), { key });
        expect(onToggle).toHaveBeenCalledWith(config, true);
        expect(onEdit).not.toHaveBeenCalled();
      }
    );
  });

  describe("McpSettingsPanel()", () => {
    beforeEach(() => {
      mockSettings.mcp.servers = [
        server("search", "streamableHttp", true),
        server("local", "stdio"),
      ];
    });

    it("filters the server list by enabled state and search text", () => {
      render(<McpSettingsPanel />);
      fireEvent.click(screen.getByRole("radio", { name: "Enabled" }));
      expect(screen.getByText("search")).toBeTruthy();
      expect(screen.queryByText("local")).toBeNull();
      fireEvent.click(screen.getByRole("radio", { name: "Disabled" }));
      expect(screen.getByText("local")).toBeTruthy();
      expect(screen.queryByText("search")).toBeNull();
      fireEvent.click(screen.getByRole("radio", { name: "All" }));
      fireEvent.change(screen.getByPlaceholderText("Search MCP servers…"), {
        target: { value: "absent" },
      });
      expect(screen.getByText("No servers match the current filters.")).toBeTruthy();
    });
  });
});
