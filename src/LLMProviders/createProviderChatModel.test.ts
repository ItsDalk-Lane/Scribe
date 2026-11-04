import { ChatModelProviders } from "@/constants";
import type { CustomModel } from "@/aiParams";
import { createProviderChatModel } from "./createProviderChatModel";
import { createHttpProviderChatModel } from "./createHttpProviderChatModel";
import { collectText, fixtureSse } from "@/LLMProviders/testing/piFixtures";
import * as obsidian from "obsidian";

jest.mock("./createHttpProviderChatModel", () => ({
  createHttpProviderChatModel: jest.fn().mockResolvedValue({}),
}));
const nativeFactory = createHttpProviderChatModel as jest.MockedFunction<
  typeof createHttpProviderChatModel
>;
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
interface Request {
  url: string;
  body?: string;
  headers?: Record<string, string>;
  contentType?: string;
}
const requests: Request[] = [];
const wire = (overrides: Partial<CustomModel> = {}): CustomModel => ({
  name: "test-model",
  provider: ChatModelProviders.OPENAI_FORMAT,
  providerNpm: "@ai-sdk/openai-compatible",
  enabled: true,
  enableCors: true,
  stream: false,
  apiKey: "fixture-key",
  baseUrl: "https://provider.invalid/v1",
  ...overrides,
});

