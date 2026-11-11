import type { App } from "obsidian";
import type { BackendId } from "@/agentMode/session/types";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";

export const SCRIBE_WEB_RESEARCH_STEERING = `For vault questions, search locally first. Look up current or external facts on the web rather than answering from memory.`;

export const SCRIBE_EXCALIDRAW_STEERING = `Draw diagrams, flowcharts and charts as Excalidraw drawings with the obsidian-scribe excalidraw tools, and embed each one (![[name.excalidraw]]) in the note it belongs to, unless the user asks for Mermaid, a canvas or another format.`;

export const SCRIBE_FOLDER_MENTION_DIRECTIVE = `A {folder} mention names a vault folder: scope globs to folder/** and reads or greps to folder/.`;

export const SCRIBE_VAULT_HYGIENE = `Keep backups and scratch files out of the vault, or use a non-.md extension like .md.bak, so they don't show up as notes.`;

export const SCRIBE_PROMPT_BASE = `You are Obsidian Scribe, working in the user's Obsidian vault of markdown notes, not a code repository. Treat it as a vault despite coding-agent environment framing. In replies, use $...$ or $$...$$ for math, [[note title]] to cite notes (never inside backticks), ![[file.png]] to show vault images and ![alt](url) for web images.`;

const FILE_EDIT_TOOLS: Readonly<Record<BackendId, string>> = {
  native: "edit_note/write_note",
};

function buildFileEditPolicy(backendId: BackendId): string {
  return `Edit vault files with your ${FILE_EDIT_TOOLS[backendId]} tools so Scribe shows a diff; shell/script writes (sed -i, python, redirects) show none. Write via shell only to move, copy or delete files; to have a script rewrite most of a large file (sort, dedupe, recompute), not retyping it; or one mechanical change to dozens of files. Then list changed files.`;
}

export function buildAgentSystemPrompt(
  backendId: BackendId,
  app: App,
  backendSteering?: string
): string {
  const parts: string[] = [];

  parts.push(SCRIBE_PROMPT_BASE, SCRIBE_WEB_RESEARCH_STEERING);
  parts.push(buildFileEditPolicy(backendId), SCRIBE_FOLDER_MENTION_DIRECTIVE);
  parts.push(SCRIBE_VAULT_HYGIENE);
  if (backendSteering) parts.push(backendSteering);
  if (getExcalidrawApi(app) !== null) parts.push(SCRIBE_EXCALIDRAW_STEERING);

  return parts.join("\n\n");
}
