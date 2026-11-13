import {
  getMcpServerManager,
  initializeMcpServerManager,
  McpServerManager,
  McpToolCallError,
} from "@/agentMode/mcp/McpServerManager";
import { buildMcpAgentTool } from "@/agentMode/mcp/mcpTools";
import { mcpDirectToolFingerprint } from "@/agentMode/mcp/mcpDirectPolicy";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";

jest.mock("@/settings/model", () => ({
  getSettings: jest.fn(() => ({ mcp: { servers: [] } })),
  subscribeToSettingsChange: jest.fn(() => jest.fn()),
}));
jest.mock("@/services/secretStore", () => ({ SecretStore: { getInstance: jest.fn() } }));
jest.mock("@/logger", () => ({ logError: jest.fn() }));
import type { McpConnectionInput, McpConnectionInstance } from "@/agentMode/mcp/McpServerManager";
import type { McpServerConfig, McpToolInfo } from "@/agentMode/mcp/types";

interface FakeConnection extends McpConnectionInstance {
  input: McpConnectionInput;
  startError?: Error;
  closeCalls: number;
  toolCalls: {
    name: string;
    args: Record<string, unknown> | undefined;
    timeoutSeconds: number;
    resetTimeoutOnProgress: boolean;
    signal?: AbortSignal;
  }[];
}

const SEARCH_TOOL: McpToolInfo = {
  name: "search",
  description: "Search things",
  inputSchema: { type: "object" },
};

function createFakeConnection(): FakeConnection {
  const connection: FakeConnection = {
    input: null as unknown as McpConnectionInput,
    closeCalls: 0,
    toolCalls: [],
    async start() {
      if (connection.startError) throw connection.startError;
      return {
        version: "2.1.0",
        tools: [SEARCH_TOOL],
      };
    },
    async callTool(name, args, timeoutSeconds, resetTimeoutOnProgress, signal) {
      connection.toolCalls.push({ name, args, timeoutSeconds, resetTimeoutOnProgress, signal });
      return { content: [{ type: "text", text: "ok" }] };
    },
    async close() {
      connection.closeCalls++;
    },
  };
  return connection;
}

