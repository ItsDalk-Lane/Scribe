import { query } from "@anthropic-ai/claude-agent-sdk";
import { testMcpConnection } from "./testMcpConnection";

jest.mock("@anthropic-ai/claude-agent-sdk", () => ({ query: jest.fn() }));

function connection(status: "connected" | "pending" | "failed" | "needs-auth" = "connected") {
  return {
    initializationResult: jest.fn(async () => ({})),
    mcpServerStatus: jest.fn(async () => [{ name: "notes", status, tools: [{ name: "read" }] }]),
    close: jest.fn(),
    async *[Symbol.asyncIterator]() {},
  };
}

describe("testMcpConnection", () => {
  describe("testMcpConnection()", () => {
    afterEach(() => jest.clearAllMocks());
    it("checks a draft with strict isolated MCP settings without sending a model message or invoking tools and always closes the process", async () => {
      const live = connection();
      jest.mocked(query).mockReturnValue(live as unknown as ReturnType<typeof query>);
      const config = {
        type: "http",
        url: "https://notes.example/mcp",
        headers: { Authorization: "private" },
      };
      expect(
        await testMcpConnection({
          name: "notes",
          config,
          binaryPath: "/bin/claude",
          cwd: "/vault",
          env: {},
        })
      ).toEqual({ status: "connected", toolCount: 1 });
      const input = jest.mocked(query).mock.calls[0][0];
      expect(input.options).toMatchObject({
        strictMcpConfig: true,
        settingSources: [],
        allowedTools: [],
        mcpServers: { notes: config },
        cwd: "/vault",
      });
      expect(await input.options!.canUseTool!("read", {}, {} as never)).toMatchObject({
        behavior: "deny",
      });
      const queued = input.prompt as AsyncIterable<unknown>;
      expect(await queued[Symbol.asyncIterator]().next()).toEqual({ done: true, value: undefined });
      expect(live.close).toHaveBeenCalledTimes(1);
    });
    it("preserves authentication and pending states instead of claiming a successful connection", async () => {
      for (const status of ["needs-auth", "pending"] as const) {
        jest
          .mocked(query)
          .mockReturnValue(connection(status) as unknown as ReturnType<typeof query>);
        expect(
          (
            await testMcpConnection({
              name: "notes",
              config: { command: "server" },
              binaryPath: "/bin/claude",
              env: {},
            })
          ).status
        ).toBe(status);
      }
    });
    it("returns safe failures for startup and connection errors without exposing credentials", async () => {
      const live = connection();
      live.mcpServerStatus.mockRejectedValue(new Error("private-token"));
      jest.mocked(query).mockReturnValue(live as unknown as ReturnType<typeof query>);
      const result = await testMcpConnection({
        name: "notes",
        config: { command: "server" },
        binaryPath: "/bin/claude",
        env: {},
      });
      expect(result.status).toBe("failed");
      expect(result.message).not.toContain("private-token");
      expect(live.close).toHaveBeenCalledTimes(1);
      jest.mocked(query).mockImplementation(() => {
        throw new Error("private-token");
      });
      expect(
        (await testMcpConnection({ name: "notes", config: {}, binaryPath: "/bin/claude", env: {} }))
          .status
      ).toBe("failed");
    });
  });
});
