import { t } from "@/lib/i18n";
import fuzzysort from "fuzzysort";
import { $getSelection, $isRangeSelection, $isRootNode, type LexicalNode } from "lexical";
import type { BackendId, Skill } from "@/agentMode";
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
      kind: "skill";
      key: string;
      name: string;
      description: string;
      body: string;
      skill: Skill;
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

export function composeSlashMenuItems(
  skills: readonly Skill[],
  activeBackend: BackendId | null,
  isAgentMode = false
): SlashMenuItem[] {
  const isBuiltinName = (name: string) => isAgentMode && name === COMPACT_COMMAND_NAME;

  const visibleSkills = skills.filter((skill) => {
    if (skill.userInvocable === false) return false;
    if (isBuiltinName(skill.name)) return false;
    if (activeBackend === null) return true;
    return skill.enabledAgents.includes(activeBackend);
  });

  return [
    ...(isAgentMode ? [COMPACT_ITEM] : []),
    ...visibleSkills.map<SlashMenuItem>((skill, index) => ({
      kind: "skill",
      key: `skill:${skill.name}:${index}`,
      name: skill.name,
      description: skill.description,
      body: skill.body,
      skill,
    })),
  ];
}

export function filterSlashMenuOptions<T extends { title: string; content?: string }>(
  options: T[],
  query: string
): T[] {
  if (!query) return options;
  const titleResults = fuzzysort.go(query, options, { key: "title", threshold: -10000 });
  if (titleResults.length > 0) return titleResults.map((result) => result.obj);
  return fuzzysort
    .go(query, options, { key: "content", threshold: -10000 })
    .map((result) => result.obj);
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
