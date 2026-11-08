import {
  buildEmptySkillCatalog,
  buildSkillCatalog,
  catalogBudgetTokens,
  deliverSkillText,
  renderCatalogDescription,
  resolveSkillCatalogBudget,
  SKILL_CATALOG_DESCRIPTION_RENDER_MAX,
  type SkillCatalogBudget,
  type SkillCatalogEntry,
} from "@/agentMode/sdk/skillCatalog";
import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";

// R1 目录预算与两级降级 https://github.com/ItsDalk-Lane/Scribe/issues/40
// R2 统一投递上限 https://github.com/ItsDalk-Lane/Scribe/issues/41
// R3/R4 目录纪律与替换语义 https://github.com/ItsDalk-Lane/Scribe/issues/42
// https://github.com/ItsDalk-Lane/Scribe/issues/43

function entry(name: string, description: string, builtin = false): SkillCatalogEntry {
  return { name, description, builtin };
}

function unlimitedBudget(): SkillCatalogBudget {
  return { contextWindow: 200000, percent: 2, maxTokens: 100000 };
}

describe("skillCatalog", () => {
  describe("catalogBudgetTokens()", () => {
    it("caps the budget at the absolute token maximum for a known context window", () => {
      expect(catalogBudgetTokens({ contextWindow: 100000, percent: 2, maxTokens: 10000 })).toBe(
        2000
      );
      expect(catalogBudgetTokens({ contextWindow: 1000000, percent: 2, maxTokens: 10000 })).toBe(
        10000
      );
    });

    it("falls back to the absolute maximum when the context window is unknown", () => {
      expect(catalogBudgetTokens({ contextWindow: 0, percent: 2, maxTokens: 10000 })).toBe(10000);
    });
  });

  describe("resolveSkillCatalogBudget()", () => {
    it("keeps provided overrides and substitutes defaults for invalid values", () => {
      expect(
        resolveSkillCatalogBudget({ contextWindow: 128000, percent: 5, maxTokens: 2000 })
      ).toEqual({ contextWindow: 128000, percent: 5, maxTokens: 2000 });
      expect(resolveSkillCatalogBudget({ percent: 0, maxTokens: -3 })).toEqual({
        contextWindow: 0,
        percent: 2,
        maxTokens: 10000,
      });
      expect(resolveSkillCatalogBudget({})).toEqual({
        contextWindow: 0,
        percent: 2,
        maxTokens: 10000,
      });
    });
  });

  describe("buildSkillCatalog()", () => {
    it("lists every skill with the usage discipline and replacement semantics within budget", () => {
      const skills = [entry("note-format", "Format notes"), entry("draw", "Draw a diagram")];
      const { description, status } = buildSkillCatalog({
        available: skills,
        budget: unlimitedBudget(),
      });
      expect(status).toEqual({
        mode: "full",
        includedNames: ["note-format", "draw"],
        omittedNames: [],
      });
      expect(description).toContain("- note-format: Format notes");
      expect(description).toContain("- draw: Draw a diagram");
      expect(description).toContain("never act on the summary alone");
      expect(description).toContain("This list replaces every earlier skill list");
      expect(description).toMatch(/Catalog version: [0-9a-f]{8}\./);
      expect(estimateTextTokens(description)).toBeLessThanOrEqual(
        catalogBudgetTokens(unlimitedBudget())
      );
    });

    it("prunes the highest-cost entries first and reports the omitted names when over budget", () => {
      const skills = [
        entry("aaa", "a".repeat(400)),
        entry("bbb", "b".repeat(400)),
        entry("ccc", "Use tables"),
      ];
      const { description, status } = buildSkillCatalog({
        available: skills,
        budget: { contextWindow: 0, maxTokens: 600, percent: 2 },
      });
      expect(status.mode).toBe("pruned");
      expect(status.omittedNames).toEqual(["aaa", "bbb"]);
      expect(status.includedNames).toEqual(["ccc"]);
      expect(description).not.toContain("a".repeat(50));
      expect(description).toContain("omitted from this list to save space");
      expect(estimateTextTokens(description)).toBeLessThanOrEqual(600);
    });

    it("keeps builtin skills longer than equally costly personal skills when pruning", () => {
      const personal = entry("personal-a", "x".repeat(80));
      const builtin = entry("builtin-b", "x".repeat(80), true);
      const { status } = buildSkillCatalog({
        available: [personal, builtin],
        budget: { contextWindow: 0, maxTokens: 100, percent: 2 },
      });
      if (status.mode === "pruned") {
        expect(status.omittedNames).toContain("personal-a");
        expect(status.includedNames).toContain("builtin-b");
      } else {
        expect(status.mode).toBe("names-only");
      }
    });

    it("degrades to names only, keeping every name and the core discipline, when descriptions cannot fit", () => {
      const skills = Array.from({ length: 12 }, (_value, index) =>
        entry(`skill-${index + 1}`, `${index + 1} `.repeat(120).trim())
      );
      const { description, status } = buildSkillCatalog({
        available: skills,
        budget: { contextWindow: 0, maxTokens: 400, percent: 2 },
      });
      expect(status.mode).toBe("names-only");
      expect(status.includedNames).toEqual(
        skills.map((skill) => skill.name).sort((left, right) => left.localeCompare(right))
      );
      expect(status.omittedNames).toEqual([]);
      expect(description).toContain("descriptions omitted to save space");
      expect(description).toContain("never act on the summary alone");
      expect(description).not.toContain("skill-1: 1 1");
      expect(estimateTextTokens(description)).toBeLessThanOrEqual(400);
    });

    it.each([1, 50, 100, 200])(
      "keeps the catalog within a %i-token limit even when fixed instructions cannot fit https://github.com/ItsDalk-Lane/Scribe/issues/40",
      (maxTokens) => {
        const skills = [entry("note-format", "Format notes"), entry("draw", "Draw a diagram")];
        const { description, status } = buildSkillCatalog({
          available: skills,
          budget: { contextWindow: 0, percent: 2, maxTokens },
        });
        expect(estimateTextTokens(description)).toBeLessThanOrEqual(maxTokens);
        expect(status.mode).toBe("names-only");
        expect(status.omittedNames).toEqual(skills.map((skill) => skill.name));
      }
    );

    it("keeps a previously published empty catalog within an extreme budget https://github.com/ItsDalk-Lane/Scribe/issues/40", () => {
      const { description } = buildEmptySkillCatalog({
        contextWindow: 0,
        percent: 2,
        maxTokens: 1,
      });
      expect(estimateTextTokens(description)).toBeLessThanOrEqual(1);
    });

    it("caps a single description at the render limit as a second safeguard beyond format validation", () => {
      const huge = entry("huge", "y".repeat(SKILL_CATALOG_DESCRIPTION_RENDER_MAX + 500));
      const { description } = buildSkillCatalog({
        available: [huge],
        budget: unlimitedBudget(),
      });
      const rendered = description.split("\n").find((line) => line.startsWith("- huge:")) ?? "";
      expect(rendered.length).toBeLessThanOrEqual(
        "- huge: ".length + SKILL_CATALOG_DESCRIPTION_RENDER_MAX
      );
      expect(rendered.endsWith("…")).toBe(true);
    });

    it("produces an empty-catalog discipline that forbids guessing names from earlier lists", () => {
      const { description, status } = buildEmptySkillCatalog();
      expect(status).toEqual({ mode: "full", includedNames: [], omittedNames: [] });
      expect(description).toContain("No skills are currently available");
      expect(description).toContain("never call names remembered from earlier lists");
      expect(description).not.toContain("Available skills:");
    });
  });

  describe("renderCatalogDescription()", () => {
    it("returns short descriptions unchanged and truncates long ones with an ellipsis", () => {
      expect(renderCatalogDescription("short")).toBe("short");
      const long = renderCatalogDescription("z".repeat(2000));
      expect(long.length).toBe(SKILL_CATALOG_DESCRIPTION_RENDER_MAX);
      expect(long.endsWith("…")).toBe(true);
    });
  });

  describe("deliverSkillText()", () => {
    it("returns short text untouched and truncates oversized text with a clear marker", () => {
      expect(deliverSkillText("small")).toEqual({ text: "small", truncated: false });
      const oversized = deliverSkillText("a".repeat(20001));
      expect(oversized.truncated).toBe(true);
      expect(oversized.text.endsWith("[Output truncated]")).toBe(true);
      expect(oversized.text.length).toBeLessThanOrEqual(20001 + "\n\n[Output truncated]".length);
    });
  });
});
