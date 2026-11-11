import { ChatModelProviders } from "@/constants";
import { resolveModelThinking } from "./modelThinking";

describe("modelThinking", () => {
  describe("resolveModelThinking()", () => {
    it("preserves installed Anthropic adaptive thinking and sampling capability without changing older model contracts https://github.com/ItsDalk-Lane/Scribe/issues/56", () => {
      const current = resolveModelThinking(
        {
          name: "claude-opus-4-7",
          provider: ChatModelProviders.ANTHROPIC,
          enabled: true,
          providerCatalogId: "anthropic",
        },
        "anthropic-messages"
      );
      const older = resolveModelThinking(
        {
          name: "claude-sonnet-4-5",
          provider: ChatModelProviders.ANTHROPIC,
          enabled: true,
          providerCatalogId: "anthropic",
        },
        "anthropic-messages"
      );
      expect(current.compat).toMatchObject({
        forceAdaptiveThinking: true,
        supportsTemperature: false,
      });
      expect(current.levels).toContain("xhigh");
      expect(older.compat?.forceAdaptiveThinking).toBeUndefined();
    });
    it("uses the installed provider contract for a reasoning model without an explicit effort list", () => {
      const result = resolveModelThinking(
        {
          name: "glm-5.3-flash",
          provider: ChatModelProviders.OPENAI_FORMAT,
          baseUrl: "https://open.bigmodel.cn/api/paas/v4",
          enabled: true,
        },
        "openai-completions"
      );
      expect(result.reasoning).toBe(true);
      expect(result.levels).toEqual(["low", "high", "max"]);
      expect(result.compat?.thinkingFormat).toBe("zai");
      expect(result.thinkingLevelMap.off).toBeNull();
    });

    it("caps the max thinking level at high for zhipu's bigmodel coding endpoint, which rejects the raw max effort value", () => {
      const result = resolveModelThinking(
        {
          name: "glm-5.3",
          provider: ChatModelProviders.OPENAI_FORMAT,
          baseUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
          enabled: true,
        },
        "openai-completions"
      );
      expect(result.thinkingLevelMap.max).toBe("high");
      expect(result.levels).toContain("max");
      expect(result.compat?.thinkingFormat).toBe("zai");
    });

    it("keeps the catalog max level for providers without an override", () => {
      const result = resolveModelThinking(
        {
          name: "glm-5.3",
          provider: ChatModelProviders.OPENAI_FORMAT,
          baseUrl: "https://api.z.ai/api/coding/paas/v4",
          enabled: true,
        },
        "openai-completions"
      );
      expect(result.thinkingLevelMap.max).toBe("max");
    });

    it("preserves an explicitly advertised effort list for a custom model", () => {
      const result = resolveModelThinking({
        name: "custom",
        provider: ChatModelProviders.OPENAI_FORMAT,
        enabled: true,
        reasoningEfforts: ["none", "low", "high", "unsupported"],
      });
      expect(result.levels).toEqual(["off", "low", "high"]);
    });

    it("preserves a configured reasoning flag when image capabilities remain unknown https://github.com/ItsDalk-Lane/Scribe/issues/56", () => {
      const result = resolveModelThinking({
        name: "private-reasoner",
        provider: ChatModelProviders.OPENAI_FORMAT,
        enabled: true,
        reasoning: true,
      });
      expect(result.reasoning).toBe(true);
      expect(result.levels).toContain("high");
    });

    it("keeps explicit reasoning disabled even when the bundled model metadata advertises it https://github.com/ItsDalk-Lane/Scribe/issues/56", () => {
      const result = resolveModelThinking({
        name: "gpt-5",
        provider: ChatModelProviders.OPENAI_FORMAT,
        enabled: true,
        reasoning: false,
      });
      expect(result.reasoning).toBe(false);
      expect(result.levels).toEqual([]);
    });

    it("offers no reasoning control for an unknown model without a reasoning capability", () => {
      const result = resolveModelThinking({
        name: "custom",
        provider: ChatModelProviders.OPENAI_FORMAT,
        enabled: true,
      });
      expect(result.levels).toEqual([]);
    });
    it("resolves known models through a custom endpoint even when catalog alternatives have no URL", () => {
      const result = resolveModelThinking({
        name: "gpt-5",
        provider: ChatModelProviders.OPENAI_FORMAT,
        baseUrl: "https://custom.invalid/v1",
        enabled: true,
      });
      expect(result.reasoning).toBe(true);
      expect(result.levels.length).toBeGreaterThan(0);
    });
  });
});
