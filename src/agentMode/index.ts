import { type App, Platform, TFile } from "obsidian";
import type ScribePlugin from "@/main";
import { logError } from "@/logger";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { isAgentBackendEnabled } from "@/settings/agentEnablement";
import { deriveSkillsFolder } from "@/settings/scribeFolder";
import { scribeAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { backendRegistry, listBackendDescriptors } from "./backends/registry";
import type { BackendId } from "./session/types";
import { AgentChatPersistenceManager } from "./session/AgentChatPersistenceManager";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { AgentSessionIndex } from "./session/AgentSessionIndex";
import { createNodeFileStorage, createNodeSnapshotStorage } from "./session/nodeFileStorage";
import { AgentSessionSnapshots } from "./session/AgentSessionSnapshots";
import { AgentSessionManager } from "./session/AgentSessionManager";
import { SkillManager } from "./skills";
import {
  createDefaultAskUserQuestionPrompter,
  createDefaultPermissionPrompter,
} from "./ui/permissionPrompter";

export { backendDisplayOrder, listBackendDescriptors } from "./backends/registry";
export type { AgentSessionManager } from "./session/AgentSessionManager";
export { frameSink as acpFrameSink, setFrameSinkVaultBasePath } from "./session/debugSink";
export type { BackendDescriptor, BackendId, ScribeMode, ModelSelection } from "./session/types";
export { getManagedSkills, SkillManager, SkillsSettings } from "./skills";
export type { Skill } from "./skills";
export { default as ScribeAgentView } from "./ui/ScribeAgentView";
export { PlanPreviewView } from "./ui/PlanPreviewView";
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
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  const skillManager = SkillManager.initialize(app, collectAgentSkillsDirsProjectRel());
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
  const persistenceManager = new AgentChatPersistenceManager(app);
  const vaultId = getVaultId(app);
  const indexPath = path.join(
    scribeAppDataDir(os.homedir()),
    "vaults",
    vaultId,
    "agent-chat-index.json"
  );
  const sessionIndex = new AgentSessionIndex(createNodeFileStorage(), indexPath);
  const sessionSnapshots = new AgentSessionSnapshots(
    createNodeSnapshotStorage(),
    path.join(path.dirname(indexPath), "agent-chat-snapshots"),
    (notePath) => {
      const file = app.vault.getAbstractFileByPath(notePath);
      return file instanceof TFile ? file : null;
    }
  );
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
    persistenceManager,
    sessionSnapshots,
    sessionIndex,
  });
  managerRef = manager;
  const refreshManagedSkills = async (): Promise<void> => {
    await skillManager.refresh(true);
  };
  subscribeToSettingsChange((prev, next) => {
    const prevFolder = deriveSkillsFolder(prev);
    const nextFolder = deriveSkillsFolder(next);
    if (prevFolder !== nextFolder) {
      void refreshManagedSkills().catch((e) => logError("[Skills] Skill refresh failed", e));
    }
  });
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
  const initialSkillsReady = refreshManagedSkills().catch((error) => {
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
