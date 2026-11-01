import {
  COPILOT_SYSTEM_PROMPT_CREATED,
  COPILOT_SYSTEM_PROMPT_MODIFIED,
  COPILOT_SYSTEM_PROMPT_LAST_USED,
} from "@/system-prompts/constants";
import { UserSystemPrompt } from "@/system-prompts/type";
import { App, normalizePath, TFile } from "obsidian";
import { getEffectiveSystemPromptsFolder } from "@/settings/copilotFolder";
export function getSystemPromptsFolder(): string {
  return getEffectiveSystemPromptsFolder();
}

export function getPromptFilePath(title: string): string {
  return normalizePath(`${getSystemPromptsFolder()}/${title}.md`);
}

export function getPromptFilePathInFolder(title: string, folder?: string): string {
  const folderPath = folder ? normalizePath(folder) : getSystemPromptsFolder();
  return normalizePath(`${folderPath}/${title}.md`);
}

export async function ensurePromptFrontmatter(app: App, file: TFile, prompt: UserSystemPrompt) {
  const now = Date.now();

  const createdMs =
    Number.isFinite(prompt.createdMs) && prompt.createdMs > 0 ? prompt.createdMs : now;
  const modifiedMs =
    Number.isFinite(prompt.modifiedMs) && prompt.modifiedMs > 0 ? prompt.modifiedMs : now;
  const lastUsedMs =
    Number.isFinite(prompt.lastUsedMs) && prompt.lastUsedMs > 0 ? prompt.lastUsedMs : 0;

  await app.fileManager.processFrontMatter(file, (frontmatter: Record<string, unknown>) => {
    if (frontmatter[COPILOT_SYSTEM_PROMPT_CREATED] == null) {
      frontmatter[COPILOT_SYSTEM_PROMPT_CREATED] = createdMs;
    }
    if (frontmatter[COPILOT_SYSTEM_PROMPT_MODIFIED] == null) {
      frontmatter[COPILOT_SYSTEM_PROMPT_MODIFIED] = modifiedMs;
    }
    if (frontmatter[COPILOT_SYSTEM_PROMPT_LAST_USED] == null) {
      frontmatter[COPILOT_SYSTEM_PROMPT_LAST_USED] = lastUsedMs;
    }
  });
}
