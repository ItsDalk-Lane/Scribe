import { buildMcpToolName, createMcpTools } from "@/agentMode/mcp/mcpTools";
import { DeferredMcpToolRegistry } from "@/agentMode/mcp/deferredMcpTools";
import type { McpServerManager } from "@/agentMode/mcp/McpServerManager";
import type { McpServerConfig, McpToolCallResult, McpToolInfo } from "@/agentMode/mcp/types";

interface ManagerStubInput {
  servers: readonly McpServerConfig[];
  toolsByServer: Record<string, readonly McpToolInfo[]>;
  callTool?: (
    serverId: string,
    name: string,
    args: Record<string, unknown> | undefined
  ) => Promise<McpToolCallResult>;
}

function managerStub({ servers, toolsByServer, callTool }: ManagerStubInput): McpServerManager {
  return {
    listEnabledServers: () => servers.filter((entry) => entry.isActive),
    getTools: (serverId: string) => toolsByServer[serverId] ?? [],
    callTool: callTool ?? (async () => ({ content: [{ type: "text", text: "done" }] })),
  } as unknown as McpServerManager;
}

function server(overrides: Partial<McpServerConfig>): McpServerConfig {
  return {
    id: "srv-1",
    name: "files",
    type: "stdio",
    command: "npx",
    isActive: true,
    createdAt: "",
    updatedAt: "",
    ...overrides,
  };
}

const SEARCH_TOOL: McpToolInfo = {
  name: "search",
  description: "Search notes.",
  inputSchema: {
    type: "object",
    properties: { query: { type: "string" } },
    required: ["query"],
  },
};

