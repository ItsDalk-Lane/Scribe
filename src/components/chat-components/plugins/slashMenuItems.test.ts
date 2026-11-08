import type { Skill } from "@/agentMode";
import type { SubagentDefinition } from "@/agentMode/subagents/SubagentManager";
import { $createParagraphNode, $createTextNode, $getRoot, createEditor } from "lexical";
import {
  $slashStartsPrompt,
  composeSlashMenuItems,
  filterSlashMenuOptions,
  slashMenuItemGroup,
  slashMenuItemSourceLabel,
} from "./slashMenuItems";

const SUBAGENT_ISSUE_URL = "https://github.com/ItsDalk-Lane/Scribe/issues/54";

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

function makeSubagent(overrides: Partial<SubagentDefinition> & { id: string }): SubagentDefinition {
  return {
    name: overrides.id,
    description: `desc for ${overrides.id}`,
    instructions: `instructions for ${overrides.id}`,
    enabled: true,
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

    it("lists enabled Agent commands as insertable items carrying their content and hides disabled ones", () => {
      const agentCommands = [
        {
          id: "translate",
          name: "翻译",
          description: "译成英文",
          content: "请翻译",
          enabled: true,
        },
        { id: "draft", name: "草稿", description: "", content: "写草稿", enabled: false },
      ];
      expect(composeSlashMenuItems([], "native", false, { agentCommands })).toEqual([
        expect.objectContaining({
          kind: "agentCommand",
          name: "翻译",
          description: "译成英文",
          body: "请翻译",
        }),
      ]);
    });

    it("hides the built-in compact command once it is turned off, even when the slash starts the prompt", () => {
      expect(
        composeSlashMenuItems([], null, true, { disabledBuiltinCommands: ["compact"] })
      ).toEqual([]);
      expect(composeSlashMenuItems([], null, true).map((item) => item.name)).toEqual(["compact"]);
    });

    it(`lists enabled subagents after commands and skills, keyed by definition id and carrying instructions ${SUBAGENT_ISSUE_URL}`, () => {
      const items = composeSlashMenuItems(
        [makeSkill({ name: "summarize", enabledAgents: ["native"] })],
        "native",
        true,
        {
          agentCommands: [
            { id: "c1", name: "翻译", description: "", content: "请翻译", enabled: true },
          ],
          subagents: [makeSubagent({ id: "research", name: "研究助理" })],
        }
      );
      expect(items.map((item) => [item.kind, item.name])).toEqual([
        ["builtin", "compact"],
        ["agentCommand", "翻译"],
        ["skill", "summarize"],
        ["subagent", "研究助理"],
      ]);
      const subagent = items[3];
      expect(subagent.key).toMatch(/^subagent:research:/);
      expect(subagent).toMatchObject({
        description: "desc for research",
        body: "instructions for research",
      });
    });

    it(`hides disabled subagents ${SUBAGENT_ISSUE_URL}`, () => {
      const items = composeSlashMenuItems([], "native", true, {
        subagents: [makeSubagent({ id: "off", enabled: false }), makeSubagent({ id: "on" })],
      });
      const ids = items
        .filter((item) => item.kind === "subagent")
        .map((item) => (item.kind === "subagent" ? item.subagent.id : ""));
      expect(ids).toEqual(["on"]);
    });

    it(`omits the whole subagent group outside agent mode or without an active backend ${SUBAGENT_ISSUE_URL}`, () => {
      const subagents = [makeSubagent({ id: "research" })];
      expect(composeSlashMenuItems([], "native", false, { subagents })).toEqual([]);
      expect(composeSlashMenuItems([], null, true, { subagents })).toEqual(
        composeSlashMenuItems([], null, true)
      );
    });

    it(`keeps subagents listed when compact is turned off ${SUBAGENT_ISSUE_URL}`, () => {
      const items = composeSlashMenuItems([], "native", true, {
        disabledBuiltinCommands: ["compact"],
        subagents: [makeSubagent({ id: "research" })],
      });
      expect(items.map((item) => item.kind)).toEqual(["subagent"]);
    });

    it(`shadows a subagent whose command token collides with compact and drops later duplicate tokens ${SUBAGENT_ISSUE_URL}`, () => {
      const items = composeSlashMenuItems([], "native", true, {
        subagents: [
          makeSubagent({ id: "c1", name: "compact" }),
          makeSubagent({ id: "dup-a", name: "research" }),
          makeSubagent({ id: "dup-b", name: "research" }),
          makeSubagent({ id: "fallback", name: "research helper" }),
        ],
      });
      const ids = items
        .filter((item) => item.kind === "subagent")
        .map((item) => (item.kind === "subagent" ? item.subagent.id : ""));
      expect(ids).toEqual(["dup-a", "fallback"]);
    });
  });

  describe("slashMenuItemGroup", () => {
    it(`maps builtin and agent commands to Commands, skills to Skills, subagents to Subagents ${SUBAGENT_ISSUE_URL}`, () => {
      const items = composeSlashMenuItems(
        [makeSkill({ name: "summarize", enabledAgents: ["native"] })],
        "native",
        true,
        {
          agentCommands: [
            { id: "c1", name: "翻译", description: "", content: "请翻译", enabled: true },
          ],
          subagents: [makeSubagent({ id: "research" })],
        }
      );
      expect(items.map(slashMenuItemGroup)).toEqual([
        "Commands",
        "Commands",
        "Skills",
        "Subagents",
      ]);
    });
  });

  describe("slashMenuItemSourceLabel", () => {
    it(`labels compact and built-in-source skills as Built-in, everything else as Custom ${SUBAGENT_ISSUE_URL}`, () => {
      const items = composeSlashMenuItems(
        [
          makeSkill({
            name: "builtin-skill",
            enabledAgents: ["native"],
            source: { kind: "builtin" },
          }),
          makeSkill({ name: "local-skill", enabledAgents: ["native"], source: { kind: "local" } }),
          makeSkill({ name: "agent-skill", enabledAgents: ["native"], source: { kind: "agent" } }),
          makeSkill({ name: "sourceless-skill", enabledAgents: ["native"] }),
        ],
        "native",
        true,
        {
          agentCommands: [
            { id: "c1", name: "翻译", description: "", content: "请翻译", enabled: true },
          ],
          subagents: [makeSubagent({ id: "research" })],
        }
      );
      expect(items.map(slashMenuItemSourceLabel)).toEqual([
        "Built-in",
        "Custom",
        "Built-in",
        "Custom",
        "Custom",
        "Custom",
        "Custom",
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

    it(`filters each group independently and preserves the command/skill/subagent group order ${SUBAGENT_ISSUE_URL}`, () => {
      const options = [
        { title: "compact", content: "", group: "Commands" },
        { title: "translate", content: "", group: "Commands" },
        { title: "compactor", content: "", group: "Skills" },
        { title: "compact-notes", content: "", group: "Skills" },
        { title: "compact-checker", content: "", group: "Subagents" },
      ];
      expect(filterSlashMenuOptions(options, "compact").map((o) => [o.title, o.group])).toEqual([
        ["compact", "Commands"],
        ["compactor", "Skills"],
        ["compact-notes", "Skills"],
        ["compact-checker", "Subagents"],
      ]);
    });

    it(`drops groups whose options all miss the query so their headers disappear ${SUBAGENT_ISSUE_URL}`, () => {
      const options = [
        { title: "compact", content: "", group: "Commands" },
        { title: "research", content: "", group: "Subagents" },
      ];
      expect(filterSlashMenuOptions(options, "res")).toEqual([
        { title: "research", content: "", group: "Subagents" },
      ]);
    });

    it(`falls back to content matching within each group ${SUBAGENT_ISSUE_URL}`, () => {
      const options = [
        { title: "polish", content: "make the prose tighter", group: "Commands" },
        { title: "other", content: "unrelated", group: "Skills" },
      ];
      expect(filterSlashMenuOptions(options, "prose").map((o) => o.title)).toEqual(["polish"]);
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
