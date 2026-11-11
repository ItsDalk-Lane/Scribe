import type { AgentTool } from "@earendil-works/pi-agent-core";
import { DeferredMcpToolRegistry } from "@/agentMode/mcp/deferredMcpTools";
import { createMcpTools } from "@/agentMode/mcp/mcpTools";
import type { McpServerManager } from "@/agentMode/mcp/McpServerManager";
import type { McpServerConfig, McpToolCallResult, McpToolInfo } from "@/agentMode/mcp/types";
import { createToolSearchTool } from "@/agentMode/sdk/nativeToolSearch";
import { getNativeToolPolicy } from "@/agentMode/sdk/nativeToolDefinition";

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
    callTool:
      callTool ??
      (async (_serverId, name) => ({ content: [{ type: "text", text: `${name} done` }] })),
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

const SCHEMA = {
  type: "object",
  properties: { url: { type: "string" } },
  required: ["url"],
};

function fixtureManager(): McpServerManager {
  return managerStub({
    servers: [
      server({ autoApprovedTools: ["search"], disabledTools: ["hidden"] }),
      server({ id: "srv-2", name: "web", type: "sse", url: "https://example.invalid/sse" }),
    ],
    toolsByServer: {
      "srv-1": [
        { name: "search", description: "Search notes.", inputSchema: {} },
        { name: "hidden", description: "Disabled tool.", inputSchema: {} },
      ],
      "srv-2": [{ name: "fetch_page", description: "Fetch a web page.", inputSchema: SCHEMA }],
    },
  });
}

interface HooksSpy {
  registered: Array<{ tool: AgentTool; autoApproved: boolean }>;
  selected: string[];
}

function toolSearchFixture() {
  const manager = fixtureManager();
  const registry = DeferredMcpToolRegistry.fromManager(manager);
  const spy: HooksSpy = { registered: [], selected: [] };
  const tool = createToolSearchTool({
    catalog: registry,
    registerTool: (registered, autoApproved) => {
      spy.registered.push({ tool: registered, autoApproved });
    },
    selections: {
      names: () => spy.selected,
      select: (name) => {
        spy.selected.push(name);
      },
    },
  });
  return { registry, tool, spy, manager };
}

function textOf(result: { content: ReadonlyArray<{ type: string; text?: string }> }): string {
  return result.content.map((part) => ("text" in part ? part.text : "")).join("");
}

