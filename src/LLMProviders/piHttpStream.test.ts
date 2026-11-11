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
  describe("streamHttpCompletion", () => {
    it("gives separate calls unique IDs when the endpoint omits IDs in simultaneous replies", async () => {
      const clock = jest.spyOn(Date, "now").mockReturnValue(1);
      try {
        const reply = async () =>
          streamHttpCompletion(model, undefined, async function* () {
            yield { toolCall: { index: 0, name: "read_note", arguments: {} } };
            yield { finishReason: "toolUse" };
          }).result();
        const [first, second] = await Promise.all([reply(), reply()]);
        const firstCall = first.content[0];
        const secondCall = second.content[0];
        expect(firstCall.type).toBe("toolCall");
        expect(secondCall.type).toBe("toolCall");
        if (firstCall.type !== "toolCall" || secondCall.type !== "toolCall")
          throw new Error("Expected calls");
        expect(firstCall.id).not.toBe(secondCall.id);
      } finally {
        clock.mockRestore();
      }
    });

    it("keeps split arguments unexecutable until the complete call is validated", async () => {
      let release!: () => void;
      const remaining = new Promise<void>((resolve) => {
        release = resolve;
      });
      const source = streamHttpCompletion(model, undefined, async function* () {
        yield { toolCall: { index: 0, id: "call-one", name: "read_note", arguments: '{"path":' } };
        await remaining;
        yield { toolCall: { index: 0, arguments: '"note.md"}' } };
        yield { finishReason: "toolUse" };
      });
      const iterator = source[Symbol.asyncIterator]();
      expect((await iterator.next()).value?.type).toBe("start");
      expect((await iterator.next()).value?.type).toBe("toolcall_start");
      const delta: unknown = (await iterator.next()).value;
      expect(delta).toMatchObject({
        type: "toolcall_delta",
        partial: { content: [{ arguments: {} }] },
      });
      release();
      expect(await source.result()).toMatchObject({
        stopReason: "toolUse",
        content: [{ arguments: { path: "note.md" } }],
      });
    });

    it("marks malformed complete arguments as invalid instead of executing a repaired partial prefix", async () => {
      const source = streamHttpCompletion(model, undefined, async function* () {
        yield {
          toolCall: {
            index: 0,
            id: "call-one",
            name: "read_note",
            arguments: '{"path":"unfinished',
          },
        };
        yield { finishReason: "toolUse" };
      });
      const result = await source.result();
      expect(result).toMatchObject({ content: [{ arguments: {} }] });
      const call = result.content[0];
      expect(typeof (call.type === "toolCall" ? call.argumentsError : undefined)).toBe("string");
    });

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

    it("keeps signed and unsigned content separate and does not merge text across a tool call (https://github.com/ItsDalk-Lane/Scribe/issues/60)", async () => {
      const source = streamHttpCompletion(model, undefined, async function* () {
        yield { text: "Plain" };
        yield { text: " continuation" };
        yield { text: "Signed", textSignature: "dGV4dC0x" };
        yield { text: "", textSignature: "dGV4dC0y" };
        yield { thinking: "Reason", thinkingSignature: "dGhvdWdodA==" };
        yield { toolCall: { index: 0, id: "call-one", name: "read_note", arguments: {} } };
        yield { text: "After tool" };
        yield { finishReason: "toolUse" };
      });
      expect((await source.result()).content).toEqual([
        { type: "text", text: "Plain continuation" },
        { type: "text", text: "Signed", textSignature: "dGV4dC0x" },
        { type: "text", text: "", textSignature: "dGV4dC0y" },
        { type: "thinking", thinking: "Reason", thinkingSignature: "dGhvdWdodA==" },
        { type: "toolCall", id: "call-one", name: "read_note", arguments: {} },
        { type: "text", text: "After tool" },
      ]);
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

  describe("readJsonStream", () => {
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
