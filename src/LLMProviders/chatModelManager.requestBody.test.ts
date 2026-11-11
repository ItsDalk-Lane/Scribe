import { Platform } from "obsidian";
import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, DEFAULT_MAX_OUTPUT_TOKENS } from "@/constants";
import { getSettings, setSettings } from "@/settings/model";

import * as obsidianModule from "obsidian";

import ChatModelManager from "./chatModelManager";
import { collectText, fixtureSse } from "@/LLMProviders/testing/piFixtures";

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

const OPENAI_RESPONSE = JSON.stringify({
  id: "chatcmpl-1",
  object: "chat.completion",
  created: 1,
  model: "test-model",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
});

const ANTHROPIC_RESPONSE = JSON.stringify({
  id: "msg_1",
  type: "message",
  role: "assistant",
  model: "claude-sonnet-4-5",
  content: [{ type: "text", text: "ok" }],
  stop_reason: "end_turn",
  usage: { input_tokens: 1, output_tokens: 1 },
});

const RETIRED_SAMPLING_PARAMS = ["temperature", "top_p", "frequency_penalty"];

const RESPONSES_API_RESPONSE = JSON.stringify({
  id: "resp_1",
  object: "response",
  created_at: 1,
  model: "gpt-6-luna",
  status: "completed",
  output: [
    {
      type: "message",
      id: "msg_1",
      role: "assistant",
      status: "completed",
      content: [{ type: "output_text", text: "ok", annotations: [] }],
    },
  ],
  usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
});

const LOOKUP_TOOL = {
  type: "function",
  function: {
    name: "lookupReference",
    description: "Look up a reference",
    parameters: { type: "object", properties: { query: { type: "string" } } },
  },
};

interface CapturedRequest {
  url: string;
  body: Record<string, unknown>;
  headers?: Record<string, string>;
}

function captureRequest(responseText: string): () => CapturedRequest {
  let captured: CapturedRequest = { url: "", body: {} };
  const parsedResponse = JSON.parse(responseText) as Record<string, unknown>;
  setRequestUrlImpl((request: { url: string; body?: string; headers?: Record<string, string> }) => {
    captured = {
      url: request.url,
      headers: request.headers,
      body: request.body ? (JSON.parse(request.body) as Record<string, unknown>) : {},
    };
    return Promise.resolve({
      status: 200,
      text: fixtureSse(parsedResponse),
      json: parsedResponse,
      arrayBuffer: new ArrayBuffer(0),
      headers: { "content-type": "text/event-stream" },
    });
  });
  return () => captured;
}

function captureRequestBody(responseText: string): () => Record<string, unknown> {
  const request = captureRequest(responseText);
  return () => request().body;
}

function wireModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "test-model",
    provider: ChatModelProviders.OPENAI_FORMAT,
    enabled: true,
    stream: false,
    apiKey: "test-key",
    baseUrl: "https://provider.invalid/v1",
    ...overrides,
  };
}

function respondWithBadRequest(message: string): void {
  const body = JSON.stringify({ error: { message, type: "invalid_request_error" } });
  setRequestUrlImpl(() =>
    Promise.resolve({
      status: 400,
      text: body,
      json: JSON.parse(body) as Record<string, unknown>,
      arrayBuffer: new ArrayBuffer(0),
      headers: { "content-type": "application/json" },
    })
  );
}

async function send(model: CustomModel): Promise<void> {
  const instance = await ChatModelManager.getInstance().createModelInstanceFromBridged(model);
  await collectText(instance);
}

async function sendWithTools(model: CustomModel): Promise<void> {
  const instance = await ChatModelManager.getInstance().createModelInstanceFromBridged(model);
  await collectText(instance, {
    tools: [LOOKUP_TOOL.function],
    messages: [{ role: "user", content: "hi", timestamp: 0 }],
  });
}

