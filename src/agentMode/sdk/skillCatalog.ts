import { estimateTextTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  DEFAULT_SKILL_CATALOG_BUDGET_MAX_TOKENS,
  DEFAULT_SKILL_CATALOG_BUDGET_PERCENT,
} from "@/constants";

// 模型可见目录受预算约束并两级降级；正文与支撑文件共用统一投递上限。
// https://github.com/ItsDalk-Lane/Scribe/issues/40
// https://github.com/ItsDalk-Lane/Scribe/issues/41
export const SKILL_DELIVERY_MAX_CHARS = 20000;

// 渲染层单条描述上限是格式校验（1024）之外的第二次保险。
// https://github.com/ItsDalk-Lane/Scribe/issues/40
export const SKILL_CATALOG_DESCRIPTION_RENDER_MAX = 1024;

export type SkillCatalogMode = "full" | "pruned" | "names-only";

export interface SkillCatalogBuildStatus {
  mode: SkillCatalogMode;
  includedNames: string[];
  omittedNames: string[];
}

export interface SkillCatalogBudget {
  contextWindow: number;
  percent: number;
  maxTokens: number;
}

export interface SkillCatalogEntry {
  name: string;
  description: string;
  builtin: boolean;
}

export interface SkillCatalogInput {
  available: readonly SkillCatalogEntry[];
  budget: SkillCatalogBudget;
}

const USAGE_DISCIPLINE = [
  "This list only summarizes skills. Before following a skill, invoke it with its name to load its full instructions; never act on the summary alone or infer what a skill says.",
  "Use a skill when the user names it or when the task clearly matches its description; when several are mentioned, use all of them.",
  "When several skills apply, use the smallest set that covers the task, state in one sentence which skills you are using and why, and explain when you skip an obviously matching skill.",
  "Read and follow skill instructions yourself; never delegate their interpretation to a subagent. Subagents may execute the resulting task.",
  "Reuse the skill's bundled scripts and assets instead of rewriting them from memory. Read supporting files with the file argument only when needed; do not chase reference chains or load unrelated files.",
  "If a skill is unavailable, fails to load, or does not fit the task, tell the user briefly and continue with the next best approach; never invent skill content.",
  "This list replaces every earlier skill list: use only the names below and never call names remembered from earlier lists. When the list is empty, do not guess skill names.",
];

const CORE_USAGE_DISCIPLINE = [USAGE_DISCIPLINE[0], USAGE_DISCIPLINE[5], USAGE_DISCIPLINE[6]];

const TOOL_INTRODUCTION =
  "Read the instructions of a registered Scribe skill for the current project and user, read one of its supporting files, or list every registered skill by calling this tool with no arguments.";

const LIST_POINTER =
  "Call this tool with no arguments to list every registered skill, including ones omitted from this list to save space.";

export function catalogBudgetTokens(budget: SkillCatalogBudget): number {
  const percentShare =
    budget.contextWindow > 0
      ? Math.floor((budget.contextWindow * budget.percent) / 100)
      : Number.POSITIVE_INFINITY;
  const cap = Math.max(1, Math.floor(budget.maxTokens));
  return Math.max(1, Math.min(percentShare, cap));
}

export function resolveSkillCatalogBudget(input: {
  contextWindow?: number;
  percent?: number;
  maxTokens?: number;
}): SkillCatalogBudget {
  return {
    contextWindow: input.contextWindow ?? 0,
    percent:
      typeof input.percent === "number" && Number.isFinite(input.percent) && input.percent > 0
        ? input.percent
        : DEFAULT_SKILL_CATALOG_BUDGET_PERCENT,
    maxTokens:
      typeof input.maxTokens === "number" &&
      Number.isSafeInteger(input.maxTokens) &&
      input.maxTokens > 0
        ? input.maxTokens
        : DEFAULT_SKILL_CATALOG_BUDGET_MAX_TOKENS,
  };
}