interface Harness {
  manager: McpServerManager;
  connections: readonly FakeConnection[];
  apply(servers: McpServerConfig[]): Promise<void>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

function waitForSettled(manager: McpServerManager, ids: string[]): Promise<void> {
  return new Promise((resolve) => {
    const check = () => {
      if (ids.some((id) => manager.getState(id)?.status === "connecting")) return;
      unsubscribe();
      resolve();
    };
    const unsubscribe = manager.subscribe(check);
    check();
  });
}

function createHarness(
  queue: FakeConnection[] = [],
  getWebSearchSelection?: () => { serverId: string; toolName: string } | undefined
): Harness {
  const connections: FakeConnection[] = [];
  const manager = new McpServerManager({
    createConnection: (input) => {
      const connection = queue.shift() ?? createFakeConnection();
      connection.input = input;
      connections.push(connection);
      return connection;
    },
    resolveValues: async () => ({ env: {}, headers: {} }),
    clientInfo: { name: "Scribe", version: "1.0.0" },
    getWebSearchSelection,
  });
  return {
    manager,
    connections,
    async apply(servers) {
      await manager.setServers(servers);
      await waitForSettled(
        manager,
        servers.map((server) => server.id)
      );
    },
  };
}

function stdioServer(overrides: Partial<McpServerConfig> = {}): McpServerConfig {
  return {
    id: "srv-1",
    name: "files",
    type: "stdio",
    command: "npx",
    args: ["-y", "server-files"],
    isActive: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function approvedServer(overrides: Partial<McpServerConfig> = {}, tool = SEARCH_TOOL) {
  const server = stdioServer(overrides);
  return {
    ...server,
    directToolApprovals: { [tool.name]: mcpDirectToolFingerprint(server, tool) },
  };
}

describe("McpServerManager", () => {
  describe("McpToolCallError", () => {
    describe("constructor()", () => {
      it("preserves the structured dispatch outcome independently of human wording https://github.com/ItsDalk-Lane/Scribe/issues/70", () => {
        const error = new McpToolCallError("outcome_unknown", "Connection interrupted");
        expect(error).toBeInstanceOf(Error);
        expect(error).toMatchObject({
          name: "McpToolCallError",
          message: "Connection interrupted",
          outcome: "outcome_unknown",
        });
      });
    });
  });
  describe("McpServerManager", () => {
    describe("setServers()", () => {
      it("connects an active server and records version, tools, and state", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        expect(harness.manager.getState("srv-1")?.status).toBe("connected");
        expect(harness.manager.getState("srv-1")?.version).toBe("2.1.0");
        expect(harness.manager.getState("srv-1")?.toolCount).toBe(1);
        expect(harness.manager.getTools("srv-1").map((tool) => tool.name)).toEqual(["search"]);
      });

      it("returns while the handshake is pending and exposes the connecting state", async () => {
        const connection = createFakeConnection();
        const started = deferred<void>();
        const handshake = deferred<Awaited<ReturnType<McpConnectionInstance["start"]>>>();
        connection.start = () => {
          started.resolve();
          return handshake.promise;
        };
        const harness = createHarness([connection]);
        await harness.manager.setServers([stdioServer()]);
        await started.promise;
        expect(harness.manager.getState("srv-1")?.status).toBe("connecting");
        const settled = waitForSettled(harness.manager, ["srv-1"]);
        handshake.resolve({ tools: [] });
        await settled;
        expect(harness.manager.getState("srv-1")?.status).toBe("connected");
      });

      it("closes a handshake immediately when disabled and ignores its late success", async () => {
        const connection = createFakeConnection();
        const started = deferred<void>();
        const handshake = deferred<Awaited<ReturnType<McpConnectionInstance["start"]>>>();
        connection.start = () => {
          started.resolve();
          return handshake.promise;
        };
        const harness = createHarness([connection]);
        await harness.manager.setServers([stdioServer()]);
        await started.promise;
        await harness.manager.setServers([stdioServer({ isActive: false })]);
        expect(connection.closeCalls).toBe(1);
        handshake.resolve({ tools: [{ name: "late", inputSchema: {} }] });
        await handshake.promise;
        expect(harness.manager.getState("srv-1")?.status).toBe("disabled");
        expect(harness.manager.getTools("srv-1")).toEqual([]);
      });

      it("does not create a connection after credentials finish for a removed server", async () => {
        const resolving = deferred<void>();
        const values = deferred<{ env: Record<string, string>; headers: Record<string, string> }>();
        const createConnection = jest.fn(() => createFakeConnection());
        const manager = new McpServerManager({
          createConnection,
          resolveValues: () => {
            resolving.resolve();
            return values.promise;
          },
          clientInfo: { name: "Scribe", version: "1.0.0" },
        });
        await manager.setServers([stdioServer()]);
        await resolving.promise;
        await manager.setServers([]);
        values.resolve({ env: {}, headers: {} });
        await values.promise;
        expect(createConnection).not.toHaveBeenCalled();
        expect(manager.getState("srv-1")).toBeUndefined();
      });

      it("closes a late-created connection without starting it after its server is removed", async () => {
        const creating = deferred<void>();
        const creation = deferred<McpConnectionInstance>();
        const connection = createFakeConnection();
        const start = jest.spyOn(connection, "start");
        const manager = new McpServerManager({
          createConnection: () => {
            creating.resolve();
            return creation.promise;
          },
          resolveValues: async () => ({ env: {}, headers: {} }),
          clientInfo: { name: "Scribe", version: "1.0.0" },
        });
        await manager.setServers([stdioServer()]);
        await creating.promise;
        await manager.setServers([]);
        creation.resolve(connection);
        await creation.promise;
        expect(start).not.toHaveBeenCalled();
        expect(connection.closeCalls).toBe(1);
      });

      it("reports inactive servers as disabled without creating a connection", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer({ isActive: false })]);
        expect(harness.manager.getState("srv-1")?.status).toBe("disabled");
        expect(harness.connections).toHaveLength(0);
      });

      it("stops a server that becomes inactive", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        await harness.apply([stdioServer({ isActive: false })]);
        expect(harness.connections[0].closeCalls).toBe(1);
        expect(harness.manager.getState("srv-1")?.status).toBe("disabled");
        expect(harness.manager.getTools("srv-1")).toEqual([]);
      });

      it("closes and forgets removed servers", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        await harness.apply([]);
        expect(harness.connections[0].closeCalls).toBe(1);
        expect(harness.manager.getState("srv-1")).toBeUndefined();
      });

      it("restarts a running server when connection settings change", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        await harness.apply([stdioServer({ args: ["changed"] })]);
        expect(harness.connections).toHaveLength(2);
        expect(harness.connections[0].closeCalls).toBe(1);
        expect(harness.manager.getState("srv-1")?.status).toBe("connected");
      });

      it("keeps the same connection for display-only changes", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        await harness.apply([stdioServer({ name: "renamed", description: "new" })]);
        expect(harness.connections).toHaveLength(1);
      });