function reply(request: Request): Record<string, unknown> {
  if (request.url.includes("iam.cloud.ibm.com"))
    return { access_token: "iam-fixture-token", expires_in: 3600 };
  if (request.url.endsWith("/messages"))
    return {
      id: "msg-test",
      type: "message",
      role: "assistant",
      model: "test-model",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  if (request.url.endsWith("/responses"))
    return {
      id: "resp-test",
      object: "response",
      created_at: 1,
      model: "test-model",
      status: "completed",
      output: [
        {
          type: "message",
          id: "m",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ok", annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
  return {
    id: "chat-test",
    object: "chat.completion",
    created: 1,
    model: "test-model",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

describe("createProviderChatModel", () => {
  describe("createProviderChatModel", () => {
    beforeEach(() => {
      requests.length = 0;
      nativeFactory.mockClear();
      setRequestUrlImpl((request: Request) => {
        requests.push(request);
        const json = reply(request);
        return Promise.resolve({
          status: 200,
          json,
          text: request.url.includes("iam.cloud.ibm.com") ? JSON.stringify(json) : fixtureSse(json),
          headers: {
            "content-type": request.url.includes("iam.cloud.ibm.com")
              ? "application/json"
              : "text/event-stream",
          },
          arrayBuffer: new ArrayBuffer(0),
        });
      });
    });
    it.each(["@ai-sdk/openai-compatible", "@ai-sdk/groq", "@ai-sdk/xai", "@ai-sdk/mistral"])(
      "uses the configured compatible transport for %s",
      async (providerNpm) => {
        const model = await createProviderChatModel(wire({ providerNpm }));
        expect(await collectText(model)).toBe("ok");
        expect(requests[0].url).toBe("https://provider.invalid/v1/chat/completions");
        expect(new Headers(requests[0].headers).get("authorization")).toBe("Bearer fixture-key");
      }
    );
    it("uses the configured context window and reports a genuinely unknown window as zero", async () => {
      const known = await createProviderChatModel(wire({ numCtx: 8192 }));
      expect(known.model.contextWindow).toBe(8192);
      const unknown = await createProviderChatModel(wire({}));
      expect(unknown.model.contextWindow).toBe(0);
    });
    it.each([
      ["responses", "/responses"],
      ["completions", "/chat/completions"],
    ] as const)("honors the explicit %s API shape", async (apiShape, path) => {
      const model = await createProviderChatModel(
        wire({ providerNpm: "@ai-sdk/openai", apiShape })
      );
      expect(await collectText(model)).toBe("ok");
      expect(requests[0].url).toBe(`https://provider.invalid/v1${path}`);
    });
    it("uses the native OpenAI default Responses API when the model gives no override", async () => {
      const model = await createProviderChatModel(wire({ providerNpm: "@ai-sdk/openai" }));
      await collectText(model);
      expect(requests[0].url.endsWith("/responses")).toBe(true);
    });
    it("normalizes a versioned Anthropic proxy and preserves the stable URL and user message", async () => {
      const model = await createProviderChatModel(
        wire({ providerNpm: "@ai-sdk/anthropic", baseUrl: "https://proxy.invalid/anthropic/v1" })
      );
      expect(await collectText(model, "original text")).toBe("ok");
      expect(requests[0].url).toBe("https://proxy.invalid/anthropic/v1/messages");
      expect(requests[0].body).toContain("original text");
    });
    it.each([
      ["claude-sonnet-4-6", undefined, 16384],
      ["claude-3-7-sonnet-latest", undefined, 8192],
      ["private-model", undefined, 4096],
      ["claude-sonnet-4-6", 512, 512],
    ] as const)(
      "preserves Anthropic's existing omitted or explicit limit for %s",
      async (name, maxTokens, limit) => {
        const model = await createProviderChatModel(
          wire({ name, providerNpm: "@ai-sdk/anthropic", maxTokens })
        );
        await collectText(model);
        expect(JSON.parse(requests[0].body!).max_tokens).toBe(limit);
      }
    );
    it("requires a real legacy custom-provider address instead of sending credentials to an example host", async () => {
      await expect(
        createProviderChatModel(wire({ providerNpm: undefined, baseUrl: undefined }))
      ).rejects.toThrow("A base URL is required");
      expect(requests).toHaveLength(0);
    });
    it("keeps an OAuth-looking BYOK key from rewriting the system prompt or client identity", async () => {
      const model = await createProviderChatModel(
        wire({ providerNpm: "@ai-sdk/anthropic", apiKey: "sk-ant-oat-fixture" })
      );
      await collectText(model, {
        systemPrompt: "Keep the original instruction.",
        messages: [{ role: "user", content: "Question", timestamp: 0 }],
      });
      expect(JSON.parse(requests[0].body!).system).toEqual([
        { type: "text", text: "Keep the original instruction." },
      ]);
      expect(new Headers(requests[0].headers).get("x-api-key")).toBe("sk-ant-oat-fixture");
      expect(requests[0].body).not.toContain("Claude Code");
    });
    it("gives Go auxiliary invocations its required client and session identity", async () => {
      const model = await createProviderChatModel(
        wire({
          providerCatalogId: "opencode-go",
          baseUrl: "https://opencode.ai/inference/go/openai/v1",
        })
      );
      await collectText(model);
      const headers = new Headers(requests[0].headers);
      expect(headers.get("user-agent")).toBe("obsidian-scribe/4");
      expect(headers.get("x-opencode-session")).toBeTruthy();
    });
    it("uses the actual form authentication and IBM chat path through the same model", async () => {
      const model = await createProviderChatModel(
        wire({
          providerNpm: "watsonx-ai-provider",
          providerCatalogId: "watsonx",
          baseUrl: "https://us-south.ml.cloud.ibm.com",
          providerOptions: { WATSONX_AI_PROJECT_ID: "project" },
        })
      );
      expect(await collectText(model)).toBe("ok");
      expect(requests[0]).toMatchObject({
        url: "https://iam.cloud.ibm.com/identity/token",
        contentType: "application/x-www-form-urlencoded",
      });
      expect(requests[1].url).toContain("/ml/v1/text/chat_stream?");
      expect(JSON.parse(requests[1].body!)).toMatchObject({
        model_id: "test-model",
        project_id: "project",
      });
    });
    it.each([
      "@ai-sdk/google",
      "@ai-sdk/cohere",
      "@ai-sdk/google-vertex",
      "@ai-sdk/google-vertex/anthropic",
      "@jerome-benoit/sap-ai-provider-v2",
      "gitlab-ai-provider",
    ])(
      "delegates %s to its implemented native protocol driver without changing credentials",
      async (providerNpm) => {
        const configured = wire({ providerNpm });
        await createProviderChatModel(configured);
        expect(nativeFactory.mock.calls[0][0]).toMatchObject(configured);
        expect(nativeFactory.mock.calls[0][1]).toMatchObject({ id: configured.name });
        expect(nativeFactory.mock.calls[0][2].fetch).toBeInstanceOf(Function);
        expect(requests).toHaveLength(0);
      }
    );
    it("keeps keyless endpoints unauthenticated instead of sending the SDK placeholder", async () => {
      const model = await createProviderChatModel(
        wire({ apiKey: undefined, requiresApiKey: false })
      );
      expect(await collectText(model, "keyless original message")).toBe("ok");
      expect(new Headers(requests[0].headers).get("Authorization")).toBeNull();
    });
    it("refuses an incomplete compatible endpoint instead of sending its credential to OpenAI by default", async () => {
      await expect(createProviderChatModel(wire({ baseUrl: undefined }))).rejects.toThrow(
        /base URL/i
      );
      expect(requests).toHaveLength(0);
    });
  });
});
