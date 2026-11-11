import type { SubagentDefinition } from "@/agentMode/subagents/SubagentManager";
import { parseSubagentCommand, subagentCommandToken } from "@/commands/subagentCommand";

const ISSUE_URL = "https://github.com/ItsDalk-Lane/Scribe/issues/54";

function makeDefinition(
  overrides: Partial<SubagentDefinition> & { id: string }
): SubagentDefinition {
  return {
    name: overrides.id,
    description: `desc for ${overrides.id}`,
    instructions: `instructions for ${overrides.id}`,
    enabled: true,
    ...overrides,
  };
}

describe("subagentCommand", () => {
  describe("subagentCommandToken()", () => {
    it(`returns the name when it is a single slash-command word (whitespace-free, no slash) ${ISSUE_URL}`, () => {
      expect(subagentCommandToken(makeDefinition({ id: "research", name: "research" }))).toBe(
        "research"
      );
      expect(subagentCommandToken(makeDefinition({ id: "research", name: "研究助理" }))).toBe(
        "研究助理"
      );
    });

    it(`falls back to the id when the name contains whitespace or a slash ${ISSUE_URL}`, () => {
      expect(
        subagentCommandToken(makeDefinition({ id: "research", name: "research helper" }))
      ).toBe("research");
      expect(
        subagentCommandToken(makeDefinition({ id: "research", name: "research/assistant" }))
      ).toBe("research");
    });
  });

  describe("parseSubagentCommand()", () => {
    it(`matches an enabled definition by its name token and returns the task text as prompt ${ISSUE_URL}`, () => {
      const definitions = [makeDefinition({ id: "research", name: "research" })];
      expect(parseSubagentCommand("/research collect sources about Obsidian", definitions)).toEqual(
        {
          definition: definitions[0],
          prompt: "collect sources about Obsidian",
        }
      );
    });

    it(`matches by the id token when the definition name contains whitespace, with the rest of the text as prompt ${ISSUE_URL}`, () => {
      const definitions = [makeDefinition({ id: "research", name: "research helper" })];
      expect(parseSubagentCommand("/research collect sources", definitions)).toEqual({
        definition: definitions[0],
        prompt: "collect sources",
      });
      expect(parseSubagentCommand("/research helper collect sources", definitions)).toEqual({
        definition: definitions[0],
        prompt: "helper collect sources",
      });
    });

    it("keeps multi-line task text intact as the prompt", () => {
      const definitions = [makeDefinition({ id: "research", name: "research" })];
      expect(parseSubagentCommand("/research  first line\nsecond line ", definitions)).toEqual({
        definition: definitions[0],
        prompt: "first line\nsecond line",
      });
    });

    it(`ignores disabled definitions instead of matching them ${ISSUE_URL}`, () => {
      const definitions = [makeDefinition({ id: "research", name: "research", enabled: false })];
      expect(parseSubagentCommand("/research collect sources", definitions)).toBeUndefined();
    });

    it(`returns undefined for a bare command without task text so it falls back to a normal prompt ${ISSUE_URL}`, () => {
      const definitions = [makeDefinition({ id: "research", name: "research" })];
      expect(parseSubagentCommand("/research", definitions)).toBeUndefined();
      expect(parseSubagentCommand("  /research  ", definitions)).toBeUndefined();
    });

    it.each([
      "hello",
      "",
      "please /research do it",
      "/unknown-agent do it",
      "/research/extra do it",
    ])("returns undefined for %j", (text) => {
      const definitions = [makeDefinition({ id: "research", name: "research" })];
      expect(parseSubagentCommand(text, definitions)).toBeUndefined();
    });

    it(`prefers the first enabled definition when two definitions resolve to the same token ${ISSUE_URL}`, () => {
      const first = makeDefinition({ id: "alpha", name: "research" });
      const second = makeDefinition({ id: "beta", name: "research" });
      expect(parseSubagentCommand("/research do it", [first, second])?.definition).toBe(first);
    });
  });
});