      it("retries an errored connection on the next reconcile", async () => {
        const failing = createFakeConnection();
        failing.startError = new Error("spawn npx ENOENT");
        const harness = createHarness([failing]);
        await harness.apply([stdioServer()]);
        expect(harness.manager.getState("srv-1")?.status).toBe("error");
        expect(harness.manager.getState("srv-1")?.lastError).toContain("ENOENT");
        await harness.apply([stdioServer()]);
        expect(harness.manager.getState("srv-1")?.status).toBe("connected");
        expect(harness.connections).toHaveLength(2);
        expect(harness.connections[0].closeCalls).toBe(1);
      });

      it("marks the server as errored", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        harness.connections[0].input.onUnexpectedClose("process exited with code 1");
        expect(harness.manager.getState("srv-1")?.status).toBe("error");
        expect(harness.manager.getState("srv-1")?.lastError).toBe("process exited with code 1");
      });

      it("closes the retained instance after an unexpected error so no process is left behind", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        const connection = harness.connections[0];
        connection.input.onUnexpectedClose("transport failed");
        expect(connection.closeCalls).toBe(1);
        expect(harness.manager.getState("srv-1")?.status).toBe("error");
        await harness.manager.shutdown();
        expect(connection.closeCalls).toBe(1);
      });

      it("keeps a handshake error after an unexpected close even if startup later succeeds", async () => {
        const connection = createFakeConnection();
        const started = deferred<void>();
        const handshake = deferred<Awaited<ReturnType<McpConnectionInstance["start"]>>>();
        connection.start = () => {
          started.resolve();
          return handshake.promise;
        };
        const harness = createHarness([connection]);
        await harness.manager.setServers([stdioServer()]);
        await started.promise;
        connection.input.onUnexpectedClose("handshake interrupted");
        expect(connection.closeCalls).toBe(1);
        handshake.resolve({ tools: [] });
        await handshake.promise;
        expect(harness.manager.getState("srv-1")?.status).toBe("error");
        expect(harness.manager.getState("srv-1")?.lastError).toBe("handshake interrupted");
      });

      it("ignores close notifications from replaced connections", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        const first = harness.connections[0];
        await harness.apply([stdioServer({ args: ["changed"] })]);
        first.input.onUnexpectedClose("stale exit");
        expect(harness.manager.getState("srv-1")?.status).toBe("connected");
      });
    });

    describe("callTool()", () => {
      it("does not dispatch a directly called MCP tool without a non-search confirmation https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        await expect(
          harness.manager.callTool("srv-1", "search", {}, undefined)
        ).rejects.toMatchObject({
          outcome: "not_started",
        });
        expect(harness.connections[0].toolCalls).toEqual([]);
      });

      it("does not reuse a non-search confirmation after a tool changes its description and schema https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const connection = createFakeConnection();
        connection.listTools = async () => [
          {
            ...SEARCH_TOOL,
            description: "Retrieve different records",
            inputSchema: { type: "object", required: ["q"] },
          },
        ];
        const harness = createHarness([connection]);
        await harness.apply([approvedServer()]);
        connection.input.onToolsChanged?.();
        await waitForSettled(harness.manager, ["srv-1"]);

        expect(harness.manager.getTools("srv-1")[0].description).toBe("Retrieve different records");
        await expect(harness.manager.callTool("srv-1", "search", {})).rejects.toMatchObject({
          outcome: "not_started",
        });
        expect(connection.toolCalls).toEqual([]);
      });

      it("reserves a selected search route even when its alias was previously confirmed for direct use https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const harness = createHarness([], () => ({ serverId: "srv-1", toolName: "search" }));
        await harness.apply([approvedServer()]);

        await expect(harness.manager.callTool("srv-1", "search", {})).rejects.toMatchObject({
          outcome: "not_started",
        });
        expect(harness.connections[0].toolCalls).toEqual([]);
      });

      it("does not dispatch an advertised web search directly even if its current definition was confirmed https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const connection = createFakeConnection();
        const web = { ...SEARCH_TOOL, description: "Search public web pages" };
        connection.start = async () => ({ tools: [web] });
        const harness = createHarness([connection]);
        await harness.apply([approvedServer({}, web)]);

        await expect(harness.manager.callTool("srv-1", "search", {})).rejects.toMatchObject({
          outcome: "not_started",
        });
        expect(connection.toolCalls).toEqual([]);
      });

      it("rejects dispatch as soon as manager shutdown begins https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer()]);
        const shutdown = harness.manager.shutdown();
        try {
          await expect(harness.manager.callTool("srv-1", "search", {})).rejects.toMatchObject({
            outcome: "not_started",
          });
          expect(harness.connections[0].toolCalls).toEqual([]);
        } finally {
          await shutdown;
        }
      });

      it.each(["timeout", "cancel", "disconnect"])(
        "preserves an uncertain remote outcome after controlled %s without automatic replay https://github.com/ItsDalk-Lane/Scribe/issues/70",
        async (failure) => {
          const connection = createFakeConnection();
          const harness = createHarness([connection]);
          const config = approvedServer();
          await harness.apply([config]);
          const started = deferred<void>();
          const response = deferred<never>();
          const call = jest
            .spyOn(connection, "callTool")
            .mockImplementation(async (_name, _args, _timeout, _reset, signal) => {
              started.resolve();
              if (failure === "cancel")
                signal?.addEventListener(
                  "abort",
                  () => response.reject(new Error("Aborted after remote dispatch")),
                  { once: true }
                );
              return response.promise;
            });
          const tool = buildMcpAgentTool(
            config,
            harness.manager.getTools(config.id)[0],
            harness.manager
          );
          const controller = new AbortController();
          const pending = tool.execute("controlled-call", {}, controller.signal);
          await started.promise;
          if (failure === "cancel") controller.abort();
          else {
            if (failure === "disconnect") connection.input.onUnexpectedClose("Transport closed");
            response.reject(
              new Error(
                failure === "timeout" ? "Timed out after remote dispatch" : "Transport closed"
              )
            );
          }
          const result = await pending;
          expect(result.isError).toBe(true);
          expect(result.details).toEqual({
            execution: { status: "outcome_unknown", retry: "verify_before_retry", complete: false },
          });
          expect(result.content[0]).toMatchObject({
            type: "text",
            text: expect.stringContaining('"status":"outcome_unknown"'),
          });
          expect(call).toHaveBeenCalledTimes(1);
          expect(tool.replay).toBe("never");
        }
      );

      it("refuses a configured but disabled tool at final dispatch rather than calling its live connection https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer({ disabledTools: ["search"] })]);
        await expect(harness.manager.callTool("srv-1", "search", {})).rejects.toMatchObject({
          outcome: "not_started",
        });
        expect(harness.connections[0].toolCalls).toEqual([]);
      });

      it("refuses a tool that was not discovered on the current connection https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer()]);
        await expect(harness.manager.callTool("srv-1", "missing", {})).rejects.toMatchObject({
          outcome: "not_started",
        });
        expect(harness.connections[0].toolCalls).toEqual([]);
      });

      it("does not dispatch an already cancelled request https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer()]);
        const controller = new AbortController();
        controller.abort();
        await expect(
          harness.manager.callTool("srv-1", "search", {}, controller.signal)
        ).rejects.toMatchObject({ outcome: "not_started" });
        expect(harness.connections[0].toolCalls).toEqual([]);
      });

      it("marks a thrown connection failure after dispatch as unknown without retrying https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer()]);
        const call = jest
          .spyOn(harness.connections[0], "callTool")
          .mockRejectedValue(new Error("Connection lost after dispatch"));
        await expect(harness.manager.callTool("srv-1", "search", {})).rejects.toMatchObject({
          outcome: "outcome_unknown",
          message: "Connection lost after dispatch",
        });
        expect(call).toHaveBeenCalledTimes(1);
      });

      it("preserves a server-reported business failure as a definite response https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer()]);
        const failure = {
          content: [{ type: "text", text: "The record was not changed." }],
          isError: true,
        };
        jest.spyOn(harness.connections[0], "callTool").mockResolvedValue(failure);
        await expect(harness.manager.callTool("srv-1", "search", {})).resolves.toEqual(failure);
      });

      it("routes the call to the live connection with the configured timeout", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer({ timeoutSeconds: 30 })]);
        const result = await harness.manager.callTool("srv-1", "search", { q: "notes" });
        expect(result).toEqual({ content: [{ type: "text", text: "ok" }] });
        expect(harness.connections[0].toolCalls[0]).toEqual({
          name: "search",
          args: { q: "notes" },
          timeoutSeconds: 30,
          resetTimeoutOnProgress: false,
          signal: undefined,
        });
      });

      it("passes the caller's cancellation signal to the live request", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer()]);
        const controller = new AbortController();
        await harness.manager.callTool("srv-1", "search", { q: "notes" }, controller.signal);
        expect(harness.connections[0].toolCalls[0].signal).toBe(controller.signal);
      });

      it("keeps the configured idle timeout while enabling progress-based resets for long-running servers", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer({ longRunning: true, timeoutSeconds: 30 })]);
        await harness.manager.callTool("srv-1", "search", undefined);
        expect(harness.connections[0].toolCalls[0]).toMatchObject({
          timeoutSeconds: 30,
          resetTimeoutOnProgress: true,
        });
      });

      it("throws when the server is not connected", async () => {
        const harness = createHarness();
        await harness.apply([approvedServer({ isActive: false })]);
        await expect(harness.manager.callTool("srv-1", "search", {})).rejects.toThrow(
          /not connected/
        );
      });
    });

    describe("callWebSearchTool()", () => {
      it("dispatches the current selected search tool without direct tool confirmation", async () => {
        const harness = createHarness([], () => ({ serverId: "srv-1", toolName: "search" }));
        await harness.apply([stdioServer()]);

        const args = { query: "Obsidian documentation" };
        await expect(harness.manager.callWebSearchTool("srv-1", "search", args)).resolves.toEqual({
          content: [{ type: "text", text: "ok" }],
        });
        expect(harness.connections[0].toolCalls).toEqual([
          expect.objectContaining({ name: "search", args }),
        ]);
      });

      it("refuses a search call once a different route is selected https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const selection = { serverId: "srv-1", toolName: "search" };
        const harness = createHarness([], () => selection);
        await harness.apply([stdioServer()]);
        selection.toolName = "other";

        await expect(
          harness.manager.callWebSearchTool("srv-1", "search", {})
        ).rejects.toMatchObject({
          outcome: "not_started",
        });
        expect(harness.connections[0].toolCalls).toEqual([]);
      });
    });

    describe("signature()", () => {
      it("leaves tools unavailable after discovery failure and recovers on a later notification https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const connection = createFakeConnection();
        connection.listTools = jest
          .fn()
          .mockRejectedValueOnce(new Error("Catalog refresh timed out"))
          .mockResolvedValueOnce([{ name: "replacement", inputSchema: { type: "object" } }]);
        const harness = createHarness([connection]);
        await harness.apply([stdioServer()]);
        connection.input.onToolsChanged?.();
        await waitForSettled(harness.manager, ["srv-1"]);
        expect(harness.manager.getState("srv-1")).toMatchObject({
          status: "error",
          lastError: "Catalog refresh timed out",
        });
        expect(harness.manager.getTools("srv-1")).toEqual([]);
        connection.input.onToolsChanged?.();
        await waitForSettled(harness.manager, ["srv-1"]);
        expect(harness.manager.getTools("srv-1").map((tool) => tool.name)).toEqual(["replacement"]);
      });

      it("ignores a notified catalog reply after the server was disabled https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const connection = createFakeConnection();
        const reply = deferred<readonly McpToolInfo[]>();
        connection.listTools = () => reply.promise;
        const harness = createHarness([connection]);
        await harness.apply([stdioServer()]);
        connection.input.onToolsChanged?.();
        await harness.apply([stdioServer({ isActive: false })]);
        reply.resolve([{ name: "late", inputSchema: { type: "object" } }]);
        await reply.promise;
        expect(harness.manager.getState("srv-1")?.status).toBe("disabled");
        expect(harness.manager.getTools("srv-1")).toEqual([]);
      });

      it("withdraws an outdated remote catalog until the latest notified snapshot is available https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const connection = createFakeConnection();
        const first = deferred<readonly McpToolInfo[]>();
        const second = deferred<readonly McpToolInfo[]>();
        const secondStarted = deferred<void>();
        connection.listTools = jest
          .fn()
          .mockReturnValueOnce(first.promise)
          .mockImplementationOnce(() => {
            secondStarted.resolve();
            return second.promise;
          });
        const harness = createHarness([connection]);
        await harness.apply([stdioServer()]);
        const oldSignature = harness.manager.signature();

        connection.input.onToolsChanged?.();
        expect(harness.manager.getTools("srv-1")).toEqual([]);
        await expect(harness.manager.callTool("srv-1", "search", {})).rejects.toMatchObject({
          outcome: "not_started",
        });
        connection.input.onToolsChanged?.();
        first.resolve([{ name: "obsolete", inputSchema: { type: "object" } }]);
        await secondStarted.promise;
        expect(harness.manager.getTools("srv-1")).toEqual([]);
        const settled = waitForSettled(harness.manager, ["srv-1"]);
        second.resolve([
          { name: "search", inputSchema: { type: "object", required: ["newQuery"] } },
        ]);
        await settled;
        expect(harness.manager.getTools("srv-1")[0].inputSchema.required).toEqual(["newQuery"]);
        expect(harness.manager.signature()).not.toBe(oldSignature);
      });

      it("changes when a reconnect replaces a tool schema without changing count or version https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const original = createFakeConnection();
        const replacement = createFakeConnection();
        replacement.start = async () => ({
          version: "2.1.0",
          tools: [
            {
              name: "search",
              description: "Search things",
              inputSchema: { type: "object", required: ["newQuery"] },
            },
          ],
        });
        const harness = createHarness([original, replacement]);
        await harness.apply([stdioServer()]);
        const priorSignature = harness.manager.signature();
        original.input.onUnexpectedClose("Transport closed");
        await harness.apply([stdioServer()]);
        expect(harness.manager.getTools("srv-1")[0].inputSchema.required).toEqual(["newQuery"]);
        expect(harness.manager.signature()).not.toBe(priorSignature);
      });

      it("changes after a server rename so existing chats refresh their model-visible tool names without reconnecting", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        const before = harness.manager.signature();
        await harness.apply([stdioServer({ name: "renamed" })]);
        expect(harness.manager.signature()).not.toBe(before);
        expect(harness.connections).toHaveLength(1);
      });

      it("refreshes chat capabilities after search classification or direct confirmation changes without reconnecting https://github.com/ItsDalk-Lane/Scribe/issues/70", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        const unconfirmed = harness.manager.signature();
        const confirmed = approvedServer();
        await harness.apply([confirmed]);
        expect(harness.manager.signature()).not.toBe(unconfirmed);
        const afterConfirmation = harness.manager.signature();
        await harness.apply([{ ...confirmed, description: "Search public web pages" }]);
        expect(harness.manager.signature()).not.toBe(afterConfirmation);
        expect(harness.connections).toHaveLength(1);
      });

      it("changes when status, tool count, or tool settings change", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer({ isActive: false })]);
        const disabled = harness.manager.signature();
        await harness.apply([stdioServer()]);
        const connected = harness.manager.signature();
        expect(connected).not.toBe(disabled);
        await harness.apply([stdioServer({ autoApprovedTools: ["search"] })]);
        expect(harness.manager.signature()).not.toBe(connected);
      });
    });

    describe("subscribe()", () => {
      it("notifies on every reconcile and supports unsubscribe", async () => {
        const harness = createHarness();
        let notifications = 0;
        const unsubscribe = harness.manager.subscribe(() => {
          notifications++;
        });
        await harness.apply([stdioServer({ isActive: false })]);
        expect(notifications).toBe(1);
        unsubscribe();
        await harness.apply([stdioServer()]);
        expect(notifications).toBe(1);
      });
    });

    describe("shutdown()", () => {
      it("closes a connection whose handshake is still pending and never publishes its late tools", async () => {
        const connection = createFakeConnection();
        const started = deferred<void>();
        const handshake = deferred<Awaited<ReturnType<McpConnectionInstance["start"]>>>();
        connection.start = () => {
          started.resolve();
          return handshake.promise;
        };
        const harness = createHarness([connection]);
        await harness.manager.setServers([stdioServer()]);
        await started.promise;
        await harness.manager.shutdown();
        expect(connection.closeCalls).toBe(1);
        handshake.resolve({ tools: [{ name: "late", inputSchema: {} }] });
        await handshake.promise;
        expect(harness.manager.getState("srv-1")?.status).toBe("disabled");
        expect(harness.manager.getTools("srv-1")).toEqual([]);
      });

      it("closes every connection and ignores later reconcile requests", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        await harness.manager.shutdown();
        expect(harness.connections[0].closeCalls).toBe(1);
        await harness.apply([stdioServer({ args: ["changed"] })]);
        expect(harness.connections).toHaveLength(1);
      });
    });
    describe("getRevision()", () => {
      it("advances when a new server state becomes observable", async () => {
        const harness = createHarness();
        expect(harness.manager.getRevision()).toBe(0);
        await harness.apply([stdioServer({ isActive: false })]);
        expect(harness.manager.getRevision()).toBe(1);
      });
    });

    describe("getState()", () => {
      it("returns the configured server's live state and no state for unknown servers", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        expect(harness.manager.getState("srv-1")).toMatchObject({
          serverId: "srv-1",
          status: "connected",
          toolCount: 1,
        });
        expect(harness.manager.getState("missing")).toBeUndefined();
      });
    });

    describe("listStates()", () => {
      it("returns state copies without allowing list edits to change a server", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        const states = harness.manager.listStates();
        states[0].status = "disabled";
        expect(harness.manager.getState("srv-1")?.status).toBe("connected");
      });
    });

    describe("getTools()", () => {
      it("returns discovered tools and a shared stable empty result for unknown servers", async () => {
        const harness = createHarness();
        expect(harness.manager.getTools("missing")).toBe(harness.manager.getTools("other"));
        await harness.apply([stdioServer()]);
        expect(harness.manager.getTools("srv-1").map((tool) => tool.name)).toEqual(["search"]);
      });
    });

    describe("listEnabledServers()", () => {
      it("lists active configurations in their configured order and omits disabled servers", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer(), stdioServer({ id: "disabled", isActive: false })]);
        expect(harness.manager.listEnabledServers().map((server) => server.id)).toEqual(["srv-1"]);
      });
    });

    describe("listServerStatuses()", () => {
      it("lists live status and tool counts for both connected and disabled servers", async () => {
        const harness = createHarness();
        await harness.apply([
          stdioServer(),
          stdioServer({ id: "disabled", name: "off", isActive: false }),
        ]);
        expect(harness.manager.listServerStatuses()).toEqual([
          { name: "files", status: "connected", toolCount: 1 },
          { name: "off", status: "disabled", toolCount: 0 },
        ]);
      });
    });
  });

  describe("initializeMcpServerManager()", () => {
    it("reuses the live manager for the same vault", async () => {
      const app = {} as never;
      const callbacks: (() => void)[] = [];
      const plugin = { register: (callback: () => void) => callbacks.push(callback) };
      const manager = initializeMcpServerManager(app, plugin);
      expect(initializeMcpServerManager(app, plugin)).toBe(manager);
      expect(getMcpServerManager(app)).toBe(manager);
      expect(callbacks).toHaveLength(1);
      callbacks[0]();
      await manager.shutdown();
    });

    it("unsubscribes settings on unload and preserves a replacement while the previous shutdown finishes", async () => {
      const unsubscribe = jest.fn();
      jest.mocked(subscribeToSettingsChange).mockReturnValueOnce(unsubscribe);
      jest.mocked(getSettings).mockReturnValue({ mcp: { servers: [] } } as never);
      const app = {} as never;
      const callbacks: (() => void)[] = [];
      const plugin = { register: (callback: () => void) => callbacks.push(callback) };
      const first = initializeMcpServerManager(app, plugin);
      const stopping = deferred<void>();
      jest.spyOn(first, "shutdown").mockReturnValue(stopping.promise);
      callbacks[0]();
      expect(unsubscribe).toHaveBeenCalledTimes(1);
      expect(getMcpServerManager(app)).toBeNull();
      const replacement = initializeMcpServerManager(app, plugin);
      expect(replacement).not.toBe(first);
      stopping.resolve();
      await stopping.promise;
      expect(getMcpServerManager(app)).toBe(replacement);
      callbacks[1]();
      await replacement.shutdown();
    });
  });

  describe("getMcpServerManager()", () => {
    it("returns no manager before the vault has initialized", () => {
      expect(getMcpServerManager({} as never)).toBeNull();
    });
  });
});
