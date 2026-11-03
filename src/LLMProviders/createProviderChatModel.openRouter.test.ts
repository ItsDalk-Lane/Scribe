import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, ModelCapability, ReasoningEffort } from "@/constants";
import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import { collectReply, collectText, fixtureSse, sse } from "@/LLMProviders/testing/piFixtures";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import * as obsidian from "obsidian";

jest.mock("@/logger");
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const wire: CustomModel = {
  name: "private/model",
  provider: ChatModelProviders.OPENROUTERAI,
  enabled: true,
  apiKey: "fixture",
  enableCors: true,
};

describe("createProviderChatModel OpenRouter", () => {
  describe("createProviderChatModel()", () => {
    let requests: Array<{ url: string; body: string; headers: Record<string, string> }>;
    let response: string;
    beforeEach(() => {
      requests = [];
      response = fixtureSse({
        choices: [
          { index: 0, message: { role: "assistant", content: "Reply" }, finish_reason: "stop" },
        ],
      });
      setRequestUrlImpl(async (request: (typeof requests)[number]) => {
        requests.push(request);
        return {
          status: 200,
          text: response,
          json: {},
          headers: { "content-type": "text/event-stream" },
          arrayBuffer: new ArrayBuffer(0),
        };
      });
    });

    it.each([
      [undefined, undefined, { max_tokens: 1024 }],
      [8192, undefined, { max_tokens: 1024 }],
      [undefined, ReasoningEffort.HIGH, { effort: "high" }],
      [undefined, ReasoningEffort.MINIMAL, { effort: "low" }],
    ] as const)(
      `preserves the output limit %s and reasoning effort %s without inventing limits (${issue})`,
      async (maxTokens, reasoningEffort, reasoning) => {
        const client = await createProviderChatModel({
          ...wire,
          maxTokens,
          reasoningEffort,
          capabilities: [ModelCapability.REASONING],
        });
        expect(await collectText(client)).toBe("Reply");
        const body = JSON.parse(requests[0].body) as Record<string, unknown>;
        expect(body.reasoning).toEqual(reasoning);
        expect(body.max_tokens).toBe(maxTokens);
        expect(body).not.toHaveProperty("reasoning_effort");
        expect(body.cache_control).toEqual({ type: "ephemeral" });
        expect(new Headers(requests[0].headers).get("HTTP-Referer")).toBe(
          "https://obsidiancopilot.com"
        );
        expect(new Headers(requests[0].headers).get("X-Title")).toBe("Obsidian Scribe");
      }
    );

    it(`disables optional reasoning and caching without changing system or conversation text (${issue})`, async () => {
      const client = await createProviderChatModel({ ...wire, enablePromptCaching: false });
      const previous = createAssistantMessage(client.model);
      previous.content = [{ type: "text", text: "Previous answer" }];
      previous.stopReason = "stop";
      await collectText(client, {
        systemPrompt: "Original {system} instruction",
        messages: [
          { role: "user", content: "Previous question", timestamp: 0 },
          previous,
          { role: "user", content: "Follow-up", timestamp: 0 },
        ],
      });
      const body = JSON.parse(requests[0].body) as Record<string, unknown>;
      expect(body.messages).toEqual([
        { role: "system", content: "Original {system} instruction" },
        { role: "user", content: "Previous question" },
        { role: "assistant", content: "Previous answer" },
        { role: "user", content: "Follow-up" },
      ]);
      expect(body).not.toHaveProperty("cache_control");
      expect(body).not.toHaveProperty("reasoning");
    });

    it(`assembles streamed tool arguments and keeps assistant/tool-result pairing on replay (${issue})`, async () => {
      const client = await createProviderChatModel(wire);
      response = sse(
        [
          {
            choices: [
              {
                index: 0,
                delta: {
                  tool_calls: [
                    {
                      index: 0,
                      id: "call_1",
                      type: "function",
                      function: { name: "lookupReference", arguments: '{"q":' },
                    },
                  ],
                },
              },
            ],
          },
          {
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index: 0, function: { arguments: '"x"}' } }] },
                finish_reason: "tool_calls",
              },
            ],
          },
        ],
        true
      );
      const result = await collectReply(client);
      expect(result.content).toEqual([
        { type: "toolCall", id: "call_1", name: "lookupReference", arguments: { q: "x" } },
      ]);
      response = fixtureSse({
        choices: [{ index: 0, message: { content: "Reply" }, finish_reason: "stop" }],
      });
      await collectText(client, {
        messages: [
          { role: "user", content: "Lookup", timestamp: 0 },
          result,
          {
            role: "toolResult",
            toolCallId: "call_1",
            toolName: "lookupReference",
            content: [{ type: "text", text: "42" }],
            isError: false,
            timestamp: 0,
          },
        ],
      });
      expect(JSON.parse(requests[1].body).messages).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            role: "assistant",
            tool_calls: [
              {
                id: "call_1",
                type: "function",
                function: { name: "lookupReference", arguments: '{"q":"x"}' },
              },
            ],
          }),
          { role: "tool", tool_call_id: "call_1", content: "42" },
        ])
      );
    });

    it(`does not open a request after cancellation (${issue})`, async () => {
      const client = await createProviderChatModel(wire);
      const controller = new AbortController();
      controller.abort();
      await expect(
        collectText(client, "Question", { signal: controller.signal })
      ).rejects.toMatchObject({ name: "AbortError" });
      expect(requests).toHaveLength(0);
    });
  });
});
