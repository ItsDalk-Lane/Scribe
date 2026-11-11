import React from "react";
import { Notice, type App } from "obsidian";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  draftChanged,
  draftFromServer,
  EMPTY_MCP_SERVER_DRAFT,
  McpServerEditorContent,
  McpServerEditorModal,
  validateMcpServerDraft,
  type McpServerEditorContentProps,
} from "./McpServerEditorDialog";
import type { McpServerConfig } from "@/agentMode/mcp/types";

const mockSetSecret = jest.fn(async () => undefined);
const mockDeleteSecret = jest.fn(async () => undefined);
let mockConfirm!: () => Promise<void>;
jest.mock("@/components/modals/ConfirmModal", () => ({
  ConfirmModal: class {
    constructor(_app: unknown, onConfirm: () => Promise<void>) {
      mockConfirm = onConfirm;
    }
    open() {}
  },
}));
const mockSettings = { mcp: { servers: [] as McpServerConfig[] } };
const mockWrite = jest.fn(
  async (_app: unknown, update: (servers: McpServerConfig[]) => McpServerConfig[]) => {
    mockSettings.mcp.servers = update(mockSettings.mcp.servers);
  }
);
/* eslint-disable @eslint-react/hooks-extra/no-unnecessary-use-prefix -- 模拟真实 Hook 导出，名称必须一致 */
jest.mock("@/context", () => ({ useApp: () => ({}) }));
jest.mock("@/settings/model", () => ({
  getSettings: () => mockSettings,
  useSettingsValue: () => mockSettings,
}));
jest.mock("./mcpUiState", () => ({
  writeMcpServers: (...args: Parameters<typeof mockWrite>) => mockWrite(...args),
  useMcpServerRuntime: () => ({ state: { status: "connected", version: "1.0" }, tools: [] }),
}));
/* eslint-enable @eslint-react/hooks-extra/no-unnecessary-use-prefix */
jest.mock("@/services/secretStore", () => ({
  SecretStore: {
    getInstance: () => ({ setSecret: mockSetSecret, deleteSecret: mockDeleteSecret }),
  },
}));
jest.mock("@/components/modals/ReactModal", () => ({ ReactModal: class {} }));

