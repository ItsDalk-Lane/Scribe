import { routeWebSearch } from "@/agentMode/sdk/webSearchRouter";

describe("webSearchRouter", () => {
  describe("routeWebSearch()", () => {
    const signal = new AbortController().signal;

    it("uses only the preferred source when it returns a valid empty result", async () => {
      const builtin = jest.fn(async () => ({ text: "built-in results" }));
      const mcp = jest.fn(async () => ({ text: '{"results":[]}' }));
      const skill = jest.fn(async () => ({ text: "skill results" }));
      await expect(
        routeWebSearch("mcp", { builtin, mcp, skill }, "call", "query", signal)
      ).resolves.toEqual({
        text: '{"results":[]}',
        source: "mcp",
        failures: [],
      });
      expect(mcp).toHaveBeenCalledWith("call", "query", signal);
      expect(builtin).not.toHaveBeenCalled();
      expect(skill).not.toHaveBeenCalled();
    });

    it("tries each configured backup in order only after confirmed failure https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const calls: string[] = [];
      const routes = {
        skill: async () => {
          calls.push("skill");
          return { failure: "exit 1" };
        },
        builtin: async () => {
          calls.push("builtin");
          return { failure: "HTTP 403" };
        },
        mcp: async () => {
          calls.push("mcp");
          return { text: "search result" };
        },
      };
      await expect(routeWebSearch("skill", routes, "call", "query", signal)).resolves.toEqual({
        text: "search result",
        source: "mcp",
        failures: ["skill: exit 1", "builtin: HTTP 403"],
      });
      expect(calls).toEqual(["skill", "builtin", "mcp"]);
    });

    it("reports an unavailable preferred source before using the available backup", async () => {
      await expect(
        routeWebSearch(
          "mcp",
          { builtin: async () => ({ text: "search result" }) },
          "call",
          "query",
          signal
        )
      ).resolves.toEqual({
        text: "search result",
        source: "builtin",
        failures: ["mcp: No search source configured."],
      });
    });

    it("never sends the query to a backup after cancellation or an indeterminate outcome https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
      const builtin = jest.fn();
      const cancellation = new AbortController();
      const skill = async () => {
        cancellation.abort();
        return { failure: "terminated" };
      };
      const mcp = async () => {
        throw new Error("Outcome unknown");
      };
      await expect(
        routeWebSearch("skill", { skill, builtin }, "call", "query", cancellation.signal)
      ).rejects.toThrow();
      await expect(
        routeWebSearch("mcp", { mcp, builtin }, "call", "query", signal)
      ).rejects.toThrow("Outcome unknown");
      expect(builtin).not.toHaveBeenCalled();
    });
  });
});
