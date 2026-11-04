import type { CustomModel } from "@/aiParams";
import { ModelCapability, ReasoningEffort } from "@/constants";
import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import { sse } from "@/LLMProviders/testing/piFixtures";
import * as obsidian from "obsidian";

jest.mock("@/logger");

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

type Protocol = "completions" | "responses" | "anthropic" | "google" | "cohere" | "ollama" | "sap";

const providers: Array<{ label: string; protocol: Protocol; model: Partial<CustomModel> }> = [
  {
    label: "Chat Completions",
    protocol: "completions",
    model: { providerNpm: "@ai-sdk/openai-compatible" },
  },
  { label: "Responses", protocol: "responses", model: { providerNpm: "@ai-sdk/openai" } },
  {
    label: "Anthropic Messages",
    protocol: "anthropic",
    model: { providerNpm: "@ai-sdk/anthropic" },
  },
  { label: "Google", protocol: "google", model: { providerNpm: "@ai-sdk/google" } },
  {
    label: "Vertex Google",
    protocol: "google",
    model: {
      providerNpm: "@ai-sdk/google-vertex",
      providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
    },
  },
  {
    label: "Vertex Anthropic",
    protocol: "anthropic",
    model: {
      providerNpm: "@ai-sdk/google-vertex/anthropic",
      providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
    },
  },
  { label: "Cohere", protocol: "cohere", model: { providerNpm: "@ai-sdk/cohere" } },
  { label: "Ollama", protocol: "ollama", model: { providerNpm: "scribe-ollama" } },
  {
    label: "GitLab Chat",
    protocol: "completions",
    model: {
      providerNpm: "gitlab-ai-provider",
      name: "duo-chat-gpt-5-1",
      providerOptions: {
        GITLAB_INSTANCE_URL: "https://fixture.invalid/gitlab",
        GITLAB_AI_GATEWAY_URL: "https://fixture.invalid/gateway",
      },
    },
  },
  {
    label: "GitLab Responses",
    protocol: "responses",
    model: {
      providerNpm: "gitlab-ai-provider",
      name: "duo-chat-gpt-6-sol",
      providerOptions: {
        GITLAB_INSTANCE_URL: "https://fixture.invalid/gitlab",
        GITLAB_AI_GATEWAY_URL: "https://fixture.invalid/gateway",
      },
    },
  },
  {
    label: "GitLab Anthropic",
    protocol: "anthropic",
    model: {
      providerNpm: "gitlab-ai-provider",
      name: "duo-chat-sonnet-5",
      providerOptions: {
        GITLAB_INSTANCE_URL: "https://fixture.invalid/gitlab",
        GITLAB_AI_GATEWAY_URL: "https://fixture.invalid/gateway",
      },
    },
  },
  {
    label: "SAP",
    protocol: "sap",
    model: {
      providerNpm: "@jerome-benoit/sap-ai-provider-v2",
      providerOptions: { AICORE_DEPLOYMENT_ID: "fixture-deployment" },
      apiKey: JSON.stringify({
        clientid: "fixture",
        clientsecret: "fixture",
        url: "https://fixture.invalid/auth",
        serviceurls: { AI_API_URL: "https://fixture.invalid/sap" },
      }),
    },
  },
];

