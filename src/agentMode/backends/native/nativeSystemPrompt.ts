import { FileSystemAdapter, type App } from "obsidian";
import type { OpenSessionInput } from "@/agentMode/session/types";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  DeferredMcpToolRegistry,
  buildMcpToolCatalogBlock,
  resolveMcpLoadingState,
} from "@/agentMode/mcp/deferredMcpTools";
import { getMcpServerManager } from "@/agentMode/mcp/McpServerManager";
import { readAgentsFile } from "@/instructions/agentsFile";
import { getSettings } from "@/settings/model";
import { getCachedProjectRecordById } from "@/projects/state";
import { requireNodeModule } from "@/utils/desktopRuntime";

export async function buildNativeSystemPrompt(app: App, input: OpenSessionInput): Promise<string> {
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
  const mcpCatalog = deferredMcpCatalogBlock(app, input);
  return [
    buildAgentSystemPrompt("native", app),
    vaultInstructions && `<vault_instructions>\n${vaultInstructions}\n</vault_instructions>`,
    project?.systemPrompt &&
      `<project_instructions>\n${project.systemPrompt}\n</project_instructions>`,
    projectInstructions &&
      `<working_directory_instructions>\n${projectInstructions}\n</working_directory_instructions>`,
    mcpCatalog,
  ]
    .filter(Boolean)
    .join("\n\n");
}

// 目录与工具注册共用同一延迟判定；技能撰写会话本就不开放 MCP 工具，跳过目录避免误导模型。https://github.com/ItsDalk-Lane/Scribe/issues/65
function deferredMcpCatalogBlock(app: App, input: OpenSessionInput): string | null {
  if (input.purpose === "skill-authoring") return null;
  const manager = getMcpServerManager(app);
  if (!manager) return null;
  if (resolveMcpLoadingState(manager, getSettings().agentMode) === "full") return null;
  return buildMcpToolCatalogBlock(DeferredMcpToolRegistry.fromManager(manager));
}
