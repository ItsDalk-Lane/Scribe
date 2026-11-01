import { createSapHttpModel } from "./SapLanguageModel";
import type { LanguageModelV2StreamPart } from "@ai-sdk/provider";

function reply(payload: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => payload } as Response;
}
function events(records: unknown[], done = true): Response {
  const bytes = new TextEncoder().encode(
    records.map((record) => `data: ${JSON.stringify(record)}\r\n\r\n`).join("") +
      (done ? "data: [DONE]\r\n\r\n" : "")
  );
  return {
    ok: true,
    status: 200,
    body: new ReadableStream({
      start(controller) {
        for (let index = 0; index < bytes.length; index += 7)
          controller.enqueue(bytes.slice(index, index + 7));
        controller.close();
      },
    }),
  } as Response;
}
async function read(
  stream: ReadableStream<LanguageModelV2StreamPart>
): Promise<LanguageModelV2StreamPart[]> {
  const reader = stream.getReader();
  const parts = [];
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) return parts;
      parts.push(next.value);
    }
  } finally {
    reader.releaseLock();
  }
}
const prompt = [
  { role: "user" as const, content: [{ type: "text" as const, text: "Original input" }] },
];

describe("SapLanguageModel", () => {
  describe("createSapHttpModel()", () => {
    it("sends official v2 prompt parameters and returns text, reasoning and token totals", async () => {
      const transport = jest.fn(async () =>
        reply({
          final_result: {
            choices: [
              {
                message: { content: "原样回复", reasoning_content: [{ content: "思考" }] },
                finish_reason: "length",
              },
            ],
            usage: { prompt_tokens: 3, completion_tokens: 5, total_tokens: 9 },
          },
        })
      );
      const model = createSapHttpModel(
        "gpt-5",
        "https://sap.invalid/v2/completion",
        { Authorization: "Bearer fixture", "AI-Resource-Group": "group" },
        transport
      );
      const controller = new AbortController();
      const result = await model.doGenerate({
        prompt,
        maxOutputTokens: 128,
        abortSignal: controller.signal,
        headers: { "x-opencode-session": "session" },
      });
      expect(result.content).toEqual([
        { type: "reasoning", text: "思考" },
        { type: "text", text: "原样回复" },
      ]);
      expect(result.usage).toEqual({ inputTokens: 3, outputTokens: 5, totalTokens: 9 });
      expect(result.finishReason).toBe("length");
      const request = (transport.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
      expect(request.signal).toBe(controller.signal);
      expect(new Headers(request.headers).get("x-opencode-session")).toBe("session");
      expect(JSON.parse(request.body as string)).toMatchObject({
        config: {
          modules: {
            prompt_templating: {
              model: { name: "gpt-5", params: { max_completion_tokens: 128 } },
              prompt: { template: [{ role: "user", content: "Original input" }] },
            },
          },
        },
      });
    });
    it("preserves text containing template syntax and image bytes without invisible characters", async () => {
      const transport = jest.fn(async () =>
        reply({
          final_result: { choices: [{ message: { content: "Reply" }, finish_reason: "stop" }] },
        })
      );
      const model = createSapHttpModel(
        "gemini",
        "https://sap.invalid/v2/completion",
        {},
        transport
      );
      await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [
              { type: "text", text: "Show {{?private_name}} literally" },
              { type: "file", mediaType: "image/png", data: new Uint8Array([1, 2, 3]) },
            ],
          },
        ],
      });
      const request = (transport.mock.calls as unknown as Array<[string, RequestInit]>)[0][1];
      expect(JSON.parse(request.body as string)).toMatchObject({
        placeholder_values: { copilot_message_0: "Show {{?private_name}} literally" },
        config: {
          modules: {
            prompt_templating: {
              prompt: {
                template: [
                  {
                    role: "user",
                    content: [
                      { type: "text", text: "{{?copilot_message_0}}" },
                      { type: "image_url", image_url: { url: "data:image/png;base64,AQID" } },
                    ],
                  },
                ],
              },
            },
          },
        },
      });
      expect(request.body as string).not.toContain("\u200b");
    });
    it("streams UTF-8 text, reasoning and final usage across arbitrary network boundaries", async () => {
      const model = createSapHttpModel("model", "https://sap.invalid", {}, async () =>
        events([
          { intermediate_results: { templating: [] } },
          {
            final_result: {
              choices: [
                {
                  delta: { content: "中文", reasoning_content: [{ content: "思考" }] },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 2, completion_tokens: 4, total_tokens: 6 },
            },
          },
        ])
      );
      const parts = await read((await model.doStream({ prompt })).stream);
      expect(parts).toEqual([
        { type: "reasoning-delta", id: "reasoning", delta: "思考" },
        { type: "text-delta", id: "text", delta: "中文" },
        {
          type: "finish",
          finishReason: "stop",
          usage: { inputTokens: 2, outputTokens: 4, totalTokens: 6 },
        },
      ]);
    });
    it("surfaces a wrapped SSE service error without pretending the stream completed", async () => {
      const model = createSapHttpModel("model", "https://sap.invalid", {}, async () =>
        events([{ error: { code: 429, message: "SAP quota exceeded" } }], false)
      );
      await expect(read((await model.doStream({ prompt })).stream)).rejects.toThrow(
        "SAP quota exceeded"
      );
    });
    it("rejects a truncated SSE reply without the required completion marker", async () => {
      const model = createSapHttpModel("model", "https://sap.invalid", {}, async () =>
        events([{ final_result: { choices: [{ delta: { content: "Partial" } }] } }], false)
      );
      await expect(read((await model.doStream({ prompt })).stream)).rejects.toThrow(
        "Unexpected response"
      );
    });
    it("retains HTTP failure status for the shared retry policy", async () => {
      const model = createSapHttpModel("model", "https://sap.invalid", {}, async () =>
        reply({}, 401)
      );
      await expect(model.doGenerate({ prompt })).rejects.toMatchObject({ statusCode: 401 });
    });
    it("rejects a successful HTTP response that has no completion", async () => {
      const model = createSapHttpModel("model", "https://sap.invalid", {}, async () => reply({}));
      await expect(model.doGenerate({ prompt })).rejects.toThrow("Unexpected response");
    });
  });
});
