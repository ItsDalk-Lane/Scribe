import {
  canCallMcpToolDirectly,
  isAdvertisedMcpWebSearch,
  mcpDirectToolFingerprint,
} from "@/agentMode/mcp/mcpDirectPolicy";
import type { McpServerConfig, McpToolInfo } from "@/agentMode/mcp/types";

const server: McpServerConfig = {
  id: "srv",
  name: "tools",
  type: "streamableHttp",
  url: "https://mcp.example.com",
  isActive: true,
  createdAt: "",
  updatedAt: "",
};
const tool: McpToolInfo = {
  name: "lookup",
  description: "Reads the team's internal database",
  inputSchema: { type: "object", properties: { term: { type: "string" } } },
};

describe("mcpDirectPolicy", () => {
  describe("isAdvertisedMcpWebSearch()", () => {
    it.each([
      [{ name: "web-search-prime" }, { name: "lookup" }],
      [{ name: "tools" }, { name: "WebSearch" }],
      [{ name: "tools" }, { description: "Search for public results from the Internet" }],
      [{ name: "工具" }, { description: "提供联网搜索能力" }],
    ])(
      "recognizes advertised web search without relying on one vendor name",
      (serverFields, toolFields) => {
        expect(
          isAdvertisedMcpWebSearch({ ...server, ...serverFields }, { ...tool, ...toolFields })
        ).toBe(true);
      }
    );

    it("distinguishes internal search and fetching a known page from web search", () => {
      expect(isAdvertisedMcpWebSearch(server, { ...tool, name: "search_notes" })).toBe(false);
      expect(isAdvertisedMcpWebSearch(server, { ...tool, name: "fetch_url" })).toBe(false);
    });
  });

  describe("mcpDirectToolFingerprint()", () => {
    it("retains confirmation when only auto-approval and execution timeout change", () => {
      expect(
        mcpDirectToolFingerprint(
          { ...server, autoApprovedTools: ["lookup"], timeoutSeconds: 30 },
          tool
        )
      ).toBe(mcpDirectToolFingerprint(server, tool));
    });
  });

  describe("canCallMcpToolDirectly()", () => {
    it("allows an explicitly confirmed ordinary tool", () => {
      const approved = {
        ...server,
        directToolApprovals: { lookup: mcpDirectToolFingerprint(server, tool) },
      };
      expect(canCallMcpToolDirectly(approved, tool)).toBe(true);
    });

    it("withholds unknown tools even if execution was previously auto-approved https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      expect(canCallMcpToolDirectly({ ...server, autoApprovedTools: ["lookup"] }, tool)).toBe(
        false
      );
    });

    it("rejects stale confirmation when the definition or destination changes https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const approved = {
        ...server,
        directToolApprovals: { lookup: mcpDirectToolFingerprint(server, tool) },
      };
      expect(canCallMcpToolDirectly(approved, { ...tool, inputSchema: {} })).toBe(false);
      expect(canCallMcpToolDirectly({ ...approved, url: "https://other.example.com" }, tool)).toBe(
        false
      );
    });

    it("withholds selected and advertised web search even when explicitly confirmed for direct calls https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
      const approved = {
        ...server,
        directToolApprovals: { lookup: mcpDirectToolFingerprint(server, tool) },
      };
      expect(
        canCallMcpToolDirectly(approved, tool, { serverId: server.id, toolName: tool.name })
      ).toBe(false);
      const web = { ...tool, name: "web_search" };
      const incorrectApproval = {
        ...server,
        directToolApprovals: { web_search: mcpDirectToolFingerprint(server, web) },
      };
      expect(canCallMcpToolDirectly(incorrectApproval, web)).toBe(false);
    });
  });
});