describe("nativeToolSearch", () => {
  describe("createToolSearchTool()", () => {
    it("registers under the reserved tool_search name with a read-only schema", () => {
      const { tool } = toolSearchFixture();
      expect(tool.name).toBe("tool_search");
      expect(tool.parameters).toMatchObject({ type: "object" });
    });

    it("declares trusted read policy but serializes catalog mutation and excludes skill-authoring sessions https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const { tool } = toolSearchFixture();
      expect(getNativeToolPolicy(tool)).toEqual({ kind: "read", skillAuthoring: false });
      expect(tool.executionMode).toBe("sequential");
    });

    it("rejects calls that pass neither a query nor a select", async () => {
      const { tool } = toolSearchFixture();
      const result = await tool.execute("call-1", {});
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("query");
    });

    it("rejects calls that pass both a query and a select at once", async () => {
      const { tool } = toolSearchFixture();
      const result = await tool.execute("call-1", {
        query: "fetch",
        select: "mcp__web__fetch_page",
      });
      expect(result.isError).toBe(true);
    });

    describe("select", () => {
      it("does not remember a selection when runtime registration rejects its role eligibility https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const registry = DeferredMcpToolRegistry.fromManager(fixtureManager());
        const selected: string[] = [];
        const tool = createToolSearchTool({
          catalog: registry,
          registerTool: () => {
            throw new Error("This role cannot register that tool.");
          },
          selections: {
            names: () => selected,
            select: (name) => {
              selected.push(name);
            },
          },
        });
        await expect(tool.execute("call", { select: "mcp__web__fetch_page" })).rejects.toThrow(
          "role cannot register"
        );
        expect(selected).toEqual([]);
      });

      it("registers the selected tool for the next model step and returns its full parameter documentation https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const { tool, spy } = toolSearchFixture();
        const result = await tool.execute("call-1", {
          select: "select:mcp__web__fetch_page",
        });
        expect(spy.selected).toEqual(["mcp__web__fetch_page"]);
        expect(spy.registered).toHaveLength(1);
        expect(spy.registered[0].tool.name).toBe("mcp__web__fetch_page");
        expect(spy.registered[0].tool.parameters).toEqual(SCHEMA);
        expect(spy.registered[0].autoApproved).toBe(false);
        const text = textOf(result);
        expect(text).toContain("mcp__web__fetch_page");
        expect(text).toContain("url");
        expect(text).not.toMatch(/isError/);
        expect(text).toContain("next model step");
      });

      it("marks the registration as auto-approved when the server allows the tool", async () => {
        const { tool, spy } = toolSearchFixture();
        await tool.execute("call-1", { select: "mcp__files__search" });
        expect(spy.registered[0].autoApproved).toBe(true);
      });

      it("lists the available catalog names when the select misses", async () => {
        const { tool, spy } = toolSearchFixture();
        const result = await tool.execute("call-1", { select: "mcp__web__fetchpage" });
        expect(spy.registered).toHaveLength(0);
        const text = textOf(result);
        expect(text).toContain("mcp__web__fetch_page");
        expect(text).toContain("mcp__files__search");
      });

      it("does not register twice when the tool was already selected", async () => {
        const { tool, spy } = toolSearchFixture();
        await tool.execute("call-1", { select: "mcp__web__fetch_page" });
        const result = await tool.execute("call-2", { select: "mcp__web__fetch_page" });
        expect(spy.registered).toHaveLength(1);
        expect(textOf(result)).toContain("mcp__web__fetch_page");
      });
    });

    describe("query", () => {
      it("returns matching entries with their server ownership and descriptions", async () => {
        const { tool } = toolSearchFixture();
        const result = await tool.execute("call-1", { query: "fetch" });
        const text = textOf(result);
        expect(text).toContain("mcp__web__fetch_page");
        expect(text).toContain("Fetch a web page.");
        expect(text).toContain("select:");
      });

      it("reports when nothing matches instead of returning an empty list", async () => {
        const { tool } = toolSearchFixture();
        const result = await tool.execute("call-1", { query: "calendar" });
        expect(result.isError).toBe(true);
        expect(textOf(result)).toContain("calendar");
      });
    });
  });

  describe("deferred MCP full flow", () => {
    function largeCatalogManager(): McpServerManager {
      const tools: McpToolInfo[] = Array.from({ length: 24 }, (_, index) => ({
        name: `search${index}`,
        description: "Search notes deeply.",
        inputSchema: {},
      }));
      return managerStub({ servers: [server({})], toolsByServer: { "srv-1": tools } });
    }

    it("keeps unselected tool definitions out of the registered set until they are selected", async () => {
      const manager = fixtureManager();
      const registry = DeferredMcpToolRegistry.fromManager(manager);
      const deferred = createMcpTools(manager, { registry, selectedNames: [] });
      expect(deferred.tools.map((tool) => tool.name)).toEqual([]);

      const selected = createMcpTools(manager, {
        registry,
        selectedNames: ["mcp__web__fetch_page"],
      });
      expect(selected.tools.map((tool) => tool.name)).toEqual(["mcp__web__fetch_page"]);
    });

    it("carries server auto-approval into the selected tool registration", async () => {
      const manager = fixtureManager();
      const registry = DeferredMcpToolRegistry.fromManager(manager);
      const selected = createMcpTools(manager, {
        registry,
        selectedNames: ["mcp__files__search", "mcp__web__fetch_page"],
      });
      expect([...selected.autoApprovedTools]).toEqual(["mcp__files__search"]);
    });

    it("searches, selects, and executes a mocked server tool through the registered tool", async () => {
      const manager = fixtureManager();
      const registry = DeferredMcpToolRegistry.fromManager(manager);
      const sessionTools: AgentTool[] = createMcpTools(manager, {
        registry,
        selectedNames: [],
      }).tools.slice();
      const selected: string[] = [];
      const toolSearch = createToolSearchTool({
        catalog: registry,
        registerTool: (registered) => {
          sessionTools.push(registered);
        },
        selections: {
          names: () => selected,
          select: (name) => {
            selected.push(name);
          },
        },
      });
      sessionTools.push(toolSearch);

      const searchResult = await toolSearch.execute("call-1", { query: "fetch_page" });
      expect(textOf(searchResult)).toContain("mcp__web__fetch_page");

      await toolSearch.execute("call-2", { select: "mcp__web__fetch_page" });
      const registered = sessionTools.find((tool) => tool.name === "mcp__web__fetch_page");
      expect(registered).toBeDefined();
      const result = await registered!.execute("call-3", { url: "https://example.invalid/a" });
      expect(result.content).toEqual([
        {
          type: "text",
          text: '<tool_execution>\n{"status":"completed","retry":"never","complete":true}\n</tool_execution>',
        },
        { type: "text", text: "fetch_page done" },
      ]);
      expect(result.isError).toBe(false);
    });

    it("caps search results at the limit and notes the truncation", async () => {
      const manager = largeCatalogManager();
      const registry = DeferredMcpToolRegistry.fromManager(manager);
      const toolSearch = createToolSearchTool({
        catalog: registry,
        registerTool: () => {},
        selections: { names: () => [], select: () => {} },
      });
      const result = await toolSearch.execute("call-1", { query: "search" });
      const text = textOf(result);
      expect(text).toContain("More tools also matched");
    });

    it("never offers a disabled tool through search or the catalog", async () => {
      const manager = managerStub({
        servers: [server({ disabledTools: ["hidden"] })],
        toolsByServer: {
          "srv-1": [
            { name: "search", description: "Search notes.", inputSchema: {} },
            { name: "hidden", description: "Disabled tool.", inputSchema: {} },
          ],
        },
      });
      const registry = DeferredMcpToolRegistry.fromManager(manager);
      const toolSearch = createToolSearchTool({
        catalog: registry,
        registerTool: () => {},
        selections: { names: () => [], select: () => {} },
      });
      expect(registry.find("mcp__files__hidden")).toBeUndefined();
      const result = await toolSearch.execute("call-1", { query: "hidden" });
      expect(result.isError).toBe(true);
    });
  });
});
