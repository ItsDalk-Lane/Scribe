import { type App, Platform, TFile } from "obsidian";
import type CopilotPlugin from "@/main";
import { logError } from "@/logger";
import { getSettings, subscribeToSettingsChange, type CopilotSettings } from "@/settings/model";
import { isAgentBackendEnabled } from "@/settings/agentEnablement";
import { deriveSkillsFolder } from "@/settings/copilotFolder";
import { copilotAppDataDir, getVaultId } from "@/utils/appPaths";
import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { backendRegistry, listBackendDescriptors } from "./backends/registry";
import type { BackendId } from "./session/types";
import { AgentChatPersistenceManager } from "./session/AgentChatPersistenceManager";
import { AgentModelPreloader } from "./session/AgentModelPreloader";
import { AgentSessionIndex } from "./session/AgentSessionIndex";
import { createNodeFileStorage, createNodeSnapshotStorage } from "./session/nodeFileStorage";
import { AgentSessionSnapshots } from "./session/AgentSessionSnapshots";
import { AgentSessionManager } from "./session/AgentSessionManager";
import {
  createCopilotMcpServer,
  SEND_FEEDBACK_TOOL_NAME,
} from "@/agentMode/session/copilotMcpServer";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";
import { createExcalidrawTools, EXCALIDRAW_TOOL_NAMES } from "@/excalidraw/excalidrawTools";
import { SkillManager } from "./skills";
import {
  availableBuiltinAgents,
  reconcileBuiltinSkills,
} from "./skills/builtin/reconcileBuiltinSkills";
import {
  saveBuiltinPreferences,
  type BuiltinPreferencesUpdate,
} from "@/settings/builtinSkillPreferences";
import { buildBuiltinSeedFs } from "./skills/builtin/buildBuiltinSeedFs";
import {
  createDefaultAskUserQuestionPrompter,
  createDefaultPermissionPrompter,
} from "./ui/permissionPrompter";

export { ModelEnableList } from "@/components/ui/ModelEnableList";
export type { ModelEnableGroup } from "@/components/ui/ModelEnableList";
export { backendDisplayOrder, listBackendDescriptors } from "./backends/registry";
export type { AgentSessionManager } from "./session/AgentSessionManager";
export { frameSink as acpFrameSink, setFrameSinkVaultBasePath } from "./session/debugSink";
export type { BackendDescriptor, BackendId, CopilotMode, ModelSelection } from "./session/types";
export { getManagedSkills, SkillManager, SkillsSettings } from "./skills";
export type { Skill } from "./skills";
export { default as CopilotAgentView } from "./ui/CopilotAgentView";
export { PlanPreviewView } from "./ui/PlanPreviewView";
export { closeAgentDetailModals } from "./ui/AgentDetailModal";
export { openReportIssueModal } from "./ui/ReportIssueModal";
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

function backendEnvOverridesKey(settings: CopilotSettings, backendId: BackendId): string {
  const backends = settings.agentMode?.backends as
    | Partial<Record<BackendId, { envOverrides?: Record<string, string> }>>
    | undefined;
  const env = backends?.[backendId]?.envOverrides ?? {};
  return JSON.stringify(Object.entries(env).sort(([a], [b]) => a.localeCompare(b)));
}

// The Excalidraw tools follow the Excalidraw plugin rather than a setting, so they appear only where drawings can be made.
// https://github.com/Brevilabs/obsidian-copilot-private/issues/787
export function isCopilotToolOn(toolName: string, settings: CopilotSettings, app: App): boolean {
  if (toolName === SEND_FEEDBACK_TOOL_NAME) {
    return settings.agentMode.offerFeedbackCards;
  }
  if (EXCALIDRAW_TOOL_NAMES.has(toolName)) {
    return getExcalidrawApi(app) !== null;
  }
  return true;
}

