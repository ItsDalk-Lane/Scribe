import { FileSystemAdapter, type App } from "obsidian";
import type { OpenSessionInput } from "@/agentMode/session/types";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import { readAgentsFile } from "@/instructions/agentsFile";
import { getCachedProjectRecordById } from "@/projects/state";
import { getSettings, type ScribeSettings } from "@/settings/model";
import { getPromptFilePath } from "@/system-prompts/systemPromptUtils";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { stripFrontmatter } from "@/utils";

export async function buildNativeSystemPrompt(
  app: App,
  input: OpenSessionInput,
  settings: ScribeSettings = getSettings()
): Promise<string> {
  const path = requireNodeModule<typeof import("node:path")>("path");
  if (!(app.vault.adapter instanceof FileSystemAdapter))
    throw new Error("The native agent requires a desktop vault.");
  const vaultBase = app.vault.adapter.getBasePath();
  const relative = path.relative(vaultBase, input.cwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("The native agent working directory must belong to this vault.");
  const vaultInstructions = await readAgentsFile(app, "");
  const projectInstructions = relative
    ? await readAgentsFile(app, relative.replace(/\\/g, "/"))
    : "";
  const project = input.projectId
    ? getCachedProjectRecordById(input.projectId)?.project
    : undefined;
  let userPrompt = settings.userSystemPrompt;
  if (settings.defaultSystemPromptTitle) {
    const promptPath = getPromptFilePath(settings.defaultSystemPromptTitle);
    if (await app.vault.adapter.exists(promptPath))
      userPrompt = stripFrontmatter(await app.vault.adapter.read(promptPath));
  }
  return [
    buildAgentSystemPrompt("native", app),
    vaultInstructions && `<vault_instructions>\n${vaultInstructions}\n</vault_instructions>`,
    userPrompt && `<user_custom_instructions>\n${userPrompt}\n</user_custom_instructions>`,
    project?.systemPrompt &&
      `<project_instructions>\n${project.systemPrompt}\n</project_instructions>`,
    projectInstructions &&
      `<working_directory_instructions>\n${projectInstructions}\n</working_directory_instructions>`,
  ]
    .filter(Boolean)
    .join("\n\n");
}
