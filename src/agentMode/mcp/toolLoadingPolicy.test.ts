import {
  DEFAULT_MCP_TOOL_LOADING_THRESHOLD_CHARS,
  isMcpToolLoadingMode,
  resolveMcpToolRegistration,
} from "@/agentMode/mcp/toolLoadingPolicy";

describe("toolLoadingPolicy", () => {
  describe("DEFAULT_MCP_TOOL_LOADING_THRESHOLD_CHARS", () => {
    it("defaults to a 4000-character definition budget", () => {
      expect(DEFAULT_MCP_TOOL_LOADING_THRESHOLD_CHARS).toBe(4000);
    });
  });

  describe("isMcpToolLoadingMode()", () => {
    it("accepts the three loading modes", () => {
      expect(isMcpToolLoadingMode("auto")).toBe(true);
      expect(isMcpToolLoadingMode("always")).toBe(true);
      expect(isMcpToolLoadingMode("off")).toBe(true);
    });

    it("rejects unknown loading values", () => {
      expect(isMcpToolLoadingMode("full")).toBe(false);
      expect(isMcpToolLoadingMode(2)).toBe(false);
      expect(isMcpToolLoadingMode(undefined)).toBe(false);
    });
  });

  describe("resolveMcpToolRegistration()", () => {
    it("keeps full registration when the mode is off regardless of the estimate", () => {
      expect(resolveMcpToolRegistration("off", 4000, 100000)).toBe("full");
      expect(resolveMcpToolRegistration("off", 4000, 0)).toBe("full");
    });

    it("defers registration whenever the mode is always", () => {
      expect(resolveMcpToolRegistration("always", 4000, 0)).toBe("deferred");
      expect(resolveMcpToolRegistration("always", 4000, 100000)).toBe("deferred");
    });

    it("keeps full registration below the auto threshold so small setups are unchanged", () => {
      expect(resolveMcpToolRegistration("auto", 4000, 3999)).toBe("full");
      expect(resolveMcpToolRegistration("auto", 4000, 4000)).toBe("full");
    });

    it("defers registration above the auto threshold", () => {
      expect(resolveMcpToolRegistration("auto", 4000, 4001)).toBe("deferred");
    });
  });
});