function providerReply(protocol: Protocol, withTools: boolean): string {
  const calls = ["one", "two"].map((suffix) => ({
    id: `call-${suffix}`,
    name: "read_note",
    arguments: { path: `${suffix}.md` },
  }));
  if (protocol === "google")
    return sse([
      {
        candidates: [
          {
            content: {
              parts: withTools
                ? calls.map((call) => ({
                    functionCall: { id: call.id, name: call.name, args: call.arguments },
                  }))
                : [{ text: "MARKER-42" }],
            },
            finishReason: "STOP",
          },
        ],
      },
    ]);
  if (protocol === "ollama")
    return [
      {
        message: withTools
          ? {
              tool_calls: calls.map((call, index) => ({
                id: call.id,
                function: { index, name: call.name, arguments: call.arguments },
              })),
            }
          : { content: "MARKER-42" },
      },
      { done: true, done_reason: "stop" },
    ]
      .map((value) => JSON.stringify(value))
      .join("\n");
  if (protocol === "cohere")
    return sse([
      ...(withTools
        ? calls.flatMap((call, index) => [
            {
              type: "tool-call-start",
              index,
              delta: {
                message: {
                  tool_calls: { id: call.id, function: { name: call.name, arguments: '{"path":' } },
                },
              },
            },
            {
              type: "tool-call-delta",
              index,
              delta: {
                message: {
                  tool_calls: {
                    function: { arguments: JSON.stringify(call.arguments.path) + "}" },
                  },
                },
              },
            },
            { type: "tool-call-end", index },
          ])
        : [{ type: "content-delta", delta: { message: { content: { text: "MARKER-42" } } } }]),
      { type: "message-end", delta: { finish_reason: withTools ? "TOOL_CALL" : "COMPLETE" } },
    ]);
  if (protocol === "anthropic")
    return sse([
      {
        type: "message_start",
        message: {
          id: "fixture-message",
          type: "message",
          role: "assistant",
          model: "manual-model",
          content: [],
          stop_reason: null,
          usage: { input_tokens: 2, output_tokens: 0 },
        },
      },
      ...(withTools
        ? calls.flatMap((call, index) => [
            {
              type: "content_block_start",
              index,
              content_block: { type: "tool_use", id: call.id, name: call.name, input: {} },
            },
            {
              type: "content_block_delta",
              index,
              delta: { type: "input_json_delta", partial_json: JSON.stringify(call.arguments) },
            },
            { type: "content_block_stop", index },
          ])
        : [
            { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
            {
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "MARKER-42" },
            },
            { type: "content_block_stop", index: 0 },
          ]),
      {
        type: "message_delta",
        delta: { stop_reason: withTools ? "tool_use" : "end_turn" },
        usage: { output_tokens: 2 },
      },
      { type: "message_stop" },
    ]);
  if (protocol === "responses") {
    const output = withTools
      ? calls.map((call) => ({
          type: "function_call",
          id: `fc-${call.id}`,
          call_id: call.id,
          name: call.name,
          arguments: JSON.stringify(call.arguments),
          status: "completed",
        }))
      : [
          {
            type: "message",
            id: "message-one",
            role: "assistant",
            status: "completed",
            content: [{ type: "output_text", text: "MARKER-42", annotations: [] }],
          },
        ];
    return sse([
      {
        type: "response.created",
        response: { id: "response-one", status: "in_progress", output: [] },
      },
      ...(withTools
        ? calls.flatMap((call, output_index) => [
            {
              type: "response.output_item.added",
              output_index,
              item: {
                type: "function_call",
                id: `fc-${call.id}`,
                call_id: call.id,
                name: call.name,
                arguments: "",
              },
            },
            {
              type: "response.function_call_arguments.delta",
              output_index,
              item_id: `fc-${call.id}`,
              delta: JSON.stringify(call.arguments),
            },
            { type: "response.output_item.done", output_index, item: output[output_index] },
          ])
        : [
            {
              type: "response.output_item.added",
              output_index: 0,
              item: { ...output[0], content: [] },
            },
            {
              type: "response.output_text.delta",
              output_index: 0,
              content_index: 0,
              item_id: "message-one",
              delta: "MARKER-42",
            },
            { type: "response.output_item.done", output_index: 0, item: output[0] },
          ]),
      {
        type: "response.completed",
        response: {
          id: "response-one",
          status: "completed",
          output,
          usage: { input_tokens: 2, output_tokens: 2, total_tokens: 4 },
        },
      },
    ]);
  }
  const chunks = withTools
    ? [
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: calls.map((call, index) => ({
                  index,
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: '{"path":' },
                })),
              },
              finish_reason: null,
            },
          ],
        },
        {
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: calls.map((call, index) => ({
                  index,
                  function: { arguments: JSON.stringify(call.arguments.path) + "}" },
                })),
              },
              finish_reason: "tool_calls",
            },
          ],
        },
      ]
    : [{ choices: [{ index: 0, delta: { content: "MARKER-42" }, finish_reason: "stop" }] }];
  return sse(protocol === "sap" ? chunks.map((chunk) => ({ final_result: chunk })) : chunks, true);
}

