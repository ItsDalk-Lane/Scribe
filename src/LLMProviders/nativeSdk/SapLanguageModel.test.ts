import { createSapHttpModel } from "@/LLMProviders/nativeSdk/SapLanguageModel";
import { createPiChatModel } from "@/LLMProviders/piChatModel";
import { collectReply, collectText, sse } from "@/LLMProviders/testing/piFixtures";
import type { Model } from "@earendil-works/pi-ai";

jest.mock("@/logger");
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const descriptor: Model<"scribe-sap"> = {
  id: "gpt-5",
  name: "SAP model",
  provider: "sap-ai",
  api: "scribe-sap",
  baseUrl: "https://sap.invalid",
  input: ["text", "image"],
  reasoning: false,
  contextWindow: 0,
  maxTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function events(records: unknown[], done = true): Response {
  const bytes = new TextEncoder().encode(sse(records, done).replace(/\n/g, "\r\n"));
  return new Response(
    new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 7)
          controller.enqueue(bytes.slice(index, index + 7));
        controller.close();
      },
    })
  );
}

function chat(transport: typeof fetch, maxTokens?: number) {
  return createPiChatModel(descriptor, async () => ({
    stream: createSapHttpModel("https://sap.invalid/v2/completion", {
      "AI-Resource-Group": "group",
    }),
    options: { fetch: transport, maxTokens, maxRetries: 0 },
  }));
}

describe("SapLanguageModel", () => {
  describe("createSapHttpModel", () => {
    it("streams split tool arguments and returns results with the original call ID", async () => {
      const transport = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () =>
        events([
          {
            final_result: {
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: "sap-call",
                        function: { name: "read_note", arguments: '{"path":' },
                      },
                    ],
                  },
                },
              ],
            },
          },
          {
            final_result: {
              choices: [
                {
                  delta: { tool_calls: [{ index: 0, function: { arguments: '"note.md"}' } }] },
                  finish_reason: "tool_calls",
                },
              ],
            },
          },
        ])
      );
      const tools = [
        {
          name: "read_note",
          description: "Read note",
          parameters: { type: "object", properties: { path: { type: "string" } } },
        },
      ];
      const reply = await collectReply(chat(transport), { tools, messages: [] });
      expect(reply).toMatchObject({
        stopReason: "toolUse",
        content: [
          { type: "toolCall", id: "sap-call", name: "read_note", arguments: { path: "note.md" } },
        ],
      });
      await collectReply(chat(transport), {
        tools,
        messages: [
          reply,
          {
            role: "toolResult",
            toolCallId: "sap-call",
            toolName: "read_note",
            content: [{ type: "text", text: "MARKER-42" }],
            isError: false,
            timestamp: 0,
          },
        ],
      });
      const body = JSON.parse(transport.mock.calls[1][1]?.body as string) as {
        config: { modules: { prompt_templating: { prompt: unknown } } };
      };
      expect(body.config.modules.prompt_templating.prompt).toMatchObject({
        tools: [{ type: "function", function: tools[0] }],
        template: [
          {
            role: "assistant",
            tool_calls: [
              { id: "sap-call", function: { name: "read_note", arguments: '{"path":"note.md"}' } },
            ],
          },
          { role: "tool", tool_call_id: "sap-call", content: "MARKER-42" },
        ],
      });
    });

    it(`preserves prompt parameters, reasoning, Unicode text and reported usage across network boundaries (${issue})`, async () => {
      const transport = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () =>
        events([
          { intermediate_results: { templating: [] } },
          {
            final_result: {
              choices: [
                {
                  delta: { content: "原样回复", reasoning_content: [{ content: "思考" }] },
                  finish_reason: "length",
                },
              ],
              usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 9 },
            },
          },
        ])
      );
      const result = await collectReply(chat(transport, 128), "Original input", {
        headers: { "x-opencode-session": "session" },
      });
      expect(result.content).toEqual([
        { type: "thinking", thinking: "思考" },
        { type: "text", text: "原样回复" },
      ]);
      expect(result.usage).toMatchObject({ input: 3, output: 5, totalTokens: 9 });
      expect(result.stopReason).toBe("length");
      const request = transport.mock.calls[0][1]!;
      expect(new Headers(request.headers).get("x-opencode-session")).toBe("session");
      expect(JSON.parse(request.body as string)).toMatchObject({
        config: {
          stream: { enabled: true },
          modules: {
            prompt_templating: {
              model: { name: "gpt-5", params: { max_completion_tokens: 128 } },
              prompt: { template: [{ role: "user", content: "Original input" }] },
            },
          },
        },
      });
    });

    it(`preserves template-looking input and image bytes without invisible characters (${issue})`, async () => {
      const transport = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(async () =>
        events([
          { final_result: { choices: [{ delta: { content: "Reply" }, finish_reason: "stop" }] } },
        ])
      );
      await collectText(chat(transport), {
        messages: [
          {
            role: "user",
            timestamp: 0,
            content: [
              { type: "text", text: "Show {{?private_name}} literally" },
              { type: "image", mimeType: "image/png", data: "AQID" },
            ],
          },
        ],
      });
      const body = transport.mock.calls[0][1]?.body as string;
      expect(JSON.parse(body)).toMatchObject({
        placeholder_values: { scribe_message_0: "Show {{?private_name}} literally" },
        config: {
          modules: {
            prompt_templating: {
              prompt: {
                template: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: "{{?scribe_message_0}}" },
                      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
                    ],
                  },
                ],
              },
            },
          },
        },
      });
      expect(body).not.toContain("\u200b");
    });

    it(`reports a service error without pretending the stream completed (${issue})`, async () => {
      await expect(
        collectText(
          chat(async () => events([{ error: { code: 429, message: "SAP quota exceeded" } }], false))
        )
      ).rejects.toThrow("SAP quota exceeded");
    });

    it(`rejects a truncated reply even when final_result contains a finish reason (${issue})`, async () => {
      await expect(
        collectText(
          chat(async () =>
            events(
              [
                {
                  final_result: {
                    choices: [{ delta: { content: "Partial" }, finish_reason: "stop" }],
                  },
                },
              ],
              false
            )
          )
        )
      ).rejects.toThrow("Unexpected response");
    });

    it(`retains HTTP status for credential classification (${issue})`, async () => {
      await expect(
        collectText(chat(async () => new Response("Unauthorized", { status: 401 })))
      ).rejects.toMatchObject({ status: 401 });
    });

    it(`rejects a successful HTTP response without any completion (${issue})`, async () => {
      await expect(collectText(chat(async () => events([], false)))).rejects.toThrow(
        "Unexpected response"
      );
    });
  });
});
