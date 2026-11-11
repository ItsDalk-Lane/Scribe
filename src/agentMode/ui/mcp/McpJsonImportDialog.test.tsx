import React from "react";
import type { App } from "obsidian";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { McpJsonImportModal } from "./McpJsonImportDialog";
import type { McpServerConfig } from "@/agentMode/mcp/types";

const mockSecrets = new Map<string, string>();
const mockSetSecret = jest.fn(async (id: string, value: string) => {
  mockSecrets.set(id, value);
});
const mockSettings = { mcp: { servers: [] as McpServerConfig[] } };
const mockWrite = jest.fn(async (update: (servers: McpServerConfig[]) => McpServerConfig[]) => {
  mockSettings.mcp.servers = update(mockSettings.mcp.servers);
});
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 模拟真实 Hook 导出，名称必须一致 */
jest.mock("@/context", () => ({ useApp: () => ({}) }));
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  useSettingsValue: () => mockSettings,
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/services/secretStore", () => ({
  SecretStore: { getInstance: () => ({ setSecret: mockSetSecret }) },
}));
jest.mock("./mcpUiState", () => ({
  writeMcpServers: (_app: unknown, update: (servers: McpServerConfig[]) => McpServerConfig[]) =>
    mockWrite(update),
}));
jest.mock("@/components/modals/ReactModal", () => ({ ReactModal: class {} }));

class ImportModalFixture extends McpJsonImportModal {
  content(close: () => void): React.ReactElement {
    return this.renderContent(close);
  }
}

const config = JSON.stringify({
  mcpServers: {
    search: {
      type: "http",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer synthetic-key", "X-Trace": "trace" },
    },
  },
});

function mountImport() {
  const close = jest.fn();
  render(new ImportModalFixture({} as App, {}).content(close));
  fireEvent.change(screen.getByRole("textbox"), { target: { value: config } });
  return close;
}

describe("McpJsonImportDialog", () => {
  describe("McpJsonImportModal", () => {
    describe("renderContent()", () => {
      beforeEach(() => {
        mockSecrets.clear();
        mockSettings.mcp.servers = [];
        mockSetSecret.mockReset();
        mockSetSecret.mockImplementation(async (id, value) => {
          mockSecrets.set(id, value);
        });
        mockWrite.mockClear();
      });

      it("encrypts imported credentials before publishing a disabled server with only references", async () => {
        const close = mountImport();
        fireEvent.click(screen.getByRole("button", { name: "Import" }));
        await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        const server = mockSettings.mcp.servers[0];
        expect(server).toMatchObject({
          name: "search",
          type: "streamableHttp",
          isActive: false,
          headers: { "X-Trace": "trace" },
          secretRefs: [{ scope: "headers", key: "Authorization" }],
        });
        expect(server.headers).not.toHaveProperty("Authorization");
        expect(mockSecrets.get(server.secretRefs![0].secretId)).toBe("Bearer synthetic-key");
        expect(JSON.stringify(server)).not.toContain("synthetic-key");
      });

      it("keeps the entered JSON and dialog open when saving a credential fails", async () => {
        mockSetSecret.mockRejectedValueOnce(new Error("synthetic save failure"));
        const close = mountImport();
        fireEvent.click(screen.getByRole("button", { name: "Import" }));
        await screen.findByText("Failed to save the MCP server configuration.");
        expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(config);
        expect(mockSettings.mcp.servers).toEqual([]);
        expect(close).not.toHaveBeenCalled();
      });

      it("keeps controls disabled and the dialog open until configuration persistence completes", async () => {
        let complete!: () => void;
        const persisted = new Promise<void>((resolve) => {
          complete = resolve;
        });
        mockWrite.mockImplementationOnce(async (update) => {
          await persisted;
          mockSettings.mcp.servers = update(mockSettings.mcp.servers);
        });
        const close = mountImport();
        fireEvent.click(screen.getByRole("button", { name: "Import" }));
        await waitFor(() => expect(mockWrite).toHaveBeenCalled());
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Import" }).disabled).toBe(
          true
        );
        expect(screen.getByRole<HTMLButtonElement>("button", { name: "Cancel" }).disabled).toBe(
          true
        );
        expect(close).not.toHaveBeenCalled();
        await act(async () => {
          complete();
          await persisted;
        });
        await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
      });

      it("keeps the JSON available for retry when saving the server configuration fails", async () => {
        mockWrite.mockRejectedValueOnce(new Error("synthetic disk failure"));
        const close = mountImport();
        fireEvent.click(screen.getByRole("button", { name: "Import" }));
        await screen.findByText("Failed to save the MCP server configuration.");
        expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(config);
        expect(mockSettings.mcp.servers).toEqual([]);
        expect(close).not.toHaveBeenCalled();
      });

      it("preserves a same-named server added after the import dialog opened", async () => {
        const close = mountImport();
        const existing: McpServerConfig = {
          id: "existing",
          name: "search",
          type: "stdio",
          command: "existing-command",
          isActive: true,
          createdAt: "2026-01-01",
          updatedAt: "2026-01-01",
        };
        mockSettings.mcp.servers = [existing];
        fireEvent.click(screen.getByRole("button", { name: "Import" }));
        await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        expect(mockSettings.mcp.servers).toEqual([existing]);
        expect(mockSecrets.size).toBe(0);
      });

      it("shows the server name in an invalid endpoint report", () => {
        render(new ImportModalFixture({} as App, {}).content(jest.fn()));
        fireEvent.change(screen.getByRole("textbox"), {
          target: { value: JSON.stringify({ mcpServers: { broken: { url: "invalid" } } }) },
        });
        expect(screen.getByText("broken has an invalid URL.")).toBeTruthy();
      });
    });
  });
});
