import { searchWithMcp } from "@/agentMode/backends/native/mcpWebSearch";
import { McpToolCallError, type McpServerManager } from "@/agentMode/mcp/McpServerManager";
import type { McpServerConfig, McpToolCallResult, McpToolInfo } from "@/agentMode/mcp/types";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";
import type { PermissionDecision } from "@/agentMode/session/types";
import type { WebSearchMcpSelection } from "@/settings/webSearchProvider";

const SELECTION: WebSearchMcpSelection = {
  serverId: "search-server",
  toolName: "lookup",
  queryParameter: "keyword",
};

const SERVER: McpServerConfig = {
  id: SELECTION.serverId,
  name: "Search",
  type: "stdio",
  command: "mcp-search",
  isActive: true,
  createdAt: "",
  updatedAt: "",
};

const TOOL: McpToolInfo = {
  name: SELECTION.toolName,
  inputSchema: {
    type: "object",
    properties: { keyword: { type: "string" } },
    required: ["keyword"],
    additionalProperties: false,
  },
};

describe("mcpWebSearch", () => {
  describe("searchWithMcp()", () => {
    function setup(config: Partial<McpServerConfig> = {}) {
      const callWebSearchTool = jest.fn<Promise<McpToolCallResult>, unknown[]>().mockResolvedValue({
        content: [
          { type: "text", text: "Found a result", _meta: { private: "text-private" } },
          {
            type: "resource_link",
            uri: "https://example.com/guide",
            _meta: { private: "link-private" },
          },
        ],
        structuredContent: { results: [{ url: "https://example.com/doc" }] },
        _meta: { private: "result-private" },
      });
      const server = { ...SERVER, ...config };
      const manager = {
        listEnabledServers: jest.fn(() => [server]),
        getState: jest.fn(() => ({ status: "connected" })),
        getTools: jest.fn(() => [TOOL]),
        callWebSearchTool,
        callTool: jest.fn(),
      };
      const context = {
        sessionId: "chat",
        requester: "main",
        assertCanExecute: jest.fn(),
        requestPermission: jest.fn<Promise<PermissionDecision>, unknown[]>().mockResolvedValue({
          outcome: { outcome: "selected", optionId: "allow_once" },
        }),
      };
      const controller = new AbortController();
      const search = (
        selection = SELECTION,
        overrides: Pick<Partial<NativeToolContext>, "allowedTools"> = {}
      ) =>
        searchWithMcp(
          manager as unknown as McpServerManager,
          { ...context, ...overrides } as unknown as NativeToolContext,
          selection,
          "call-1",
          "Obsidian & diagrams",
          controller.signal
        );
      return { manager, context, controller, search };
    }

    it("sends the configured query field to the approved server and returns public search text and links", async () => {
      const { manager, context, controller, search } = setup();
      await expect(search()).resolves.toEqual({
        text: 'Found a result\n\nhttps://example.com/guide\n\n{"results":[{"url":"https://example.com/doc"}]}',
      });
      expect(context.requestPermission).toHaveBeenCalledWith(
        expect.objectContaining({
          toolCall: expect.objectContaining({
            mcpServer: "Search",
            vendorToolName: "lookup",
            rawInput: { keyword: "Obsidian & diagrams" },
          }),
        })
      );
      expect(manager.callWebSearchTool).toHaveBeenCalledWith(
        "search-server",
        "lookup",
        { keyword: "Obsidian & diagrams" },
        controller.signal
      );
      expect(manager.callTool).not.toHaveBeenCalled();
    });

    it("honors the MCP tool's existing auto-approval", async () => {
      const { manager, context, search } = setup({ autoApprovedTools: ["lookup"] });
      await search();
      expect(context.requestPermission).not.toHaveBeenCalled();
      expect(manager.callWebSearchTool).toHaveBeenCalledTimes(1);
    });

    it("does not dispatch a disabled tool or send a query through an undeclared field", async () => {
      const disabled = setup({ disabledTools: ["lookup"] });
      await expect(disabled.search()).resolves.toHaveProperty("failure");
      expect(disabled.manager.callWebSearchTool).not.toHaveBeenCalled();
      const invalid = setup();
      await expect(
        invalid.search({ ...SELECTION, queryParameter: "bogus" })
      ).resolves.toHaveProperty("failure");
      expect(invalid.manager.callWebSearchTool).not.toHaveBeenCalled();
    });

    it("stops when the role disallows the MCP tool or the user declines permission", async () => {
      const { manager, context, search } = setup();
      await expect(search(SELECTION, { allowedTools: ["web_search"] })).rejects.toThrow(
        "cannot use"
      );
      expect(context.requestPermission).not.toHaveBeenCalled();
      context.requestPermission.mockResolvedValue({
        outcome: { outcome: "selected", optionId: "reject_once" },
      });
      await expect(search()).rejects.toThrow("permission denied");
      expect(manager.callWebSearchTool).not.toHaveBeenCalled();
    });

    it("does not dispatch after the approved catalog changes or the call is cancelled https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const changed = setup();
      changed.context.requestPermission.mockImplementation(async () => {
        changed.manager.getTools.mockReturnValue([{ ...TOOL }]);
        return { outcome: { outcome: "selected", optionId: "allow_once" } };
      });
      await expect(changed.search()).rejects.toThrow("configuration changed");
      expect(changed.manager.callWebSearchTool).not.toHaveBeenCalled();

      const cancelled = setup();
      cancelled.controller.abort();
      await expect(cancelled.search()).rejects.toHaveProperty("name", "AbortError");
      expect(cancelled.manager.callWebSearchTool).not.toHaveBeenCalled();
    });

    it("returns an explicit remote error as failure but stops on an unknown outcome https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const { manager, search } = setup();
      manager.callWebSearchTool
        .mockResolvedValueOnce({ content: [], isError: true })
        .mockRejectedValueOnce(new McpToolCallError("outcome_unknown", "connection lost"));
      await expect(search()).resolves.toHaveProperty("failure");
      await expect(search()).rejects.toThrow("outcome is unknown");
    });
  });
});
