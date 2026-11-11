import { getProviderPreset } from "./providerPresets";
import type { ProviderPreset } from "./providerPresets";
import { presetDomain, presetVersionLabel } from "./presetVersionLabels";

function presetFixture(overrides: Partial<ProviderPreset>): ProviderPreset {
  return {
    id: "fixture",
    displayName: "Fixture",
    providerType: "openai-compatible",
    baseUrl: "https://api.example.com/v1",
    websiteUrl: "https://example.com",
    category: "aggregator",
    requiresApiKey: true,
    recommendedModelIds: ["model-a"],
    ...overrides,
  };
}

describe("presetVersionLabels", () => {
  describe("presetVersionLabel()", () => {
    it("combines the plan and region labels for a family version", () => {
      const kimi = getProviderPreset("kimi");
      expect(presetVersionLabel(kimi!)).toBe("Pay-as-you-go · China");
    });

    it("labels a region-only version with just the region name", () => {
      const zhipu = getProviderPreset("zhipu-glm");
      expect(presetVersionLabel(zhipu!)).toBe("China");
    });

    it("falls back to the endpoint domain for a versionless preset", () => {
      const tokenplus = getProviderPreset("tokenplus");
      expect(presetVersionLabel(tokenplus!)).toBe("api.tokenplus.cn");
    });
  });

  describe("presetDomain()", () => {
    it("extracts the host from a preset base URL", () => {
      expect(presetDomain(presetFixture({ baseUrl: "https://api.example.com/v1" }))).toBe(
        "api.example.com"
      );
    });

    it("returns the raw value when the base URL is not an absolute address", () => {
      expect(presetDomain(presetFixture({ baseUrl: "not a url" }))).toBe("not a url");
    });
  });
});
