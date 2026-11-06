import type { Model, ToolCall } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createAssistantMessage, createPiChatModel } from "@/LLMProviders/piChatModel";
import { collectText } from "@/LLMProviders/testing/piFixtures";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const model: Model<"openai-completions"> = {
  id: "private-model",
  name: "Private model",
  provider: "custom",
  api: "openai-completions",
  baseUrl: "https://fixture.invalid/v1",
  reasoning: false,
  input: ["text"],
  contextWindow: 0,
  maxTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

describe("piChatModel", () => {
  describe("createAssistantMessage", () => {
    it("creates independent pending messages with the selected model identity", () => {
      const first = createAssistantMessage(model);
      first.content.push({ type: "text", text: "One" });
      const second = createAssistantMessage(model);
      expect(second).toMatchObject({
        api: "openai-completions",
        provider: "custom",
        model: "private-model",
        stopReason: "pending",
        content: [],
        usage: { totalTokens: 0 },
      });
    });
  });

  describe("createPiChatModel", () => {
    describe("agentStream", () => {
      it("redacts request credentials from split text, thinking, tool arguments and persisted final messages", async () => {
        const apiKey = "request-private-key";
        const bearer = "request-derived-token";
        const message = createAssistantMessage(model);
        message.content = [
          { type: "text", text: apiKey },
          { type: "thinking", thinking: bearer },
          { type: "toolCall", id: "tool", name: "write_note", arguments: { content: apiKey } },
        ];
        message.stopReason = "toolUse";
        const chat = createPiChatModel(model, async () => ({
          stream: () => {
            const source = createAssistantMessageEventStream();
            source.push({ type: "text_start", contentIndex: 0, partial: message });
            source.push({
              type: "text_delta",
              contentIndex: 0,
              delta: "request-",
              partial: message,
            });
            source.push({
              type: "text_delta",
              contentIndex: 0,
              delta: "private-key",
              partial: message,
            });
            source.push({ type: "text_end", contentIndex: 0, content: apiKey, partial: message });
            source.push({ type: "thinking_start", contentIndex: 1, partial: message });
            source.push({
              type: "thinking_delta",
              contentIndex: 1,
              delta: "request-derived-",
              partial: message,
            });
            source.push({
              type: "thinking_delta",
              contentIndex: 1,
              delta: "token",
              partial: message,
            });
            source.push({
              type: "thinking_end",
              contentIndex: 1,
              content: bearer,
              partial: message,
            });
            source.push({ type: "toolcall_start", contentIndex: 2, partial: message });
            source.push({
              type: "toolcall_delta",
              contentIndex: 2,
              delta: '{"content":"request-',
              partial: message,
            });
            source.push({
              type: "toolcall_delta",
              contentIndex: 2,
              delta: 'private-key"}',
              partial: message,
            });
            source.push({
              type: "toolcall_end",
              contentIndex: 2,
              toolCall: message.content[2] as ToolCall,
              partial: message,
            });
            source.push({ type: "done", reason: "toolUse", message });
            source.end();
            return source;
          },
          options: {
            apiKey,
            headers: { Authorization: `Bearer ${bearer}` },
            fetch: jest.fn(),
            maxRetries: 0,
          },
        }));
        const events = [];
        const source = chat.agentStream({ messages: [] });
        for await (const event of source) events.push(event);
        const result = await source.result();
        expect(result.content).toEqual([
          { type: "text", text: "[redacted]" },
          { type: "thinking", thinking: "[redacted]" },
          {
            type: "toolCall",
            id: "tool",
            name: "write_note",
            arguments: { content: "[redacted]" },
          },
        ]);
        for (const secret of [apiKey, bearer]) {
          expect(JSON.stringify(events)).not.toContain(secret);
          expect(
            events
              .filter(
                (event) =>
                  event.type === "text_delta" ||
                  event.type === "thinking_delta" ||
                  event.type === "toolcall_delta"
              )
              .map((event) => ("delta" in event ? event.delta : ""))
              .join("")
          ).not.toContain(secret);
        }
      });

      it("masks service-account fields in errors and every terminal content payload before persistence", async () => {
        const privateKey = "PRIVATE-KEY-CONTENT";
        const json = JSON.stringify({ private_key: privateKey, access_token: "oauth-token" });
        const message = createAssistantMessage(model);
        message.content = [
          { type: "thinking", thinking: privateKey, thinkingSignature: "opaque-signature" },
          {
            type: "toolCall",
            id: "call",
            name: "write_note",
            arguments: { value: "oauth-token" },
            argumentsError: json,
          },
        ];
        message.stopReason = "error";
        message.errorMessage = `Rejected ${privateKey}`;
        const chat = createPiChatModel(model, async () => ({
          redactionValues: [json],
          stream: () => {
            const source = createAssistantMessageEventStream();
            source.push({ type: "error", reason: "error", error: message });
            source.end();
            return source;
          },
          options: { apiKey: "provider-managed-auth", fetch: jest.fn(), maxRetries: 0 },
        }));
        const result = await chat.agentStream({ messages: [] }).result();
        expect(result).toMatchObject({ stopReason: "error" });
        for (const value of [privateKey, "oauth-token", json])
          expect(JSON.stringify(result)).not.toContain(value);
        expect(result.errorMessage).toContain("[redacted]");
      });

      it("preserves tool identity and opaque protocol signatures with a short credential", async () => {
        const message = createAssistantMessage(model);
        const tool: ToolCall = {
          type: "toolCall",
          id: "call-a",
          name: "read_note",
          arguments: { path: "a" },
          thoughtSignature: "opaque-signature",
        };
        message.content = [
          { type: "thinking", thinking: "a", thinkingSignature: "opaque-signature" },
          tool,
        ];
        message.stopReason = "toolUse";
        const chat = createPiChatModel(model, async () => ({
          stream: () => {
            const source = createAssistantMessageEventStream();
            source.push({
              type: "toolcall_end",
              contentIndex: 1,
              toolCall: tool,
              partial: message,
            });
            source.push({ type: "done", reason: "toolUse", message });
            source.end();
            return source;
          },
          options: { apiKey: "a", fetch: jest.fn(), maxRetries: 0 },
        }));
        const events = [];
        const source = chat.agentStream({ messages: [] });
        for await (const event of source) events.push(event);
        const result = await source.result();
        expect(result.content).toEqual([
          { type: "thinking", thinking: "[redacted]", thinkingSignature: "opaque-signature" },
          { ...tool, arguments: { path: "[redacted]" } },
        ]);
        expect(events.find((event) => event.type === "toolcall_end")).toMatchObject({
          toolCall: {
            id: "call-a",
            name: "read_note",
            arguments: { path: "[redacted]" },
            thoughtSignature: "opaque-signature",
          },
        });
      });

      it("does not treat an unclassified transport TypeError as a proven transient network error (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
        try {
          const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
          const fetch = jest.fn(async () => {
            throw new TypeError("Invalid request configuration");
          });
          const onFailure = jest.fn();
          const chat = createPiChatModel(model, async () => ({
            stream,
            options: { fetch, apiKey: "fixture", maxRetries: 3 },
          }));
          const pending = chat.agentStream({ messages: [] }, { onFailure }).result();
          await jest.runAllTimersAsync();
          expect(await pending).toMatchObject({ stopReason: "error" });
          expect(fetch).toHaveBeenCalledTimes(1);
          expect(onFailure).toHaveBeenCalledWith({ kind: "request" });
        } finally {
          jest.useRealTimers();
        }
      });

      it("bounds transient retries and reports only the final failure (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
        const fetch = jest.fn(
          async () =>
            new Response("Unavailable", { status: 503, headers: { "retry-after-ms": "0" } })
        );
        const onFailure = jest.fn();
        const chat = createPiChatModel(model, async () => ({
          stream,
          options: { fetch, apiKey: "fixture", maxRetries: 3 },
        }));
        expect(await chat.agentStream({ messages: [] }, { onFailure }).result()).toMatchObject({
          stopReason: "error",
        });
        expect(fetch).toHaveBeenCalledTimes(4);
        expect(onFailure).toHaveBeenCalledTimes(1);
        expect(onFailure).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "transient", status: 503 })
        );
      });

      it("does not replay a request after a streamed tool call (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
        const tool = {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call",
                    type: "function",
                    function: { name: "read_note", arguments: '{"path":"one.md"}' },
                  },
                ],
              },
              finish_reason: null,
            },
          ],
        };
        const body = `data: ${JSON.stringify(tool)}\n\ndata: {"error":{"code":"rate_limit_exceeded"}}\n\n`;
        const fetch = jest.fn(
          async () => new Response(body, { headers: { "content-type": "text/event-stream" } })
        );
        const chat = createPiChatModel(model, async () => ({
          stream,
          options: { fetch, apiKey: "fixture", maxRetries: 3 },
        }));
        expect(await chat.agentStream({ messages: [] }).result()).toMatchObject({
          stopReason: "error",
          content: [{ type: "toolCall", name: "read_note" }],
        });
        expect(fetch).toHaveBeenCalledTimes(1);
      });

      it("does not replay a request after partial text even when its stream error is transient (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
        const fetch = jest.fn(
          async () =>
            new Response(
              'data: {"choices":[{"index":0,"delta":{"content":"Partial"},"finish_reason":null}]}\n\ndata: {"error":{"code":"rate_limit_exceeded","message":"Temporary"}}\n\n',
              { headers: { "content-type": "text/event-stream" } }
            )
        );
        const onFailure = jest.fn();
        const chat = createPiChatModel(model, async () => ({
          stream,
          options: { fetch, apiKey: "fixture", maxRetries: 3 },
        }));
        const result = await chat.agentStream({ messages: [] }, { onFailure }).result();
        expect(result).toMatchObject({
          stopReason: "error",
          content: [{ type: "text", text: "Partial" }],
        });
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "transient" }));
        expect(fetch).toHaveBeenCalledTimes(1);
      });

      it("keeps concurrent failures and credential redaction local to their own requests (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
        let release!: (response: Response) => void;
        let started!: () => void;
        const pending = new Promise<Response>((resolve) => {
          release = resolve;
        });
        const firstStarted = new Promise<void>((resolve) => {
          started = resolve;
        });
        const secretOne = "test-secret-one-12345";
        const secretTwo = "test-secret-two-67890";
        let request = 0;
        const chat = createPiChatModel(model, async () => {
          const first = request++ === 0;
          return {
            stream,
            options: {
              apiKey: first ? secretOne : secretTwo,
              maxRetries: 0,
              fetch: async () => {
                if (first) {
                  started();
                  return pending;
                }
                return new Response(
                  JSON.stringify({ error: { code: "invalid_api_key", message: secretTwo } }),
                  { status: 401 }
                );
              },
            },
          };
        });
        const firstFailure = jest.fn();
        const secondFailure = jest.fn();
        const first = chat.agentStream({ messages: [] }, { onFailure: firstFailure }).result();
        await firstStarted;
        const second = await chat
          .agentStream({ messages: [] }, { onFailure: secondFailure })
          .result();
        release(
          new Response(
            JSON.stringify({ error: { code: "insufficient_quota", message: secretOne } }),
            { status: 429 }
          )
        );
        const initial = await first;
        expect(initial.errorMessage).not.toContain(secretOne);
        expect(second.errorMessage).not.toContain(secretTwo);
        expect(firstFailure).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "quota", status: 429 })
        );
        expect(secondFailure).toHaveBeenCalledWith(
          expect.objectContaining({ kind: "auth", status: 401 })
        );
      });

      it("cancels a retry backoff without issuing a second request (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
        try {
          const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
          const fetch = jest.fn(
            async () =>
              new Response("Unavailable", { status: 503, headers: { "retry-after-ms": "50000" } })
          );
          const controller = new AbortController();
          const chat = createPiChatModel(model, async () => ({
            stream,
            options: { fetch, apiKey: "fixture", maxRetries: 3 },
          }));
          const pending = chat
            .agentStream({ messages: [] }, { signal: controller.signal })
            .result();
          await jest.advanceTimersByTimeAsync(1000);
          expect(fetch).toHaveBeenCalledTimes(1);
          controller.abort();
          expect(await pending).toMatchObject({ stopReason: "aborted" });
          await jest.runAllTimersAsync();
          expect(fetch).toHaveBeenCalledTimes(1);
        } finally {
          jest.useRealTimers();
        }
      });

      it.each([
        [{ error: { code: "insufficient_quota" } }, "quota"],
        [{ error: { code: "context_length_exceeded" } }, "context"],
        [{ error: { type: "authentication_error" } }, "auth"],
        [{ error: { message: "insufficient_quota" } }, "request"],
      ])(
        "stops deterministic failures without retry and reports their structured category (https://github.com/ItsDalk-Lane/Scribe/issues/31): %j",
        async (body, kind) => {
          const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
          const fetch = jest.fn(
            async () =>
              new Response(JSON.stringify(body), {
                status: 429,
                headers: { "content-type": "application/json" },
              })
          );
          const onFailure = jest.fn();
          const chat = createPiChatModel(model, async () => ({
            stream,
            options: { fetch, apiKey: "fixture", maxRetries: 3 },
          }));
          expect(await chat.agentStream({ messages: [] }, { onFailure }).result()).toMatchObject({
            stopReason: "error",
          });
          expect(fetch).toHaveBeenCalledTimes(1);
          expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind }));
        }
      );

      it("retries a structured transient failure with bottom-level retries disabled (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
        const fetch = jest
          .fn()
          .mockResolvedValueOnce(
            new Response(JSON.stringify({ error: { code: "rate_limit_exceeded" } }), {
              status: 429,
              headers: { "retry-after-ms": "0" },
            })
          )
          .mockResolvedValueOnce(
            new Response(
              'data: {"choices":[{"index":0,"delta":{"content":"Recovered"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n',
              { headers: { "content-type": "text/event-stream" } }
            )
          );
        const onFailure = jest.fn();
        const chat = createPiChatModel(model, async () => ({
          stream,
          options: { fetch, apiKey: "fixture", maxRetries: 3 },
        }));
        const result = await chat.agentStream({ messages: [] }, { onFailure }).result();
        expect(result).toMatchObject({
          stopReason: "stop",
          content: [{ type: "text", text: "Recovered" }],
        });
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(onFailure).not.toHaveBeenCalled();
      });

      it("captures raw stream quota errors before the SDK converts them into text (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const { stream } = await import("@earendil-works/pi-ai/api/anthropic-messages");
        const fetch = jest.fn(
          async () =>
            new Response(
              'event: error\ndata: {"type":"error","error":{"type":"insufficient_quota","message":"Balance exhausted"}}\n\n',
              { headers: { "content-type": "text/event-stream" } }
            )
        );
        const onFailure = jest.fn();
        const chat = createPiChatModel({ ...model, api: "anthropic-messages" }, async () => ({
          stream,
          options: { fetch, apiKey: "fixture", maxRetries: 3 },
        }));
        expect(await chat.agentStream({ messages: [] }, { onFailure }).result()).toMatchObject({
          stopReason: "error",
        });
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "quota" }));
        expect(fetch).toHaveBeenCalledTimes(1);
      });

      it("provides the same tool events and final result through Pi's event-stream contract", async () => {
        const reply = createAssistantMessage(model);
        reply.stopReason = "toolUse";
        const tool: ToolCall = {
          type: "toolCall",
          id: "call-one",
          name: "read_note",
          arguments: { path: "note.md" },
        };
        reply.content = [tool];
        const client = createPiChatModel(model, async () => ({
          options: { fetch: jest.fn() },
          stream: () => {
            const source = createAssistantMessageEventStream();
            source.push({ type: "toolcall_start", contentIndex: 0, partial: reply });
            source.push({
              type: "toolcall_end",
              contentIndex: 0,
              partial: reply,
              toolCall: tool,
            });
            source.push({ type: "done", reason: "toolUse", message: reply });
            source.end();
            return source;
          },
        }));
        const source = client.agentStream({ messages: [] });
        expect(await source.result()).toMatchObject(reply);
        const types = [];
        for await (const event of source) types.push(event.type);
        expect(types).toEqual(["toolcall_start", "toolcall_end", "done"]);
      });

      it("returns cancellation while credentials are pending and never starts the model afterwards", async () => {
        let release!: () => void;
        let started!: () => void;
        const resolving = new Promise<void>((resolve) => {
          started = resolve;
        });
        const credentials = new Promise<void>((resolve) => {
          release = resolve;
        });
        const stream = jest.fn(() => createAssistantMessageEventStream());
        const controller = new AbortController();
        const client = createPiChatModel(model, async () => {
          started();
          await credentials;
          return { stream, options: { fetch: jest.fn() } };
        });
        const pending = client
          .agentStream({ messages: [] }, { signal: controller.signal })
          .result();
        await resolving;
        controller.abort();
        expect(await pending).toMatchObject({ stopReason: "aborted" });
        release();
        await credentials;
        expect(stream).not.toHaveBeenCalled();
      });

      it("returns a diagnosable Pi error instead of completing an unsuccessful request", async () => {
        const client = createPiChatModel(model, async () => {
          throw new Error("Tool declarations rejected");
        });
        const source = client.agentStream({ messages: [] });
        expect(await source.result()).toMatchObject({
          stopReason: "error",
          errorMessage:
            "private-model (openai-completions), model stream: Tool declarations rejected",
        });
        const events = [];
        for await (const event of source) events.push(event.type);
        expect(events).toEqual(["error"]);
      });

      it.each([
        {
          name: "an echoed request credential is redacted while model, protocol, and HTTP status stay diagnosable",
          body: JSON.stringify({
            error: { message: "Invalid credential audit-secret-ONE-not-real" },
          }),
          secret: "audit-secret-ONE-not-real",
          expects: (errorMessage: string) => {
            expect(errorMessage).toContain("private-model (openai-completions)");
            expect(errorMessage).toContain("401");
            expect(errorMessage).not.toContain("audit-secret-ONE-not-real");
          },
        },
        {
          name: "an ordinary 401 body stays diagnosable",
          body: JSON.stringify({ error: { message: "Expired subscription" } }),
          secret: "unrelated-key-value-424242",
          expects: (errorMessage: string) => {
            expect(errorMessage).toContain("401");
            expect(errorMessage).toContain("Expired subscription");
          },
        },
      ])(
        "redacts provider error bodies before they persist: $name",
        async ({ body, secret, expects }) => {
          const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
          const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
            async () =>
              new Response(body, { status: 401, headers: { "content-type": "application/json" } })
          );
          const chat = createPiChatModel(model, async () => ({
            stream,
            options: { apiKey: secret, fetch, maxRetries: 0 },
          }));
          const result = await chat
            .agentStream({ messages: [{ role: "user", content: "Question", timestamp: 0 }] })
            .result();
          expect(result.stopReason).toBe("error");
          expects(result.errorMessage ?? "");
        }
      );

      it("preserves the terminal provider message, refusal reason, usage, and diagnostics when no partial was emitted", async () => {
        const reply = createAssistantMessage(model);
        reply.stopReason = "error";
        reply.rawStopReason = "content_filter";
        reply.errorMessage = "Provider finish_reason: content_filter";
        reply.usage.input = 17;
        reply.diagnostics = [{ type: "provider", timestamp: 0, details: { filter: "blocked" } }];
        const client = createPiChatModel(model, async () => ({
          options: { fetch: jest.fn() },
          stream: () => {
            const source = createAssistantMessageEventStream();
            source.push({ type: "error", reason: "error", error: reply });
            source.end();
            return source;
          },
        }));
        expect(await client.agentStream({ messages: [] }).result()).toMatchObject({
          rawStopReason: "content_filter",
          usage: { input: 17 },
          diagnostics: reply.diagnostics,
        });
        await expect(collectText(client)).rejects.toThrow("Provider finish_reason: content_filter");
      });
    });

    it(`does not start credential resolution for an already stopped turn (${issue})`, async () => {
      const resolve = jest.fn(async () => ({
        options: { fetch: jest.fn() },
        stream: createAssistantMessageEventStream,
      }));
      const controller = new AbortController();
      controller.abort();
      await expect(
        collectText(createPiChatModel(model, resolve), "Question", { signal: controller.signal })
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(resolve).not.toHaveBeenCalled();
    });

    it(`stops a silent pi-ai source while the next event is pending (${issue})`, async () => {
      const source = createAssistantMessageEventStream();
      source.push({ type: "start", partial: createAssistantMessage(model) });
      const chat = createPiChatModel(model, async () => ({
        options: { fetch: jest.fn() },
        stream: () => source,
      }));
      const controller = new AbortController();
      const events = chat.stream({ messages: [] }, { signal: controller.signal });
      const iterator = events[Symbol.asyncIterator]();
      expect((await iterator.next()).value).toMatchObject({ type: "start" });
      const pending = iterator.next();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    });

    it(`surfaces credential failures without opening an inference request (${issue})`, async () => {
      const resolve = jest.fn(async () => {
        throw Object.assign(new Error("Access denied"), { status: 401 });
      });
      await expect(collectText(createPiChatModel(model, resolve))).rejects.toMatchObject({
        message: "Access denied",
        status: 401,
      });
    });

    it(`rejects a source that closes without a terminal result (${issue})`, async () => {
      const source = createAssistantMessageEventStream();
      source.end();
      await expect(
        collectText(
          createPiChatModel(model, async () => ({
            stream: () => source,
            options: { fetch: jest.fn() },
          }))
        )
      ).rejects.toThrow("ended before completion");
    });

    it(`uses the real pi-ai completions API without introducing an output limit (${issue})`, async () => {
      const { stream } = await import("@earendil-works/pi-ai/api/openai-completions");
      const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
        async () =>
          new Response(
            new ReadableStream({
              start(controller) {
                controller.enqueue(
                  new TextEncoder().encode(
                    'data: {"choices":[{"index":0,"delta":{"content":"OK"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n'
                  )
                );
                controller.close();
              },
            }),
            { headers: { "content-type": "text/event-stream" } }
          )
      );
      const chat = createPiChatModel(model, async () => ({
        stream,
        options: { apiKey: "fixture", fetch, maxRetries: 0 },
      }));
      const events = [];
      for await (const event of chat.stream({
        messages: [{ role: "user", content: "Question", timestamp: 0 }],
      }))
        events.push(event);
      expect(events.filter((event) => event.type === "text_delta")).toMatchObject([
        { delta: "OK" },
      ]);
      expect(events.at(-1)).toMatchObject({ type: "done", message: { stopReason: "stop" } });
      const body: unknown = JSON.parse(fetch.mock.calls[0][1]?.body as string);
      expect(body).toMatchObject({ model: "private-model", stream: true });
      expect(body).not.toHaveProperty("max_tokens");
      expect(body).not.toHaveProperty("max_completion_tokens");
    });

    it(`throws pi-ai error events instead of returning partial success (${issue})`, async () => {
      const partial = createAssistantMessage(model);
      const chat = createPiChatModel(model, async () => ({
        options: { fetch: jest.fn() },
        stream() {
          const events = createAssistantMessageEventStream();
          events.push({ type: "start", partial });
          partial.stopReason = "error";
          partial.errorMessage = "Provider disconnected";
          events.push({ type: "error", reason: "error", error: partial });
          events.end();
          return events;
        },
      }));
      const consume = async () => {
        for await (const event of chat.stream({ messages: [] })) {
          expect(event.type).toBe("start");
        }
      };
      await expect(consume()).rejects.toThrow("Provider disconnected");
    });
  });
});
