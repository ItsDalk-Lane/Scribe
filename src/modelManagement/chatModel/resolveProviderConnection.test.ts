import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import * as obsidianModule from "obsidian";

jest.mock("@/logger");

const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};

import { resolveProviderConnection } from "./resolveProviderConnection";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { Provider } from "@/modelManagement/types/persisted";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p",
    providerType: "openai-compatible",
    displayName: "Test",
    origin: { kind: "byok" },
    addedAt: 0,
    ...overrides,
  };
}
const model: ModelInfo = { id: "test", displayName: "Test" };

describe("resolveProviderConnection", () => {
  describe("resolveProviderConnection()", () => {
    it.each([
      [
        "official compatibility",
        "https://api.cohere.ai/compatibility/v1",
        undefined,
        "https://api.cohere.ai/compatibility/v1/chat/completions",
        "@ai-sdk/openai-compatible",
      ],
      [
        "custom compatibility",
        "https://cohere-proxy.example/compatibility/v1",
        undefined,
        "https://cohere-proxy.example/compatibility/v1/chat/completions",
        "@ai-sdk/openai-compatible",
      ],
      [
        "explicit native",
        "https://cohere-proxy.example/v2",
        "native",
        "https://cohere-proxy.example/v2/chat",
        "@ai-sdk/cohere",
      ],
    ])(
      "calls the real SDK successfully with Cohere %s while a strict service rejects the wrong protocol",
      async (_mode, baseUrl, apiProtocol, expectedUrl, expectedNpm) => {
        const requests: string[] = [];
        setRequestUrlImpl((request: { url: string; body: string }) => {
          requests.push(request.url);
          const success = request.url === expectedUrl;
          const json = !success
            ? { error: "Wrong API path", message: "Wrong API path" }
            : expectedNpm === "@ai-sdk/cohere"
              ? {
                  id: "cohere-fixture",
                  finish_reason: "COMPLETE",
                  message: {
                    role: "assistant",
                    content: [{ type: "text", text: "fixture reply" }],
                  },
                  usage: { tokens: { input_tokens: 1, output_tokens: 1 } },
                }
              : {
                  id: "chat-fixture",
                  object: "chat.completion",
                  created: 1,
                  model: "command-a-03-2025",
                  choices: [
                    {
                      index: 0,
                      message: { role: "assistant", content: "fixture reply" },
                      finish_reason: "stop",
                    },
                  ],
                  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
                };
          return Promise.resolve({
            status: success ? 200 : 404,
            text: JSON.stringify(json),
            json,
            headers: { "content-type": "application/json" },
            arrayBuffer: new ArrayBuffer(0),
          });
        });
        const connection = resolveProviderConnection(
          provider({
            origin: { kind: "byok", catalogProviderId: "cohere" },
            baseUrl,
            extras: {
              npm: "@ai-sdk/cohere",
              catalogBaseUrl: "https://api.cohere.ai/compatibility/v1",
              ...(apiProtocol ? { apiProtocol } : {}),
            },
          }),
          { id: "command-a-03-2025", displayName: "Command A" }
        );
        const client = await createProviderChatModel({
          name: "command-a-03-2025",
          provider: "OpenAI Format",
          providerNpm: connection.npm,
          providerCatalogId: "cohere",
          providerOptions: connection.options,
          apiShape: connection.shape,
          baseUrl: connection.baseUrl,
          apiKey: "fixture-not-real",
          enableCors: true,
          enabled: true,
          stream: false,
        });
        expect((await client.invoke("fixture input")).text).toBe("fixture reply");
        expect(requests).toEqual([expectedUrl]);
        expect(connection.npm).toBe(expectedNpm);
      }
    );

    it("keeps Cloudflare compatibility and its custom address when native mode is not supported", () => {
      const result = resolveProviderConnection(
        provider({
          origin: { kind: "byok", catalogProviderId: "cloudflare-ai-gateway" },
          baseUrl: "https://gateway-proxy.example/compat",
          extras: {
            apiProtocol: "native",
            npm: "@ai-sdk/openai-compatible",
            catalogBaseUrl:
              "https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_GATEWAY_ID}/compat",
          },
        }),
        {
          ...model,
          provider: { npm: "@ai-sdk/anthropic", api: "https://official.example/anthropic/v1" },
        }
      );
      expect(result).toMatchObject({
        npm: "@ai-sdk/openai-compatible",
        baseUrl: "https://gateway-proxy.example/compat",
        shape: "completions",
      });
    });

    it("does not replace a provider's own declared address with a shared SDK vendor default", () => {
      const result = resolveProviderConnection(
        provider({
          origin: { kind: "byok", catalogProviderId: "cohere-proxy" },
          baseUrl: "https://proxy.example/v2",
          extras: { catalogBaseUrl: "https://proxy.example/v2", npm: "@ai-sdk/cohere" },
        }),
        model
      );
      expect(result.baseUrl).toBe("https://proxy.example/v2");
      expect(result.npm).toBe("@ai-sdk/cohere");
    });
    it("keeps the chosen custom address and conventional protocol", () => {
      expect(
        resolveProviderConnection(provider({ baseUrl: "https://proxy.example/v1" }), model)
      ).toMatchObject({ npm: "@ai-sdk/openai-compatible", baseUrl: "https://proxy.example/v1" });
    });
    it("uses a model's own Anthropic endpoint at the unchanged catalog address", () => {
      const result = resolveProviderConnection(
        provider({
          baseUrl: "https://opencode.ai/inference/go/openai/v1",
          extras: {
            npm: "@ai-sdk/openai-compatible",
            catalogBaseUrl: "https://opencode.ai/inference/go/openai/v1",
          },
          origin: { kind: "byok", catalogProviderId: "opencode-go" },
        }),
        {
          ...model,
          provider: {
            npm: "@ai-sdk/anthropic",
            api: "https://opencode.ai/inference/go/anthropic/v1",
          },
        }
      );
      expect(result).toMatchObject({
        npm: "@ai-sdk/anthropic",
        baseUrl: "https://opencode.ai/inference/go/anthropic/v1",
      });
    });
    it("never replaces an explicit custom address with a model's official address", () => {
      const result = resolveProviderConnection(
        provider({
          baseUrl: "https://private.example/v1",
          extras: {
            catalogBaseUrl: "https://official.example/v1",
            npm: "@ai-sdk/openai-compatible",
          },
        }),
        { ...model, provider: { api: "https://official.example/other/v1" } }
      );
      expect(result.baseUrl).toBe("https://private.example/v1");
    });
    it("keeps an older saved address when its original catalog default is unknown", () => {
      const result = resolveProviderConnection(
        provider({
          baseUrl: "https://old-proxy.example/v1",
          origin: { kind: "byok", catalogProviderId: "unlisted" },
        }),
        { ...model, provider: { api: "https://official.example/v1" } }
      );
      expect(result.baseUrl).toBe("https://old-proxy.example/v1");
    });
    it("preserves a model's explicit Responses API requirement", () => {
      expect(
        resolveProviderConnection(
          provider({
            baseUrl: "https://official.example/v1",
            extras: {
              catalogBaseUrl: "https://official.example/v1",
              npm: "@ai-sdk/openai-compatible",
            },
          }),
          { ...model, provider: { npm: "@ai-sdk/openai", shape: "responses" } }
        )
      ).toMatchObject({ npm: "@ai-sdk/openai", shape: "responses" });
    });
    it("fills a known provider's official default even when the catalog omits it", () => {
      expect(
        resolveProviderConnection(
          provider({ origin: { kind: "byok", catalogProviderId: "groq" } }),
          model
        )
      ).toMatchObject({ baseUrl: "https://api.groq.com/openai/v1" });
    });
    it("expands the Cloudflare account into its supported compatibility endpoint", () => {
      const result = resolveProviderConnection(
        provider({
          origin: { kind: "byok", catalogProviderId: "cloudflare-ai-gateway" },
          extras: { CLOUDFLARE_ACCOUNT_ID: "account", CLOUDFLARE_GATEWAY_ID: "gateway" },
        }),
        {
          ...model,
          provider: {
            npm: "@ai-sdk/anthropic",
            api: "https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_GATEWAY_ID}/anthropic/v1",
          },
        }
      );
      expect(result).toMatchObject({
        npm: "@ai-sdk/openai-compatible",
        shape: "completions",
        baseUrl: "https://gateway.ai.cloudflare.com/v1/account/gateway/compat",
      });
    });
    it("expands model-specific Vertex routes with the configured project and global endpoint", () => {
      const result = resolveProviderConnection(
        provider({
          origin: { kind: "byok", catalogProviderId: "google-vertex" },
          extras: { GOOGLE_VERTEX_PROJECT: "my-project", GOOGLE_VERTEX_LOCATION: "global" },
        }),
        {
          ...model,
          provider: {
            npm: "@ai-sdk/openai-compatible",
            api: "https://${GOOGLE_VERTEX_ENDPOINT}/v1/projects/${GOOGLE_VERTEX_PROJECT}/locations/${GOOGLE_VERTEX_LOCATION}/endpoints/openapi",
          },
        }
      );
      expect(result.baseUrl).toBe(
        "https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/endpoints/openapi"
      );
    });
    it("keeps native cloud profiles without inventing a generic endpoint", () => {
      expect(
        resolveProviderConnection(
          provider({ origin: { kind: "byok", catalogProviderId: "sap-ai-core" } }),
          model
        )
      ).toMatchObject({ npm: "@jerome-benoit/sap-ai-provider-v2" });
    });
  });
});