function server(): McpServerConfig {
  return {
    id: "remote",
    name: "search",
    type: "streamableHttp",
    url: "https://example.com/mcp",
    isActive: true,
    secretRefs: [
      { scope: "headers", key: "Authorization", secretId: "mcp:remote:headers:Authorization" },
    ],
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

function mountEditor(overrides: Partial<McpServerEditorContentProps> = {}) {
  const props: McpServerEditorContentProps = {
    mode: "create",
    server: null,
    runtime: { status: "disabled", tools: [] },
    onSave: jest.fn(),
    onCancel: jest.fn(),
    ...overrides,
  };
  render(<McpServerEditorContent {...props} />);
  return props;
}

class EditorModalFixture extends McpServerEditorModal {
  content(close: () => void): React.ReactElement {
    return this.renderContent(close);
  }
}

describe("McpServerEditorDialog", () => {
  describe("draftFromServer()", () => {
    it("displays saved credential keys as blank entries without reading their values", () => {
      expect(draftFromServer(server()).headersText).toBe("Authorization=");
      expect(draftFromServer(server()).url).toBe("https://example.com/mcp");
    });
  });

  describe("validateMcpServerDraft()", () => {
    it("accepts a named stdio command and a named http endpoint", () => {
      expect(
        validateMcpServerDraft({ ...EMPTY_MCP_SERVER_DRAFT, name: "files", command: "npx" })
      ).toEqual({});
      expect(
        validateMcpServerDraft({
          ...EMPTY_MCP_SERVER_DRAFT,
          name: "search",
          type: "streamableHttp",
          url: "https://example.com/mcp",
        })
      ).toEqual({});
    });

    it("reports required endpoints, invalid URLs and fractional timeouts before saving", () => {
      expect(validateMcpServerDraft({ ...EMPTY_MCP_SERVER_DRAFT })).toMatchObject({
        name: "This field is required",
        command: "A command is required for standard input / output servers.",
      });
      expect(
        validateMcpServerDraft({
          ...EMPTY_MCP_SERVER_DRAFT,
          name: "search",
          type: "sse",
          url: "ftp://example.com",
          timeoutText: "1.5",
        })
      ).toMatchObject({
        url: "Enter an http:// or https:// URL.",
        timeoutText: "Enter a whole number of seconds greater than 0.",
      });
    });
  });

  describe("draftChanged()", () => {
    it("keeps unchanged edits unsaveable and detects changed tool settings", () => {
      const saved = server();
      const draft = draftFromServer(saved);
      expect(draftChanged(draft, saved)).toBe(false);
      expect(draftChanged({ ...draft, disabledTools: ["search"] }, saved)).toBe(true);
      expect(draftChanged({ ...draft, autoApprovedTools: ["search"] }, saved)).toBe(true);
    });
  });

  describe("McpServerEditorContent()", () => {
    it("collects the stdio command, arguments, environment, timeout and initial enabled state", () => {
      const { onSave } = mountEditor();
      fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "files" } });
      fireEvent.change(screen.getByPlaceholderText("uvx or npx"), { target: { value: "npx" } });
      fireEvent.change(screen.getByPlaceholderText(/arg1/), {
        target: { value: "-y\nserver-files" },
      });
      fireEvent.change(screen.getByPlaceholderText(/KEY1=/), {
        target: { value: "API_KEY=synthetic" },
      });
      fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "120" } });
      fireEvent.click(screen.getByRole("switch", { name: "Enable this server" }));
      fireEvent.click(screen.getByRole("switch", { name: "Long-running mode" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({
          name: "files",
          command: "npx",
          argsText: "-y\nserver-files",
          envText: "API_KEY=synthetic",
          timeoutText: "120",
          isActive: true,
          longRunning: true,
        })
      );
    });

    it("shows the correct endpoint fields for SSE and HTTP and prevents saving invalid URLs", () => {
      mountEditor();
      fireEvent.change(screen.getByPlaceholderText("Name"), { target: { value: "search" } });
      fireEvent.click(screen.getByRole("radio", { name: "Server-sent events (sse)" }));
      expect(screen.queryByPlaceholderText("uvx or npx")).toBeNull();
      const sse = screen.getByPlaceholderText("http://localhost:3000/sse");
      fireEvent.change(sse, { target: { value: "ftp://example.com" } });
      expect(screen.getByText("Enter an http:// or https:// URL.")).toBeTruthy();
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(true);
      fireEvent.click(screen.getByRole("radio", { name: "Streamable HTTP (streamableHttp)" }));
      fireEvent.change(screen.getByPlaceholderText("http://localhost:3000/mcp"), {
        target: { value: "https://example.com/mcp" },
      });
      expect(screen.getByRole<HTMLButtonElement>("button", { name: "Save" }).disabled).toBe(false);
      expect(screen.getByPlaceholderText(/Content-Type=/)).toBeTruthy();
    });

    it("routes the live activation switch independently and saves changed tool settings", () => {
      const onToggleActive = jest.fn();
      const { onSave } = mountEditor({
        mode: "edit",
        server: server(),
        liveActive: true,
        onToggleActive,
        runtime: {
          status: "connected",
          tools: [
            { name: "search", inputSchema: {} },
            { name: "read", inputSchema: {} },
          ],
        },
      });
      fireEvent.click(screen.getByRole("switch", { name: "Enable this server" }));
      expect(onToggleActive).toHaveBeenCalledWith(false);
      expect(onSave).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole("radio", { name: "Tools (2)" }));
      fireEvent.click(screen.getByRole("switch", { name: "Enable search" }));
      fireEvent.click(screen.getByRole("switch", { name: "Auto-approve read" }));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ disabledTools: ["search"], autoApprovedTools: ["read"] })
      );
    });

    it("prevents changes to fields and live switches while saving the submitted configuration", () => {
      const onToggleActive = jest.fn();
      mountEditor({ mode: "edit", server: server(), saving: true, onToggleActive });
      expect(screen.getByPlaceholderText<HTMLInputElement>("Name").disabled).toBe(true);
      expect(
        screen.getByRole<HTMLButtonElement>("radio", { name: "Server-sent events (sse)" }).disabled
      ).toBe(true);
      const active = screen.getByRole("switch", { name: "Enable this server" });
      expect(active.getAttribute("aria-disabled")).toBe("true");
      fireEvent.click(active);
      expect(onToggleActive).not.toHaveBeenCalled();
    });

    it("provides a readable label for each editable field", () => {
      mountEditor();
      for (const label of [
        "Name",
        "Description",
        "Command",
        "Arguments",
        "Environment variables",
        "Timeout",
      ]) {
        expect(screen.getByLabelText(label)).toBeTruthy();
      }
    });
  });

  describe("McpServerEditorModal", () => {
    describe("renderContent()", () => {
      beforeEach(() => {
        mockSettings.mcp.servers = [server()];
        mockSetSecret.mockClear();
        mockDeleteSecret.mockReset();
        mockDeleteSecret.mockImplementation(async () => undefined);
        jest.mocked(Notice).mockClear();
        mockWrite.mockClear();
      });

      it("preserves a server's credential when removing its configuration cannot be saved", async () => {
        mockWrite.mockRejectedValueOnce(new Error("synthetic disk failure"));
        const close = jest.fn();
        render(new EditorModalFixture({} as App, { serverId: "remote" }).content(close));
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));
        await mockConfirm();
        expect(mockSettings.mcp.servers).toHaveLength(1);
        expect(mockDeleteSecret).not.toHaveBeenCalled();
        expect(close).not.toHaveBeenCalled();
      });

      it("retains the original credential when removing its field cannot be saved", async () => {
        mockWrite.mockRejectedValueOnce(new Error("synthetic disk failure"));
        render(new EditorModalFixture({} as App, { serverId: "remote" }).content(jest.fn()));
        fireEvent.change(screen.getByLabelText("Headers"), { target: { value: "" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
          expect(Notice).toHaveBeenCalledWith("Failed to save the MCP server configuration.")
        );
        expect(mockSettings.mcp.servers[0].secretRefs).toEqual(server().secretRefs);
        expect(mockDeleteSecret).not.toHaveBeenCalled();
      });

      it("keeps a successful configuration save committed when unused credential cleanup fails", async () => {
        mockDeleteSecret.mockRejectedValueOnce(new Error("synthetic cleanup failure"));
        const close = jest.fn();
        render(new EditorModalFixture({} as App, { serverId: "remote" }).content(close));
        fireEvent.change(screen.getByLabelText("Headers"), { target: { value: "" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        expect(mockSettings.mcp.servers[0].secretRefs).toBeUndefined();
        expect(Notice).toHaveBeenCalledWith(
          "The server was saved, but its unused credentials could not be deleted."
        );
      });

      it("saves a replacement credential under its new reference before deleting the old credential", async () => {
        const close = jest.fn();
        render(new EditorModalFixture({} as App, { serverId: "remote" }).content(close));
        fireEvent.change(screen.getByLabelText("Headers"), {
          target: { value: "Authorization=Bearer synthetic-replacement" },
        });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() =>
          expect(mockDeleteSecret).toHaveBeenCalledWith("mcp:remote:headers:Authorization")
        );
        const saved = mockSettings.mcp.servers[0];
        expect(saved.secretRefs![0].secretId).not.toBe("mcp:remote:headers:Authorization");
        expect(mockSetSecret).toHaveBeenCalledWith(
          saved.secretRefs![0].secretId,
          "Bearer synthetic-replacement"
        );
        expect(JSON.stringify(saved)).not.toContain("synthetic-replacement");
        expect(close).toHaveBeenCalledTimes(1);
      });

      it("keeps a server removed and reports a separate warning if its credential cleanup fails", async () => {
        mockDeleteSecret.mockRejectedValueOnce(new Error("synthetic cleanup failure"));
        const close = jest.fn();
        render(new EditorModalFixture({} as App, { serverId: "remote" }).content(close));
        fireEvent.click(screen.getByRole("button", { name: "Delete" }));
        await mockConfirm();
        expect(mockSettings.mcp.servers).toEqual([]);
        expect(close).toHaveBeenCalledTimes(1);
        expect(Notice).toHaveBeenCalledWith(
          "The server was removed, but its saved credentials could not be deleted."
        );
      });

      it("retains a blank saved credential when another setting is changed", async () => {
        const close = jest.fn();
        render(new EditorModalFixture({} as App, { serverId: "remote" }).content(close));
        fireEvent.change(screen.getByRole("spinbutton"), { target: { value: "90" } });
        fireEvent.click(screen.getByRole("button", { name: "Save" }));
        await waitFor(() => expect(close).toHaveBeenCalledTimes(1));
        expect(mockSettings.mcp.servers[0]).toMatchObject({
          timeoutSeconds: 90,
          secretRefs: server().secretRefs,
        });
        expect(mockSetSecret).not.toHaveBeenCalled();
        expect(mockDeleteSecret).not.toHaveBeenCalled();
      });
    });
  });
});
