import { randomBytes } from "node:crypto";
import * as obsidian from "obsidian";
import type { CustomModel } from "@/aiParams";
import { ChatModelProviders, ModelCapability, ReasoningEffort } from "@/constants";
import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import { collectText, fixtureSse } from "@/LLMProviders/testing/piFixtures";
import { testProviderConnection } from "@/LLMProviders/testProviderConnection";
import { configuredModelToCustomModel, type ModelInfo, type Provider } from "@/modelManagement";
import { createChatChain, createChatMemory } from "@/commands/customCommandChatEngine";

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
interface CapturedRequest {
  url: string;
  headers: Headers;
  body: Record<string, unknown>;
}
const key = randomBytes(24).toString("hex");
const systemPrompt = "Keep this synthetic instruction unchanged.";
const originalFetch = window.fetch;

function wire(extra: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "fixture-model",
    provider: ChatModelProviders.OPENAI_FORMAT,
    providerNpm: "@ai-sdk/openai-compatible",
    enabled: true,
    apiKey: key,
    baseUrl: "https://gateway.invalid/v1",
    ...extra,
  };
}

function savedOpenAI(
  enableCors: boolean,
  reasoning = true
): { provider: Provider; model: ModelInfo } {
  return {
    provider: {
      providerId: "fixture-openai",
      providerType: "openai-compatible",
      displayName: "Synthetic OpenAI",
      baseUrl: "https://api.openai.com/v1",
      origin: { kind: "byok", catalogProviderId: "openai" },
      addedAt: 0,
      enableCors,
    },
    model: {
      id: reasoning ? "o3" : "gpt-4o",
      displayName: "Synthetic model",
      provider: { npm: "@ai-sdk/openai", shape: "responses" },
      reasoning,
    },
  };
}

function bridge(provider: Provider, info: ModelInfo): CustomModel {
  return configuredModelToCustomModel({
    provider,
    configuredModel: {
      configuredModelId: "fixture-configured-model",
      providerId: provider.providerId,
      info,
      configuredAt: 0,
    },
    apiKey: key,
  });
}