export function createAgentSessionManager(app: App, plugin: CopilotPlugin): AgentSessionManager {
  const os = requireNodeModule<typeof import("node:os")>("os");
  const path = requireNodeModule<typeof import("node:path")>("path");
  let lastAvailableSkillAgents: readonly string[] = [];
  let seededWithCli = false;
  const availableSkillAgents = (): readonly string[] => {
    const states = Object.fromEntries(
      listBackendDescriptors()
        .filter((descriptor) => descriptor.skillsProjectDir)
        .map((descriptor) => [descriptor.id, descriptor.getInstallState(getSettings())])
    );
    lastAvailableSkillAgents = availableBuiltinAgents(states, lastAvailableSkillAgents);
    return lastAvailableSkillAgents;
  };
  const saveSkillPreferences = (update: BuiltinPreferencesUpdate) =>
    saveBuiltinPreferences(update, (data) => plugin.saveData(data));
  const skillManager = SkillManager.initialize(app, collectAgentSkillsDirsProjectRel(), {
    availableAgents: availableSkillAgents,
    savePreferences: saveSkillPreferences,
    prepare: async (folder) => {
      await reconcileBuiltinSkills({
        folder,
        fs: buildBuiltinSeedFs(app),
        settings: getSettings(),
        availableAgents: availableSkillAgents(),
        registeredAgents: Object.keys(collectAgentSkillsDirsProjectRel()),
      });
    },
  });
  const initializing = new Map<BackendId, Promise<void>>();
  const beforeBackendStart = async (id: BackendId): Promise<void> => {
    await initializing.get(id);
    if (!isAgentBackendEnabled(getSettings(), id)) throw new Error("This agent is disabled.");
    // Obsidian 不会通知命令行开关的变化，因此每次启动代理前重新检查。https://github.com/Brevilabs/obsidian-copilot-private/issues/726
    if (isObsidianCliEnabled() !== seededWithCli) {
      await seedManagedBuiltins().catch((error) =>
        logError("[Skills] Refresh after an Obsidian CLI toggle change failed", error)
      );
    }
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
    copilotAppDataDir(os.homedir()),
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
    copilotMcpServer: createCopilotMcpServer(
      (toolName) => isCopilotToolOn(toolName, getSettings(), app),
      [...createExcalidrawTools(() => getExcalidrawApi(app))]
    ),
  });
  managerRef = manager;
  subscribeToSettingsChange((prev, next) => {
    for (const descriptor of listBackendDescriptors()) {
      if (
        backendEnvOverridesKey(prev, descriptor.id) === backendEnvOverridesKey(next, descriptor.id)
      ) {
        continue;
      }
      void manager
        .noteSpawnConfigChanged(descriptor.id, "env overrides changed")
        .catch((error) =>
          logError(`[AgentMode] restart after env overrides change failed: ${descriptor.id}`, error)
        );
    }
  });
  const seedManagedBuiltins = async (): Promise<void> => {
    seededWithCli = isObsidianCliEnabled();
    await skillManager.refresh(true);
  };
  subscribeToSettingsChange((prev, next) => {
    const prevFolder = deriveSkillsFolder(prev);
    const nextFolder = deriveSkillsFolder(next);
    if (
      prevFolder !== nextFolder ||
      prev.agentMode.skills.builtinPreferences !== next.agentMode.skills.builtinPreferences
    ) {
      void seedManagedBuiltins().catch((e) =>
        logError("[Skills] builtin skill re-seeding failed", e)
      );
    }
  });
  for (const descriptor of listBackendDescriptors()) {
    descriptor.subscribeInstallState(plugin, () => {
      // Startup reads the final installation; reacting to intermediate writes would duplicate
      // probes. https://github.com/Brevilabs/obsidian-copilot-private/issues/530
      if (initializing.has(descriptor.id)) return;
      // The first warm probe must see newly installed skills. https://github.com/logancyang/obsidian-copilot/issues/3022
      void seedManagedBuiltins()
        .then(() => manager.onInstallStateChanged(descriptor.id))
        .catch((error) =>
          logError(`[AgentMode] install-state refresh failed: ${descriptor.id}`, error)
        );
    });
  }
  const initialSkillsReady = seedManagedBuiltins().catch((error) => {
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

export { AgentBackendHeader } from "./backends/shared/ui/AgentBackendHeader";
export { AgentConfigurationCard } from "./backends/shared/ui/AgentConfigurationCard";

export { useBackendAuthState } from "./session/useBackendAuthState";

export { AgentExtensionsSettings } from "./ui/AgentExtensionsSettings";
