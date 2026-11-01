import { ChatModelProviders } from "@/constants";
import type { CustomModel } from "@/aiParams";
import { createProviderChatModel } from "./createProviderChatModel";
import { createNativeSdkChatModel } from "./nativeSdk/createNativeSdkChatModel";
import * as obsidian from "obsidian";

jest.mock("./nativeSdk/createNativeSdkChatModel", () => ({
  createNativeSdkChatModel: jest.fn().mockResolvedValue({}),
}));
const nativeFactory = createNativeSdkChatModel as jest.MockedFunction<
  typeof createNativeSdkChatModel
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

function reply(request: Request): unknown {
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
  describe("createProviderChatModel()", () => {
    beforeEach(() => {
      requests.length = 0;
      nativeFactory.mockClear();
      setRequestUrlImpl((request: Request) => {
        requests.push(request);
        const json = reply(request);
        return Promise.resolve({
          status: 200,
          json,
          text: JSON.stringify(json),
          headers: { "content-type": "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        });
      });
    });
    it.each(["@ai-sdk/openai-compatible", "@ai-sdk/groq", "@ai-sdk/xai", "@ai-sdk/mistral"])(
      "uses the configured compatible transport for %s",
      async (providerNpm) => {
        const model = await createProviderChatModel(wire({ providerNpm }));
        expect((await model.invoke("hi")).text).toBe("ok");
        expect(requests[0].url).toBe("https://provider.invalid/v1/chat/completions");
        expect(new Headers(requests[0].headers).get("authorization")).toBe("Bearer fixture-key");
      }
    );
    it.each([
      ["responses", "/responses"],
      ["completions", "/chat/completions"],
    ] as const)("honors the explicit %s API shape", async (apiShape, path) => {
      const model = await createProviderChatModel(
        wire({ providerNpm: "@ai-sdk/openai", apiShape })
      );
      expect((await model.invoke("hi")).text).toBe("ok");
      expect(requests[0].url).toBe(`https://provider.invalid/v1${path}`);
    });
    it("uses the native OpenAI default Responses API when the model gives no override", async () => {
      const model = await createProviderChatModel(wire({ providerNpm: "@ai-sdk/openai" }));
      await model.invoke("hi");
      expect(requests[0].url.endsWith("/responses")).toBe(true);
    });
    it("normalizes a versioned Anthropic proxy and preserves the user message", async () => {
      const model = await createProviderChatModel(
        wire({ providerNpm: "@ai-sdk/anthropic", baseUrl: "https://proxy.invalid/anthropic/v1" })
      );
      expect((await model.invoke("original text")).text).toBe("ok");
      expect(requests[0].url).toBe("https://proxy.invalid/anthropic/v1/messages");
      expect(requests[0].body).toContain("original text");
    });
    it("gives Go auxiliary invocations its required client and session identity", async () => {
      const model = await createProviderChatModel(
        wire({
          providerCatalogId: "opencode-go",
          baseUrl: "https://opencode.ai/inference/go/openai/v1",
        })
      );
      await model.invoke("hi");
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
      expect((await model.invoke("hi")).text).toBe("ok");
      expect(requests[0]).toMatchObject({
        url: "https://iam.cloud.ibm.com/identity/token",
        contentType: "application/x-www-form-urlencoded",
      });
      expect(requests[1].url).toContain("/ml/v1/text/chat?");
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
        expect(nativeFactory).toHaveBeenCalledWith(configured);
        expect(requests).toHaveLength(0);
      }
    );
    it("keeps keyless endpoints unauthenticated instead of sending the SDK placeholder (https://github.com/logancyang/obsidian-copilot/issues/2946)", async () => {
      const model = await createProviderChatModel(
        wire({ apiKey: undefined, requiresApiKey: false })
      );
      expect((await model.invoke("keyless original message")).text).toBe("ok");
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
