import {
  assertUniqueMcpToolNames,
  buildMcpToolName,
  createMcpTools,
} from "@/agentMode/mcp/mcpTools";
import { getNativeToolPolicy } from "@/agentMode/sdk/nativeToolDefinition";
import { DeferredMcpToolRegistry } from "@/agentMode/mcp/deferredMcpTools";
import { McpServerManager, McpToolCallError } from "@/agentMode/mcp/McpServerManager";
import { mcpDirectToolFingerprint } from "@/agentMode/mcp/mcpDirectPolicy";
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
  const approvedServers = servers.map((entry) => ({
    ...entry,
    directToolApprovals:
      entry.directToolApprovals ??
      Object.fromEntries(
        (toolsByServer[entry.id] ?? []).map((tool) => [
          tool.name,
          mcpDirectToolFingerprint(entry, tool),
        ])
      ),
  }));
  return {
    listEnabledServers: () => approvedServers.filter((entry) => entry.isActive),
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

  describe("assertUniqueMcpToolNames()", () => {
    it("accepts empty and unique names and rejects an ambiguous name https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      expect(() => assertUniqueMcpToolNames([])).not.toThrow();
      expect(() => assertUniqueMcpToolNames(["a", "b"])).not.toThrow();
      expect(() => assertUniqueMcpToolNames(["a", "a"])).toThrow("Duplicate MCP tool name: a");
    });
  });

  describe("createMcpTools()", () => {
    it("rejects ambiguous qualified names instead of advertising one server while executing another https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const manager = managerStub({
        servers: [server({ name: "a__b" }), server({ id: "srv-2", name: "a" })],
        toolsByServer: {
          "srv-1": [{ name: "c", inputSchema: {} }],
          "srv-2": [{ name: "b__c", inputSchema: {} }],
        },
      });
      expect(() => createMcpTools(manager)).toThrow("Duplicate MCP tool name: mcp__a__b__c");
    });

    it("keeps remote tools sequential with no automatic replay or managed-native approval exemption https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const [tool] = createMcpTools(
        managerStub({ servers: [server({})], toolsByServer: { "srv-1": [SEARCH_TOOL] } })
      ).tools;
      expect(tool.executionMode).toBe("sequential");
      expect(tool.replay).toBe("never");
      expect(getNativeToolPolicy(tool)).toBeUndefined();
    });

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

    it("keeps unconfirmed aliases and advertised web search out of full registration even if auto-approved https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const web: McpToolInfo = { name: "web_search", inputSchema: {} };
      const alias: McpToolInfo = { name: "lookup", inputSchema: {} };
      const config = server({ autoApprovedTools: [web.name, alias.name, SEARCH_TOOL.name] });
      config.directToolApprovals = Object.fromEntries(
        [web, SEARCH_TOOL].map((tool) => [tool.name, mcpDirectToolFingerprint(config, tool)])
      );
      const bundle = createMcpTools(
        managerStub({ servers: [config], toolsByServer: { "srv-1": [web, alias, SEARCH_TOOL] } })
      );

      expect(bundle.tools.map((tool) => tool.name)).toEqual(["mcp__files__search"]);
      expect([...bundle.autoApprovedTools]).toEqual(["mcp__files__search"]);
    });

    it("keeps the reserved search alias out of full registration despite its previous confirmation https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const config = server({ autoApprovedTools: [SEARCH_TOOL.name] });
      const manager = managerStub({ servers: [config], toolsByServer: { "srv-1": [SEARCH_TOOL] } });
      const bundle = createMcpTools(manager, undefined, {
        serverId: config.id,
        toolName: SEARCH_TOOL.name,
      });

      expect(bundle.tools).toEqual([]);
      expect([...bundle.autoApprovedTools]).toEqual([]);
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

    it("ignores saved selections for unconfirmed aliases and advertised web search https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const web: McpToolInfo = { name: "web_search", inputSchema: {} };
      const alias: McpToolInfo = { name: "lookup", inputSchema: {} };
      const config = server({ autoApprovedTools: [web.name, alias.name, SEARCH_TOOL.name] });
      config.directToolApprovals = Object.fromEntries(
        [web, SEARCH_TOOL].map((tool) => [tool.name, mcpDirectToolFingerprint(config, tool)])
      );
      const manager = managerStub({
        servers: [config],
        toolsByServer: { "srv-1": [web, alias, SEARCH_TOOL] },
      });
      const bundle = createMcpTools(manager, {
        registry: DeferredMcpToolRegistry.fromManager(manager),
        selectedNames: ["mcp__files__web_search", "mcp__files__lookup", "mcp__files__search"],
      });

      expect(bundle.tools.map((tool) => tool.name)).toEqual(["mcp__files__search"]);
      expect([...bundle.autoApprovedTools]).toEqual(["mcp__files__search"]);
    });
  });

  describe("MCP tool execute()", () => {
    it("reports typed predispatch refusal without guessing from the error wording https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const bundle = createMcpTools(
        managerStub({
          servers: [server({})],
          toolsByServer: { "srv-1": [SEARCH_TOOL] },
          callTool: async () => {
            throw new McpToolCallError("not_started", "Unavailable");
          },
        })
      );
      const result = await bundle.tools[0].execute("call", { query: "x" });
      expect(result.details).toMatchObject({
        execution: { status: "not_started", retry: "safe", complete: false },
      });
      expect(result.content[0]).toEqual({
        type: "text",
        text: '<tool_execution>\n{"status":"not_started","retry":"safe","complete":false}\n</tool_execution>',
      });
    });

    it("reports cancellation before dispatch as not_started and never calls the manager https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const callTool = jest.fn();
      const bundle = createMcpTools(
        managerStub({ servers: [server({})], toolsByServer: { "srv-1": [SEARCH_TOOL] }, callTool })
      );
      const controller = new AbortController();
      controller.abort();
      const result = await bundle.tools[0].execute("call", { query: "x" }, controller.signal);
      expect(result.details).toMatchObject({
        execution: { status: "not_started", retry: "safe", complete: false },
      });
      expect(callTool).not.toHaveBeenCalled();
    });

    it("keeps the original mixed result for display and exposes public structured content without private metadata https://github.com/ItsDalk-Lane/Scribe/issues/52 https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
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
      expect(first.content.slice(1)).toEqual([
        original.content[0],
        { type: "text", text: JSON.stringify(original.content[1]) },
        {
          type: "text",
          text: '<mcp_structured_content>\n{"answer":42}\n</mcp_structured_content>',
        },
      ]);
      expect(first.structuredContent).toEqual(original.structuredContent);
      expect(first.details).toEqual({
        mcpResult: original,
        execution: { status: "completed", retry: "never", complete: true },
      });
      expect(JSON.stringify(first.content)).not.toContain("original");
      const structured = await bundle.tools[0].execute("call-2", { query: "x" });
      expect(structured.content.slice(1)).toEqual([
        {
          type: "text",
          text: '<mcp_structured_content>\n{"answer":42}\n</mcp_structured_content>',
        },
      ]);
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
      expect(result.content.slice(1)).toEqual([{ type: "text", text: "found 2 notes" }]);
      expect(result.isError).toBe(false);
      expect(result.details).toMatchObject({
        execution: { status: "completed", retry: "never", complete: true },
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
      expect(result.content.slice(1)).toEqual([
        { type: "image", data: "aGVsbG8=", mimeType: "image/jpeg" },
      ]);
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
      expect(result.details).toMatchObject({
        execution: { status: "failed", retry: "verify_before_retry", complete: false },
      });
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
      expect(result.details).toMatchObject({
        execution: { status: "outcome_unknown", retry: "verify_before_retry", complete: false },
      });
    });

    it("reports not_started without dispatching arguments that violate the server's input schema https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
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
      const result = await bundle.tools[0].execute("call-1", { wrong: true });
      expect(result.isError).toBe(true);
      expect(result.details).toMatchObject({
        execution: { status: "not_started", retry: "safe", complete: false },
      });
      expect(JSON.stringify(result.content)).toContain("Invalid arguments");
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
      expect(result.content.slice(1)).toEqual([
        { type: "text", text: '{"type":"audio","data":"AAEC"}' },
      ]);
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
      expect(result.content.slice(1)).toEqual([{ type: "text", text: "(empty result)" }]);
    });
  });
});