describe("mcpTools", () => {
  describe("buildMcpToolName()", () => {
    it("qualifies the tool with its server", () => {
      expect(buildMcpToolName("context7", "query-docs")).toBe("mcp__context7__query-docs");
    });
  });

  describe("createMcpTools()", () => {
    it("exposes discovered tools under qualified names", () => {
      const bundle = createMcpTools(
        managerStub({ servers: [server({})], toolsByServer: { "srv-1": [SEARCH_TOOL] } })
      );
      expect(bundle.tools.map((tool) => tool.name)).toEqual(["mcp__files__search"]);
      expect(bundle.tools[0]).toMatchObject({
        label: "search",
        description: "Search notes.",
      });
    });

    it("passes the MCP input schema through as the tool parameters", () => {
      const bundle = createMcpTools(
        managerStub({ servers: [server({})], toolsByServer: { "srv-1": [SEARCH_TOOL] } })
      );
      expect(bundle.tools[0].parameters).toEqual(SEARCH_TOOL.inputSchema);
    });

    it("defaults a missing schema to an object schema", () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: {
            "srv-1": [{ name: "ping", inputSchema: undefined } as unknown as McpToolInfo],
          },
        })
      );
      expect(bundle.tools[0].parameters).toEqual({ type: "object", properties: {} });
    });

    it("skips tools disabled on the server", () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({ disabledTools: ["search"] })],
          toolsByServer: { "srv-1": [SEARCH_TOOL, { name: "ping", inputSchema: {} }] },
        })
      );
      expect(bundle.tools.map((tool) => tool.name)).toEqual(["mcp__files__ping"]);
    });

    it("only exposes servers that are active", () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({}), server({ id: "srv-2", name: "off", isActive: false })],
          toolsByServer: { "srv-1": [SEARCH_TOOL], "srv-2": [{ name: "hidden", inputSchema: {} }] },
        })
      );
      expect(bundle.tools.map((tool) => tool.name)).toEqual(["mcp__files__search"]);
    });

    it("collects auto-approved tool names for the session runtime", () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({ autoApprovedTools: ["search"] })],
          toolsByServer: { "srv-1": [SEARCH_TOOL, { name: "ping", inputSchema: {} }] },
        })
      );
      expect([...bundle.autoApprovedTools]).toEqual(["mcp__files__search"]);
    });
  });

  describe("createMcpTools() deferred registration", () => {
    function deferredManager() {
      return managerStub({
        servers: [server({ autoApprovedTools: ["search"] })],
        toolsByServer: { "srv-1": [SEARCH_TOOL, { name: "ping", inputSchema: {} }] },
      });
    }

    it("registers nothing while no deferred tool has been selected", () => {
      const manager = deferredManager();
      const registry = DeferredMcpToolRegistry.fromManager(manager);
      const bundle = createMcpTools(manager, { registry, selectedNames: [] });
      expect(bundle.tools.map((tool) => tool.name)).toEqual([]);
      expect(bundle.autoApprovedTools.size).toBe(0);
    });

    it("keeps unselected tool definitions out of the registered set", () => {
      const manager = deferredManager();
      const registry = DeferredMcpToolRegistry.fromManager(manager);
      const bundle = createMcpTools(manager, {
        registry,
        selectedNames: ["mcp__files__ping"],
      });
      expect(bundle.tools.map((tool) => tool.name)).toEqual(["mcp__files__ping"]);
    });

    it("inherits the server's auto-approval when a selected tool is registered", () => {
      const manager = deferredManager();
      const registry = DeferredMcpToolRegistry.fromManager(manager);
      const bundle = createMcpTools(manager, {
        registry,
        selectedNames: ["mcp__files__search", "mcp__files__ping"],
      });
      expect(bundle.tools.map((tool) => tool.name).sort()).toEqual([
        "mcp__files__ping",
        "mcp__files__search",
      ]);
      expect([...bundle.autoApprovedTools]).toEqual(["mcp__files__search"]);
    });

    it("matches the full registration set when every tool is selected", () => {
      const manager = deferredManager();
      const registry = DeferredMcpToolRegistry.fromManager(manager);
      const deferred = createMcpTools(manager, {
        registry,
        selectedNames: registry.list().map((entry) => entry.qualifiedName),
      });
      const full = createMcpTools(manager);
      expect(deferred.tools.map((tool) => tool.name)).toEqual(full.tools.map((tool) => tool.name));
      expect([...deferred.autoApprovedTools].sort()).toEqual([...full.autoApprovedTools].sort());
    });
  });

  describe("MCP tool execute()", () => {
    it("keeps the original mixed result for display without rewriting model text and supplies structured-only content https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
      const original = {
        content: [
          { type: "text", text: '{"id":900719925474099312345}' },
          { type: "resource_link", uri: "https://example.com/report", name: "Report" },
        ],
        structuredContent: { answer: 42 },
        _meta: { trace: "original" },
      };
      const results = [original, { content: [], structuredContent: { answer: 42 } }];
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: { "srv-1": [SEARCH_TOOL] },
          callTool: async () => results.shift()!,
        })
      );
      const first = await bundle.tools[0].execute("call-1", { query: "x" });
      expect(first.content[0]).toEqual(original.content[0]);
      expect(first.details).toEqual({ mcpResult: original });
      const structured = await bundle.tools[0].execute("call-2", { query: "x" });
      expect(structured.content).toEqual([{ type: "text", text: '{"answer":42}' }]);
    });
    it("routes the call to its server and maps text results", async () => {
      const callTool = jest.fn(
        async (): Promise<McpToolCallResult> => ({
          content: [{ type: "text", text: "found 2 notes" }],
        })
      );
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: { "srv-1": [SEARCH_TOOL] },
          callTool,
        })
      );
      const controller = new AbortController();
      const result = await bundle.tools[0].execute("call-1", { query: "notes" }, controller.signal);
      expect(callTool).toHaveBeenCalledWith(
        "srv-1",
        "search",
        { query: "notes" },
        controller.signal
      );
      expect(result).toMatchObject({
        content: [{ type: "text", text: "found 2 notes" }],
        isError: false,
      });
    });

    it("maps image results to image content", async () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: { "srv-1": [{ name: "render", inputSchema: {} }] },
          callTool: async () => ({
            content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/jpeg" }],
          }),
        })
      );
      const result = await bundle.tools[0].execute("call-1", {});
      expect(result.content).toEqual([{ type: "image", data: "aGVsbG8=", mimeType: "image/jpeg" }]);
    });

    it("propagates the server's own error flag", async () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: { "srv-1": [SEARCH_TOOL] },
          callTool: async () => ({
            content: [{ type: "text", text: "boom" }],
            isError: true,
          }),
        })
      );
      const result = await bundle.tools[0].execute("call-1", { query: "x" });
      expect(result.isError).toBe(true);
    });

    it("wraps transport failures as error results instead of throwing", async () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: { "srv-1": [SEARCH_TOOL] },
          callTool: async () => {
            throw new Error("The server is not connected (status: error).");
          },
        })
      );
      const result = await bundle.tools[0].execute("call-1", { query: "x" });
      expect(result.isError).toBe(true);
      expect(JSON.stringify(result.content)).toContain("not connected");
    });

    it("rejects arguments that violate the server's input schema", async () => {
      const callTool = jest.fn(
        async (): Promise<McpToolCallResult> => ({
          content: [{ type: "text", text: "unused" }],
        })
      );
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: { "srv-1": [SEARCH_TOOL] },
          callTool,
        })
      );
      await expect(bundle.tools[0].execute("call-1", { wrong: true })).rejects.toThrow(
        /Invalid arguments/
      );
      expect(callTool).not.toHaveBeenCalled();
    });

    it("serializes unknown content parts as JSON text", async () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: { "srv-1": [{ name: "voice", inputSchema: {} }] },
          callTool: async () => ({
            content: [{ type: "audio", data: "AAEC" }],
          }),
        })
      );
      const result = await bundle.tools[0].execute("call-1", {});
      expect(result.content).toHaveLength(1);
      expect(result.content[0]).toMatchObject({ type: "text" });
    });

    it("falls back to a placeholder when the server returns no content", async () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: { "srv-1": [{ name: "ping", inputSchema: {} }] },
          callTool: async () => ({ content: [] }),
        })
      );
      const result = await bundle.tools[0].execute("call-1", {});
      expect(result.content).toEqual([{ type: "text", text: "(empty result)" }]);
    });
  });
});
