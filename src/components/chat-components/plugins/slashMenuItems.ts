import { t } from "@/lib/i18n";
import fuzzysort from "fuzzysort";
import { $getSelection, $isRangeSelection, $isRootNode, type LexicalNode } from "lexical";
import type { AgentCommandDefinition, BackendId, Skill } from "@/agentMode";
import type { SubagentDefinition } from "@/agentMode/subagents/SubagentManager";
import { subagentCommandToken } from "@/commands/subagentCommand";
import { COMPACT_COMMAND_NAME } from "@/commands/compactCommand";

export type SlashMenuItem =
  | {
      kind: "builtin";
      key: string;
      name: string;
      description: string;
      body: string;
    }
  | {
      kind: "agentCommand";
      key: string;
      name: string;
      description: string;
      body: string;
    }
  | {
      kind: "skill";
      key: string;
      name: string;
      description: string;
      body: string;
      skill: Skill;
    }
  | {
      kind: "subagent";
      key: string;
      name: string;
      description: string;
      body: string;
      subagent: SubagentDefinition;
    };

const COMPACT_ITEM: SlashMenuItem = {
  kind: "builtin",
  key: `builtin:${COMPACT_COMMAND_NAME}`,
  name: COMPACT_COMMAND_NAME,
  get description() {
    return t("Summarize this chat to free up context");
  },
  body: "",
};

export interface SlashMenuOptions {
  agentCommands?: readonly AgentCommandDefinition[];
  disabledBuiltinCommands?: readonly string[];
  subagents?: readonly SubagentDefinition[];
}

const NO_AGENT_COMMANDS: readonly AgentCommandDefinition[] = Object.freeze([]);
const NO_DISABLED_COMMANDS: readonly string[] = Object.freeze([]);
const NO_SUBAGENTS: readonly SubagentDefinition[] = Object.freeze([]);

export function composeSlashMenuItems(
  skills: readonly Skill[],
  activeBackend: BackendId | null,
  isAgentMode = false,
  {
    agentCommands = NO_AGENT_COMMANDS,
    disabledBuiltinCommands = NO_DISABLED_COMMANDS,
    subagents = NO_SUBAGENTS,
  }: SlashMenuOptions = {}
): SlashMenuItem[] {
  const compactVisible = isAgentMode && !disabledBuiltinCommands.includes(COMPACT_COMMAND_NAME);
  const isBuiltinName = (name: string) => compactVisible && name === COMPACT_COMMAND_NAME;
  // 子代理委派只在斜杠位于消息开头时生效，且依赖代理后端运行时，因此门槛与 compact 对齐并额外要求已激活后端；禁用 compact 不应连带隐藏子代理。https://github.com/ItsDalk-Lane/Scribe/issues/54
  const subagentsVisible = isAgentMode && activeBackend !== null;

  const visibleSkills = skills.filter((skill) => {
    if (skill.userInvocable === false) return false;
    if (isBuiltinName(skill.name)) return false;
    if (activeBackend === null) return true;
    return skill.enabledAgents.includes(activeBackend);
  });

  const visibleSubagents = subagentsVisible
    ? subagents
        .filter((entry) => entry.enabled)
        .filter((entry) => !isBuiltinName(subagentCommandToken(entry)))
        .filter(
          (entry, index, all) =>
            all.findIndex(
              (other) => subagentCommandToken(other) === subagentCommandToken(entry)
            ) === index
        )
    : [];

  return [
    ...(compactVisible ? [COMPACT_ITEM] : []),
    ...agentCommands
      .filter((command) => command.enabled)
      .map<SlashMenuItem>((command) => ({
        kind: "agentCommand",
        key: `agent-command:${command.id}`,
        name: command.name,
        description: command.description,
        body: command.content,
      })),
    ...visibleSkills.map<SlashMenuItem>((skill, index) => ({
      kind: "skill",
      key: `skill:${skill.name}:${index}`,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      skill,
    })),
    ...visibleSubagents.map<SlashMenuItem>((entry, index) => ({
      kind: "subagent",
      key: `subagent:${entry.id}:${index}`,
      name: entry.name,
      description: entry.description,
      body: entry.instructions,
      subagent: entry,
    })),
  ];
}

export function slashMenuItemGroup(item: SlashMenuItem): string {
  switch (item.kind) {
    case "builtin":
    case "agentCommand":
      return t("Commands");
    case "skill":
      return t("Skills");
    case "subagent":
      return t("Subagents");
  }
}

// 技能来源统一二分为内置/自定义，与命令组、子代理组的标签体系保持一致。https://github.com/ItsDalk-Lane/Scribe/issues/54
export function slashMenuItemSourceLabel(item: SlashMenuItem): string {
  switch (item.kind) {
    case "builtin":
      return t("Built-in");
    case "agentCommand":
    case "subagent":
      return t("Custom");
    case "skill":
      return item.skill.source?.kind === "builtin" ? t("Built-in") : t("Custom");
  }
}

export function filterSlashMenuOptions<
  T extends { title: string; content?: string; group?: string },
>(options: T[], query: string): T[] {
  if (!query) return options;
  // 每个分组独立过滤再按固定组序拼接，避免跨组统一打分把命令/技能/子代理的组序打散。https://github.com/ItsDalk-Lane/Scribe/issues/54
  const segments: T[][] = [];
  for (const option of options) {
    const last = segments[segments.length - 1];
    if (last && last[0].group === option.group) last.push(option);
    else segments.push([option]);
  }
  const matched: T[] = [];
  for (const segment of segments) {
    const titleResults = fuzzysort.go(query, segment, { key: "title", threshold: -10000 });
    if (titleResults.length > 0) {
      matched.push(...titleResults.map((result) => result.obj));
      continue;
    }
    matched.push(
      ...fuzzysort
        .go(query, segment, { key: "content", threshold: -10000 })
        .map((result) => result.obj)
    );
  }
  return matched;
}

export function $slashStartsPrompt(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) return false;
  const anchorNode = selection.anchor.getNode();
  const text = anchorNode.getTextContent();
  const slashIndex = text.lastIndexOf("/", selection.anchor.offset);
  if (slashIndex === -1 || text.slice(0, slashIndex).trim()) return false;
  for (let node: LexicalNode | null = anchorNode; node && !$isRootNode(node); ) {
    if (node.getPreviousSiblings().some((sibling) => sibling.getTextContent().trim())) return false;
    node = node.getParent();
  }
  return true;
}
