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
  });
});
