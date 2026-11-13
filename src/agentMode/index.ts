import { AgentCommandManager } from "@/agentMode/agentCommands/AgentCommandManager";
import { SubagentManager } from "@/agentMode/subagents/SubagentManager";
import { initializeSkillUsageStore } from "@/agentMode/skills/skillUsageStore";
import { type App, Platform } from "obsidian";
import type ScribePlugin from "@/main";
import { logError } from "@/logger";
import { getSettings } from "@/settings/model";
import { isAgentBackendEnabled } from "@/settings/agentEnablement";
import { getScribeDataPath } from "@/utils/appPaths";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";
import { initializeMcpServerManager } from "./mcp/McpServerManager";
import { backendRegistry, listBackendDescriptors } from "./backends/registry";
import type { BackendId } from "./session/types";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { AgentSessionIndex } from "./session/AgentSessionIndex";
import { createNodeFileStorage } from "./session/nodeFileStorage";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { SkillManager } from "./skills";
import {
  createDefaultAskUserQuestionPrompter,
  createDefaultPermissionPrompter,
} from "./ui/permissionPrompter";

export { backendDisplayOrder, listBackendDescriptors } from "./backends/registry";
export type { AgentSessionManager } from "./session/AgentSessionManager";
export type { BackendDescriptor, BackendId, ScribeMode, ModelSelection } from "./session/types";
export { getManagedSkills, SkillManager, SKILL_CREATOR_SKILL_NAME, SkillsSettings } from "./skills";
export { flushSkillUsageStore } from "./skills/skillUsageStore";
export { getAgentCommands, subscribeAgentCommands } from "./agentCommands/AgentCommandManager";
export type { AgentCommandDefinition } from "./agentCommands/AgentCommandManager";
export type { Skill } from "./skills";
export { default as ScribeAgentView } from "./ui/ScribeAgentView";
export { PlanPreviewView } from "./ui/PlanPreviewView";
export {
  SubagentChatView,
  openSubagentChat,
  closeFloatingSubagentChat,
} from "./ui/SubagentChatView";
export { closeAgentDetailModals } from "./ui/AgentDetailModal";
export { closeRestoredTurnDiffs, registerTurnDiffCommands } from "./ui/TurnDiffView";
export { useBackendInstallState, useManagedInstallActionState } from "./ui/useBackendDescriptor";
function isAgentModeEnabled(): boolean {
  return !Platform.isMobile;
}

function collectAgentSkillsDirsProjectRel(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const descriptor of listBackendDescriptors()) {
    out[descriptor.id] = descriptor.skillsProjectDir;
  }
  return out;
}

export function createAgentSessionManager(app: App, plugin: ScribePlugin): AgentSessionManager {
  const path = requireNodeModule<typeof import("node:path")>("path");
  const skillManager = SkillManager.initialize(app, collectAgentSkillsDirsProjectRel());
  // 台账存储随技能管理器生命周期初始化。https://github.com/ItsDalk-Lane/Scribe/issues/48
  initializeSkillUsageStore(app);
  const subagentManager = SubagentManager.getInstance(app);
  plugin.register(() => SubagentManager.reset());
  const agentCommandManager = AgentCommandManager.getInstance(app);
  plugin.register(() => AgentCommandManager.reset());
  if (isDesktopRuntime()) initializeMcpServerManager(app, plugin);
  const initializing = new Map<BackendId, Promise<void>>();
  const beforeBackendStart = async (id: BackendId): Promise<void> => {
    await initializing.get(id);
    if (!isAgentBackendEnabled(getSettings(), id)) throw new Error("This agent is disabled.");
  };
  const preloader = new AgentModelPreloader(
    app,
    plugin,
    (id) => backendRegistry[id],
    beforeBackendStart
  );
  const indexPath = path.join(getScribeDataPath(app), "chats", "v2", "cache", "index.json");
  const sessionIndex = new AgentSessionIndex(createNodeFileStorage(), indexPath);
  let managerRef: AgentSessionManager | null = null;
  const prompter = createDefaultPermissionPrompter(
    (id) => managerRef?.getSessionByBackendId(id) ?? null
  );
  const askUserQuestionPrompter = createDefaultAskUserQuestionPrompter(
    (id) => managerRef?.getSessionByBackendId(id) ?? null
  );
  const manager = new AgentSessionManager(app, plugin, {
    permissionPrompter: prompter,
    askUserQuestionPrompter,
    resolveDescriptor: (id) => backendRegistry[id],
    modelPreloader: preloader,
    beforeBackendStart,
    sessionIndex,
  });
  managerRef = manager;
  const refreshManagedSkills = async (): Promise<void> => {
    await skillManager.refresh(true);
  };
  for (const descriptor of listBackendDescriptors()) {
    descriptor.subscribeInstallState(plugin, () => {
      if (initializing.has(descriptor.id)) return;
      void refreshManagedSkills()
        .then(() => manager.onInstallStateChanged(descriptor.id))
        .catch((error) =>
          logError(`[AgentMode] install-state refresh failed: ${descriptor.id}`, error)
        );
    });
  }
  const initialSkillsReady = Promise.all([
    refreshManagedSkills(),
    skillManager.syncBuiltins(),
    subagentManager.refresh(),
    agentCommandManager.refresh(),
  ])
    .then(() => undefined)
    .catch((error) => {
      logError("[Skills] Initial discovery pass failed", error);
    });
  for (const descriptor of listBackendDescriptors()) {
    const ready = Promise.resolve()
      .then(() => descriptor.onPluginLoad?.(plugin))
      .catch((e) => logError(`[AgentMode] backend ${descriptor.id} onPluginLoad failed`, e))
      .then(() => initialSkillsReady)
      .finally(() => initializing.delete(descriptor.id));
    initializing.set(descriptor.id, ready);
    if (isAgentModeEnabled() && isAgentBackendEnabled(getSettings(), descriptor.id)) {
      manager.registerPreload(
        descriptor.id,
        ready.then(() => {
          if (descriptor.getInstallState(getSettings()).kind === "ready") {
            return manager.preloadModels(descriptor.id);
          }
        })
      );
    }
  }

  return manager;
}

export { useBackendAuthState } from "./session/useBackendAuthState";

export { AgentExtensionsSettings } from "./ui/AgentExtensionsSettings";
export { WebSearchSourcesPanel } from "./ui/WebSearchSourcesPanel";
export { McpSettingsPanel } from "./ui/mcp/McpSettingsPanel";