function catalogVersion(available: readonly SkillCatalogEntry[]): string {
  let hash = 0x811c9dc5;
  const rows = available
    .map((skill) => `${skill.name}\u001f${skill.description}`)
    .sort()
    .join("\u001e");
  for (let index = 0; index < rows.length; index++) {
    hash ^= rows.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function renderCatalogDescription(
  description: string,
  max = SKILL_CATALOG_DESCRIPTION_RENDER_MAX
): string {
  return description.length > max ? `${description.slice(0, max - 1)}…` : description;
}

function catalogLine(skill: SkillCatalogEntry): string {
  return `- ${skill.name}: ${renderCatalogDescription(skill.description)}`;
}

function assembleDescription(
  available: readonly SkillCatalogEntry[],
  discipline: readonly string[],
  extra: readonly string[]
): string {
  const lines = [
    TOOL_INTRODUCTION,
    "",
    "Usage discipline:",
    ...discipline.map((rule) => `- ${rule}`),
  ];
  if (extra.length) lines.push(...extra);
  if (available.length) {
    lines.push("", "Available skills:", ...available.map(catalogLine), "", LIST_POINTER);
  }
  return lines.join("\n");
}

function namesOnlyDescription(
  available: readonly SkillCatalogEntry[],
  omittedDescriptions: number
): string {
  const lines = [
    TOOL_INTRODUCTION,
    "",
    "Usage discipline:",
    ...CORE_USAGE_DISCIPLINE.map((rule) => `- ${rule}`),
  ];
  if (omittedDescriptions > 0) {
    lines.push(
      `- The descriptions of ${omittedDescriptions} skill(s) were omitted from this list to save space; load a skill or list every skill to see its description.`
    );
  }
  lines.push("", "Skill names (descriptions omitted to save space):");
  lines.push(...available.map((skill) => `- ${skill.name}`));
  lines.push("", LIST_POINTER);
  return lines.join("\n");
}

function removalOrder(entries: readonly SkillCatalogEntry[]): SkillCatalogEntry[] {
  return [...entries].sort((left, right) => {
    const cost = catalogLine(right).length - catalogLine(left).length;
    if (cost !== 0) return cost;
    if (left.builtin !== right.builtin) return left.builtin ? 1 : -1;
    return right.name.localeCompare(left.name);
  });
}

function byName(entries: readonly SkillCatalogEntry[]): SkillCatalogEntry[] {
  return [...entries].sort((left, right) => left.name.localeCompare(right.name));
}

export function buildSkillCatalog(input: SkillCatalogInput): {
  description: string;
  status: SkillCatalogBuildStatus;
} {
  const budgetTokens = catalogBudgetTokens(input.budget);
  const version = `Catalog version: ${catalogVersion(input.available)}.`;

  const full = assembleDescription(input.available, USAGE_DISCIPLINE, [version]);
  if (estimateTextTokens(full) <= budgetTokens) {
    return {
      description: full,
      status: { mode: "full", includedNames: input.available.map((s) => s.name), omittedNames: [] },
    };
  }

  const removals = removalOrder(input.available);
  // 淘汰模式的核算必须包含淘汰说明行本身，否则最终目录仍会超出预算。
  // https://github.com/ItsDalk-Lane/Scribe/issues/40
  const prunedFits = (kept: readonly SkillCatalogEntry[]): boolean => {
    const omittedCount = input.available.length - kept.length;
    const note = `${LIST_POINTER} ${omittedCount} skill(s) were omitted from this list to save space.`;
    return (
      estimateTextTokens(assembleDescription(kept, USAGE_DISCIPLINE, [version, note])) <=
      budgetTokens
    );
  };
  let kept = [...input.available];
  for (const candidate of removals) {
    if (prunedFits(kept)) break;
    kept = kept.filter((skill) => skill !== candidate);
  }
  if (kept.length && prunedFits(kept)) {
    const omitted = input.available.filter((skill) => !kept.includes(skill));
    const note = `${LIST_POINTER} ${omitted.length} skill(s) were omitted from this list to save space.`;
    const description = assembleDescription(kept, USAGE_DISCIPLINE, [version, note]);
    return {
      description,
      status: {
        mode: "pruned",
        includedNames: kept.map((s) => s.name),
        omittedNames: omitted.map((s) => s.name),
      },
    };
  }

  let droppable = [...input.available].sort((left, right) => right.name.length - left.name.length);
  while (
    droppable.length &&
    estimateTextTokens(namesOnlyDescription(byName(droppable), input.available.length)) >
      budgetTokens
  ) {
    droppable = droppable.slice(1);
  }
  const names = byName(droppable);
  const description = namesOnlyDescription(names, input.available.length);
  return {
    description,
    status: {
      mode: "names-only",
      includedNames: names.map((s) => s.name),
      omittedNames: input.available.filter((skill) => !names.includes(skill)).map((s) => s.name),
    },
  };
}

export function buildEmptySkillCatalog(): { description: string; status: SkillCatalogBuildStatus } {
  const description = assembleDescription([], USAGE_DISCIPLINE.slice(5, 7), [
    "No skills are currently available for this session. Do not guess or call skill names from earlier lists; ask the user or wait for an updated list.",
  ]);
  return { description, status: { mode: "full", includedNames: [], omittedNames: [] } };
}

export function deliverSkillText(
  text: string,
  max = SKILL_DELIVERY_MAX_CHARS
): { text: string; truncated: boolean } {
  if (text.length <= max) return { text, truncated: false };
  return { text: `${text.slice(0, max)}\n\n[Output truncated]`, truncated: true };
}
