import type { Model } from "@earendil-works/pi-ai";
import { readJsonStream, streamHttpCompletion } from "@/LLMProviders/piHttpStream";

jest.mock("@/logger");
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const model: Model<"scribe-http"> = {
  id: "fixture",
  name: "Fixture",
  api: "scribe-http",
  provider: "custom",
  baseUrl: "https://fixture.invalid",
  reasoning: true,
  input: ["text"],
  contextWindow: 0,
  maxTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

describe("piHttpStream", () => {
  describe("streamHttpCompletion()", () => {
    it(`emits pi-ai deltas and a single terminal snapshot with reasoning and usage (${issue})`, async () => {
      const source = streamHttpCompletion(model, undefined, async function* () {
        yield { thinking: "Reason" };
        yield { text: "One" };
        yield { text: " two" };
        yield { usage: { input: 3, output: 2, totalTokens: 5 }, finishReason: "length" as const };
      });
      const events = [];
      for await (const event of source) events.push(event);
      expect(events.map((event) => event.type)).toEqual([
        "start",
        "thinking_start",
        "thinking_delta",
        "text_start",
        "text_delta",
        "text_delta",
        "thinking_end",
        "text_end",
        "done",
      ]);
      expect(await source.result()).toMatchObject({
        content: [
          { type: "thinking", thinking: "Reason" },
          { type: "text", text: "One two" },
        ],
        usage: { input: 3, output: 2, totalTokens: 5 },
        stopReason: "length",
      });
    });

    it(`turns a disconnected partial reply into an error, never a successful snapshot (${issue})`, async () => {
      const source = streamHttpCompletion(model, undefined, async function* () {
        yield { text: "Partial" };
        throw new Error("Disconnected");
      });
      expect(await source.result()).toMatchObject({
        stopReason: "error",
        errorMessage: "Disconnected",
      });
      const events = [];
      for await (const event of source) events.push(event);
      expect(events.at(-1)).toMatchObject({ type: "error", reason: "error" });
      expect(events.some((event) => event.type === "done")).toBe(false);
    });
  });

  describe("readJsonStream()", () => {
    it(`decodes split UTF-8, CRLF and multiline SSE data and stops at DONE (${issue})`, async () => {
      const bytes = new TextEncoder().encode(
        'event: content\r\ndata: {"text":\r\ndata: "中文"}\r\n\r\ndata: [DONE]\r\n\r\ndata: {"ignored":true}\r\n\r\n'
      );
      const cancelled = jest.fn();
      const response = new Response(
        new ReadableStream({
          start(controller) {
            for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
          },
          cancel: cancelled,
        })
      );
      const records = [];
      for await (const record of readJsonStream(response)) records.push(record);
      expect(records).toEqual([{ text: "中文" }, "[DONE]"]);
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(response.body?.locked).toBe(false);
    });

    it(`accepts NDJSON whose final record has no newline (${issue})`, async () => {
      const records = [];
      for await (const record of readJsonStream(
        new Response('{"text":"one"}\n{"text":"two"}'),
        undefined,
        true
      ))
        records.push(record);
      expect(records).toEqual([{ text: "one" }, { text: "two" }]);
    });

    it(`cancels a pending reader and releases its lock when generation stops (${issue})`, async () => {
      const cancelled = jest.fn();
      const body = new ReadableStream({ cancel: cancelled });
      const controller = new AbortController();
      const reader = readJsonStream(new Response(body), controller.signal);
      const pending = reader.next();
      controller.abort();
      await expect(pending).rejects.toMatchObject({ name: "AbortError" });
      expect(cancelled).toHaveBeenCalledTimes(1);
      expect(body.locked).toBe(false);
    });

    it(`retains non-success status and rejects malformed or missing response bodies (${issue})`, async () => {
      await expect(
        readJsonStream(new Response("Denied", { status: 403 })).next()
      ).rejects.toMatchObject({ message: "Denied", status: 403 });
      await expect(readJsonStream(new Response("data: not-json\n\n")).next()).rejects.toThrow();
      await expect(readJsonStream(new Response(null)).next()).rejects.toThrow(
        "Unexpected response"
      );
    });
  });
});