describe("createProviderChatModel", () => {
  describe("createProviderChatModel()", () => {
    const originalFetch = window.fetch;
    afterEach(() => {
      window.fetch = originalFetch;
      setRequestUrlImpl(undefined);
    });

    it.each(providers)(
      "$label distinguishes explicit reasoning disablement from the unchanged provider default",
      async ({ model, protocol }) => {
        const requests: Record<string, unknown>[] = [];
        window.fetch = jest.fn(async (input, init) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.endsWith("/oauth/token"))
            return new Response(
              JSON.stringify({ access_token: "fixture-access", expires_in: 3600 })
            );
          if (url.endsWith("/direct_access"))
            return new Response(JSON.stringify({ token: "fixture-access", headers: {} }));
          requests.push(JSON.parse(init?.body as string) as Record<string, unknown>);
          return new Response(providerReply(protocol, false), {
            headers: { "content-type": "text/event-stream" },
          });
        });
        const client = await createProviderChatModel({
          name: "manual-model",
          provider: "fixture",
          apiKey: "fixture-access",
          baseUrl: "https://fixture.invalid/v1",
          enabled: true,
          ...model,
          capabilities: [ModelCapability.REASONING],
          reasoningEffort: ReasoningEffort.HIGH,
          enableCors: false,
        });
        await client.agentStream({ messages: [] }).result();
        await client
          .agentStream({ messages: [] }, { reasoning: undefined, ...{ disableReasoning: true } })
          .result();
        await client.agentStream({ messages: [] }).result();
        expect(requests[2]).toEqual(requests[0]);
        const body = requests[1];
        if (protocol === "completions") expect(body).toMatchObject({ reasoning_effort: "none" });
        if (protocol === "responses") expect(body).toMatchObject({ reasoning: { effort: "none" } });
        if (protocol === "anthropic")
          expect(body).toMatchObject({ thinking: { type: "disabled" } });
        if (protocol === "google")
          expect(body).toMatchObject({
            generationConfig: { thinkingConfig: { thinkingBudget: 0, includeThoughts: false } },
          });
        if (protocol === "cohere") expect(body).toMatchObject({ thinking: { type: "disabled" } });
        if (protocol === "ollama") expect(body).toMatchObject({ think: false });
        if (protocol === "sap")
          expect(body).toMatchObject({
            config: {
              modules: { prompt_templating: { model: { params: { reasoning_effort: "none" } } } },
            },
          });
      }
    );

    it.each([
      {
        protocol: "completions",
        providerNpm: "@ai-sdk/openai-compatible",
        rawStopReason: "content_filter",
      },
      { protocol: "anthropic", providerNpm: "@ai-sdk/anthropic", rawStopReason: "refusal" },
      { protocol: "responses", providerNpm: "@ai-sdk/openai", rawStopReason: "refusal" },
    ] as const)(
      "$protocol preserves the provider's structured refusal reason for Agent Chat",
      async ({ protocol, providerNpm, rawStopReason }) => {
        const response =
          protocol === "completions"
            ? sse(
                [
                  {
                    choices: [
                      {
                        index: 0,
                        delta: { content: "Unavailable" },
                        finish_reason: "content_filter",
                      },
                    ],
                  },
                ],
                true
              )
            : protocol === "anthropic"
              ? providerReply("anthropic", false).replace(
                  '"stop_reason":"end_turn"',
                  '"stop_reason":"refusal"'
                )
              : sse([
                  {
                    type: "response.created",
                    response: { id: "response-refusal", status: "in_progress", output: [] },
                  },
                  {
                    type: "response.output_item.added",
                    output_index: 0,
                    item: {
                      type: "message",
                      id: "message-refusal",
                      role: "assistant",
                      status: "in_progress",
                      content: [],
                    },
                  },
                  {
                    type: "response.refusal.delta",
                    output_index: 0,
                    content_index: 0,
                    item_id: "message-refusal",
                    delta: "Unavailable",
                  },
                  {
                    type: "response.output_item.done",
                    output_index: 0,
                    item: {
                      type: "message",
                      id: "message-refusal",
                      role: "assistant",
                      status: "completed",
                      content: [{ type: "refusal", refusal: "Unavailable" }],
                    },
                  },
                  {
                    type: "response.completed",
                    response: {
                      id: "response-refusal",
                      status: "completed",
                      output: [],
                      usage: { input_tokens: 2, output_tokens: 1, total_tokens: 3 },
                    },
                  },
                ]);
        window.fetch = jest.fn(
          async () => new Response(response, { headers: { "content-type": "text/event-stream" } })
        );
        const client = await createProviderChatModel({
          name: "manual-model",
          provider: "fixture",
          providerNpm,
          apiKey: "fixture",
          baseUrl: "https://fixture.invalid/v1",
          enabled: true,
          enableCors: false,
        });
        const reply = await client.agentStream({ messages: [] }).result();
        expect(reply).toMatchObject({
          rawStopReason,
          content: [{ type: "text", text: protocol === "anthropic" ? "MARKER-42" : "Unavailable" }],
        });
      }
    );

    it.each(providers)(
      "$label applies an explicitly selected reasoning level to the original protocol",
      async ({ model, protocol }) => {
        const requests: Record<string, unknown>[] = [];
        window.fetch = jest.fn(async (input, init) => {
          const url =
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
          if (url.endsWith("/oauth/token"))
            return new Response(
              JSON.stringify({ access_token: "fixture-access", expires_in: 3600 })
            );
          if (url.endsWith("/direct_access"))
            return new Response(JSON.stringify({ token: "fixture-access", headers: {} }));
          requests.push(JSON.parse(init?.body as string) as Record<string, unknown>);
          return new Response(providerReply(protocol, false), {
            headers: { "content-type": "text/event-stream" },
          });
        });
        const client = await createProviderChatModel({
          name: "manual-model",
          provider: "fixture",
          apiKey: "fixture-access",
          baseUrl: "https://fixture.invalid/v1",
          enabled: true,
          ...model,
          capabilities: [ModelCapability.REASONING],
          enableCors: false,
        });
        const reply = await client
          .agentStream({ messages: [] }, { reasoning: "high", maxTokens: 4096 })
          .result();
        expect(reply.errorMessage).toBeUndefined();
        expect(reply.stopReason).toBe("stop");
        const body = requests[0];
        if (protocol === "completions")
          expect(body).toMatchObject({ reasoning_effort: "high", max_tokens: 4096 });
        if (protocol === "responses")
          expect(body).toMatchObject({ reasoning: { effort: "high" }, max_output_tokens: 4096 });
        if (protocol === "anthropic")
          expect(body).toMatchObject({
            thinking: { type: "enabled", budget_tokens: 3072 },
            max_tokens: 4096,
          });
        if (protocol === "google")
          expect(body).toMatchObject({
            generationConfig: {
              maxOutputTokens: 4096,
              thinkingConfig: { includeThoughts: true, thinkingBudget: 3072 },
            },
          });
        if (protocol === "cohere")
          expect(body).toMatchObject({
            thinking: { type: "enabled", token_budget: 3072 },
            max_tokens: 4096,
          });
        if (protocol === "ollama")
          expect(body).toMatchObject({ think: "high", options: { num_predict: 4096 } });
        if (protocol === "sap")
          expect(body).toMatchObject({
            config: {
              modules: {
                prompt_templating: {
                  model: { params: { reasoning_effort: "high", max_completion_tokens: 4096 } },
                },
              },
            },
          });
      }
    );

    it.each(
      providers.flatMap((provider) =>
        [false, true].map((enableCors) => ({ ...provider, enableCors }))
      )
    )(
      "$label completes a tool-result continuation through CORS=$enableCors without changing the selected endpoint",
      async ({ model, protocol, enableCors }) => {
        const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
        const respond = (url: string, body = ""): Response => {
          if (url.endsWith("/oauth/token"))
            return new Response(
              JSON.stringify({ access_token: "fixture-access", expires_in: 3600 })
            );
          if (url.endsWith("/direct_access"))
            return new Response(JSON.stringify({ token: "fixture-access", headers: {} }));
          requests.push({ url, body: JSON.parse(body) as Record<string, unknown> });
          return new Response(providerReply(protocol, requests.length === 1), {
            headers: { "content-type": "text/event-stream" },
          });
        };
        window.fetch = jest.fn(async (input, init) =>
          respond(
            typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
            init?.body as string
          )
        );
        setRequestUrlImpl(async (input: { url: string; body?: string }) => {
          const response = respond(input.url, input.body);
          const text = await response.text();
          let json: unknown;
          try {
            json = JSON.parse(text);
          } catch {
            json = undefined;
          }
          return {
            status: response.status,
            text,
            json,
            headers: Object.fromEntries(response.headers.entries()),
            arrayBuffer: new ArrayBuffer(0),
          };
        });
        const client = await createProviderChatModel({
          name: "manual-model",
          provider: "fixture",
          apiKey: "fixture-access",
          baseUrl: "https://fixture.invalid/v1",
          enabled: true,
          ...model,
          enableCors,
        });
        const tools = [
          {
            name: "read_note",
            description: "Read a note",
            parameters: {
              type: "object",
              properties: { path: { type: "string" } },
              required: ["path"],
            },
          },
        ];
        const first = await client
          .agentStream(
            { tools, messages: [{ role: "user", content: "Read both notes", timestamp: 0 }] },
            { apiKey: undefined, maxTokens: undefined }
          )
          .result();
        expect(first.errorMessage).toBeUndefined();
        expect(first.stopReason).toBe("toolUse");
        expect(first.content.filter((part) => part.type === "toolCall")).toEqual([
          expect.objectContaining({
            id: protocol === "responses" ? "call-one|fc-call-one" : "call-one",
            name: "read_note",
            arguments: { path: "one.md" },
          }),
          expect.objectContaining({
            id: protocol === "responses" ? "call-two|fc-call-two" : "call-two",
            name: "read_note",
            arguments: { path: "two.md" },
          }),
        ]);
        expect(JSON.stringify(requests[0].body)).toContain(
          protocol === "anthropic" ? '"input_schema"' : '"parameters'
        );
        const second = await client
          .agentStream({
            tools,
            messages: [
              first,
              ...first.content
                .filter((part) => part.type === "toolCall")
                .reverse()
                .map(({ id: toolCallId }) => ({
                  role: "toolResult" as const,
                  toolCallId,
                  toolName: "read_note",
                  content: [{ type: "text" as const, text: "MARKER-42" }],
                  isError: toolCallId.includes("call-two"),
                  timestamp: 0,
                })),
            ],
          })
          .result();
        expect(second.stopReason).toBe("stop");
        expect(second.content.filter((part) => part.type === "text")).toMatchObject([
          { text: "MARKER-42" },
        ]);
        expect(requests).toHaveLength(2);
        expect(requests.every(({ url }) => new URL(url).hostname === "fixture.invalid")).toBe(true);
        expect(JSON.stringify(requests[1].body)).toContain("MARKER-42");
        expect(JSON.stringify(requests[1].body)).toContain("call-two");
        expect(JSON.stringify(requests[1].body)).toContain("call-one");
        if (
          (protocol === "completions" || protocol === "responses") &&
          model.providerNpm !== "gitlab-ai-provider"
        ) {
          expect(requests[0].body).not.toHaveProperty("max_tokens");
          expect(requests[0].body).not.toHaveProperty("max_output_tokens");
        }
      }
    );
  });
});
