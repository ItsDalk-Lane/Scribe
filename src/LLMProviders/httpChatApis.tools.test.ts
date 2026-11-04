import type {
  Api,
  Context,
  Model,
  ProviderStreams,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import { streamGoogle, streamCohere, streamOllama } from "@/LLMProviders/httpChatApis";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import { sse } from "@/LLMProviders/testing/piFixtures";

jest.mock("@/logger");

const model: Model<Api> = {
  id: "manual-model-id",
  name: "Manual model",
  api: "scribe-http",
  provider: "fixture",
  baseUrl: "https://fixture.invalid",
  reasoning: false,
  input: ["text", "image"],
  contextWindow: 16384,
  maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

const tools = [
  {
    name: "read_note",
    description: "Read a note",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
];

const protocols: Array<{
  name: string;
  stream: ProviderStreams["stream"];
  response: string;
  callIds: string[];
  requestTools: object;
  expectedResults: object[];
}> = [
  {
    name: "streamGoogle()",
    stream: streamGoogle,
    response: sse([
      {
        candidates: [
          {
            content: {
              parts: [
                {
                  functionCall: { id: "call-one", name: "read_note", args: { path: "one.md" } },
                  thoughtSignature: "signature-one",
                },
                { functionCall: { id: "call-two", name: "read_note", args: { path: "two.md" } } },
              ],
            },
            finishReason: "STOP",
          },
        ],
      },
    ]),
    callIds: ["call-one", "call-two"],
    requestTools: {
      tools: [
        {
          functionDeclarations: tools.map(({ parameters, ...tool }) => ({
            ...tool,
            parametersJsonSchema: parameters,
          })),
        },
      ],
    },
    expectedResults: [
      {
        role: "user",
        parts: [
          {
            functionResponse: { id: "call-two", name: "read_note", response: { error: "Denied" } },
          },
          {
            functionResponse: {
              id: "call-one",
              name: "read_note",
              response: { output: "MARKER-42" },
            },
          },
        ],
      },
    ],
  },
  {
    name: "streamCohere()",
    stream: streamCohere,
    response: sse([
      {
        type: "tool-call-start",
        index: 0,
        delta: {
          message: {
            tool_calls: { id: "call-one", function: { name: "read_note", arguments: '{"path":' } },
          },
        },
      },
      {
        type: "tool-call-start",
        index: 1,
        delta: {
          message: {
            tool_calls: {
              id: "call-two",
              function: { name: "read_note", arguments: '{"path":"two.md"}' },
            },
          },
        },
      },
      {
        type: "tool-call-delta",
        index: 0,
        delta: { message: { tool_calls: { function: { arguments: '"one.md"}' } } } },
      },
      { type: "tool-call-end", index: 0 },
      { type: "tool-call-end", index: 1 },
      { type: "message-end", delta: { finish_reason: "TOOL_CALL" } },
    ]),
    callIds: ["call-one", "call-two"],
    requestTools: { tools: tools.map((tool) => ({ type: "function", function: tool })) },
    expectedResults: [
      { role: "tool", tool_call_id: "call-two", content: "Denied" },
      { role: "tool", tool_call_id: "call-one", content: "MARKER-42" },
    ],
  },
  {
    name: "streamOllama()",
    stream: streamOllama,
    response: [
      {
        message: {
          tool_calls: [
            {
              id: "call-one",
              function: { index: 0, name: "read_note", arguments: { path: "one.md" } },
            },
            {
              id: "call-two",
              function: { index: 1, name: "read_note", arguments: { path: "two.md" } },
            },
          ],
        },
        done: false,
      },
      { done: true, done_reason: "stop" },
    ]
      .map((chunk) => JSON.stringify(chunk))
      .join("\n"),
    callIds: ["call-one", "call-two"],
    requestTools: { tools: tools.map((tool) => ({ type: "function", function: tool })) },
    expectedResults: [
      { role: "tool", tool_name: "read_note", tool_call_id: "call-two", content: "Denied" },
      { role: "tool", tool_name: "read_note", tool_call_id: "call-one", content: "MARKER-42" },
    ],
  },
];

describe("httpChatApis", () => {
  for (const protocol of protocols) {
    describe(protocol.name, () => {
      it("declares tools for a manual model and returns two independent structured calls", async () => {
        const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
          async () => new Response(protocol.response)
        );
        const source = protocol.stream(model, normalizeContext({ tools, messages: [] }), { fetch });
        const reply = await source.result();
        expect(reply.stopReason).toBe("toolUse");
        expect(reply.content).toEqual([
          expect.objectContaining({
            type: "toolCall",
            id: protocol.callIds[0],
            name: "read_note",
            arguments: { path: "one.md" },
          }),
          expect.objectContaining({
            type: "toolCall",
            id: protocol.callIds[1],
            name: "read_note",
            arguments: { path: "two.md" },
          }),
        ]);
        expect(JSON.parse(fetch.mock.calls[0][1]?.body as string)).toMatchObject(
          protocol.requestTools
        );
        const events = [];
        for await (const event of source) events.push(event.type);
        expect(events.filter((type) => type === "toolcall_start")).toHaveLength(2);
        expect(events.filter((type) => type === "toolcall_end")).toHaveLength(2);
      });

      it("returns out-of-order successful and failed results under their original calls", async () => {
        const assistant = createAssistantMessage(model);
        assistant.stopReason = "toolUse";
        assistant.content = [
          {
            type: "toolCall",
            id: "call-one",
            name: "read_note",
            arguments: { path: "one.md" },
            thoughtSignature: "signature-one",
          },
          { type: "toolCall", id: "call-two", name: "read_note", arguments: { path: "two.md" } },
        ];
        const result = (id: string, text: string, isError: boolean): ToolResultMessage => ({
          role: "toolResult",
          toolCallId: id,
          toolName: "read_note",
          content: [{ type: "text", text }],
          isError,
          timestamp: 0,
        });
        const context: Context = {
          tools,
          messages: [
            assistant,
            result("call-two", "Denied", true),
            result("call-one", "MARKER-42", false),
          ],
        };
        const fetch = jest.fn<ReturnType<typeof window.fetch>, Parameters<typeof window.fetch>>(
          async () => new Response(protocol.response)
        );
        const reply = await protocol.stream(model, normalizeContext(context), { fetch }).result();
        expect(reply.stopReason).toBe("toolUse");
        const request = JSON.parse(fetch.mock.calls[0][1]?.body as string) as Record<
          string,
          unknown
        >;
        expect(request.contents ?? request.messages).toEqual(
          expect.arrayContaining(protocol.expectedResults)
        );
      });
    });
  }
});
