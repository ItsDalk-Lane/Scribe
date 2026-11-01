import { createNativeSdkChatModel } from "./createNativeSdkChatModel";
import type { CustomModel } from "@/aiParams";
import type { NativeSdkCallOptions } from "./NativeSdkChatModel";
import * as obsidianModule from "obsidian";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { generateKeyPairSync, webcrypto } from "node:crypto";

Object.defineProperty(window, "TextDecoderStream", {
  configurable: true,
  value: class extends TransformStream<Uint8Array, string> {
    constructor() {
      const decoder = new TextDecoder();
      super({
        transform(value, controller) {
          controller.enqueue(decoder.decode(value, { stream: true }));
        },
      });
    }
  },
});

jest.mock("@/logger");
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: jest.fn(() => true) }));
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
function model(npm: string, extra: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "fixture-model",
    provider: "google",
    providerNpm: npm,
    enabled: true,
    apiKey: "fixture-key",
    ...extra,
  };
}

const GITLAB_CATALOG_MODELS = [
  "duo-chat-gpt-5-6-terra",
  "duo-chat-gpt-5-4",
  "duo-chat-haiku-4-5",
  "duo-chat-sonnet-5",
  "duo-chat-gpt-6-astra",
  "duo-chat-sonnet-4-6",
  "duo-chat-fable-5",
  "duo-chat-opus-4-8",
  "duo-chat-gpt-5-1",
  "duo-chat-opus-5-5",
  "duo-chat-haiku-5-5",
  "duo-chat-opus-4-7",
  "duo-chat-gpt-5-4-nano",
  "duo-chat-gpt-6-1-sol",
  "duo-chat-gpt-5-2",
  "duo-chat-gpt-5-mini",
  "duo-chat-gpt-5-2-codex",
  "duo-chat-gpt-6-luna",
  "duo-chat-opus-4-6",
  "duo-chat-gpt-5-3-codex",
  "duo-chat-opus-4-5",
  "duo-chat-gpt-5-5",
  "duo-chat-opus-5",
  "duo-chat-gpt-6-sol",
  "duo-chat-gpt-5-6-sol",
  "duo-chat-gpt-5-4-mini",
  "duo-chat-gpt-5-codex",
  "duo-chat-fable-5-1",
  "duo-chat-sonnet-4-5",
  "duo-chat-gpt-5-6-luna",
  "duo-chat-sonnet-5-5",
];

