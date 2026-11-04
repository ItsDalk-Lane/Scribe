import { randomBytes } from "node:crypto";
import { act, renderHook } from "@testing-library/react";
import type { AssistantMessage, AssistantMessageEvent } from "@earendil-works/pi-ai";
import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import { testProviderConnection } from "@/LLMProviders/testProviderConnection";
import { configuredModelToCustomModel, type Provider, type ModelInfo } from "@/modelManagement";
import { useStreamingChatSession } from "@/hooks/use-streaming-chat-session";
import { sse } from "@/LLMProviders/testing/piFixtures";
import * as obsidian from "obsidian";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const apiKey = randomBytes(24).toString("hex");
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
const mockPublished = jest.fn();
jest.mock("@/hooks/use-raf-throttled-callback", () => {
  const publishImmediately = (callback: (value: string) => void) => (value: string) => {
    callback(value);
    mockPublished(value);
  };
  return { useRafThrottledCallback: publishImmediately };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

function anthropicEvents(initial: string, delta: string, multiple = false): unknown[] {
  return [
    {
      type: "message_start",
      message: {
        id: "synthetic-reply",
        type: "message",
        role: "assistant",
        model: "fixture-model",
        content: [],
        usage: { input_tokens: 1, output_tokens: 0 },
        stop_reason: null,
      },
    },
    ...(multiple
      ? [
          {
            type: "content_block_start",
            index: 0,
            content_block: { type: "thinking", thinking: "Hidden thought" },
          },
          { type: "content_block_stop", index: 0 },
          {
            type: "content_block_start",
            index: 1,
            content_block: { type: "tool_use", id: "call_1", name: "lookup", input: {} },
          },
          {
            type: "content_block_delta",
            index: 1,
            delta: { type: "input_json_delta", partial_json: '{"secret":"not visible"}' },
          },
          { type: "content_block_stop", index: 1 },
        ]
      : []),
    { type: "content_block_start", index: 4, content_block: { type: "text", text: initial } },
    ...(delta
      ? [{ type: "content_block_delta", index: 4, delta: { type: "text_delta", text: delta } }]
      : []),
    { type: "content_block_stop", index: 4 },
    ...(multiple
      ? [
          {
            type: "content_block_start",
            index: 7,
            content_block: { type: "text", text: " Third" },
          },
          { type: "content_block_stop", index: 7 },
        ]
      : []),
    { type: "message_delta", delta: { stop_reason: "end_turn" }, usage: { output_tokens: 3 } },
    { type: "message_stop" },
  ];
}

function openRouterEvents(content: unknown): unknown[] {
  return [
    {
      choices: [
        {
          index: 0,
          delta: { content, reasoning_content: "Hidden thought" },
          finish_reason: "stop",
        },
      ],
    },
  ];
}

const cases = [
  {
    name: "Anthropic initial text and delta",
    anthropic: true,
    events: anthropicEvents("First", " second"),
    text: "First second",
  },
  {
    name: "Anthropic initial text only",
    anthropic: true,
    events: anthropicEvents("All here", ""),
    text: "All here",
  },
  {
    name: "Anthropic ordinary delta",
    anthropic: true,
    events: anthropicEvents("", "Plain delta"),
    text: "Plain delta",
  },
  {
    name: "Anthropic indexed text blocks beside thinking and tools",
    anthropic: true,
    events: anthropicEvents("First", " second", true),
    text: "First second Third",
  },
  {
    name: "OpenRouter string array",
    anthropic: false,
    events: openRouterEvents(["Hi", " there"]),
    text: "Hi there",
  },
  {
    name: "OpenRouter mixed text parts",
    anthropic: false,
    events: openRouterEvents([
      "Hi",
      { type: "text", text: " there" },
      { type: "thinking", text: "Hidden" },
    ]),
    text: "Hi there",
  },
  {
    name: "OpenRouter text objects",
    anthropic: false,
    events: openRouterEvents([
      { type: "text", text: "Hi" },
      { type: "text", text: " there" },
    ]),
    text: "Hi there",
  },
  {
    name: "OpenRouter ordinary text",
    anthropic: false,
    events: openRouterEvents("Hi there"),
    text: "Hi there",
  },
];

function configuration(anthropic: boolean, enableCors: boolean) {
  const provider: Provider = {
    providerId: "synthetic-provider",
    providerType: anthropic ? "anthropic" : "openai-compatible",
    displayName: "Synthetic provider",
    baseUrl: "https://gateway.invalid/v1",
    origin: { kind: "byok", catalogProviderId: anthropic ? "anthropic" : "openrouter" },
    requiresApiKey: true,
    enableCors,
    addedAt: 0,
  };
  const info: ModelInfo = {
    id: "fixture-model",
    displayName: "Synthetic model",
    provider: { npm: anthropic ? "@ai-sdk/anthropic" : "@openrouter/ai-sdk-provider" },
  };
  const model = configuredModelToCustomModel({
    provider,
    configuredModel: {
      configuredModelId: "synthetic",
      providerId: provider.providerId,
      info,
      configuredAt: 0,
    },
    apiKey,
  });
  return { provider, info, model };
}

async function readAnswer(events: AsyncIterable<AssistantMessageEvent>) {
  let text = "";
  let message: AssistantMessage | undefined;
  for await (const event of events) {
    if (event.type === "text_delta") text += event.delta;
    if (event.type === "done") message = event.message;
  }
  return {
    text,
    finalText: message?.content.map((part) => (part.type === "text" ? part.text : "")).join(""),
  };
}

function controlledResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
  });
  return {
    response: new Response(body, { headers: { "content-type": "text/event-stream" } }),
    send(events: unknown[]) {
      controller.enqueue(new TextEncoder().encode(sse(events)));
    },
    close() {
      controller.close();
    },
    fail(error: Error) {
      controller.error(error);
    },
  };
}

