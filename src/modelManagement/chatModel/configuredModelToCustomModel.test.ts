import { ChatModelProviders, DEFAULT_MAX_OUTPUT_TOKENS, ModelCapability } from "@/constants";
import type { ConfiguredModel, Provider } from "@/modelManagement/types/persisted";

import {
  configuredModelToCustomModel,
  mapProviderTypeToChatModelProvider,
} from "./configuredModelToCustomModel";

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    providerId: "p1",
    providerType: "openai-compatible",
    displayName: "P",
    origin: { kind: "byok" },
    addedAt: 0,
    apiKeyRef: null,
    ...overrides,
  };
}

function configuredModel(overrides: Partial<ConfiguredModel> = {}): ConfiguredModel {
  return {
    configuredModelId: "cm1",
    providerId: "p1",
    info: { id: "gpt-5", displayName: "GPT-5" },
    configuredAt: 0,
    ...overrides,
  };
}

describe("configuredModelToCustomModel", () => {
  describe("mapProviderTypeToChatModelProvider", () => {
    it("maps anthropic and google provider types to their dedicated chat providers", () => {
      expect(mapProviderTypeToChatModelProvider(provider({ providerType: "anthropic" }))).toBe(
        ChatModelProviders.ANTHROPIC
      );
      expect(mapProviderTypeToChatModelProvider(provider({ providerType: "google" }))).toBe(
        ChatModelProviders.GOOGLE
      );
    });

    it("maps an openai-compatible BYOK provider to the chat provider of its catalog id", () => {
      const cases: Array<[string, ChatModelProviders]> = [
        ["openai", ChatModelProviders.OPENAI],
        ["groq", ChatModelProviders.GROQ],
        ["mistral", ChatModelProviders.MISTRAL],
        ["openrouter", ChatModelProviders.OPENROUTERAI],
        ["deepseek", ChatModelProviders.DEEPSEEK],
        ["xai", ChatModelProviders.XAI],
        ["cohere", ChatModelProviders.COHEREAI],
        ["siliconflow", ChatModelProviders.SILICONFLOW],
      ];
      for (const [catalogProviderId, expected] of cases) {
        expect(
          mapProviderTypeToChatModelProvider(
            provider({ origin: { kind: "byok", catalogProviderId } })
          )
        ).toBe(expected);
      }
    });

    it("maps an openai-compatible provider with an unknown or missing catalog id to OPENAI_FORMAT", () => {
      expect(
        mapProviderTypeToChatModelProvider(
          provider({ origin: { kind: "byok", catalogProviderId: "together" } })
        )
      ).toBe(ChatModelProviders.OPENAI_FORMAT);
      expect(
        mapProviderTypeToChatModelProvider(
          provider({ baseUrl: "http://localhost:11434/v1", origin: { kind: "byok" } })
        )
      ).toBe(ChatModelProviders.OPENAI_FORMAT);
    });

    it("maps an xAI catalog provider with a custom base URL to OPENAI_FORMAT", () => {
      expect(
        mapProviderTypeToChatModelProvider(
          provider({
            baseUrl: "https://proxy.example.com/v1",
            origin: { kind: "byok", catalogProviderId: "xai" },
          })
        )
      ).toBe(ChatModelProviders.OPENAI_FORMAT);
    });
  });

  describe("configuredModelToCustomModel", () => {
    it("carries the configured provider display name for distinct usage sources https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ displayName: "Research endpoint" }),
        configuredModel: configuredModel(),
      });
      expect(custom).toHaveProperty("providerDisplayName", "Research endpoint");
      expect(custom.configuredModelId).toBe("cm1");
      expect(custom.name).toBe("gpt-5");
    });

    it("uses the wire id as the model name and the stored display name", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ providerType: "anthropic" }),
        configuredModel: configuredModel({
          info: { id: "claude-sonnet-4-5", displayName: "Claude Sonnet 4.5" },
        }),
        apiKey: "sk-ant",
      });
      expect(custom.name).toBe("claude-sonnet-4-5");
      expect(custom.displayName).toBe("Claude Sonnet 4.5");
      expect(custom.provider).toBe(ChatModelProviders.ANTHROPIC);
      expect(custom.apiKey).toBe("sk-ant");
      expect(custom.enabled).toBe(true);
      expect(custom.configuredModelId).toBe("cm1");
    });

    it("carries the catalog context limit as the runtime context window and stays unset when the catalog has none", () => {
      const known = configuredModelToCustomModel({
        provider: provider(),
        configuredModel: configuredModel({
          info: { id: "small-model", displayName: "Small", limits: { context: 8192 } },
        }),
        apiKey: "fixture",
      });
      expect(known.numCtx).toBe(8192);
      const unknown = configuredModelToCustomModel({
        provider: provider(),
        configuredModel: configuredModel({
          info: { id: "opaque-model", displayName: "Opaque" },
        }),
        apiKey: "fixture",
      });
      expect(unknown.numCtx).toBeUndefined();
    });

    it("caps an Anthropic model's published ceiling rather than passing it through", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ providerType: "anthropic" }),
        configuredModel: configuredModel({
          info: {
            id: "claude-sonnet-4-5",
            displayName: "Claude Sonnet 4.5",
            limits: { context: 200000, output: 64000 },
          },
        }),
        apiKey: "sk-ant",
      });

      expect(custom.maxTokens).toBe(DEFAULT_MAX_OUTPUT_TOKENS);
    });

    it("keeps a published output ceiling below the product default instead of raising it https://github.com/ItsDalk-Lane/Scribe/issues/56", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ providerType: "anthropic" }),
        configuredModel: configuredModel({
          info: {
            id: "claude-3-5-haiku",
            displayName: "Claude 3.5 Haiku",
            limits: { context: 200000, output: 8192 },
          },
        }),
        apiKey: "sk-ant",
      });

      expect(custom.maxTokens).toBe(8192);
    });

    it("sends no output limit to a provider that accepts a request without one", () => {
      const openAiCompatible = configuredModelToCustomModel({
        provider: provider({ origin: { kind: "byok", catalogProviderId: "openai" } }),
        configuredModel: configuredModel({
          info: { id: "gpt-5", displayName: "GPT-5", limits: { context: 400000, output: 128000 } },
        }),
        apiKey: "sk",
      });
      const anthropicWithoutLimits = configuredModelToCustomModel({
        provider: provider({ providerType: "anthropic" }),
        configuredModel: configuredModel({
          info: { id: "claude-next", displayName: "Claude Next" },
        }),
        apiKey: "sk-ant",
      });

      expect(openAiCompatible.maxTokens).toBeUndefined();
      expect(anthropicWithoutLimits.maxTokens).toBeUndefined();
    });

    it("carries the provider base URL onto the custom model", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ baseUrl: "https://api.example.com/v1" }),
        configuredModel: configuredModel(),
        apiKey: "key-123",
      });
      expect(custom.apiKey).toBe("key-123");
      expect(custom.baseUrl).toBe("https://api.example.com/v1");
    });

    it.each([false, true])(
      "does not carry a retired CORS value %s into the automatic transport https://github.com/ItsDalk-Lane/Scribe/issues/51",
      (enableCors) => {
        const storedProvider = { ...provider(), enableCors };
        const custom = configuredModelToCustomModel({
          provider: storedProvider,
          configuredModel: configuredModel(),
          apiKey: "key-123",
        });
        expect(custom).not.toHaveProperty("enableCors");
        expect(custom.apiKey).toBe("key-123");
      }
    );

    it("carries the runtime auth contract without synthesizing a key", () => {
      const keyless = configuredModelToCustomModel({
        provider: provider({ requiresApiKey: false, baseUrl: "http://localhost:11434/v1" }),
        configuredModel: configuredModel(),
        apiKey: null,
      });
      expect(keyless.apiKey).toBeUndefined();
      expect(keyless.requiresApiKey).toBe(false);

      const requiresKey = configuredModelToCustomModel({
        provider: provider({ requiresApiKey: true }),
        configuredModel: configuredModel(),
        apiKey: null,
      });
      expect(requiresKey.apiKey).toBeUndefined();
      expect(requiresKey.requiresApiKey).toBe(true);

      const missingStoredKey = configuredModelToCustomModel({
        provider: provider({ requiresApiKey: false, apiKeyRef: "keychain-p1" }),
        configuredModel: configuredModel(),
        apiKey: null,
      });
      expect(missingStoredKey.requiresApiKey).toBe(true);
    });

    it("lists reasoning and vision capabilities from the stored model info", () => {
      const custom = configuredModelToCustomModel({
        provider: provider({ providerType: "anthropic" }),
        configuredModel: configuredModel({
          info: {
            id: "claude-sonnet-4-5",
            displayName: "Claude Sonnet 4.5",
            reasoning: true,
            modalities: { input: ["text", "image"] },
          },
        }),
        apiKey: "k",
      });
      expect(custom.capabilities).toEqual([ModelCapability.REASONING, ModelCapability.VISION]);
    });

    it("copies the OpenAI organization id from provider extras", () => {
      const openai = configuredModelToCustomModel({
        provider: provider({
          origin: { kind: "byok", catalogProviderId: "openai" },
          extras: { openAIOrgId: "org-1" },
        }),
        configuredModel: configuredModel(),
        apiKey: "sk",
      });
      expect(openai.openAIOrgId).toBe("org-1");
    });
  });
});
