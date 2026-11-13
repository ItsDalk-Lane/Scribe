import { FileSystemAdapter, type App } from "obsidian";
import type { OpenSessionInput } from "@/agentMode/session/types";
import { buildAgentSystemPrompt } from "@/agentMode/backends/shared/agentSystemPrompt";
import {
  DeferredMcpToolRegistry,
  buildMcpToolCatalogBlock,
  resolveMcpLoadingState,
} from "@/agentMode/mcp/deferredMcpTools";
import { getMcpServerManager, type McpServerManager } from "@/agentMode/mcp/McpServerManager";
import {
  buildInstructionPromptState,
  renderInstructionPrompt,
  type InstructionPromptState,
} from "@/instructions/instructionPolicy";
import { getSettings } from "@/settings/model";
import { requireNodeModule } from "@/utils/desktopRuntime";

interface McpCatalogCacheEntry {
  revision: number;
  mode: string | undefined;
  threshold: number | undefined;
  reserved: string;
  block: string | null;
}

const mcpCatalogCache = new WeakMap<McpServerManager, McpCatalogCacheEntry>();

export async function buildNativeSystemPrompt(app: App, input: OpenSessionInput): Promise<string> {
  return renderInstructionPrompt(await buildNativeSystemPromptState(app, input));
}

export async function buildNativeSystemPromptState(
  app: App,
  input: OpenSessionInput
): Promise<InstructionPromptState> {
  const path = requireNodeModule<typeof import("node:path")>("path");
  if (!(app.vault.adapter instanceof FileSystemAdapter))
    throw new Error("The native agent requires a desktop vault.");
  const vaultBase = app.vault.adapter.getBasePath();
  const relative = path.relative(vaultBase, input.cwd);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new Error("The native agent working directory must belong to this vault.");
  const state = await buildInstructionPromptState(app, buildAgentSystemPrompt("native", app), {
    projectId: input.projectId,
    workspacePath: relative.replace(/\\/g, "/"),
  });
  return {
    content: state.content,
    sections: { ...state.sections, mcp_catalog: deferredMcpCatalogBlock(app, input) },
  };
}

// 目录与工具注册共用同一延迟判定；技能撰写会话本就不开放 MCP 工具，跳过目录避免误导模型。https://github.com/ItsDalk-Lane/Scribe/issues/65
function deferredMcpCatalogBlock(app: App, input: OpenSessionInput): string | null {
  if (input.purpose === "skill-authoring") return null;
  const manager = getMcpServerManager(app);
  if (!manager) return null;
  const settings = getSettings().agentMode;
  const revision = manager.getRevision();
  const reserved = JSON.stringify(settings.webSearch?.mcp ?? null);
  const cached = mcpCatalogCache.get(manager);
  // 能力或加载设置变化立即失效；连续变化只在下一请求渲染最终目录，避免每步重复扫描。https://github.com/ItsDalk-Lane/Scribe/issues/65
  if (
    cached?.revision === revision &&
    cached.mode === settings.mcpToolLoading &&
    cached.threshold === settings.mcpToolLoadingThresholdChars &&
    cached.reserved === reserved
  )
    return cached.block;
  const block =
    resolveMcpLoadingState(manager, settings, settings.webSearch?.mcp) === "full"
      ? null
      : buildMcpToolCatalogBlock(
          DeferredMcpToolRegistry.fromManager(manager, settings.webSearch?.mcp)
        );
  mcpCatalogCache.set(manager, {
    revision,
    mode: settings.mcpToolLoading,
    threshold: settings.mcpToolLoadingThresholdChars,
    reserved,
    block,
  });
  return block;
}
