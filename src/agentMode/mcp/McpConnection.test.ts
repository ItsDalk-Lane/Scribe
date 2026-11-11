import { SSEClientTransport, SseError } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { McpSdkConnection } from "@/agentMode/mcp/McpConnection";
import type { McpConnectionInput } from "@/agentMode/mcp/McpServerManager";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { loadDesktopStreamingFetch } from "@/utils/desktopStreamingFetch";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ToolListChangedNotificationSchema,
  type CallToolRequest,
  type CallToolResult,
} from "@modelcontextprotocol/sdk/types.js";

jest.mock("@/utils/desktopStreamingFetch", () => ({
  loadDesktopStreamingFetch: jest.fn(
    () => (input: RequestInfo | URL, init?: RequestInit) => fetch(input, init)
  ),
}));

jest.mock("@modelcontextprotocol/sdk/client/index.js", () => ({ Client: jest.fn() }));
jest.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  StdioClientTransport: jest.fn(() => ({})),
  getDefaultEnvironment: () => ({ PATH: "/bin" }),
}));
jest.mock("@modelcontextprotocol/sdk/client/auth.js", () => ({}));
jest.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
  ...jest.requireActual("@modelcontextprotocol/sdk/client/sse.js"),
  SSEClientTransport: jest.fn(() => ({})),
}));
jest.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: jest.fn(() => ({})),
}));

function createHarness() {
  const client = {
    onclose: undefined as (() => void) | undefined,
    onerror: undefined as ((error: Error) => void) | undefined,
    connect: jest.fn(async (transport: { onerror?: (error: Error) => void }) => {
      transport.onerror?.(new Error("Optional GET stream returned HTTP 400"));
    }),
    getServerVersion: () => ({ version: "1.2.3" }),
    setNotificationHandler: jest.fn(),
    listTools: jest
      .fn()
      .mockResolvedValue({ tools: [{ name: "search", inputSchema: { type: "object" } }] }),
    callTool: jest.fn().mockResolvedValue({ content: [{ type: "text", text: "result" }] }),
    close: jest.fn().mockResolvedValue(undefined),
  };
  jest.mocked(Client).mockImplementation(() => client as unknown as Client);
  const input: McpConnectionInput = {
    server: {
      id: "remote",
      name: "search",
      type: "streamableHttp",
      url: "https://example.com/mcp",
      isActive: true,
      createdAt: "",
      updatedAt: "",
    },
    env: {},
    headers: {},
    clientInfo: { name: "Scribe", version: "1" },
    onUnexpectedClose: jest.fn(),
  };
  return { client, input, connection: new McpSdkConnection(input) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

async function createProtocolHarness(type: "sse" | "streamableHttp", listChanged = false) {
  const { connection, input } = createHarness();
  input.server.type = type;
  const { Client: ActualClient } = jest.requireActual<
    typeof import("@modelcontextprotocol/sdk/client/index.js")
  >("@modelcontextprotocol/sdk/client/index.js");
  const actualClient = new ActualClient({ name: "progress-client", version: "1" });
  jest.mocked(Client).mockImplementationOnce(() => actualClient);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  if (type === "sse") {
    jest
      .mocked(SSEClientTransport)
      .mockReturnValueOnce(clientTransport as unknown as SSEClientTransport);
  } else {
    jest
      .mocked(StreamableHTTPClientTransport)
      .mockReturnValueOnce(clientTransport as unknown as StreamableHTTPClientTransport);
  }
  const server = new Server(
    { name: "progress-server", version: "1" },
    { capabilities: { tools: { listChanged } } }
  );
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [] }));
  await server.connect(serverTransport);
  return { connection, input, actualClient, server };
}

