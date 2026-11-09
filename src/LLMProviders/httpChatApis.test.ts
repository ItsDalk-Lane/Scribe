import type { Model } from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { abortSignalWithDeadline } from "@/utils/abortDeadline";
import {
  postChatRequest,
  streamGoogle,
  streamCohere,
  streamOllama,
  textContent,
} from "@/LLMProviders/httpChatApis";
import { createAssistantMessage, createPiChatModel } from "@/LLMProviders/piChatModel";
import { collectReply, collectText, sse } from "@/LLMProviders/testing/piFixtures";

jest.mock("@/logger");
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const issue56 = "https://github.com/ItsDalk-Lane/Scribe/issues/56";
const model: Model<"google-generative-ai"> = {
  id: "private/model",
  name: "Private model",
  provider: "custom",
  api: "google-generative-ai",
  baseUrl: "https://fixture.invalid",
  input: ["text", "image"],
  reasoning: true,
  contextWindow: 16384,
  maxTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

describe("httpChatApis", () => {
  describe("postChatRequest", () => {
    it("does not retry hard quota errors at the direct HTTP entry point (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
      const fetch = jest.fn(
        async () =>
          new Response(JSON.stringify({ error: { code: "insufficient_quota" } }), { status: 429 })
      );
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
      try {
        const pending = postChatRequest(model, "/chat", {}, { fetch, maxRetries: 3 }).catch(
          (error: unknown) => error
        );
        await jest.runAllTimersAsync();
        expect(await pending).toMatchObject({ failure: { kind: "quota" }, status: 429 });
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("preserves the payload override and per-turn headers", async () => {
      const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
        async () => new Response("OK")
      );
      await postChatRequest(
        model,
        "/chat",
        { prompt: "Original" },
        {
          fetch,
          headers: { "x-session": "same-session" },
          onPayload: (body) => ({ body, stream: true }),
        }
      );
      expect(fetch).toHaveBeenCalledWith(
        "https://fixture.invalid/chat",
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json", "x-session": "same-session" },
          body: JSON.stringify({ body: { prompt: "Original" }, stream: true }),
        })
      );
    });

    it(`retries a transient HTTP failure without replaying the streamed answer (${issue})`, async () => {
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
      const fetch = jest
        .fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>()
        .mockResolvedValueOnce(new Response("Temporary capacity failure", { status: 503 }))
        .mockResolvedValueOnce(new Response("Reply"));
      try {
        const pending = postChatRequest(model, "/chat", {}, { fetch, maxRetries: 1 });
        await jest.runAllTimersAsync();
        expect(await (await pending).text()).toBe("Reply");
        expect(fetch).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });

    it(`surfaces an authentication failure immediately with its HTTP status (${issue})`, async () => {
      const fetch = jest.fn(async () => new Response("Invalid key", { status: 401 }));
      await expect(
        postChatRequest(model, "/chat", {}, { fetch, maxRetries: 3 })
      ).rejects.toMatchObject({ message: "Invalid key", status: 401 });
      expect(fetch).toHaveBeenCalledTimes(1);
    });

    it(`rejects a missing transport instead of falling back to global fetch (${issue})`, async () => {
      await expect(postChatRequest(model, "/chat", {})).rejects.toThrow(
        "A provider transport is required."
      );
    });

    it("aborts a hung request through the caller's deadline signal (https://github.com/ItsDalk-Lane/Scribe/issues/59)", async () => {
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
      try {
        const fetch = jest.fn(
          (_url: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  const reason: unknown = init.signal?.reason;
                  reject(
                    reason instanceof Error ? reason : new DOMException("Aborted", "AbortError")
                  );
                },
                { once: true }
              );
            })
        );
        const deadline = abortSignalWithDeadline(undefined, 1000);
        const pending = postChatRequest(
          model,
          "/chat",
          {},
          {
            fetch,
            signal: deadline.signal,
          }
        ).catch((error: unknown) => error);
        await jest.advanceTimersByTimeAsync(1000);
        deadline.dispose();
        expect(await pending).toBeInstanceOf(DOMException);
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("textContent", () => {
    it("keeps plain user content and combines assistant text without reasoning", () => {
      expect(textContent({ role: "user", content: "Original", timestamp: 0 })).toBe("Original");
      const assistant = createAssistantMessage(model);
      assistant.content = [
        { type: "thinking", thinking: "Private" },
        { type: "text", text: "One" },
        { type: "text", text: "Two" },
      ];
      expect(textContent(assistant)).toBe("OneTwo");
    });
  });

  describe("streamGoogle", () => {
    it(`preserves system, multi-turn text, image input, reasoning and usage without an implicit output cap (${issue})`, async () => {
      const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
        async () =>
          new Response(
            sse([
              {
                candidates: [
                  {
                    content: { parts: [{ text: "Reason", thought: true }, { text: "Answer" }] },
                    finishReason: "STOP",
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 6,
                  candidatesTokenCount: 4,
                  thoughtsTokenCount: 2,
                  cachedContentTokenCount: 1,
                  totalTokenCount: 12,
                },
              },
            ])
          )
      );
      const client = createPiChatModel(model, async () => ({
        stream: streamGoogle,
        options: { fetch },
      }));
      const previous = createAssistantMessage(model);
      previous.stopReason = "stop";
      previous.content = [{ type: "text", text: "Previous answer" }];
      const result = await collectReply(client, {
        systemPrompt: "Unchanged instruction",
        messages: [
          { role: "user", content: "Previous question", timestamp: 0 },
          previous,
          {
            role: "user",
            timestamp: 0,
            content: [
              { type: "text", text: "Follow-up" },
              { type: "image", data: "AQID", mimeType: "image/png" },
            ],
          },
        ],
      });
      expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({
        systemInstruction: { parts: [{ text: "Unchanged instruction" }] },
        contents: [
          { role: "user", parts: [{ text: "Previous question" }] },
          { role: "model", parts: [{ text: "Previous answer" }] },
          {
            role: "user",
            parts: [{ text: "Follow-up" }, { inlineData: { mimeType: "image/png", data: "AQID" } }],
          },
        ],
      });
      expect(result.content).toEqual([
        { type: "thinking", thinking: "Reason" },
        { type: "text", text: "Answer" },
      ]);
      expect(result.usage).toMatchObject({
        input: 5,
        cacheRead: 1,
        output: 6,
        reasoning: 2,
        totalTokens: 12,
      });
      expect(fetch.mock.calls[0][0]).toBe(
        "https://fixture.invalid/models/private%2Fmodel:streamGenerateContent?alt=sse"
      );
    });

    it.each([
      [{ promptFeedback: { blockReason: "SAFETY" } }, "SAFETY"],
      [{ error: { message: "Vertex access denied" } }, "Vertex access denied"],
      [{ candidates: [{ finishReason: "RECITATION" }] }, "RECITATION"],
      [{ candidates: [{ content: { parts: [{ text: "Partial" }] } }] }, "Unexpected response"],
    ])(
      `reports blocked, errored or disconnected streams instead of success (${issue})`,
      async (chunk, message) => {
        const client = createPiChatModel(model, async () => ({
          stream: streamGoogle,
          options: { fetch: async () => new Response(sse([chunk])), maxRetries: 0 },
        }));
        await expect(collectText(client)).rejects.toThrow(String(message));
      }
    );

    it(`replaces history images with placeholder text for a text-only model (${issue56})`, async () => {
      const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
        async () =>
          new Response(
            sse([
              { candidates: [{ content: { parts: [{ text: "Answer" }] }, finishReason: "STOP" }] },
            ])
          )
      );
      const client = createPiChatModel({ ...model, input: ["text"] }, async () => ({
        stream: streamGoogle,
        options: { fetch },
      }));
      await collectReply(client, {
        systemPrompt: "System",
        messages: [
          {
            role: "user",
            timestamp: 0,
            content: [
              { type: "text", text: "Look" },
              { type: "image", data: "AQID", mimeType: "image/png" },
            ],
          },
        ],
      });
      expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).contents).toEqual([
        {
          role: "user",
          parts: [{ text: "Look" }, { text: "(image omitted: model does not support images)" }],
        },
      ]);
    });

    it("ends a hung call at the call-level deadline and keeps continuation requests on one signal (https://github.com/ItsDalk-Lane/Scribe/issues/59)", async () => {
      jest.useFakeTimers({ doNotFake: ["nextTick", "queueMicrotask"] });
      try {
        const fetch = jest.fn(
          (_url: unknown, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener(
                "abort",
                () => {
                  const reason: unknown = init.signal?.reason;
                  reject(
                    reason instanceof Error ? reason : new DOMException("Aborted", "AbortError")
                  );
                },
                { once: true }
              );
            })
        );
        const onFailure = jest.fn();
        const client = createPiChatModel(model, async () => ({
          stream: streamGoogle,
          options: { fetch, maxRetries: 0, timeoutMs: 1000 },
        }));
        const pending = collectText(client, "hi", { onFailure, maxRetries: 0 }).catch(
          (error: unknown) => error
        );
        await jest.runAllTimersAsync();
        const failure = await pending;
        expect(failure).toBeInstanceOf(Error);
        expect(onFailure).toHaveBeenCalledWith(expect.objectContaining({ kind: "transient" }));
        expect(fetch).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("streamCohere", () => {
    it(`preserves native v2 history, text, thinking and the token-limit finish reason (${issue})`, async () => {
      const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
        async () =>
          new Response(
            sse([
              { type: "content-delta", delta: { message: { content: { thinking: "Thought" } } } },
              { type: "content-delta", delta: { message: { content: { text: "Reply" } } } },
              {
                type: "message-end",
                delta: {
                  finish_reason: "MAX_TOKENS",
                  usage: { tokens: { input_tokens: 2, output_tokens: 3 } },
                },
              },
            ])
          )
      );
      const result = await collectReply(
        createPiChatModel(model, async () => ({
          stream: streamCohere,
          options: { fetch, maxTokens: 128 },
        })),
        { systemPrompt: "System", messages: [{ role: "user", content: "Input", timestamp: 0 }] }
      );
      expect(result.content).toEqual([
        { type: "thinking", thinking: "Thought" },
        { type: "text", text: "Reply" },
      ]);
      expect(result).toMatchObject({
        stopReason: "length",
        usage: { input: 2, output: 3, totalTokens: 5 },
      });
      expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "Input" },
        ],
        stream: true,
        max_tokens: 128,
      });
    });

    it(`replaces history images with placeholder text for a text-only model (${issue56})`, async () => {
      const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
        async () =>
          new Response(
            sse([
              { type: "content-delta", delta: { message: { content: { text: "Reply" } } } },
              {
                type: "message-end",
                delta: {
                  finish_reason: "COMPLETE",
                  usage: { tokens: { input_tokens: 1, output_tokens: 1 } },
                },
              },
            ])
          )
      );
      const message = {
        role: "user",
        timestamp: 0,
        content: [
          { type: "text", text: "Look" },
          { type: "image", data: "AQID", mimeType: "image/png" },
        ],
      } as const;
      await collectReply(
        createPiChatModel({ ...model, input: ["text"] }, async () => ({
          stream: streamCohere,
          options: { fetch },
        })),
        { systemPrompt: "System", messages: [message] }
      );
      expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).messages[1]).toEqual({
        role: "user",
        content: [
          { type: "text", text: "Look" },
          { type: "text", text: "(image omitted: model does not support images)" },
        ],
      });
    });
  });

  describe("streamOllama", () => {
    it(`retains legacy local context size, thinking, repetition penalty and keyless NDJSON streaming (${issue})`, async () => {
      const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
        async () =>
          new Response(
            [
              { message: { content: "Local ", thinking: "Thought" }, done: false },
              {
                message: { content: "reply" },
                done: true,
                done_reason: "stop",
                prompt_eval_count: 7,
                eval_count: 2,
              },
            ]
              .map((chunk) => JSON.stringify(chunk))
              .join("\n")
          )
      );
      const events = streamOllama(
        model,
        normalizeContext({ messages: [{ role: "user", content: "Input", timestamp: 0 }] }),
        { fetch }
      );
      const reply = await events.result();
      expect(reply.content).toEqual([
        { type: "thinking", thinking: "Thought" },
        { type: "text", text: "Local reply" },
      ]);
      expect(reply.usage).toMatchObject({ input: 7, output: 2, totalTokens: 9 });
      expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toEqual({
        model: "private/model",
        messages: [{ role: "user", content: "Input" }],
        stream: true,
        think: true,
        options: { num_ctx: 16384, repeat_penalty: 1.1 },
      });
      expect(fetch.mock.calls[0][0]).toBe("https://fixture.invalid/api/chat");
    });
    it("omits num_ctx when the context window is unknown so Ollama keeps its own runtime configuration", async () => {
      const fetch = jest.fn(
        async (_url: unknown, init?: { body?: string }) =>
          new Response(
            [{ message: { content: "reply" }, done: true, done_reason: "stop" }]
              .map((chunk) => JSON.stringify(chunk))
              .join("\n"),
            { headers: { "content-type": "application/x-ndjson" } }
          )
      );
      await streamOllama(
        { ...model, contextWindow: 0 },
        normalizeContext({ messages: [{ role: "user", content: "Input", timestamp: 0 }] }),
        { fetch }
      ).result();
      expect(JSON.parse(fetch.mock.calls[0][1]?.body as string).options).toEqual({
        repeat_penalty: 1.1,
      });
    });
    it(`keeps image data only for a vision-capable model and sends none for a text-only one (${issue56})`, async () => {
      const fetch = jest.fn(
        async (_url: unknown, init?: { body?: string }) =>
          new Response(
            [{ message: { content: "reply" }, done: true, done_reason: "stop" }]
              .map((chunk) => JSON.stringify(chunk))
              .join("\n"),
            { headers: { "content-type": "application/x-ndjson" } }
          )
      );
      const sentImages = async (input: Array<"text" | "image">) => {
        await streamOllama(
          { ...model, input },
          normalizeContext({
            messages: [
              {
                role: "user",
                timestamp: 0,
                content: [
                  { type: "text", text: "Look" },
                  { type: "image", data: "AQID", mimeType: "image/png" },
                ],
              },
            ],
          }),
          { fetch }
        ).result();
        const body = JSON.parse(fetch.mock.calls.at(-1)![1]?.body as string) as {
          messages: Array<{ images: string[] }>;
        };
        return body.messages[0].images;
      };
      expect(await sentImages(["text"])).toEqual([]);
      expect(await sentImages(["text", "image"])).toEqual(["AQID"]);
    });
  });
});
