import { observeProviderResponse } from "@/LLMProviders/providerResponse";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/31";

describe("providerResponse", () => {
  describe("observeProviderResponse()", () => {
    it(`preserves response bytes and captures split, multiline error events (${issue})`, async () => {
      const chunks = [
        'event: error\ndata: {"error":\n',
        'data: {"code":"insufficient_quota"}}\n\n',
      ];
      const original = chunks.join("");
      const response = new Response(
        new ReadableStream({
          start(controller) {
            chunks.forEach((chunk) => controller.enqueue(new TextEncoder().encode(chunk)));
            controller.close();
          },
        })
      );
      const failed = jest.fn();
      expect(await (await observeProviderResponse(response, failed)).text()).toBe(original);
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ kind: "quota" }));
    });

    it(`observes NDJSON errors while leaving ordinary content untouched (${issue})`, async () => {
      const body = '{"message":{"content":"Hello"}}\n{"error":{"code":"context_length_exceeded"}}';
      const failed = jest.fn();
      expect(await (await observeProviderResponse(new Response(body), failed)).text()).toBe(body);
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ kind: "context" }));
    });

    it(`limits oversized error responses and does not infer a category from unstructured text (${issue})`, async () => {
      const failed = jest.fn();
      const response = await observeProviderResponse(
        new Response("x".repeat(100000), { status: 429 }),
        failed
      );
      expect((await response.text()).length).toBe(65536);
      expect(failed).toHaveBeenCalledWith({ kind: "request", status: 429 });
    });

    it(`skips oversized stream records but still captures a later error (${issue})`, async () => {
      const body = `data: ${"x".repeat(100000)}\n\ndata: {"error":{"code":"insufficient_quota"}}\n\n`;
      const failed = jest.fn();
      expect(await (await observeProviderResponse(new Response(body), failed)).text()).toBe(body);
      expect(failed).toHaveBeenCalledWith(expect.objectContaining({ kind: "quota" }));
    });

    it(`classifies a bodyless error and leaves a bodyless successful response unchanged (${issue})`, async () => {
      const failed = jest.fn();
      const response = new Response(null, { status: 401 });
      expect(await observeProviderResponse(response, failed)).toBe(response);
      expect(failed).toHaveBeenCalledWith({ kind: "auth", status: 401 });
      const empty = new Response(null, { status: 204 });
      failed.mockClear();
      expect(await observeProviderResponse(empty, failed)).toBe(empty);
      expect(failed).not.toHaveBeenCalled();
    });

    it(`cancels the underlying response when its consumer stops (${issue})`, async () => {
      const cancelled = jest.fn();
      const response = await observeProviderResponse(
        new Response(new ReadableStream({ cancel: cancelled })),
        jest.fn()
      );
      await response.body!.cancel("Stopped");
      expect(cancelled).toHaveBeenCalledWith("Stopped");
    });
  });
});