describe("McpConnection", () => {
  describe("McpSdkConnection", () => {
    describe("start()", () => {
      it("forwards MCP tool list change notifications to the catalog owner https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const { connection, client, input } = createHarness();
        const changed = jest.fn();
        input.onToolsChanged = changed;
        await connection.start();
        expect(client.setNotificationHandler).toHaveBeenCalledWith(
          ToolListChangedNotificationSchema,
          expect.any(Function)
        );
        const notify = client.setNotificationHandler.mock.calls[0][1] as () => void;
        notify();
        expect(changed).toHaveBeenCalledTimes(1);
        await connection.close();
        notify();
        expect(changed).toHaveBeenCalledTimes(1);
      });

      it("receives a list-change notification through the actual MCP protocol https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const { connection, input, server } = await createProtocolHarness("streamableHttp", true);
        const changed = deferred<void>();
        input.onToolsChanged = () => changed.resolve();
        try {
          await connection.start();
          await server.sendToolListChanged();
          await changed.promise;
        } finally {
          await connection.close();
          await server.close();
        }
      });

      it("keeps a working POST session available when the optional GET stream fails", async () => {
        const { connection, input, client } = createHarness();
        await expect(connection.start()).resolves.toEqual({
          version: "1.2.3",
          tools: [{ name: "search", inputSchema: { type: "object" } }],
        });
        expect(input.onUnexpectedClose).not.toHaveBeenCalled();
        expect(
          jest.mocked(StreamableHTTPClientTransport).mock.calls.at(-1)![1]!.fetch
        ).toBeDefined();
        expect(loadDesktopStreamingFetch).toHaveBeenCalled();
        client.onerror?.(new Error("Optional GET stream returned HTTP 400"));
        expect(input.onUnexpectedClose).not.toHaveBeenCalled();
      });
      it("lists every tool page before offering the server to the agent", async () => {
        const { connection, client } = createHarness();
        client.listTools
          .mockResolvedValueOnce({
            tools: [{ name: "first", inputSchema: { type: "object" } }],
            nextCursor: "page-2",
          })
          .mockResolvedValueOnce({ tools: [{ name: "second", inputSchema: { type: "object" } }] });
        const started = await connection.start();
        expect(started.tools.map((tool) => tool.name)).toEqual(["first", "second"]);
        expect(client.listTools).toHaveBeenLastCalledWith({ cursor: "page-2" }, { timeout: 60000 });
      });
      it("preserves protocol headers while adding SSE authentication", async () => {
        const { connection, input } = createHarness();
        input.server.type = "sse";
        input.headers = { Authorization: "Bearer synthetic-key" };
        await connection.start();
        const options = jest.mocked(SSEClientTransport).mock.calls.at(-1)![1]!;
        expect(options.fetch).toBeDefined();
        const request = jest.fn().mockResolvedValue(new Response(""));
        const original = window.fetch;
        window.fetch = request;
        try {
          const fetchEvents = options.eventSourceInit!.fetch as typeof fetch;
          await fetchEvents("https://example.com/mcp", {
            headers: new Headers({ Accept: "text/event-stream", "X-Trace": "trace" }),
          });
          const headers = new Headers(request.mock.calls[0][1].headers);
          expect(headers.get("accept")).toBe("text/event-stream");
          expect(headers.get("x-trace")).toBe("trace");
          expect(headers.get("authorization")).toBe("Bearer synthetic-key");
        } finally {
          window.fetch = original;
        }
      });
      it("starts local servers with their command, arguments and inherited environment", async () => {
        const { connection, input } = createHarness();
        input.server = { ...input.server, type: "stdio", command: "node", args: ["server.js"] };
        input.env = { MCP_MODE: "test" };
        await connection.start();
        expect(StdioClientTransport).toHaveBeenLastCalledWith({
          command: "node",
          args: ["server.js"],
          env: { PATH: "/bin", MCP_MODE: "test" },
        });
      });
      it("reports a real client close after connecting", async () => {
        const { connection, client, input } = createHarness();
        await connection.start();
        client.onclose?.();
        expect(input.onUnexpectedClose).toHaveBeenCalledTimes(1);
      });
      it("reports a lost SSE receive stream even when the SDK only emits an error", async () => {
        const { connection, client, input } = createHarness();
        input.server.type = "sse";
        await connection.start();
        const error = new SseError(undefined, "connection terminated", new Event("error"));
        client.onerror?.(error);
        expect(input.onUnexpectedClose).toHaveBeenCalledWith(error.message);
        await connection.close();
        expect(client.close).toHaveBeenCalledTimes(1);
        client.onerror?.(new SseError(undefined, "late stream error", new Event("error")));
        client.onclose?.();
        expect(input.onUnexpectedClose).toHaveBeenCalledTimes(1);
      });
      it("releases the client after an initialization failure", async () => {
        const { connection, client } = createHarness();
        client.connect.mockRejectedValueOnce(new Error("unauthorized"));
        await expect(connection.start()).rejects.toThrow("unauthorized");
        await connection.close();
        expect(client.close).toHaveBeenCalledTimes(1);
      });
    });
    describe("listTools()", () => {
      it("rejects a repeated remote cursor instead of waiting on a directory that cannot advance https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const { connection, client } = createHarness();
        await connection.start();
        client.listTools
          .mockResolvedValueOnce({ tools: [], nextCursor: "same-page" })
          .mockResolvedValueOnce({ tools: [], nextCursor: "same-page" })
          .mockResolvedValueOnce({ tools: [] });
        await expect(connection.listTools()).rejects.toThrow(/repeated.*cursor/i);
      });
    });
    describe("callTool()", () => {
      it("retains structured-only results and response metadata while masking configured credentials https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
        const { connection, input, client } = createHarness();
        input.headers = { Authorization: "Bearer fixture-private-key" };
        client.callTool.mockResolvedValueOnce({
          content: [],
          structuredContent: { count: 2, echoed: "fixture-private-key" },
          _meta: { trace: "trace-123" },
        });
        await connection.start();
        expect(await connection.callTool("search", {}, 60, false)).toEqual({
          content: [],
          structuredContent: { count: 2, echoed: "[redacted]" },
          _meta: { trace: "trace-123" },
          isError: false,
        });
      });
      it("requests server progress and keeps a long-running call alive beyond its idle deadline while progress arrives", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
        const { connection, server } = await createProtocolHarness("streamableHttp");
        const received = deferred<CallToolRequest>();
        const completed = deferred<CallToolResult>();
        server.setRequestHandler(CallToolRequestSchema, async (request) => {
          received.resolve(request);
          return completed.promise;
        });
        let outcome: Promise<unknown> | undefined;
        try {
          await connection.start();
          outcome = connection.callTool("long-operation", {}, 5, true).then(
            (result) => result,
            (error: unknown) => error
          );
          const request = await received.promise;
          const progressToken = request.params._meta?.progressToken;
          expect(progressToken).toEqual(expect.any(Number));
          for (let progress = 1; progress <= 3; progress++) {
            await jest.advanceTimersByTimeAsync(4000);
            await server.notification({
              method: "notifications/progress",
              params: { progressToken: progressToken!, progress, total: 3 },
            });
          }
          completed.resolve({ content: [{ type: "text", text: "finished after 12 seconds" }] });
          await expect(outcome).resolves.toEqual({
            content: [{ type: "text", text: "finished after 12 seconds" }],
            isError: false,
          });
        } finally {
          completed.resolve({ content: [] });
          await connection.close();
          await server.close();
          await outcome;
          jest.useRealTimers();
        }
      });
      it.each(["cancelled", "completed"] as const)(
        "keeps the SSE connection usable when progress arrives after a call has %s",
        async (ending) => {
          const { connection, input, server, actualClient } = await createProtocolHarness("sse");
          const received = deferred<CallToolRequest>();
          const completed = deferred<CallToolResult>();
          const diagnosed = deferred<void>();
          server.setRequestHandler(CallToolRequestSchema, async (request) => {
            if (request.params.name === "echo")
              return { content: [{ type: "text", text: "connection still alive" }] };
            received.resolve(request);
            return completed.promise;
          });
          let outcome: Promise<unknown> | undefined;
          try {
            await connection.start();
            const onerror = actualClient.onerror;
            actualClient.onerror = (error) => {
              onerror?.(error);
              diagnosed.resolve();
            };
            const controller = new AbortController();
            outcome = connection.callTool("long-operation", {}, 5, true, controller.signal).then(
              (result) => result,
              (error: unknown) => error
            );
            const request = await received.promise;
            if (ending === "cancelled") controller.abort(new Error("user stopped this call"));
            else completed.resolve({ content: [{ type: "text", text: "operation finished" }] });
            await outcome;
            await server.notification({
              method: "notifications/progress",
              params: { progressToken: request.params._meta!.progressToken!, progress: 1 },
            });
            await diagnosed.promise;
            expect(input.onUnexpectedClose).not.toHaveBeenCalled();
            await expect(connection.callTool("echo", {}, 5, false)).resolves.toEqual({
              content: [{ type: "text", text: "connection still alive" }],
              isError: false,
            });
          } finally {
            completed.resolve({ content: [] });
            await connection.close();
            await server.close();
            await outcome;
          }
        }
      );
      it("returns the server result with the configured deadline and cancellation signal", async () => {
        const { connection, client } = createHarness();
        const controller = new AbortController();
        await connection.start();
        await expect(
          connection.callTool("search", { q: "obsidian" }, 30, true, controller.signal)
        ).resolves.toEqual({ content: [{ type: "text", text: "result" }], isError: false });
        expect(client.callTool).toHaveBeenCalledWith(
          { name: "search", arguments: { q: "obsidian" } },
          undefined,
          expect.objectContaining({
            timeout: 30000,
            maxTotalTimeout: 600000,
            signal: controller.signal,
          })
        );
      });
    });
    describe("close()", () => {
      it("closes intentionally without reporting a lost connection", async () => {
        const { connection, client, input } = createHarness();
        await connection.start();
        await connection.close();
        client.onclose?.();
        expect(client.close).toHaveBeenCalledTimes(1);
        expect(input.onUnexpectedClose).not.toHaveBeenCalled();
      });
    });
  });
});
