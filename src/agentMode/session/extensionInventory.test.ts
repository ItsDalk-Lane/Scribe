import type { AgentExtensionRuntimeSnapshot } from "./extensionInventory";
import { hasPendingMcpServers, markPendingMcpServersUnconfirmed } from "./extensionInventory";

function runtimeWith(
  servers: readonly { name: string; status: string; toolCount?: number }[] | null
): AgentExtensionRuntimeSnapshot {
  return {
    commands: [],
    skills: null,
    plugins: null,
    failedPlugins: null,
    mcpServers: servers as AgentExtensionRuntimeSnapshot["mcpServers"],
  };
}

describe("extensionInventory", () => {
  describe("hasPendingMcpServers()", () => {
    it("is true only while some server is still connecting (https://github.com/ItsDalk-Lane/Scribe/issues/3)", () => {
      expect(hasPendingMcpServers(runtimeWith([{ name: "a", status: "connected" }]))).toBe(false);
      expect(hasPendingMcpServers(runtimeWith([]))).toBe(false);
      expect(
        hasPendingMcpServers(
          runtimeWith([
            { name: "zread", status: "connected" },
            { name: "slow", status: "pending" },
          ])
        )
      ).toBe(true);
    });
    it("treats a missing server list as settled", () => {
      expect(hasPendingMcpServers(runtimeWith(null))).toBe(false);
    });
  });
  describe("markPendingMcpServersUnconfirmed()", () => {
    it("rewrites only the still-connecting servers and keeps the rest untouched (https://github.com/ItsDalk-Lane/Scribe/issues/3)", () => {
      const runtime = runtimeWith([
        { name: "zread", status: "pending" },
        { name: "notes", status: "connected", toolCount: 2 },
      ]);
      expect(markPendingMcpServersUnconfirmed(runtime)).toEqual(
        runtimeWith([
          { name: "zread", status: "unconfirmed" },
          { name: "notes", status: "connected", toolCount: 2 },
        ])
      );
    });
    it("returns the snapshot unchanged when nothing is connecting", () => {
      const runtime = runtimeWith([{ name: "notes", status: "connected", toolCount: 2 }]);
      expect(markPendingMcpServersUnconfirmed(runtime)).toBe(runtime);
    });
  });
});
