import { DEFAULT_SCRIBE_FOLDER } from "@/constants";
import { logWarn } from "@/logger";
import { ensureFolderExists } from "@/utils";
import { normalizePath, type Vault } from "obsidian";

export const SCRIBE_SUBFOLDER = Object.freeze({
  conversations: "chats",
  customPrompts: "scribe-custom-prompts",
  skills: "skills",
  projects: "projects",
} as const);

type FolderSettings = unknown;

function deriveSubfolder(_settings: FolderSettings, subfolder: string): string {
  return normalizePath(`${DEFAULT_SCRIBE_FOLDER}/${subfolder}`);
}

export function deriveConversationsFolder(settings?: FolderSettings): string {
  return deriveSubfolder(settings, SCRIBE_SUBFOLDER.conversations);
}

export function deriveCustomPromptsFolder(settings?: FolderSettings): string {
  return deriveSubfolder(settings, SCRIBE_SUBFOLDER.customPrompts);
}

export function deriveSkillsFolder(settings?: FolderSettings): string {
  return deriveSubfolder(settings, SCRIBE_SUBFOLDER.skills);
}

export function deriveProjectsFolder(settings?: FolderSettings): string {
  return deriveSubfolder(settings, SCRIBE_SUBFOLDER.projects);
}

export function getEffectiveScribeFolder(): string {
  return normalizePath(DEFAULT_SCRIBE_FOLDER);
}

export function getEffectiveConversationsFolder(): string {
  return deriveConversationsFolder();
}

export function getEffectiveCustomPromptsFolder(): string {
  return deriveCustomPromptsFolder();
}

export function getEffectiveSkillsFolder(): string {
  return deriveSkillsFolder();
}

export function getEffectiveProjectsFolder(): string {
  return deriveProjectsFolder();
}

export async function ensureScribeSubfolders(
  vault: Vault,
  settings?: FolderSettings
): Promise<void> {
  const derivers = [deriveCustomPromptsFolder, deriveSkillsFolder, deriveProjectsFolder];
  for (const derive of derivers) {
    const folder = derive(settings);
    try {
      await ensureFolderExists(vault, folder);
    } catch (error) {
      logWarn(`Could not pre-create Scribe sub-folder "${folder}".`, error);
    }
  }
}
