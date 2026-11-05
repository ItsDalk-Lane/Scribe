import type { Skill } from "@/agentMode";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import {
  $slashStartsPrompt,
  composeSlashMenuItems,
  filterSlashMenuOptions,
} from "./slashMenuItems";

function makeSkill(overrides: Partial<Skill> & { name: string }): Skill {
  const name = overrides.name;
  return {
    description: `desc for ${name}`,
    filePath: `/skills/${name}/SKILL.md`,
    dirPath: `/skills/${name}`,
    body: `body for ${name}`,
    enabledAgents: [],
    location: { kind: "canonical" },
    ...overrides,
  };
}

describe("slashMenuItems", () => {
  describe("composeSlashMenuItems", () => {
    it("filters skills by active backend when one is provided", () => {
      const skills = [
        makeSkill({ name: "summarize", enabledAgents: ["claude"] }),
        makeSkill({ name: "only-codex", enabledAgents: ["codex"] }),
        makeSkill({ name: "both", enabledAgents: ["claude", "codex"] }),
      ];
      const items = composeSlashMenuItems(skills, "claude");
      const names = items.map((i) => i.name);
      expect(names).toEqual(["summarize", "both"]);
      expect(items.every((i) => i.kind === "skill")).toBe(true);
    });

    it("hides skills with user-invocable: false even when backend matches", () => {
      const skills = [
        makeSkill({ name: "auto-only", enabledAgents: ["claude"], userInvocable: false }),
        makeSkill({ name: "summarize", enabledAgents: ["claude"], userInvocable: true }),
        makeSkill({ name: "default-invocable", enabledAgents: ["claude"] }),
      ];
      const items = composeSlashMenuItems(skills, "claude");
      expect(items.map((i) => i.name)).toEqual(["summarize", "default-invocable"]);
    });

    it("bypasses the backend filter when active backend is null (plain-LLM fallback)", () => {
      const skills = [
        makeSkill({ name: "summarize", enabledAgents: ["claude"] }),
        makeSkill({ name: "untoggled", enabledAgents: [] }),
        makeSkill({ name: "hidden", enabledAgents: [], userInvocable: false }),
      ];
      const items = composeSlashMenuItems(skills, null);
      expect(items.map((i) => i.name)).toEqual(["summarize", "untoggled"]);
    });

    it("offers only skills and the built-in compact item, so saved commands never reach the menu", () => {
      const skills = [makeSkill({ name: "summarize", enabledAgents: ["claude"] })];
      const kinds = new Set(composeSlashMenuItems(skills, "claude", true).map((i) => i.kind));
      expect([...kinds].sort()).toEqual(["builtin", "skill"]);
    });

    it("preserves caller-supplied skill order", () => {
      const skills = [
        makeSkill({ name: "b-skill", enabledAgents: ["claude"] }),
        makeSkill({ name: "a-skill", enabledAgents: ["claude"] }),
      ];
      expect(composeSlashMenuItems(skills, "claude").map((i) => i.name)).toEqual([
        "b-skill",
        "a-skill",
      ]);
    });

    it("lists the built-in compact item first in agent mode", () => {
      const skills = [makeSkill({ name: "summarize", enabledAgents: ["claude"] })];
      const items = composeSlashMenuItems(skills, "claude", true);
      expect(items.map((i) => [i.kind, i.name])).toEqual([
        ["builtin", "compact"],
        ["skill", "summarize"],
      ]);
    });

    it("lists compact in agent mode before the backend is known", () => {
      const items = composeSlashMenuItems([], null, true);
      expect(items.map((i) => i.name)).toEqual(["compact"]);
    });

    it("omits the built-in compact item outside agent mode", () => {
      const skills = [makeSkill({ name: "compact", enabledAgents: ["claude"] })];
      const items = composeSlashMenuItems(skills, null, false);
      expect(items.map((i) => [i.kind, i.name])).toEqual([["skill", "compact"]]);
    });

    it("shadows a skill named exactly compact with the built-in in agent mode, leaving other casings listed because /Compact still expands them", () => {
      const skills = [
        makeSkill({ name: "compact", enabledAgents: ["claude"] }),
        makeSkill({ name: "Compact", enabledAgents: ["claude"] }),
      ];
      const items = composeSlashMenuItems(skills, "claude", true);
      expect(items.map((i) => [i.kind, i.name])).toEqual([
        ["builtin", "compact"],
        ["skill", "Compact"],
      ]);
    });
  });

  describe("filterSlashMenuOptions", () => {
    const option = (title: string, content = "") => ({ title, content });

    it("returns every option for an empty query", () => {
      const options = [option("b"), option("a")];
      expect(filterSlashMenuOptions(options, "")).toBe(options);
    });

    it("matches option titles by fuzzy query", () => {
      const options = [option("summarize"), option("polish")];
      expect(filterSlashMenuOptions(options, "smz").map((o) => o.title)).toEqual(["summarize"]);
    });

    it("falls back to matching option content when no title matches", () => {
      const options = [option("polish", "make the prose tighter"), option("other", "unrelated")];
      expect(filterSlashMenuOptions(options, "prose").map((o) => o.title)).toEqual(["polish"]);
    });

    it("ranks the built-in compact first for the exact query compact", () => {
      const skills = [
        makeSkill({ name: "compactor", enabledAgents: ["claude"] }),
        makeSkill({ name: "compact-notes", enabledAgents: ["claude"] }),
      ];
      const options = composeSlashMenuItems(skills, "claude", true).map((item) => ({
        title: item.name,
        content: item.body,
        item,
      }));

      const ranked = filterSlashMenuOptions(options, "compact");

      expect(ranked[0].item.kind).toBe("builtin");
      expect(ranked.map((o) => o.title)).toEqual(["compact", "compactor", "compact-notes"]);
    });
  });

  describe("$slashStartsPrompt", () => {
    function slashStartsPromptFor(paragraphs: string[]): boolean {
      const editor = createEditor({
        namespace: "slash-starts-prompt-test",
        onError: (e) => {
          throw e;
        },
      });
      let result: boolean | undefined;
      editor.update(
        () => {
          const nodes = paragraphs.map((text) => $createTextNode(text));
          for (const node of nodes) $getRoot().append($createParagraphNode().append(node));
          const last = nodes[nodes.length - 1];
          last.select(last.getTextContentSize(), last.getTextContentSize());
          result = $slashStartsPrompt();
        },
        { discrete: true }
      );
      return result!;
    }

    it("is true when the slash begins an otherwise empty prompt", () => {
      expect(slashStartsPromptFor(["/co"])).toBe(true);
      expect(slashStartsPromptFor(["", "  /co"])).toBe(true);
    });

    it("is false when text precedes the slash in the same or an earlier paragraph", () => {
      expect(slashStartsPromptFor(["review this /co"])).toBe(false);
      expect(slashStartsPromptFor(["review this", "/co"])).toBe(false);
    });
  });
});
