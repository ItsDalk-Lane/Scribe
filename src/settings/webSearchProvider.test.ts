import type { Provider } from "@/modelManagement";
import { getDeepSeekSearchCredential } from "@/settings/webSearchProvider";

describe("webSearchProvider", () => {
  describe("getDeepSeekSearchCredential()", () => {
    const provider: Provider = {
      providerId: "deepseek",
      providerType: "openai-compatible",
      displayName: "DeepSeek",
      baseUrl: "https://api.deepseek.com/v1",
      apiKeyRef: "saved-key",
      origin: { kind: "byok" },
      addedAt: 1,
    };

    it("returns the existing encrypted reference for the official endpoint", () => {
      expect(getDeepSeekSearchCredential(provider)).toBe("saved-key");
    });

    it.each([
      "http://api.deepseek.com",
      "https://api.deepseek.com.example.net",
      "https://api.deepseek.com@another.example",
    ])(
      "does not use a key configured for %s with DeepSeek official search https://github.com/ItsDalk-Lane/Scribe/issues/70",
      (baseUrl) => expect(getDeepSeekSearchCredential({ ...provider, baseUrl })).toBeUndefined()
    );
  });
});