function responseBody(url: string): string {
  if (url.endsWith("/direct_access"))
    return JSON.stringify({ token: "synthetic-gitlab-access", headers: { "X-Fixture": "gitlab" } });
  if (url.endsWith("/responses"))
    return fixtureSse({
      id: "resp-fixture",
      object: "response",
      status: "completed",
      created_at: 1,
      model: "o3",
      output: [
        {
          type: "message",
          id: "m-fixture",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ok", annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    });
  if (url.endsWith("/messages") || url.endsWith(":streamRawPredict"))
    return fixtureSse({
      id: "msg-fixture",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4-6",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    });
  return fixtureSse({
    id: "chat-fixture",
    object: "chat.completion",
    created: 1,
    model: "fixture-model",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  });
}

describe("createProviderChatModel", () => {
  describe("createProviderChatModel()", () => {
    const requests: CapturedRequest[] = [];
    let rejectUnexpectedFields = false;
    function serve(
      url: string,
      init: RequestInit
    ): { status: number; text: string; headers: Record<string, string> } {
      const body = init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
      requests.push({ url, headers: new Headers(init.headers), body });
      const rejected =
        (body.reasoning as { effort?: string } | undefined)?.effort === "none" ||
        (rejectUnexpectedFields && "cache_control" in body);
      return {
        status: rejected ? 400 : 200,
        text: rejected
          ? JSON.stringify({
              error: { message: "Unexpected request field", type: "invalid_request_error" },
            })
          : responseBody(url),
        headers: {
          "content-type": url.endsWith("/direct_access") ? "application/json" : "text/event-stream",
        },
      };
    }

    beforeEach(() => {
      requests.length = 0;
      rejectUnexpectedFields = false;
      setRequestUrlImpl(
        (request: { url: string; headers?: Record<string, string>; body?: string }) => {
          const reply = serve(request.url, request);
          return Promise.resolve({
            ...reply,
            json:
              reply.headers["content-type"] === "application/json"
                ? (JSON.parse(reply.text) as unknown)
                : {},
            arrayBuffer: new ArrayBuffer(0),
          });
        }
      );
      window.fetch = jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = input instanceof Request ? input.url : String(input);
        const reply = serve(url, init ?? {});
        return new Response(reply.text, { status: reply.status, headers: reply.headers });
      });
    });
    afterEach(() => {
      window.fetch = originalFetch;
    });

    it.each([false, true])(
      "verifies saved o3 with supplier-default effort over compatibility=%s (https://github.com/ItsDalk-Lane/Scribe/issues/8)",
      async (enableCors) => {
        const saved = savedOpenAI(enableCors);
        expect(await testProviderConnection({ ...saved, apiKey: key })).toMatchObject({ ok: true });
        expect(requests).toHaveLength(1);
        expect(requests[0].url).toBe("https://api.openai.com/v1/responses");
        expect(requests[0].headers.get("Authorization")).toBe(`Bearer ${key}`);
        expect(requests[0].body).not.toHaveProperty("reasoning");
      }
    );

    it.each([false, true])(
      "keeps saved o3 Quick Tools instructions and follow-up history over compatibility=%s (https://github.com/ItsDalk-Lane/Scribe/issues/8)",
      async (enableCors) => {
        const saved = savedOpenAI(enableCors);
        const memory = createChatMemory();
        const chain = await createChatChain(
          bridge(saved.provider, saved.model),
          systemPrompt,
          memory
        );
        let answer = "";
        for await (const event of chain.stream("Synthetic note", { maxRetries: 0 }))
          if (event.type === "text_delta") answer += event.delta;
        expect(answer).toBe("ok");
        chain.saveContext("Synthetic note", answer);
        for await (const event of chain.stream("Follow up", { maxRetries: 0 }))
          if (event.type === "text_delta") expect(event.delta).toBe("ok");
        for (const request of requests) {
          expect(request.body).not.toHaveProperty("reasoning");
          expect(request.body.input).toEqual(
            expect.arrayContaining([{ role: "developer", content: systemPrompt }])
          );
        }
        expect(requests[1].body.input).toEqual(
          expect.arrayContaining([expect.objectContaining({ role: "assistant" })])
        );
      }
    );

    it("keeps ordinary OpenAI instructions as system messages (https://github.com/ItsDalk-Lane/Scribe/issues/8)", async () => {
      const saved = savedOpenAI(true, false);
      const model = await createProviderChatModel(bridge(saved.provider, saved.model));
      expect(
        await collectText(model, {
          systemPrompt,
          messages: [{ role: "user", content: "Question", timestamp: 0 }],
        })
      ).toBe("ok");
      expect(requests[0].body.input).toEqual(
        expect.arrayContaining([{ role: "system", content: systemPrompt }])
      );
      expect(requests[0].body).not.toHaveProperty("reasoning");
    });

    it("preserves an explicitly selected Responses effort (https://github.com/ItsDalk-Lane/Scribe/issues/8)", async () => {
      const saved = savedOpenAI(true);
      const model = await createProviderChatModel({
        ...bridge(saved.provider, saved.model),
        reasoningEffort: ReasoningEffort.HIGH,
      });
      expect(await collectText(model)).toBe("ok");
      expect(requests[0].body.reasoning).toMatchObject({ effort: "high" });
    });

    it("keeps compatible Responses reasoning instructions as system messages (https://github.com/ItsDalk-Lane/Scribe/issues/8)", async () => {
      const model = await createProviderChatModel(
        wire({ apiShape: "responses", capabilities: [ModelCapability.REASONING], enableCors: true })
      );
      expect(
        await collectText(model, {
          systemPrompt,
          messages: [{ role: "user", content: "Question", timestamp: 0 }],
        })
      ).toBe("ok");
      expect(requests[0].body.input).toEqual(
        expect.arrayContaining([{ role: "system", content: systemPrompt }])
      );
      expect(requests[0].body).not.toHaveProperty("reasoning");
    });

    it("does not add reasoning or developer roles to a Chat Completions gateway (https://github.com/ItsDalk-Lane/Scribe/issues/8)", async () => {
      const model = await createProviderChatModel(
        wire({ capabilities: [ModelCapability.REASONING], enableCors: true })
      );
      expect(
        await collectText(model, {
          systemPrompt,
          messages: [{ role: "user", content: "Question", timestamp: 0 }],
        })
      ).toBe("ok");
      expect(requests[0].body.messages).toEqual(
        expect.arrayContaining([{ role: "system", content: systemPrompt }])
      );
      expect(requests[0].body).not.toHaveProperty("reasoning");
      expect(requests[0].body).not.toHaveProperty("reasoning_effort");
    });

    it.each([
      [false, undefined],
      [true, undefined],
      [false, ReasoningEffort.HIGH],
      [true, ReasoningEffort.HIGH],
    ] as const)(
      "preserves GitLab Responses instructions over compatibility=%s and selected effort=%s (https://github.com/ItsDalk-Lane/Scribe/issues/8)",
      async (enableCors, reasoningEffort) => {
        const model = await createProviderChatModel(
          wire({
            name: "duo-chat-gpt-6-astra",
            providerNpm: "gitlab-ai-provider",
            capabilities: [ModelCapability.REASONING],
            reasoningEffort,
            enableCors,
            baseUrl: "https://gitlab.invalid",
            providerOptions: {
              GITLAB_INSTANCE_URL: "https://gitlab.invalid",
              GITLAB_AI_GATEWAY_URL: "https://gateway.invalid",
            },
          })
        );
        expect(
          await collectText(model, {
            systemPrompt,
            messages: [{ role: "user", content: "Question", timestamp: 0 }],
          })
        ).toBe("ok");
        const request = requests[1];
        expect(request.url).toBe("https://gateway.invalid/ai/v1/proxy/openai/v1/responses");
        expect(request.headers.get("Authorization")).toBe("Bearer synthetic-gitlab-access");
        if (reasoningEffort)
          expect(request.body.reasoning).toMatchObject({ effort: reasoningEffort });
        else expect(request.body).not.toHaveProperty("reasoning");
        expect(request.body.input).toEqual(
          expect.arrayContaining([{ role: "developer", content: systemPrompt }])
        );
      }
    );

    it.each([
      ["https://openrouter.ai/api/v1", undefined, true],
      ["https://openrouter.ai/api/v1", false, false],
      ["https://gateway.invalid/v1", undefined, false],
      ["http://localhost:1234/v1", undefined, false],
      ["https://openrouter.ai.gateway.invalid/v1", undefined, false],
      ["https://gateway.invalid/openrouter.ai/v1", undefined, false],
    ] as const)(
      "limits OpenRouter cache fields by real host at %s with caching=%s (https://github.com/ItsDalk-Lane/Scribe/issues/8)",
      async (baseUrl, enablePromptCaching, expectedCache) => {
        rejectUnexpectedFields = !expectedCache;
        const model = await createProviderChatModel(
          wire({
            providerNpm: "@openrouter/ai-sdk-provider",
            baseUrl,
            enablePromptCaching,
            capabilities: [ModelCapability.REASONING],
            enableCors: true,
          })
        );
        expect(await collectText(model, "Synthetic note", { maxRetries: 0 })).toBe("ok");
        expect(requests[0].url).toBe(`${baseUrl}/chat/completions`);
        if (expectedCache) expect(requests[0].body.cache_control).toEqual({ type: "ephemeral" });
        else expect(requests[0].body).not.toHaveProperty("cache_control");
        expect(requests[0].body.reasoning).toEqual({ max_tokens: 1024 });
        expect(requests[0].body.stream_options).toEqual({ include_usage: true });
      }
    );

    it("preserves explicit OpenRouter effort on a strict custom gateway (https://github.com/ItsDalk-Lane/Scribe/issues/8)", async () => {
      rejectUnexpectedFields = true;
      const model = await createProviderChatModel(
        wire({
          providerNpm: "@openrouter/ai-sdk-provider",
          reasoningEffort: ReasoningEffort.MINIMAL,
          capabilities: [ModelCapability.REASONING],
          enableCors: false,
        })
      );
      expect(await collectText(model, "Synthetic note", { maxRetries: 0 })).toBe("ok");
      expect(requests[0].body.reasoning).toEqual({ effort: "low" });
      expect(requests[0].body).not.toHaveProperty("max_tokens");
      expect(requests[0].body).not.toHaveProperty("cache_control");
    });

    it("keeps LM Studio Chat Completions usage without OpenRouter cache fields (https://github.com/ItsDalk-Lane/Scribe/issues/8)", async () => {
      rejectUnexpectedFields = true;
      const model = await createProviderChatModel(
        wire({
          provider: ChatModelProviders.LM_STUDIO,
          providerNpm: undefined,
          useResponsesApi: false,
          baseUrl: "http://localhost:1234/v1",
          enableCors: true,
        })
      );
      expect(await collectText(model, "Synthetic note", { maxRetries: 0 })).toBe("ok");
      expect(requests[0].body.stream_options).toEqual({ include_usage: true });
      expect(requests[0].body).not.toHaveProperty("cache_control");
      expect(requests[0].body).not.toHaveProperty("reasoning");
    });

    it.each([
      ["claude-sonnet-4-6", "@ai-sdk/google-vertex/anthropic", undefined, 4096],
      ["claude-haiku-4-5", "@ai-sdk/google-vertex/anthropic", undefined, 4096],
      ["claude-sonnet-4-6", "@ai-sdk/google-vertex/anthropic", 777, 777],
      ["claude-sonnet-4-6", "@ai-sdk/anthropic", undefined, 16384],
    ] as const)(
      "preserves %s %s output ceiling %s as %s (https://github.com/ItsDalk-Lane/Scribe/issues/8)",
      async (name, providerNpm, maxTokens, expected) => {
        const model = await createProviderChatModel(
          wire({
            name,
            providerNpm,
            maxTokens,
            enableCors: true,
            providerOptions: {
              GOOGLE_VERTEX_PROJECT: "synthetic-project",
              GOOGLE_VERTEX_LOCATION: "global",
            },
          })
        );
        expect(await collectText(model)).toBe("ok");
        expect(requests[0].body.max_tokens).toBe(expected);
        expect(
          requests[0].headers.get(
            providerNpm === "@ai-sdk/anthropic" ? "x-api-key" : "Authorization"
          )
        ).toBe(providerNpm === "@ai-sdk/anthropic" ? key : `Bearer ${key}`);
      }
    );
  });
});