function observePublished(text: string) {
  const seen = deferred<void>();
  mockPublished.mockImplementation((value: string) => {
    if (value === text) seen.resolve();
  });
  return seen.promise;
}

describe("piChatModel stream compatibility", () => {
  const originalFetch = window.fetch;
  let requests: Array<{ url: string; body: string }>;
  let response: string;

  beforeEach(() => {
    requests = [];
    mockPublished.mockReset();
    setRequestUrlImpl(async (request: { url: string; body: string }) => {
      requests.push(request);
      return {
        status: 200,
        text: response,
        json: {},
        headers: { "content-type": "text/event-stream" },
        arrayBuffer: new ArrayBuffer(0),
      };
    });
    window.fetch = jest.fn(async (url, init) => {
      requests.push({
        url: typeof url === "string" ? url : url instanceof URL ? url.toString() : url.url,
        body: typeof init?.body === "string" ? init.body : "",
      });
      return new Response(response, { headers: { "content-type": "text/event-stream" } });
    });
  });
  afterEach(() => {
    window.fetch = originalFetch;
  });

  describe("createPiChatModel", () => {
    it.each(
      cases.flatMap((fixture) => [false, true].map((enableCors) => ({ ...fixture, enableCors })))
    )(
      `delivers $name once through compatibility=$enableCors and preserves the completed message (${issue})`,
      async (fixture) => {
        response = sse(fixture.events, !fixture.anthropic);
        const { model } = configuration(fixture.anthropic, fixture.enableCors);
        const client = await createProviderChatModel(model);
        expect(
          await readAnswer(
            client.stream({ messages: [{ role: "user", content: "Synthetic note", timestamp: 0 }] })
          )
        ).toEqual({ text: fixture.text, finalText: fixture.text });
      }
    );

    it.each([true, false])(
      `publishes the seeded first block before later bytes arrive for Anthropic=%s (${issue})`,
      async (anthropic) => {
        const reply = controlledResponse();
        window.fetch = jest.fn(async () => reply.response);
        const { model } = configuration(anthropic, false);
        const client = await createProviderChatModel(model);
        const events = client.stream({
          messages: [{ role: "user", content: "Question", timestamp: 0 }],
        });
        const iterator = events[Symbol.asyncIterator]();
        reply.send(
          anthropic ? anthropicEvents("First", "").slice(0, 3) : openRouterEvents(["First"])
        );
        let first = "";
        let firstDelta: unknown;
        while (!first) {
          const event = await iterator.next();
          if (event.done) throw new Error("Missing first streamed text");
          if (event.value.type === "text_delta") {
            firstDelta = event.value.delta;
            first += event.value.delta;
          }
          if (event.value.type === "text_end") break;
        }
        try {
          expect(first).toBe("First");
          expect(firstDelta).toBe("First");
        } finally {
          reply.close();
          await iterator.return?.();
        }
      }
    );

    it(`does not publish a seeded block after the caller stops at its start event (${issue})`, async () => {
      response = sse(anthropicEvents("First", " second"));
      const { model } = configuration(true, true);
      const client = await createProviderChatModel(model);
      const controller = new AbortController();
      const events = client.stream(
        { messages: [{ role: "user", content: "Question", timestamp: 0 }] },
        { signal: controller.signal }
      );
      const iterator = events[Symbol.asyncIterator]();
      try {
        while (true) {
          const event = await iterator.next();
          if (event.done) throw new Error("Missing text block start");
          if (event.value.type === "text_start") break;
        }
        controller.abort();
        await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
      } finally {
        await iterator.return?.();
      }
    });
  });

  describe("useStreamingChatSession", () => {
    it.each(cases)(
      `returns $name and sends that exact accepted answer in the next turn (${issue})`,
      async (fixture) => {
        response = sse(fixture.events, !fixture.anthropic);
        const { model } = configuration(fixture.anthropic, true);
        const { result, unmount } = renderHook(() =>
          useStreamingChatSession({ model, systemPrompt: "Original instruction" })
        );
        try {
          await act(async () => {
            expect(await result.current.runTurn(async () => "First question")).toBe(fixture.text);
          });
          await act(async () => {
            expect(await result.current.runTurn(async () => "Continue")).toBe(fixture.text);
          });
          const body = JSON.parse(requests[1].body) as {
            messages: Array<{ role: string; content: unknown }>;
          };
          expect(body.messages).toEqual(
            expect.arrayContaining([
              {
                role: "assistant",
                content: fixture.anthropic ? [{ type: "text", text: fixture.text }] : fixture.text,
              },
            ])
          );
        } finally {
          unmount();
        }
      }
    );

    it.each(["stop", "error", "timeout"] as const)(
      `keeps seeded text only for an intentional %s and never saves a failed partial answer (${issue})`,
      async (outcome) => {
        const reply = controlledResponse();
        const started = deferred<void>();
        window.fetch = jest.fn(async () => {
          started.resolve();
          return reply.response;
        });
        const { model } = configuration(true, false);
        const onNonAbortError = jest.fn();
        const { result, unmount } = renderHook(() =>
          useStreamingChatSession({ model, systemPrompt: "Original instruction", onNonAbortError })
        );
        let turn!: Promise<string | null>;
        await act(async () => {
          turn = result.current.runTurn(async () => "Question");
          await started.promise;
        });
        const published = observePublished("First");
        await act(async () => {
          reply.send(anthropicEvents("First", "").slice(0, 2));
          await published;
        });
        try {
          await act(async () => {
            if (outcome === "stop") result.current.stop();
            else
              reply.fail(
                outcome === "timeout"
                  ? new DOMException("Synthetic request timeout", "TimeoutError")
                  : new Error("Synthetic connection failure")
              );
            expect(await turn).toBe(outcome === "stop" ? "First" : null);
          });
          expect(result.current.getMemory()?.chatHistory.messages).toHaveLength(
            outcome === "stop" ? 2 : 0
          );
          expect(onNonAbortError).toHaveBeenCalledTimes(outcome === "stop" ? 0 : 1);
        } finally {
          if (outcome === "stop") reply.close();
          unmount();
        }
      }
    );
  });

  describe("testProviderConnection", () => {
    it.each(cases)(
      `accepts the visible $name as a nonempty connection reply (${issue})`,
      async (fixture) => {
        response = sse(fixture.events, !fixture.anthropic);
        const { provider, info } = configuration(fixture.anthropic, true);
        expect(await testProviderConnection({ provider, model: info, apiKey })).toMatchObject({
          ok: true,
        });
      }
    );
  });
});
