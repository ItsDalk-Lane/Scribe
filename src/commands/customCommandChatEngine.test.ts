jest.mock("@/utils/desktopStreamingFetch", () => ({
  loadDesktopStreamingFetch: () => (input: RequestInfo | URL, init?: RequestInit) =>
    window.fetch(input, init),
}));

import { createChatChain, createChatMemory } from "@/commands/customCommandChatEngine";
import { ChatModelProviders } from "@/constants";
import { fixtureSse } from "@/LLMProviders/testing/piFixtures";

jest.mock("@/logger");
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const model = {
  name: "private-model",
  provider: ChatModelProviders.OPENAI_FORMAT,
  providerNpm: "@ai-sdk/openai-compatible",
  baseUrl: "https://fixture.invalid/v1",
  apiKey: "fixture",
  enabled: true,
};

function expectContextRejection(request: () => unknown): void {
  let failure: unknown;
  try {
    request();
  } catch (error) {
    failure = error;
  }
  expect(failure).toMatchObject({ failure: { kind: "context" } });
}

describe("customCommandChatEngine", () => {
  describe("createChatMemory", () => {
    it("creates independent conversation histories", () => {
      const first = createChatMemory();
      first.chatHistory.messages.push({ role: "user", content: "One conversation", timestamp: 0 });
      expect(createChatMemory().chatHistory.messages).toEqual([]);
    });
  });

  describe("createChatChain", () => {
    const originalFetch = window.fetch;
    afterEach(() => {
      window.fetch = originalFetch;
    });

    it.each(["Keep {literal} instructions.", ""])(
      `preserves the system prompt %s and accepted history when the selected model changes (${issue})`,
      async (systemPrompt) => {
        const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
          async () =>
            new Response(
              fixtureSse({
                choices: [{ index: 0, message: { content: "New answer" }, finish_reason: "stop" }],
              })
            )
        );
        window.fetch = fetch;
        const memory = createChatMemory();
        const previous = await createChatChain(model, systemPrompt, memory);
        previous.saveContext("Question", "Accepted partial");
        expect(memory.chatHistory.messages[1]).toMatchObject({
          role: "assistant",
          stopReason: "stop",
        });
        const next = await createChatChain(
          { ...model, name: "another-private-model" },
          systemPrompt,
          memory
        );
        let text = "";
        for await (const event of next.stream("Continue", {}))
          if (event.type === "text_delta") text += event.delta;
        expect(text).toBe("New answer");
        expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
          model: "another-private-model",
          messages: [
            {
              role: "system",
              content:
                systemPrompt ||
                "You are a helpful assistant. You'll help the user with their content editing needs.",
            },
            { role: "user", content: "Question" },
            { role: "assistant", content: "Accepted partial" },
            { role: "user", content: "Continue" },
          ],
        });
        expect(memory.chatHistory.messages).toHaveLength(2);
        next.saveContext("Continue", text);
        expect(memory.chatHistory.messages).toHaveLength(4);
      }
    );
    it("rejects the combined system, history and current input before dispatch and allows a shorter retry without losing history https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      const fetch = jest.fn(
        async () =>
          new Response(
            fixtureSse({
              choices: [{ index: 0, message: { content: "Accepted" }, finish_reason: "stop" }],
            })
          )
      );
      window.fetch = fetch;
      const memory = createChatMemory();
      const chain = await createChatChain(
        { ...model, numCtx: 1000, maxTokens: 200 },
        "System ".repeat(50),
        memory
      );
      chain.saveContext(
        "Keep original note names. " + "Earlier question ".repeat(70),
        "Earlier answer ".repeat(70)
      );
      const saved = [...memory.chatHistory.messages];
      expectContextRejection(() => chain.stream("Current input ".repeat(70), {}));
      expect(fetch).not.toHaveBeenCalled();
      expect(memory.chatHistory.messages).toEqual(saved);
      let text = "";
      for await (const event of chain.stream("Continue", {}))
        if (event.type === "text_delta") text += event.delta;
      expect(text).toBe("Accepted");
      expect(fetch).toHaveBeenCalledTimes(1);
      expect(JSON.stringify(fetch.mock.calls)).toContain("Keep original note names");
    });

    it("reserves the selected output budget before accepting a large current input https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      const fetch = jest.fn(async () => new Response("unused"));
      window.fetch = fetch;
      const chain = await createChatChain(
        { ...model, numCtx: 1000, maxTokens: 600 },
        "System",
        createChatMemory()
      );
      expectContextRejection(() => chain.stream("x".repeat(1500), {}));
      expect(fetch).not.toHaveBeenCalled();
    });

    it("checks a per-call output override instead of the model's smaller default https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      const fetch = jest.fn(async () => new Response("unused"));
      window.fetch = fetch;
      const chain = await createChatChain(
        { ...model, numCtx: 1000, maxTokens: 200 },
        "System",
        createChatMemory()
      );
      expectContextRejection(() => chain.stream("x".repeat(1500), { maxTokens: 600 }));
      expect(fetch).not.toHaveBeenCalled();
    });

    it("rejects a system instruction that exceeds the known window even with a short user input https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      const fetch = jest.fn(async () => new Response("unused"));
      window.fetch = fetch;
      const chain = await createChatChain(
        { ...model, numCtx: 1000, maxTokens: 200 },
        "x".repeat(3000),
        createChatMemory()
      );
      expectContextRejection(() => chain.stream("Hi", {}));
      expect(fetch).not.toHaveBeenCalled();
    });

    it("allows a large input when the model has no known context window https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      window.fetch = jest.fn(
        async () =>
          new Response(
            fixtureSse({
              choices: [{ index: 0, message: { content: "Accepted" }, finish_reason: "stop" }],
            })
          )
      );
      const chain = await createChatChain(model, "System", createChatMemory());
      let text = "";
      for await (const event of chain.stream("x".repeat(10000), {}))
        if (event.type === "text_delta") text += event.delta;
      expect(text).toBe("Accepted");
      expect(window.fetch).toHaveBeenCalledTimes(1);
    });

    it.each([NaN, Infinity, -1, 1100])(
      "rejects an invalid or oversized output budget %s before sending even a short input https://github.com/ItsDalk-Lane/Scribe/issues/64",
      async (maxTokens) => {
        const fetch = jest.fn(async () => new Response("unused"));
        window.fetch = fetch;
        const chain = await createChatChain(
          { ...model, numCtx: 1000, maxTokens: 200 },
          "System",
          createChatMemory()
        );
        expectContextRejection(() => chain.stream("Hi", { maxTokens }));
        expect(fetch).not.toHaveBeenCalled();
      }
    );

    it("keeps an explicitly truncated accepted answer in history with its length stop reason https://github.com/ItsDalk-Lane/Scribe/issues/64", async () => {
      const memory = createChatMemory();
      const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
        async () =>
          new Response(
            fixtureSse({
              choices: [{ index: 0, message: { content: "Continuation" }, finish_reason: "stop" }],
            })
          )
      );
      window.fetch = fetch;
      const chain = await createChatChain(model, "System", memory);
      chain.saveContext("Question", "Partial answer", "length");
      expect(memory.chatHistory.messages[1]).toMatchObject({
        stopReason: "length",
        content: [{ type: "text", text: "Partial answer" }],
      });
      let text = "";
      for await (const event of chain.stream("Continue", {}))
        if (event.type === "text_delta") text += event.delta;
      expect(text).toBe("Continuation");
      expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject({
        messages: [
          { role: "system", content: "System" },
          { role: "user", content: "Question" },
          { role: "assistant", content: "Partial answer" },
          { role: "user", content: "Continue" },
        ],
      });
      expect(memory.chatHistory.messages[1]).toHaveProperty("stopReason", "length");
    });
  });
});
