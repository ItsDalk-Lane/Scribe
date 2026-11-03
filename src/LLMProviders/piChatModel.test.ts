import type { Model } from "@earendil-works/pi-ai";
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
  describe("createAssistantMessage()", () => {
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

  describe("createPiChatModel()", () => {
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
