import {
  CONTEXT_LIMIT_PRESETS,
  OUTPUT_LIMIT_PRESETS,
  buildModelInfoPatch,
  formStateFromCatalogDefault,
  formStateFromInfo,
  hasCostConfig,
  isModelSelectable,
  parseLimitInput,
} from "./modelConfigForm";
import type { ModelInfo } from "@/modelManagement/types/catalog";

describe("modelConfigForm", () => {
  describe("CONTEXT_LIMIT_PRESETS", () => {
    it("offers the 64K–1M context presets in token values https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      expect([...CONTEXT_LIMIT_PRESETS]).toEqual([64000, 128000, 200000, 256000, 512000, 1000000]);
    });
  });

  describe("OUTPUT_LIMIT_PRESETS", () => {
    it("offers the 8K–256K output presets in token values https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      expect([...OUTPUT_LIMIT_PRESETS]).toEqual([8000, 16000, 32000, 64000, 128000, 256000]);
    });
  });

  describe("parseLimitInput()", () => {
    it.each([
      ["", undefined],
      ["   ", undefined],
      ["128K", 128000],
      ["128k", 128000],
      ["1M", 1000000],
      ["131072", 131072],
      ["0.5M", 500000],
      ["abc", undefined],
      ["-5", undefined],
      ["0", undefined],
      ["12x", undefined],
    ] as Array<[string, number | undefined]>)("parses %j → %j", (raw, expected) => {
      expect(parseLimitInput(raw)).toBe(expected);
    });
  });

  describe("hasCostConfig()", () => {
    it("treats a declared cost as API billing and its absence as subscription billing https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      expect(hasCostConfig({ id: "m", displayName: "M", cost: { input: 1 } })).toBe(true);
      expect(hasCostConfig({ id: "m", displayName: "M" })).toBe(false);
    });
  });

  describe("isModelSelectable()", () => {
    it("blocks new selection of deprecated models but keeps selected ones removable https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      const deprecated: ModelInfo = {
        id: "m",
        displayName: "M",
        status: "deprecated",
      };
      expect(isModelSelectable(deprecated, false)).toBe(false);
      expect(isModelSelectable(deprecated, true)).toBe(true);
      expect(isModelSelectable({ id: "m", displayName: "M", status: "beta" }, false)).toBe(true);
      expect(isModelSelectable({ id: "m", displayName: "M" }, false)).toBe(true);
    });
  });

  describe("formStateFromInfo()", () => {
    it("auto-fills from declared metadata and keeps undeclared fields blank https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      const state = formStateFromInfo({
        id: "m",
        displayName: "M",
        modalities: { input: ["text", "image", "psx"], output: ["text"] },
        limits: { context: 262144, output: 16384 },
        reasoning: true,
        reasoningEfforts: ["low", "high"],
        toolCall: true,
        temperature: true,
        temperatureValue: 0.7,
        cost: { input: 2.4, output: 9.6, cacheRead: 1.2, currency: "CNY" },
      });
      expect(state.inputModalities).toEqual(["text", "image"]);
      expect(state.outputModalities).toEqual(["text"]);
      expect(state.reasoning).toBe(true);
      expect(state.reasoningEfforts).toEqual(["low", "high"]);
      expect(state.toolCall).toBe(true);
      expect(state.attachment).toBe(false);
      expect(state.structuredOutput).toBe(false);
      expect(state.temperature).toBe(true);
      expect(state.temperatureValue).toBe("0.7");
      expect(state.contextLimit).toBe("262144");
      expect(state.outputLimit).toBe("16384");
      expect(state.inputLimit).toBe("");
      expect(state.costInput).toBe("2.4");
      expect(state.costCurrency).toBe("CNY");
    });

    it("defaults a declared cost without currency to USD https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      const state = formStateFromInfo({
        id: "m",
        displayName: "M",
        cost: { input: 1 },
      });
      expect(state.costCurrency).toBe("USD");
      expect(state.costCacheWrite).toBe("");
    });
  });

  describe("formStateFromCatalogDefault()", () => {
    it("keeps only catalog-declared fields and clears user-only values https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      const state = formStateFromCatalogDefault({
        id: "m",
        displayName: "M",
        modalities: { input: ["text"], output: ["text"] },
        limits: { context: 128000 },
        reasoning: false,
        cost: { output: 5 },
      });
      expect(state.inputModalities).toEqual(["text"]);
      expect(state.contextLimit).toBe("128000");
      expect(state.reasoning).toBe(false);
      expect(state.temperatureValue).toBe("");
      expect(state.costInput).toBe("");
      expect(state.costOutput).toBe("5");
    });
  });

  describe("buildModelInfoPatch()", () => {
    it("writes every configured field back with K/M limits parsed to tokens https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      const patch = buildModelInfoPatch({
        inputModalities: ["text", "image"],
        outputModalities: [],
        reasoning: true,
        reasoningEfforts: ["low", "high"],
        toolCall: true,
        attachment: false,
        structuredOutput: true,
        temperature: true,
        temperatureValue: "0.7",
        contextLimit: "128K",
        outputLimit: "32K",
        inputLimit: "",
        costInput: "2.4",
        costOutput: "",
        costCacheRead: "",
        costCacheWrite: "",
        costCurrency: "CNY",
      });
      expect(patch.modalities).toEqual({ input: ["text", "image"] });
      expect(patch.limits).toEqual({ context: 128000, output: 32000 });
      expect(patch.reasoning).toBe(true);
      expect(patch.reasoningEfforts).toEqual(["low", "high"]);
      expect(patch.structuredOutput).toBe(true);
      expect(patch.temperature).toBe(true);
      expect(patch.temperatureValue).toBe(0.7);
      expect(patch.cost).toEqual({ input: 2.4, currency: "CNY" });
    });

    it("clears temperature value when the toggle is off and omits an all-blank cost block https://github.com/ItsDalk-Lane/Scribe/issues/67", () => {
      const patch = buildModelInfoPatch({
        inputModalities: [],
        outputModalities: [],
        reasoning: false,
        reasoningEfforts: ["low"],
        toolCall: false,
        attachment: false,
        structuredOutput: false,
        temperature: false,
        temperatureValue: "0.9",
        contextLimit: "",
        outputLimit: "",
        inputLimit: "",
        costInput: "",
        costOutput: "",
        costCacheRead: "",
        costCacheWrite: "",
        costCurrency: "USD",
      });
      expect(patch.reasoning).toBe(false);
      expect(patch.reasoningEfforts).toEqual([]);
      expect(patch.temperatureValue).toBeUndefined();
      expect(patch.cost).toBeUndefined();
      expect(patch.modalities).toBeUndefined();
      expect(patch.limits).toBeUndefined();
    });
  });
});
