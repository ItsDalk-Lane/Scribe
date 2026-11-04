import { openaiCompatibleAdapter } from "./openaiCompatibleAdapter";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

import type { Provider } from "@/modelManagement/types/persisted";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

function respondWith(status: number, payload: unknown = { data: [] }): void {
  mockSafeFetch.mockResolvedValue({
    status,
    text: async () => "",
    json: async () => payload,
  } as Response);
}

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyKeychainId: null,
    ...overrides,
  };
}

const OPENROUTER = {
  baseUrl: "https://openrouter.ai/api/v1",
  origin: { kind: "byok", catalogProviderId: "openrouter" },
} as const;

describe("openaiCompatibleAdapter", () => {
  describe("verifyCredentials", () => {
    beforeEach(() => {
      mockSafeFetch.mockReset();
      respondWith(200);
    });

    it("sends Bearer auth to the provider's models endpoint when an API key is set", async () => {
      const result = await openaiCompatibleAdapter.verifyCredentials({
        provider: provider(),
        apiKey: "sk-openai",
        extras: {},
      });

      expect(result.ok).toBe(true);
      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer sk-openai" },
      });
    });

    it("verifies Go against its official authenticated directory without changing the chat base URL", async () => {
      const go = provider({
        baseUrl: " https://opencode.ai/inference/go/openai/v1/// ",
        requiresApiKey: true,
        origin: { kind: "byok", catalogProviderId: "opencode-go" },
      });
      const result = await openaiCompatibleAdapter.verifyCredentials({
        provider: go,
        apiKey: "fixture-go-key",
        extras: {},
      });
      expect(result.ok).toBe(true);
      expect(mockSafeFetch).toHaveBeenCalledWith("https://opencode.ai/inference/go/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer fixture-go-key" },
      });
      expect(go.baseUrl).toBe(" https://opencode.ai/inference/go/openai/v1/// ");
    });

    it("reports an invalid Go key when its official directory rejects explicit Bearer auth", async () => {
      respondWith(401);
      const result = await openaiCompatibleAdapter.verifyCredentials({
        provider: provider({
          baseUrl: "https://opencode.ai/inference/go/openai/v1",
          requiresApiKey: true,
        }),
        apiKey: "invalid-diagnostic-key",
        extras: {},
      });
      expect(result).toMatchObject({ ok: false, code: "invalid_api_key" });
      expect(mockSafeFetch).toHaveBeenCalledWith("https://opencode.ai/inference/go/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer invalid-diagnostic-key" },
      });
    });

    it.each([null, "", "   "])(
      "does not treat a public directory as verified when a required Go key is absent or blank: %p",
      async (apiKey) => {
        const result = await openaiCompatibleAdapter.verifyCredentials({
          provider: provider({
            baseUrl: "https://opencode.ai/inference/go/openai/v1",
            requiresApiKey: true,
          }),
          apiKey,
          extras: {},
        });
        expect(result).toMatchObject({ ok: false, code: "missing_api_key" });
        expect(mockSafeFetch).not.toHaveBeenCalled();
      }
    );

    it("keeps a catalog provider's custom proxy rather than sending its credential to OpenCode", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider({
          baseUrl: "https://proxy.example/inference/go/openai/v1",
          origin: { kind: "byok", catalogProviderId: "opencode-go" },
        }),
        apiKey: "fixture-proxy-key",
        extras: {},
      });
      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://proxy.example/inference/go/openai/v1/models",
        {
          method: "GET",
          headers: { Authorization: "Bearer fixture-proxy-key" },
        }
      );
    });

    it("sends no Authorization header for a keyless provider such as Ollama", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider({ baseUrl: "http://localhost:11434/v1", requiresApiKey: false }),
        apiKey: null,
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith("http://localhost:11434/v1/models", {
        method: "GET",
        headers: {},
      });
    });

    it("adds the OpenAI-Organization header when extras carry an organization id", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider(),
        apiKey: "sk-openai",
        extras: { openAIOrgId: "org-abc" },
      });

      expect(mockSafeFetch).toHaveBeenCalledWith("https://api.openai.com/v1/models", {
        method: "GET",
        headers: { Authorization: "Bearer sk-openai", "OpenAI-Organization": "org-abc" },
      });
    });

    it("strips the trailing slash from the base URL", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider({ baseUrl: "https://example.test/v1/" }),
        apiKey: "k",
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://example.test/v1/models",
        expect.any(Object)
      );
    });

    it("uses the plain models endpoint for catalog providers other than OpenRouter", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider({ origin: { kind: "byok", catalogProviderId: "groq" } }),
        apiKey: "k",
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith(
        "https://api.openai.com/v1/models",
        expect.any(Object)
      );
    });

    it("verifies OpenRouter against its auth-gated /key path because public /models would always succeed", async () => {
      await openaiCompatibleAdapter.verifyCredentials({
        provider: provider(OPENROUTER),
        apiKey: "sk-or",
        extras: {},
      });

      expect(mockSafeFetch).toHaveBeenCalledWith("https://openrouter.ai/api/v1/key", {
        method: "GET",
        headers: { Authorization: "Bearer sk-or" },
      });
    });

    it("checks OpenRouter key metadata instead of accepting a public model list", async () => {
      respondWith(200, { data: [] });
      expect(
        await openaiCompatibleAdapter.verifyCredentials({
          provider: provider(OPENROUTER),
          apiKey: "sk-or",
          extras: {},
        })
      ).toMatchObject({ ok: false, code: "invalid_response" });
      respondWith(200, { data: { label: "key-label" } });
      expect(
        await openaiCompatibleAdapter.verifyCredentials({
          provider: provider(OPENROUTER),
          apiKey: "sk-or",
          extras: {},
        })
      ).toMatchObject({ ok: true });
    });

    it("reports invalid_api_key when OpenRouter's /key rejects the key with 401", async () => {
      respondWith(401);

      const result = await openaiCompatibleAdapter.verifyCredentials({
        provider: provider(OPENROUTER),
        apiKey: "sk-wrong",
        extras: {},
      });

      expect(result).toMatchObject({ ok: false, code: "invalid_api_key" });
    });

    it.each([undefined, "   "])(
      "returns missing_base_url without sending a request when the base URL is %p",
      async (baseUrl) => {
        const result = await openaiCompatibleAdapter.verifyCredentials({
          provider: provider({ baseUrl }),
          apiKey: "sk-openai",
          extras: {},
        });

        expect(result).toMatchObject({ ok: false, code: "missing_base_url" });
        expect(mockSafeFetch).not.toHaveBeenCalled();
      }
    );
  });

  describe("extrasSchema", () => {
    it("accepts the catalog metadata stored beside a provider's extras", () => {
      expect(() =>
        openaiCompatibleAdapter.extrasSchema.parse({
          npm: "@ai-sdk/openai-compatible",
          catalogBaseUrl: "https://opencode.ai/inference/go/openai/v1",
        })
      ).not.toThrow();
    });
  });
});
