import {
  DeferredMcpToolRegistry,
  buildMcpToolCatalogBlock,
  type DeferredMcpToolEntry,
} from "@/agentMode/mcp/deferredMcpTools";
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

function registryWith(overrides: Partial<ManagerStubInput> = {}): {
  registry: DeferredMcpToolRegistry;
  manager: McpServerManager;
} {
  const manager = managerStub({
    servers: [server({})],
    toolsByServer: { "srv-1": [SEARCH_TOOL] },
    ...overrides,
  });
  return { registry: DeferredMcpToolRegistry.fromManager(manager), manager };
}

describe("deferredMcpTools", () => {
  describe("DeferredMcpToolRegistry", () => {
    describe("fromManager()", () => {
      it("rejects a collision between different server and tool components before a deferred catalog is published https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
        expect(() =>
          registryWith({
            servers: [server({ name: "a__b" }), server({ id: "srv-2", name: "a" })],
            toolsByServer: {
              "srv-1": [{ name: "c", inputSchema: {} }],
              "srv-2": [{ name: "b__c", inputSchema: {} }],
            },
          })
        ).toThrow("Duplicate MCP tool name: mcp__a__b__c");
      });

      it("lists every enabled server tool as a deferred entry with its server ownership", () => {
        const { registry } = registryWith();
        expect(registry.list()).toEqual([
          {
            qualifiedName: "mcp__files__search",
            serverId: "srv-1",
            serverName: "files",
            toolName: "search",
            description: "Search notes.",
            inputSchema: SEARCH_TOOL.inputSchema,
            autoApproved: false,
          },
        ] satisfies DeferredMcpToolEntry[]);
      });

      it("excludes tools disabled on their server", () => {
        const { registry } = registryWith({
          servers: [server({ disabledTools: ["search"] })],
          toolsByServer: { "srv-1": [SEARCH_TOOL, { name: "ping", inputSchema: {} }] },
        });
        expect(registry.list().map((entry) => entry.qualifiedName)).toEqual(["mcp__files__ping"]);
      });

      it("only indexes servers that are active", () => {
        const { registry } = registryWith({
          servers: [server({}), server({ id: "srv-2", name: "off", isActive: false })],
          toolsByServer: { "srv-1": [SEARCH_TOOL], "srv-2": [{ name: "hidden", inputSchema: {} }] },
        });
        expect(registry.list().map((entry) => entry.qualifiedName)).toEqual(["mcp__files__search"]);
      });

      it("records the server-level auto-approval membership on the entry", () => {
        const { registry } = registryWith({
          servers: [server({ autoApprovedTools: ["search"] })],
        });
        expect(registry.list()[0].autoApproved).toBe(true);
      });
    });

    describe("find()", () => {
      it("resolves an entry by qualified name", () => {
        const { registry } = registryWith();
        expect(registry.find("mcp__files__search")?.toolName).toBe("search");
      });

      it("returns undefined for an unknown qualified name", () => {
        const { registry } = registryWith();
        expect(registry.find("mcp__files__missing")).toBeUndefined();
      });
    });

    describe("search()", () => {
      it("matches case-insensitively against the tool name", () => {
        const { registry } = registryWith();
        expect(registry.search("SEARCH", 20).entries.map((entry) => entry.qualifiedName)).toEqual([
          "mcp__files__search",
        ]);
      });

      it("matches against the description and the server name", () => {
        const { registry } = registryWith();
        expect(registry.search("notes", 20).entries).toHaveLength(1);
        expect(registry.search("files", 20).entries).toHaveLength(1);
      });

      it("requires every whitespace-separated token to match", () => {
        const { registry } = registryWith();
        expect(registry.search("search notes", 20).entries).toHaveLength(1);
        expect(registry.search("search calendar", 20).entries).toHaveLength(0);
      });

      it("reports truncation when more entries match than the limit", () => {
        const tools: McpToolInfo[] = Array.from({ length: 3 }, (_, index) => ({
          name: `search${index}`,
          description: "Search notes.",
          inputSchema: {},
        }));
        const { registry } = registryWith({ toolsByServer: { "srv-1": tools } });
        const result = registry.search("notes", 2);
        expect(result.entries).toHaveLength(2);
        expect(result.truncated).toBe(true);
      });

      it("keeps entries without a description searchable by name only", () => {
        const { registry } = registryWith({
          toolsByServer: { "srv-1": [{ name: "ping", inputSchema: {} }] },
        });
        expect(registry.search("ping", 20).entries).toHaveLength(1);
      });
    });

    describe("catalogLines()", () => {
      it("renders one qualified-name line with a short description per tool", () => {
        const { registry } = registryWith();
        expect(registry.catalogLines()).toEqual(["mcp__files__search — Search notes."]);
      });

      it("collapses multiline descriptions into a single catalog line", () => {
        const { registry } = registryWith({
          toolsByServer: {
            "srv-1": [{ name: "noisy", description: "First line.\nSecond line.", inputSchema: {} }],
          },
        });
        expect(registry.catalogLines()).toEqual(["mcp__files__noisy — First line. Second line."]);
      });
    });

    describe("estimateDefinitionChars()", () => {
      it("sums the serialized name, description, and schema length of every entry", () => {
        const { registry } = registryWith();
        const entry = registry.list()[0];
        const expected = JSON.stringify({
          name: entry.qualifiedName,
          description: entry.description,
          parameters: entry.inputSchema,
        }).length;
        expect(registry.estimateDefinitionChars()).toBe(expected);
      });
    });

    describe("buildTool()", () => {
      it("builds a full agent tool that routes execution to its server", async () => {
        const callTool = jest.fn(
          async (): Promise<McpToolCallResult> => ({
            content: [{ type: "text", text: "found 2 notes" }],
          })
        );
        const { registry } = registryWith({ callTool });
        const entry = registry.list()[0];
        const tool = registry.buildTool(entry);
        expect(tool).toMatchObject({
          name: "mcp__files__search",
          label: "search",
          description: "Search notes.",
        });
        expect(tool.parameters).toEqual(SEARCH_TOOL.inputSchema);
        const controller = new AbortController();
        const result = await tool.execute("call-1", { query: "notes" }, controller.signal);
        expect(callTool).toHaveBeenCalledWith(
          "srv-1",
          "search",
          { query: "notes" },
          controller.signal
        );
        expect(result.content).toEqual([
          {
            type: "text",
            text: '<tool_execution>\n{"status":"completed","retry":"never","complete":true}\n</tool_execution>',
          },
          { type: "text", text: "found 2 notes" },
        ]);
      });
    });
  });

  describe("buildMcpToolCatalogBlock()", () => {
    it("wraps the one-line catalog entries in a dedicated block with selection guidance", () => {
      const { registry } = registryWith();
      const block = buildMcpToolCatalogBlock(registry);
      expect(block).toContain("<mcp_tool_catalog>");
      expect(block).toContain("mcp__files__search — Search notes.");
      expect(block).toContain("tool_search");
    });

    it("returns null when the catalog is empty so no block is injected", () => {
      const { registry } = registryWith({ toolsByServer: { "srv-1": [] } });
      expect(buildMcpToolCatalogBlock(registry)).toBeNull();
    });
  });
});
