import {
  getMcpServerManager,
  initializeMcpServerManager,
  McpServerManager,
} from "@/agentMode/mcp/McpServerManager";
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

function createFakeConnection(): FakeConnection {
  const connection: FakeConnection = {
    input: null as unknown as McpConnectionInput,
    closeCalls: 0,
    toolCalls: [],
    async start() {
      if (connection.startError) throw connection.startError;
      return {
        version: "2.1.0",
        tools: [
          { name: "search", description: "Search things", inputSchema: { type: "object" } },
        ] satisfies McpToolInfo[],
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

function createHarness(queue: FakeConnection[] = []): Harness {
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

describe("McpServerManager", () => {
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
      it("routes the call to the live connection with the configured timeout", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer({ timeoutSeconds: 30 })]);
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
        await harness.apply([stdioServer()]);
        const controller = new AbortController();
        await harness.manager.callTool("srv-1", "search", { q: "notes" }, controller.signal);
        expect(harness.connections[0].toolCalls[0].signal).toBe(controller.signal);
      });

      it("keeps the configured idle timeout while enabling progress-based resets for long-running servers", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer({ longRunning: true, timeoutSeconds: 30 })]);
        await harness.manager.callTool("srv-1", "search", undefined);
        expect(harness.connections[0].toolCalls[0]).toMatchObject({
          timeoutSeconds: 30,
          resetTimeoutOnProgress: true,
        });
      });

      it("throws when the server is not connected", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer({ isActive: false })]);
        await expect(harness.manager.callTool("srv-1", "search", {})).rejects.toThrow(
          /not connected/
        );
      });
    });

    describe("signature()", () => {
      it("changes after a server rename so existing chats refresh their model-visible tool names without reconnecting", async () => {
        const harness = createHarness();
        await harness.apply([stdioServer()]);
        const before = harness.manager.signature();
        await harness.apply([stdioServer({ name: "renamed" })]);
        expect(harness.manager.signature()).not.toBe(before);
        expect(harness.connections).toHaveLength(1);
        const renamed = harness.manager.signature();
        await harness.apply([stdioServer({ name: "renamed", description: "New description" })]);
        expect(harness.manager.signature()).toBe(renamed);
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