describe("chatModelManager", () => {
  beforeEach(() => {
    Platform.isMobile = true;
  });
  afterEach(() => {
    Platform.isMobile = false;
  });

  describe("ChatModelManager", () => {
    describe("createModelInstanceFromBridged", () => {
      const originalOpenAIOrgId = getSettings().openAIOrgId;
      afterEach(() => setSettings({ openAIOrgId: originalOpenAIOrgId }));

      it.each([
        [undefined, "global-organization"],
        ["model-organization", "model-organization"],
        ["", "global-organization"],
      ])(
        "resolves per-model organization %s to request organization %s for official OpenAI",
        async (openAIOrgId, expected) => {
          setSettings({ openAIOrgId: "global-organization" });
          const request = captureRequest(RESPONSES_API_RESPONSE);
          await send(
            wireModel({
              name: "gpt-6-luna",
              provider: ChatModelProviders.OPENAI,
              providerCatalogId: "openai",
              providerNpm: "@ai-sdk/openai",
              baseUrl: "https://api.openai.com/v1",
              openAIOrgId,
            })
          );
          expect(request().url).toBe("https://api.openai.com/v1/responses");
          expect(new Headers(request().headers).get("OpenAI-Organization")).toBe(expected);
        }
      );

      it.each(["@ai-sdk/openai-compatible", "@ai-sdk/openai"])(
        "does not send the global OpenAI organization to another supplier using %s",
        async (providerNpm) => {
          setSettings({ openAIOrgId: "global-organization-must-not-leak" });
          const request = captureRequest(
            providerNpm === "@ai-sdk/openai" ? RESPONSES_API_RESPONSE : OPENAI_RESPONSE
          );
          await send(
            wireModel({
              provider: ChatModelProviders.OPENAI_FORMAT,
              providerCatalogId: "other-supplier",
              providerNpm,
            })
          );
          expect(new URL(request().url).hostname).toBe("provider.invalid");
          expect(new Headers(request().headers).has("OpenAI-Organization")).toBe(false);
        }
      );

      it("sends an OpenAI-compatible request with no output limit at all", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(wireModel());

        expect(body()).not.toHaveProperty("max_tokens");
        expect(body()).not.toHaveProperty("max_completion_tokens");
      });

      it("sends no sampling parameters, so the provider applies its own defaults", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(wireModel());

        for (const param of RETIRED_SAMPLING_PARAMS) {
          expect(body()).not.toHaveProperty(param);
        }
      });

      it("sends Anthropic no sampling parameters either", async () => {
        const body = captureRequestBody(ANTHROPIC_RESPONSE);

        await send(
          wireModel({
            name: "claude-sonnet-4-5",
            provider: ChatModelProviders.ANTHROPIC,
            baseUrl: "https://anthropic.invalid",
            maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          })
        );

        for (const param of RETIRED_SAMPLING_PARAMS) {
          expect(body()).not.toHaveProperty(param);
        }
      });

      it.each(["claude-opus-4-7", "claude-sonnet-4-6", "claude-opus-5"])(
        "sends Anthropic model %s no thinking configuration, so it runs at the provider's default",
        async (name) => {
          const body = captureRequestBody(ANTHROPIC_RESPONSE);

          await send(
            wireModel({
              name,
              provider: ChatModelProviders.ANTHROPIC,
              baseUrl: "https://anthropic.invalid",
              maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
            })
          );

          expect(body()).not.toHaveProperty("thinking");
        }
      );

      it("surfaces a rejected request as the provider's own message rather than a connection failure", async () => {
        respondWithBadRequest("invalid temperature: only 1 is allowed for this model");

        const error = await send(wireModel()).catch((raised: unknown) => raised);

        expect(error).toMatchObject({ status: 400 });
        expect(String(error)).toContain("invalid temperature: only 1 is allowed for this model");
        expect(String(error)).not.toContain("Connection error");
      });

      it("stops retrying a request the provider has rejected", async () => {
        let attempts = 0;
        const body = JSON.stringify({ error: { message: "nope", type: "invalid_request_error" } });
        setRequestUrlImpl(() => {
          attempts += 1;
          return Promise.resolve({
            status: 400,
            text: body,
            json: JSON.parse(body) as Record<string, unknown>,
            arrayBuffer: new ArrayBuffer(0),
            headers: { "content-type": "application/json" },
          });
        });

        await expect(send(wireModel())).rejects.toThrow();

        expect(attempts).toBe(1);
      });

      it("sends an OpenAI model with tools to the Responses API at the model's default effort", async () => {
        const request = captureRequest(RESPONSES_API_RESPONSE);

        await sendWithTools(
          wireModel({
            name: "gpt-6-luna",
            provider: ChatModelProviders.OPENAI,
            baseUrl: "https://openai.invalid/v1",
          })
        );

        expect(request().url).toBe("https://openai.invalid/v1/responses");
        expect(request().body).not.toHaveProperty("reasoning");
        expect(request().body.tools).toEqual([
          expect.objectContaining({ name: "lookupReference" }),
        ]);
      });

      it("keeps an OpenAI-compatible endpoint on Chat Completions with no reasoning effort, whatever the model name", async () => {
        const request = captureRequest(OPENAI_RESPONSE);

        await send(wireModel({ name: "gpt-5.6" }));

        expect(request().url).toBe("https://provider.invalid/v1/chat/completions");
        expect(request().body).not.toHaveProperty("reasoning");
        expect(request().body).not.toHaveProperty("reasoning_effort");
      });

      it("sends an explicit per-model output limit when the model carries one", async () => {
        const body = captureRequestBody(OPENAI_RESPONSE);

        await send(wireModel({ maxTokens: 8192 }));

        expect(body().max_tokens).toBe(8192);
      });

      it("sends Anthropic the ceiling the bridge resolved for the model", async () => {
        const body = captureRequestBody(ANTHROPIC_RESPONSE);

        await send(
          wireModel({
            name: "claude-sonnet-4-5",
            provider: ChatModelProviders.ANTHROPIC,
            baseUrl: "https://anthropic.invalid",
            maxTokens: DEFAULT_MAX_OUTPUT_TOKENS,
          })
        );

        expect(body().max_tokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
      });
    });
  });
});
