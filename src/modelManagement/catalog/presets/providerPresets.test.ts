import { PRESET_FAMILIES } from "./presetFamilies";
import { getPresetIcon } from "./presetIcons";
import {
  CATALOG_VENDOR_LINKS,
  catalogToPseudoPreset,
  catalogVendorLink,
  getProviderPreset,
  getProviderPresetVersions,
  PROVIDER_PRESETS,
} from "./providerPresets";

describe("providerPresets", () => {
  describe("PROVIDER_PRESETS", () => {
    it("ships the full ported catalog while excluding duplicated local templates and unroutable protocols", () => {
      expect(PROVIDER_PRESETS).toHaveLength(114);
      const ids = new Set(PROVIDER_PRESETS.map((preset) => preset.id));
      expect(ids.has("ollama")).toBe(false);
      expect(ids.has("lmstudio")).toBe(false);
      expect(
        PROVIDER_PRESETS.some((preset) => preset.baseUrl.toLowerCase().includes("bedrock"))
      ).toBe(false);
    });

    it("uses unique preset ids", () => {
      const ids = PROVIDER_PRESETS.map((preset) => preset.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("gives every preset a routable provider type, an absolute endpoint and a nonempty identity", () => {
      for (const preset of PROVIDER_PRESETS) {
        expect(["anthropic", "openai-compatible", "google"]).toContain(preset.providerType);
        expect(preset.baseUrl).toMatch(/^https?:\/\//);
        expect(preset.displayName.length).toBeGreaterThan(0);
        expect(preset.websiteUrl.length).toBeGreaterThan(0);
        expect(preset.recommendedModelIds.length).toBeGreaterThan(0);
        expect(preset.recommendedModelIds.every((modelId) => modelId.length > 0)).toBe(true);
        expect([
          "cn_official",
          "intl_official",
          "aggregator",
          "third_party",
          "cloud_provider",
          "local",
        ]).toContain(preset.category);
      }
    });

    it("marks local presets as keyless and loopback-bound while everything else requires a key", () => {
      const localPresets = PROVIDER_PRESETS.filter((preset) => preset.category === "local");
      expect(localPresets.length).toBeGreaterThan(0);
      for (const preset of localPresets) {
        expect(preset.requiresApiKey).toBe(false);
        expect(preset.baseUrl).toMatch(/^http:\/\/(localhost|127\.0\.0\.1)/);
      }
      for (const preset of PROVIDER_PRESETS.filter((entry) => entry.category !== "local")) {
        expect(preset.requiresApiKey).toBe(true);
      }
    });

    it("keeps family references inside the shipped family table", () => {
      for (const preset of PROVIDER_PRESETS) {
        if (!preset.family) continue;
        expect(preset.family in PRESET_FAMILIES).toBe(true);
      }
      expect(Object.keys(PRESET_FAMILIES)).toHaveLength(19);
    });

    it("groups the kimi family into four versions and the tencent family into eight", () => {
      const kimi = getProviderPreset("kimi");
      expect(kimi?.family).toBe("kimi");
      expect(getProviderPresetVersions(kimi!)).toHaveLength(4);
      const tencent = getProviderPreset("tencent-tokenhub");
      expect(tencent?.family).toBe("tencent");
      expect(getProviderPresetVersions(tencent!)).toHaveLength(8);
    });

    it("resolves a models.dev catalog namespace only for single-vendor presets", () => {
      expect(getProviderPreset("kimi")?.catalogProviderId).toBe("moonshotai");
      expect(getProviderPreset("deep-seek")?.catalogProviderId).toBe("deepseek");
      const multiVendor = getProviderPreset("tokenplus");
      expect(multiVendor?.catalogProviderId).toBeUndefined();
    });

    it("maps the kimi coding plan onto the anthropic protocol with its own endpoint", () => {
      const coding = getProviderPreset("kimi-for-coding");
      expect(coding?.providerType).toBe("anthropic");
      expect(coding?.baseUrl).toBe("https://api.kimi.com/coding");
    });

    it("keeps every referenced preset icon backed by inline svg markup", () => {
      const withIcon = PROVIDER_PRESETS.filter((preset) => preset.icon);
      expect(withIcon.length).toBeGreaterThan(0);
      for (const preset of withIcon) {
        expect(getPresetIcon(preset.icon)).toMatch(/^<svg/);
      }
    });
  });

  describe("getProviderPreset()", () => {
    it("finds a preset by id and returns undefined for unknown ids", () => {
      expect(getProviderPreset("kimi")?.displayName).toBe("Kimi");
      expect(getProviderPreset("does-not-exist")).toBeUndefined();
    });
  });

  describe("getProviderPresetVersions()", () => {
    it("returns only the preset itself when it has no family", () => {
      const tokenplus = getProviderPreset("tokenplus");
      expect(getProviderPresetVersions(tokenplus!)).toEqual([tokenplus]);
    });

    it("returns every family version including the queried one", () => {
      const versions = getProviderPresetVersions(getProviderPreset("kimi-global")!);
      expect(versions.map((preset) => preset.id)).toEqual([
        "kimi",
        "kimi-global",
        "kimi-for-coding",
        "kimi-for-coding-global",
      ]);
    });
  });

  describe("CATALOG_VENDOR_LINKS", () => {
    it("maps every catalog entry to a shipped family, an existing preset or a picker category", () => {
      for (const [catalogId, link] of Object.entries(CATALOG_VENDOR_LINKS)) {
        expect(catalogVendorLink(catalogId)).toBe(link);
        if (link.family) expect(link.family in PRESET_FAMILIES).toBe(true);
        if (link.presetId) expect(getProviderPreset(link.presetId)).toBeDefined();
        if (link.category) {
          expect([
            "cn_official",
            "intl_official",
            "aggregator",
            "third_party",
            "cloud_provider",
            "local",
          ]).toContain(link.category);
        }
        expect(link.family || link.presetId || link.category).toBeTruthy();
      }
    });

    it("classifies catalog-only vendor families into picker categories", () => {
      for (const [familyId, category] of [
        ["google", "intl_official"],
        ["perplexity", "intl_official"],
        ["azure", "cloud_provider"],
        ["siliconflow", "aggregator"],
        ["llm-gateway", "aggregator"],
        ["umans-ai", "third_party"],
        ["munito", "third_party"],
      ] as const) {
        expect(familyId in PRESET_FAMILIES).toBe(true);
        const members = Object.entries(CATALOG_VENDOR_LINKS).filter(
          ([, link]) => link.family === familyId
        );
        expect(members.length).toBeGreaterThan(0);
        expect(members.every(([, link]) => link.category === category)).toBe(true);
      }
    });

    it("covers the models.dev vendor variants that presets do not reach by endpoint host", () => {
      for (const catalogId of [
        "alibaba-cn",
        "alibaba-coding-plan",
        "xiaomi-token-plan-ams",
        "xiaomi-token-plan-sgp",
        "moonshotai-cn",
        "kimi-code-plan-cn",
        "kimi-code-plan-global",
        "zhipuai",
        "zhipuai-coding-plan",
        "zai-coding-plan",
        "tencent-tokenhub",
        "minimax-cn-coding-plan",
        "stepfun-ai-step-plan",
        "volcengine-coding-plan",
      ]) {
        expect(CATALOG_VENDOR_LINKS[catalogId]?.family).toBeDefined();
      }
    });
  });

  describe("catalogToPseudoPreset()", () => {
    it("wraps a catalog provider as a family version with a catalog-prefixed id", () => {
      const pseudo = catalogToPseudoPreset(
        {
          id: "alibaba-cn",
          displayName: "Alibaba Cloud (CN)",
          providerType: "openai-compatible",
          defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        },
        CATALOG_VENDOR_LINKS["alibaba-cn"]
      );
      expect(pseudo?.id).toBe("catalog-alibaba-cn");
      expect(pseudo?.family).toBe("alibaba");
      expect(pseudo?.category).toBe("cn_official");
      expect(pseudo?.catalogProviderId).toBe("alibaba-cn");
      expect(pseudo?.recommendedModelIds).toEqual([]);
      expect(pseudo?.baseUrl).toBe("https://dashscope.aliyuncs.com/compatible-mode/v1");
    });

    it("returns undefined for preset-targeted links or catalog providers without an endpoint", () => {
      expect(
        catalogToPseudoPreset(
          {
            id: "moark",
            displayName: "Moark",
            providerType: "openai-compatible",
            defaultBaseUrl: "https://moark.com/v1",
          },
          CATALOG_VENDOR_LINKS["moark"]
        )
      ).toBeUndefined();
    });

    it("keeps catalog-only families without an endpoint as endpointless pseudo versions", () => {
      const pseudo = catalogToPseudoPreset(
        { id: "google", displayName: "Google", providerType: "google" },
        CATALOG_VENDOR_LINKS["google"]
      );
      expect(pseudo?.id).toBe("catalog-google");
      expect(pseudo?.family).toBe("google");
      expect(pseudo?.baseUrl).toBe("");
      expect(pseudo?.category).toBe("intl_official");
    });
  });
});