describe("createNativeSdkChatModel", () => {
  describe("createNativeSdkChatModel()", () => {
    it("uses the real Google SDK and Obsidian transport for a normal reply", async () => {
      let url = "";
      setRequestUrlImpl(async (request: { url: string }) => {
        url = request.url;
        const payload = {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Google fixture reply" }] },
              finishReason: "STOP",
            },
          ],
          usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 2, totalTokenCount: 3 },
        };
        return {
          status: 200,
          text: JSON.stringify(payload),
          json: payload,
          headers: { "content-type": "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        };
      });
      const client = await createNativeSdkChatModel(
        model("@ai-sdk/google", {
          name: "gemini-2.0-flash",
          baseUrl: "https://google.fixture.invalid/v1beta",
        })
      );
      expect((await client.invoke("Original fixture input")).content).toBe("Google fixture reply");
      expect(url).toBe(
        "https://google.fixture.invalid/v1beta/models/gemini-2.0-flash:generateContent"
      );
    });
    it("uses the real Cohere v2 response and streaming protocols", async () => {
      const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
      setRequestUrlImpl(async (request: { url: string; body: string }) => {
        const body = JSON.parse(request.body) as Record<string, unknown>;
        requests.push({ url: request.url, body });
        const payload = {
          id: "cohere-1",
          finish_reason: "COMPLETE",
          message: { role: "assistant", content: [{ type: "text", text: "Cohere fixture reply" }] },
          usage: {
            tokens: { input_tokens: 1, output_tokens: 2 },
            billed_units: { input_tokens: 1, output_tokens: 2 },
          },
        };
        const events = [
          {
            type: "content-start",
            index: 0,
            delta: { message: { content: { type: "text", text: "" } } },
          },
          {
            type: "content-delta",
            index: 0,
            delta: { message: { content: { text: "Cohere fixture reply" } } },
          },
          { type: "content-end", index: 0 },
          {
            type: "message-end",
            delta: {
              finish_reason: "COMPLETE",
              usage: {
                tokens: { input_tokens: 1, output_tokens: 2 },
                billed_units: { input_tokens: 1, output_tokens: 2 },
              },
            },
          },
        ];
        return {
          status: 200,
          text: body.stream
            ? events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("")
            : JSON.stringify(payload),
          json: payload,
          headers: { "content-type": body.stream ? "text/event-stream" : "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        };
      });
      const client = await createNativeSdkChatModel(
        model("@ai-sdk/cohere", { name: "command-a-03-2025" })
      );
      expect((await client.invoke("Original Cohere input")).content).toBe("Cohere fixture reply");
      const chunks = [];
      for await (const chunk of await client.stream("Original Cohere input"))
        chunks.push(typeof chunk.content === "string" ? chunk.content : "");
      expect(chunks.join("")).toBe("Cohere fixture reply");
      expect(requests.map((request) => request.url)).toEqual([
        "https://api.cohere.com/v2/chat",
        "https://api.cohere.com/v2/chat",
      ]);
      expect(requests[0].body).not.toHaveProperty("temperature");
      expect(requests[0].body).not.toHaveProperty("max_tokens");
    });

    it("honors explicitly selected native fetch for Google", async () => {
      const originalFetch = window.fetch;
      let usedObsidian = false;
      setRequestUrlImpl(async () => {
        usedObsidian = true;
        throw new Error("Unexpected Obsidian request");
      });
      const payload = {
        candidates: [
          {
            content: { role: "model", parts: [{ text: "Native fixture reply" }] },
            finishReason: "STOP",
          },
        ],
      };
      const nativeFetch = jest.fn(
        async () =>
          ({
            ok: true,
            status: 200,
            headers: new Headers({ "content-type": "application/json" }),
            json: async () => payload,
            text: async () => JSON.stringify(payload),
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(JSON.stringify(payload)));
                controller.close();
              },
            }),
          }) as Response
      );
      window.fetch = nativeFetch;
      try {
        const client = await createNativeSdkChatModel(
          model("@ai-sdk/google", { name: "gemini-2.0-flash", enableCors: false })
        );
        expect((await client.invoke("Fixture input")).content).toBe("Native fixture reply");
        expect(nativeFetch).toHaveBeenCalledTimes(1);
        expect(usedObsidian).toBe(false);
      } finally {
        window.fetch = originalFetch;
      }
    });

    it("uses mobile WebCrypto authorization through provider transport and ignores a credential token_uri", async () => {
      const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
      const originalSubtle = Object.getOwnPropertyDescriptor(window.crypto, "subtle");
      Object.defineProperty(window.crypto, "subtle", {
        configurable: true,
        value: webcrypto.subtle,
      });
      jest.mocked(isDesktopRuntime).mockReturnValue(false);
      const requests: Array<{ url: string; body: string }> = [];
      setRequestUrlImpl(async (request: (typeof requests)[number]) => {
        requests.push(request);
        const payload =
          request.url === "https://oauth2.googleapis.com/token"
            ? { access_token: "mobile-token", expires_in: 3600 }
            : {
                candidates: [
                  {
                    content: { role: "model", parts: [{ text: "Mobile Vertex reply" }] },
                    finishReason: "STOP",
                  },
                ],
              };
        return {
          status: 200,
          text: JSON.stringify(payload),
          json: payload,
          headers: { "content-type": "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        };
      });
      try {
        const client = await createNativeSdkChatModel(
          model("@ai-sdk/google-vertex", {
            name: "gemini-2.0-flash",
            apiKey: JSON.stringify({
              type: "service_account",
              client_email: "fixture@example.invalid",
              private_key: privateKey,
              token_uri: "https://untrusted.invalid/token",
            }),
            providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
          })
        );
        expect((await client.invoke("Original mobile question")).content).toBe(
          "Mobile Vertex reply"
        );
        expect((await client.invoke("Second mobile question")).content).toBe("Mobile Vertex reply");
        expect(
          requests.filter((request) => request.url === "https://oauth2.googleapis.com/token")
        ).toHaveLength(1);
        expect(requests.some((request) => request.url.includes("untrusted.invalid"))).toBe(false);
        expect(requests.filter((request) => request.url.includes(":generateContent"))).toHaveLength(
          2
        );
      } finally {
        jest.mocked(isDesktopRuntime).mockReturnValue(true);
        if (originalSubtle) Object.defineProperty(window.crypto, "subtle", originalSubtle);
        else Reflect.deleteProperty(window.crypto, "subtle");
      }
    });

    it("uses the real Vertex Google SDK with a supplied OAuth token and project route", async () => {
      let captured: { url?: string; headers?: Record<string, string> } = {};
      setRequestUrlImpl(async (request: { url: string; headers: Record<string, string> }) => {
        captured = request;
        const payload = {
          candidates: [
            {
              content: { role: "model", parts: [{ text: "Vertex fixture reply" }] },
              finishReason: "STOP",
            },
          ],
        };
        return {
          status: 200,
          text: JSON.stringify(payload),
          json: payload,
          headers: { "content-type": "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        };
      });
      const client = await createNativeSdkChatModel(
        model("@ai-sdk/google-vertex", {
          name: "gemini-2.0-flash",
          apiKey: "Bearer supplied-vertex-token",
          baseUrl: "https://aiplatform.googleapis.com",
          providerOptions: {
            GOOGLE_VERTEX_PROJECT: "fixture-project",
            GOOGLE_VERTEX_LOCATION: "us-central1",
          },
        })
      );
      expect((await client.invoke("Original Vertex input")).content).toBe("Vertex fixture reply");
      expect(captured.url).toBe(
        "https://us-central1-aiplatform.googleapis.com/v1/projects/fixture-project/locations/us-central1/publishers/google/models/gemini-2.0-flash:generateContent"
      );
      expect(new Headers(captured.headers).get("authorization")).toBe(
        "Bearer supplied-vertex-token"
      );
    });

    it("uses the real Anthropic SDK with Vertex rawPredict routing and supplied token", async () => {
      let captured: { url?: string; headers?: Record<string, string>; body?: string } = {};
      setRequestUrlImpl(async (request: typeof captured) => {
        captured = request;
        const payload = {
          id: "vertex-anthropic-1",
          type: "message",
          role: "assistant",
          model: "claude-sonnet-4-6",
          content: [{ type: "text", text: "Vertex Claude fixture reply" }],
          stop_reason: "end_turn",
          usage: { input_tokens: 1, output_tokens: 2 },
        };
        return {
          status: 200,
          text: JSON.stringify(payload),
          json: payload,
          headers: { "content-type": "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        };
      });
      const client = await createNativeSdkChatModel(
        model("@ai-sdk/google-vertex/anthropic", {
          name: "claude-sonnet-4-6",
          apiKey: "supplied-vertex-token",
          providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
        })
      );
      expect((await client.invoke("Original Claude input")).content).toBe(
        "Vertex Claude fixture reply"
      );
      expect(captured.url).toBe(
        "https://aiplatform.googleapis.com/v1/projects/fixture-project/locations/global/publishers/anthropic/models/claude-sonnet-4-6:rawPredict"
      );
      expect(new Headers(captured.headers).get("authorization")).toBe(
        "Bearer supplied-vertex-token"
      );
      expect(JSON.parse(captured.body || "{}") as Record<string, unknown>).toHaveProperty(
        "anthropic_version",
        "vertex-2023-10-16"
      );
    });

    it.each([
      ["@ai-sdk/google-vertex", true],
      ["@ai-sdk/google-vertex/anthropic", true],
      ["@ai-sdk/google-vertex", false],
      ["@ai-sdk/google-vertex/anthropic", false],
    ] as const)(
      "loads %s service-account credentials with desktop=%s without making a request",
      async (npm, desktop) => {
        const requests = jest.fn(async () => {
          throw new Error("Unexpected provider request");
        });
        setRequestUrlImpl(requests);
        jest.mocked(isDesktopRuntime).mockReturnValue(desktop);
        try {
          const client = await createNativeSdkChatModel(
            model(npm, {
              apiKey: JSON.stringify({
                type: "service_account",
                client_email: "fixture@example.invalid",
                private_key: "fixture-private-key",
                private_key_id: "fixture-key-id",
              }),
              providerOptions: {
                GOOGLE_VERTEX_PROJECT: "fixture-project",
                GOOGLE_VERTEX_ENDPOINT: "https://vertex.fixture.invalid",
              },
            })
          );
          expect(client._llmType()).toBe(
            npm.endsWith("/anthropic") ? "authenticated-provider" : "native-provider-sdk"
          );
          expect(requests).not.toHaveBeenCalled();
        } finally {
          jest.mocked(isDesktopRuntime).mockReturnValue(true);
        }
      }
    );

    it.each(["@jerome-benoit/sap-ai-provider-v2", "gitlab-ai-provider"])(
      "returns normal and streaming replies for %s on mobile without a Node runtime",
      async (npm) => {
        jest.mocked(isDesktopRuntime).mockReturnValue(false);
        const sap = npm.startsWith("@jerome");
        setRequestUrlImpl(async (request: { url: string; body: string }) => {
          const body = JSON.parse(request.body?.startsWith("{") ? request.body : "{}") as {
            stream?: boolean;
            config?: { stream?: { enabled?: boolean } };
          };
          const streaming = body.stream || body.config?.stream?.enabled;
          const completion = {
            id: "mobile-fixture",
            object: "chat.completion",
            created: 1,
            model: "gpt-4.1",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "Mobile reply" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          };
          const chunk = {
            id: "mobile-fixture",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-4.1",
            choices: [
              { index: 0, delta: { content: "Mobile stream reply" }, finish_reason: "stop" },
            ],
            usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
          };
          const payload = request.url.endsWith("/oauth/token")
            ? { access_token: "mobile-token", expires_in: 3600 }
            : request.url.endsWith("direct_access")
              ? { token: "mobile-token", headers: {} }
              : sap
                ? { final_result: completion }
                : completion;
          const event = sap ? { final_result: chunk } : chunk;
          return {
            status: 200,
            text: streaming
              ? `data: ${JSON.stringify(event)}\n\ndata: [DONE]\n\n`
              : JSON.stringify(payload),
            json: payload,
            headers: { "content-type": streaming ? "text/event-stream" : "application/json" },
            arrayBuffer: new ArrayBuffer(0),
          };
        });
        try {
          const client = await createNativeSdkChatModel(
            model(npm, {
              name: sap ? "gpt-4.1" : "duo-chat-gpt-5-4",
              apiKey: sap
                ? JSON.stringify({
                    clientid: "fixture",
                    clientsecret: "fixture",
                    url: "https://sap.auth.invalid",
                    serviceurls: { AI_API_URL: "https://sap.api.invalid" },
                  })
                : "fixture-user",
              providerOptions: { AICORE_DEPLOYMENT_ID: "mobile-deployment" },
            })
          );
          expect((await client.invoke("Original mobile input")).content).toBe("Mobile reply");
          const chunks: string[] = [];
          for await (const chunk of await client.stream("Original mobile input"))
            chunks.push(chunk.text);
          expect(chunks.join("")).toBe("Mobile stream reply");
        } finally {
          jest.mocked(isDesktopRuntime).mockReturnValue(true);
        }
      }
    );

    it.each(["@ai-sdk/google-vertex", "@jerome-benoit/sap-ai-provider-v2"])(
      "rejects malformed %s JSON without disclosing secret text",
      async (npm) => {
        const secret = '{"private_key":"DO-NOT-LOG-THIS';
        const error = await createNativeSdkChatModel(
          model(npm, {
            apiKey: secret,
            providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
          })
        ).catch((reason: unknown) => reason);
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe("The provider credentials must be valid JSON.");
        expect((error as Error).message).not.toContain("DO-NOT-LOG-THIS");
      }
    );

    it("requires Vertex project parameters before a request can be attempted", async () => {
      await expect(createNativeSdkChatModel(model("@ai-sdk/google-vertex"))).rejects.toThrow(
        "GOOGLE_VERTEX_PROJECT"
      );
    });
    it("rejects incomplete Google service-account JSON without echoing its fields", async () => {
      await expect(
        createNativeSdkChatModel(
          model("@ai-sdk/google-vertex", {
            apiKey: '{"client_email":"fixture@example.invalid"}',
            providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
          })
        )
      ).rejects.toThrow("requires client_email and private_key");
    });
    it("rejects missing Vertex credentials before a request can be attempted", async () => {
      await expect(
        createNativeSdkChatModel(
          model("@ai-sdk/google-vertex", {
            apiKey: "",
            providerOptions: { GOOGLE_VERTEX_PROJECT: "fixture-project" },
          })
        )
      ).rejects.toThrow("requires service-account JSON or an OAuth access token");
    });
    it.each([
      "[]",
      "{}",
      '{"clientid":"fixture-id","clientsecret":"secret","url":"https://auth.example.invalid"}',
    ])("rejects incomplete SAP service credentials %s", async (apiKey) => {
      await expect(
        createNativeSdkChatModel(model("@jerome-benoit/sap-ai-provider-v2", { apiKey }))
      ).rejects.toThrow(/JSON object|requires clientid|requires serviceurls/);
    });
    it("uses public GitLab direct access with a browser-safe Anthropic child and cached tokens", async () => {
      const requests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
      setRequestUrlImpl(async (request: (typeof requests)[number]) => {
        requests.push(request);
        const payload = request.url.endsWith("direct_access")
          ? {
              token: "fixture-gitlab-direct-token",
              headers: { "x-api-key": "must-be-removed", "x-gitlab-fixture": "retained" },
            }
          : {
              id: "gitlab-message",
              type: "message",
              role: "assistant",
              model: "claude-sonnet-4-6",
              content: [{ type: "text", text: "GitLab fixture reply" }],
              stop_reason: "end_turn",
              usage: { input_tokens: 1, output_tokens: 2 },
            };
        return {
          status: 200,
          text: JSON.stringify(payload),
          json: payload,
          headers: { "content-type": "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        };
      });
      const client = await createNativeSdkChatModel(
        model("gitlab-ai-provider", {
          name: "duo-chat-sonnet-4-6",
          apiKey: "fixture-gitlab-user-token",
        })
      );
      expect((await client.invoke("Original GitLab input")).content).toBe("GitLab fixture reply");
      expect((await client.invoke("Second input")).content).toBe("GitLab fixture reply");
      expect(requests.filter((request) => request.url.endsWith("direct_access"))).toHaveLength(1);
      const inference = requests.filter((request) => !request.url.endsWith("direct_access"));
      expect(inference).toHaveLength(2);
      expect(inference[0].url).toBe("https://cloud.gitlab.com/ai/v1/proxy/anthropic/v1/messages");
      expect(new Headers(inference[0].headers).get("authorization")).toBe(
        "Bearer fixture-gitlab-direct-token"
      );
      expect(new Headers(inference[0].headers).has("x-api-key")).toBe(false);
      expect(new Headers(inference[0].headers).get("x-gitlab-fixture")).toBe("retained");
    });

    it("honors GitLab OpenAI Responses mappings through its real browser-safe SDK child", async () => {
      let path = "";
      setRequestUrlImpl(async (request: { url: string }) => {
        const payload = request.url.endsWith("direct_access")
          ? { token: "fixture-direct-token", headers: {} }
          : {
              id: "gitlab-response",
              object: "response",
              created_at: 1,
              model: "gpt-5.4",
              status: "completed",
              output: [
                {
                  type: "message",
                  id: "message-1",
                  role: "assistant",
                  status: "completed",
                  content: [{ type: "output_text", text: "GitLab OpenAI reply", annotations: [] }],
                },
              ],
              usage: { input_tokens: 1, output_tokens: 2, total_tokens: 3 },
            };
        path = request.url;
        return {
          status: 200,
          text: JSON.stringify(payload),
          json: payload,
          headers: { "content-type": "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        };
      });
      const client = await createNativeSdkChatModel(
        model("gitlab-ai-provider", {
          name: "duo-chat-gpt-5-6-terra",
          apiKey: "fixture-user-token",
        })
      );
      expect((await client.invoke("Original OpenAI input")).content).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ type: "text", text: "GitLab OpenAI reply" }),
        ])
      );
      expect(path).toBe("https://cloud.gitlab.com/ai/v1/proxy/openai/v1/responses");
    });

    it("streams GitLab OpenAI chat replies and forwards both session header forms", async () => {
      const requests: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
      setRequestUrlImpl(async (request: (typeof requests)[number]) => {
        requests.push(request);
        const payload = request.url.endsWith("direct_access")
          ? { token: "fixture-direct-token", headers: {} }
          : {
              id: "gitlab-chat",
              object: "chat.completion",
              created: 1,
              model: "gpt-5.4",
              choices: [
                {
                  index: 0,
                  message: { role: "assistant", content: "GitLab chat reply" },
                  finish_reason: "stop",
                },
              ],
              usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
            };
        const stream = request.body && (JSON.parse(request.body) as { stream?: boolean }).stream;
        const events = [
          {
            id: "gitlab-chat",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-5.4",
            choices: [
              {
                index: 0,
                delta: { role: "assistant", content: "GitLab stream reply" },
                finish_reason: null,
              },
            ],
          },
          {
            id: "gitlab-chat",
            object: "chat.completion.chunk",
            created: 1,
            model: "gpt-5.4",
            choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
          },
        ];
        return {
          status: 200,
          text: stream
            ? events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("") +
              "data: [DONE]\n\n"
            : JSON.stringify(payload),
          json: payload,
          headers: { "content-type": stream ? "text/event-stream" : "application/json" },
          arrayBuffer: new ArrayBuffer(0),
        };
      });
      const client = await createNativeSdkChatModel(
        model("gitlab-ai-provider", { name: "duo-chat-gpt-5-4" })
      );
      expect(
        (
          await client.invoke("Original input", {
            headers: { "x-opencode-session": "invoke-fixture" },
          } as NativeSdkCallOptions)
        ).content
      ).toBe("GitLab chat reply");
      const chunks: string[] = [];
      const tokens: string[] = [];
      for await (const chunk of await client.stream("Original input", {
        options: { headers: { "x-opencode-session": "stream-fixture" } },
        callbacks: [
          {
            handleLLMNewToken: (token: string) => {
              tokens.push(token);
            },
          },
        ],
      } as NativeSdkCallOptions))
        chunks.push(chunk.text);
      expect(chunks.join("")).toBe("GitLab stream reply");
      expect(tokens.join("")).toBe("GitLab stream reply");
      const inference = requests.filter((request) => !request.url.endsWith("direct_access"));
      expect(inference.every((request) => request.url.endsWith("/chat/completions"))).toBe(true);
      expect(new Headers(inference[0].headers).get("x-opencode-session")).toBe("invoke-fixture");
      expect(new Headers(inference[1].headers).get("x-opencode-session")).toBe("stream-fixture");
    });

    it.each(GITLAB_CATALOG_MODELS)(
      "accepts the published GitLab model mapping %s",
      async (name) => {
        const client = await createNativeSdkChatModel(model("gitlab-ai-provider", { name }));
        expect(client._llmType()).toBe("authenticated-provider");
      }
    );

    it("reports unknown GitLab model mappings before requesting access", async () => {
      await expect(
        createNativeSdkChatModel(model("gitlab-ai-provider", { name: "unknown-gitlab-model" }))
      ).rejects.toThrow("Unsupported GitLab chat model");
    });

    it("reports unsupported provider packages instead of routing them as OpenAI", async () => {
      await expect(createNativeSdkChatModel(model("unsupported-sdk"))).rejects.toThrow(
        "Unsupported native provider package"
      );
    });
  });
});
