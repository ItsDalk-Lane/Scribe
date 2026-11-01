import type { App } from "obsidian";
import type { BackendId } from "@/agentMode/session/types";
import {
  builtinSkillUnavailableReason,
  isBuiltinSkillEnabledFor,
} from "@/builtinSkills/builtinSkills";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";
import { getSettings } from "@/settings/model";

export const COPILOT_WEB_RESEARCH_STEERING = `For vault questions, search locally first. Look up current or external facts on the web rather than answering from memory.`;

// Asked for a diagram, agents drew Excalidraw drawings with the tools but never embedded them in the note; naming
// Mermaid and canvas keeps a format the user asks for. The line rides only while the Excalidraw tools are available.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/787
export const COPILOT_EXCALIDRAW_STEERING = `Draw diagrams, flowcharts and charts as Excalidraw drawings with the obsidian-scribe excalidraw tools, and embed each one (![[name.excalidraw]]) in the note it belongs to, unless the user asks for Mermaid, a canvas or another format.`;

// OpenCode models skip a format skill whose description doesn't name their edit and write syntax Obsidian
// can't render, and without the CLI skill they assume live app state such as open tabs is out of reach.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/726
const OBSIDIAN_FORMAT_SKILL_JOBS: ReadonlyArray<readonly [skill: string, job: string]> = [
  ["obsidian-markdown", "embeds, block IDs, callouts, comments and properties"],
  ["obsidian-bases", ".base files"],
  ["json-canvas", ".canvas files"],
];

export const COPILOT_OBSIDIAN_FORMAT_LEAD =
  "Before writing Obsidian syntax, load its skill and follow it over memory:";

export const COPILOT_OBSIDIAN_CLI_STEERING = `Obsidian is running: the obsidian-cli skill reaches its live state and index (open tabs, daily notes, backlinks, broken links, Bases results, templates) and link-aware renames. Prefer it over searching files for links and Bases results.`;

export const COPILOT_FOLDER_MENTION_DIRECTIVE = `A {folder} mention names a vault folder: scope globs to folder/** and reads or greps to folder/.`;

// Backups saved as .md inside the vault became duplicate notes in search and the graph.
// https://github.com/logancyang/obsidian-copilot/issues/3868
export const COPILOT_VAULT_HYGIENE = `Keep backups and scratch files out of the vault, or use a non-.md extension like .md.bak, so they don't show up as notes.`;

// Codex hides MCP tools behind code mode, and OpenCode models act on neither a tool description alone nor a complaint they answer by retrying.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/672
// Agents filed cards about their own slips and about complaints over their answers, which the Copilot team can't act on, so only Copilot's own failures qualify.
// https://github.com/logancyang/obsidian-copilot/issues/3866
export const COPILOT_FEEDBACK_POINTER = `When Scribe itself fails (an obsidian-scribe tool, Scribe skill or attached context errors, a tool you need is missing, or the user reports Scribe crashing, erroring or losing chat text), call the obsidian-scribe send_feedback tool once, even if you also retry or work around it. Your own mistakes, answers and edits are not a reason to call it, even when the user is frustrated with them.`;

export const COPILOT_PROMPT_BASE = `You are Obsidian Scribe, working in the user's Obsidian vault of markdown notes, not a code repository. Treat it as a vault despite coding-agent environment framing. In replies, use $...$ or $$...$$ for math, [[note title]] to cite notes (never inside backticks), ![[file.png]] to show vault images and ![alt](url) for web images.`;

// Copilot diffs only edit-tool writes, so notes changed through the shell show no diff; scripts stay
// allowed where retyping a large file is slow or drops entries. Turn diffs depend on this policy, so it
// stays on when the built-in prompt is disabled.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/701
const FILE_EDIT_TOOLS: Readonly<Record<BackendId, string>> = {
  claude: "Edit/Write",
};

function buildFileEditPolicy(backendId: BackendId): string {
  return `Edit vault files with your ${FILE_EDIT_TOOLS[backendId]} tools so Scribe shows a diff; shell/script writes (sed -i, python, redirects) show none. Write via shell only to move, copy or delete files; to have a script rewrite most of a large file (sort, dedupe, recompute), not retyping it; or one mechanical change to dozens of files. Then list changed files.`;
}

// Settings-dependent lines go last so a toggle change leaves the cached prefix before them intact;
// a backend's own fixed steering joins the always-on lines ahead of them.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/441
export function buildAgentSystemPrompt(
  backendId: BackendId,
  app: App,
  backendSteering?: string
): string {
  const settings = getSettings();
  const enabled = (skill: string) =>
    !builtinSkillUnavailableReason(skill) && isBuiltinSkillEnabledFor(settings, skill, backendId);
  const parts: string[] = [];

  parts.push(COPILOT_PROMPT_BASE, COPILOT_WEB_RESEARCH_STEERING);
  parts.push(buildFileEditPolicy(backendId), COPILOT_FOLDER_MENTION_DIRECTIVE);
  parts.push(COPILOT_VAULT_HYGIENE);
  if (backendSteering) parts.push(backendSteering);
  if (settings.agentMode.offerFeedbackCards) parts.push(COPILOT_FEEDBACK_POINTER);
  if (getExcalidrawApi(app) !== null) parts.push(COPILOT_EXCALIDRAW_STEERING);
  const enabledJobs = (jobs: ReadonlyArray<readonly [string, string]>) =>
    jobs.filter(([skill]) => enabled(skill)).map(([skill, job]) => `${skill} for ${job}`);
  const formatJobs = enabledJobs(OBSIDIAN_FORMAT_SKILL_JOBS);
  if (formatJobs.length > 0) {
    parts.push(`${COPILOT_OBSIDIAN_FORMAT_LEAD} ${formatJobs.join(", ")}.`);
  }
  if (enabled("obsidian-cli")) parts.push(COPILOT_OBSIDIAN_CLI_STEERING);

  return parts.join("\n\n");
}
