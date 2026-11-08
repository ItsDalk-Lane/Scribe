import {
  createDesktopStreamingFetch,
  loadDesktopStreamingFetch,
} from "@/utils/desktopStreamingFetch";
import { requireNodeModule } from "@/utils/desktopRuntime";

jest.mock("@/utils/desktopRuntime", () => ({ requireNodeModule: jest.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function harness() {
  const released = deferred<void>();
  const reader = {
    read: jest.fn<Promise<ReadableStreamReadResult<Uint8Array>>, []>(),
    cancel: jest.fn().mockResolvedValue(undefined),
    releaseLock: jest.fn(() => released.resolve()),
  };
  const response = {
    status: 200,
    statusText: "OK",
    headers: new Headers({
      "content-type": "text/event-stream",
      "mcp-session-id": "session-fixture",
    }),
    body: { getReader: () => reader },
  } as unknown as Response;
  const fetchRemote = jest
    .fn<Promise<Response>, [string, RequestInit]>()
    .mockResolvedValue(response);
  const fetcher = createDesktopStreamingFetch({ fetch: fetchRemote, AbortController });
  return { fetcher, fetchRemote, reader, released, response };
}

describe("desktopStreamingFetch", () => {
  describe("createDesktopStreamingFetch()", () => {
    it("reports dispatch after the bridge starts and never reports cancelled body preparation https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
      const fetch = jest.fn(async () => new Response(null, { status: 204 }));
      const dispatched = jest.fn();
      const transport = createDesktopStreamingFetch({ fetch, AbortController }, dispatched);
      await transport("https://fixture.invalid", { method: "POST", body: "{}" });
      expect(dispatched).toHaveBeenCalledTimes(1);
      const body = deferred<string>();
      const text = jest.spyOn(Request.prototype, "text").mockReturnValue(body.promise);
      const controller = new AbortController();
      const pending = transport("https://fixture.invalid", {
        method: "POST",
        body: "{}",
        signal: controller.signal,
      });
      controller.abort();
      body.resolve("{}");
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(dispatched).toHaveBeenCalledTimes(1);
      text.mockRestore();
    });
    it("preserves session headers and streams each response chunk before the response ends", async () => {
      const { fetcher, fetchRemote, reader, released } = harness();
      const signal = new AbortController();
      const response = await fetcher("https://example.test/mcp", {
        method: "POST",
        headers: { Authorization: "Bearer fixture" },
        body: '{"method":"initialize"}',
        signal: signal.signal,
        redirect: "manual",
      });
      expect(response.headers.get("mcp-session-id")).toBe("session-fixture");
      expect(response.headers.get("access-control-expose-headers")).toBeNull();
      expect(fetchRemote).toHaveBeenCalledWith(
        "https://example.test/mcp",
        expect.objectContaining({
          method: "POST",
          body: '{"method":"initialize"}',
          redirect: "manual",
        })
      );
      expect(new Headers(fetchRemote.mock.calls[0][1].headers).get("authorization")).toBe(
        "Bearer fixture"
      );
      const pending = deferred<ReadableStreamReadResult<Uint8Array>>();
      reader.read
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce({ done: true, value: undefined });
      const output = response.body!.getReader();
      const first = output.read();
      pending.resolve({ done: false, value: new TextEncoder().encode("first event") });
      expect(new TextDecoder().decode((await first).value)).toBe("first event");
      expect(reader.releaseLock).not.toHaveBeenCalled();
      expect((await output.read()).done).toBe(true);
      await released.promise;
      signal.abort();
      expect(fetchRemote.mock.calls[0][1].signal!.aborted).toBe(false);
    });

    it("cancels the main request and releases its reader when the consumer cancels", async () => {
      const { fetcher, fetchRemote, reader, released } = harness();
      const response = await fetcher("https://example.test/mcp");
      await response.body!.cancel("no longer needed");
      await released.promise;
      expect(reader.cancel).toHaveBeenCalledWith("no longer needed");
      expect(fetchRemote.mock.calls[0][1].signal!.aborted).toBe(true);
      expect(reader.releaseLock).toHaveBeenCalledTimes(1);
    });

    it("propagates caller cancellation to the main request and the returned stream", async () => {
      const { fetcher, fetchRemote, reader, released } = harness();
      const controller = new AbortController();
      const response = await fetcher("https://example.test/mcp", { signal: controller.signal });
      const reason = new DOMException("Stopped", "AbortError");
      controller.abort(reason);
      await expect(response.text()).rejects.toBe(reason);
      await released.promise;
      expect(reader.cancel).toHaveBeenCalledWith(reason);
      expect(fetchRemote.mock.calls[0][1].signal!.aborted).toBe(true);
    });

    it("rejects an already cancelled request before dispatch", async () => {
      const { fetcher, fetchRemote } = harness();
      const controller = new AbortController();
      controller.abort();
      await expect(
        fetcher("https://example.test/mcp", { signal: controller.signal })
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(fetchRemote).not.toHaveBeenCalled();
    });

    it("releases the reader and exposes a response stream failure", async () => {
      const { fetcher, fetchRemote, reader, released } = harness();
      const error = new Error("Connection interrupted");
      reader.read.mockRejectedValueOnce(error);
      const response = await fetcher("https://example.test/mcp");
      await expect(response.text()).rejects.toBe(error);
      await released.promise;
      expect(fetchRemote.mock.calls[0][1].signal!.aborted).toBe(true);
    });

    it("keeps HTTP failures visible and handles responses with no body", async () => {
      const { fetcher, fetchRemote } = harness();
      fetchRemote.mockResolvedValueOnce(new Response(null, { status: 401 }));
      const response = await fetcher("https://example.test/mcp");
      expect(response.status).toBe(401);
      expect(response.ok).toBe(false);
      expect(response.body).toBeNull();
    });

    it("normalizes cancellation while awaiting headers and preserves ordinary network errors", async () => {
      const { fetcher, fetchRemote } = harness();
      const waiting = deferred<Response>();
      fetchRemote.mockImplementationOnce((_url, init) => {
        init.signal!.addEventListener("abort", () => waiting.reject(new Error("Remote abort")), {
          once: true,
        });
        return waiting.promise;
      });
      const controller = new AbortController();
      const operation = fetcher("https://example.test/mcp", { signal: controller.signal });
      controller.abort();
      await expect(operation).rejects.toMatchObject({ name: "AbortError" });
      const networkError = new Error("Network unavailable");
      fetchRemote.mockRejectedValueOnce(networkError);
      await expect(fetcher("https://example.test/mcp")).rejects.toBe(networkError);
    });
  });

  describe("loadDesktopStreamingFetch()", () => {
    it("uses the existing main-process bridge without installing another network client", async () => {
      const request = jest.fn().mockResolvedValue(new Response(null, { status: 204 }));
      jest.mocked(requireNodeModule).mockReturnValue({
        remote: {
          require: () => ({ net: { fetch: request } }),
          getGlobal: () => AbortController,
        },
      });
      const dispatched = jest.fn();
      const response = await loadDesktopStreamingFetch(dispatched)("https://example.test/mcp");
      expect(dispatched).toHaveBeenCalledTimes(1);
      expect(response.status).toBe(204);
      expect(requireNodeModule).toHaveBeenCalledWith("electron");
    });

    it.each([{}, { remote: {} }, { remote: { require: () => ({}) } }])(
      "reports an unavailable desktop bridge instead of silently using browser CORS (%p)",
      (electron) => {
        jest.mocked(requireNodeModule).mockReturnValue(electron);
        expect(() => loadDesktopStreamingFetch()).toThrow("desktop network bridge");
      }
    );
  });
});
