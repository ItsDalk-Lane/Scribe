import { reviewSkillDraft } from "@/agentMode/skills/ui/SkillDraftModal";
import { SubagentManager, getSubagents } from "@/agentMode/subagents/SubagentManager";
import { ScribeBrandIcon } from "@/components/ui/ScribeBrandIcon";
import { t } from "@/lib/i18n";
import { NativeBackendProcess } from "@/agentMode/sdk/NativeBackendProcess";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import { NodeAttachmentStorage } from "@/agentMode/sdk/AttachmentStorage";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
import { createNativeAdvancedTools } from "@/agentMode/sdk/nativeAdvancedTools";
import { EXCALIDRAW_TOOL_NAMES } from "@/excalidraw/excalidrawTools";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import {
  createNativeModel,
  getNativeDefaultModelId,
  getNativeEnabledModelEntries,
  getNativeModelEntries,
  getNativeModelReadiness,
} from "@/agentMode/backends/native/nativeModels";
import { buildNativeSystemPrompt } from "@/agentMode/backends/native/nativeSystemPrompt";
import {
  createNativeExtensionManager,
  getNativeScopedSkills,
  NATIVE_SKILLS_PROJECT_DIR,
  readNativeExtensions,
  readNativeExtensionRuntime,
} from "@/agentMode/backends/native/nativeExtensions";
import { getSettings, subscribeToSettingsChange } from "@/settings/model";
import { isAgentBackendEnabled } from "@/settings/agentEnablement";
import { openScribeSettings } from "@/settings/openSettings";
import { getScribeDataPath } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { providerDestination } from "@/modelManagement";
import { buildObsidianCommandEnv } from "@/agentMode/backends/shared/obsidianCommandEnv";

const READY: InstallState = Object.freeze({ kind: "ready", source: "managed" });

// 无模型错误走 t()：英文界面不再显示中文提示。
// https://github.com/ItsDalk-Lane/Scribe/issues/28
function noModelsState(): InstallState {
  return {
    kind: "error",
    reason: "configuration",
    message: t("Configure a chat model in Models first."),
  };
}

export const NativeBackendDescriptor: BackendDescriptor = {
  id: "native",
  displayName: "Scribe",
  Icon: ScribeBrandIcon,
  usesConfiguredModels: true,
  // 存英文原文键，由渲染处 t() 本地化（https://github.com/ItsDalk-Lane/Scribe/issues/28）。
  setupDescription: "Runs note tasks inside Scribe using the chat models you configure.",
  skillsProjectDir: NATIVE_SKILLS_PROJECT_DIR,
  crossDiscoveredAgents: [],
  summarizesSessionTitle: false,
  midTurnDelivery: true,
  withdraw: true,
  stopTask: true,
  processPerChat: true,
  agentProductName: "Scribe",
  showModelDescriptions: true,
  planFeedbackDelivery: "permission",
  createExtensionManager: createNativeExtensionManager,
  readExtensions: async (input) => readNativeExtensions(input),
  checkExtensions: async ({ cwd, signal }) => {
    signal?.throwIfAborted();
    return readNativeExtensionRuntime(cwd);
  },
  wire: {
    encode: (selection) => selection.baseModelId,
    decode: (wireId) => ({ selection: { baseModelId: wireId, effort: null }, provider: null }),
    effortConfigFor(baseModelId) {
      const options = getNativeModelEntries(getSettings()).find(
        (model) => model.baseModelId === baseModelId
      )?.effortOptions;
      return options?.length
        ? {
            id: "effort",
            type: "select",
            name: "Reasoning effort",
            currentValue: "default",
            options: options.flatMap((option) =>
              option.value ? [{ value: option.value, name: option.label }] : []
            ),
          }
        : null;
    },
  },
  getEnabledModelEntries: getNativeEnabledModelEntries,
  getWireBaseId: (configuredModelId, settings) =>
    getNativeModelEntries(settings).some((model) => model.baseModelId === configuredModelId)
      ? configuredModelId
      : null,
  // 就绪条件沿用实际运行的模型启用清单。https://github.com/ItsDalk-Lane/Scribe/issues/21
  getInstallState: (settings) => {
    const readiness = getNativeModelReadiness(settings);
    if (readiness === "no_models") return noModelsState();
    if (readiness === "ready") return READY;
    return {
      kind: "error",
      reason: "configuration",
      message: t("No configured chat model has usable credentials on this device. Check Models."),
    };
  },
  subscribeInstallState: (plugin, listener) => {
    const settings = subscribeToSettingsChange((previous, current) => {
      // 偏好与历史开关变化不能被误当作安装改变，否则记住模型会重建正在使用的聊天。https://github.com/ItsDalk-Lane/Scribe/issues/31
      if (
        previous.providers !== current.providers ||
        previous.configuredModels !== current.configuredModels
      )
        listener();
    });
    const providers = plugin.modelManagement?.providerRegistry.subscribe(listener);
    return () => {
      settings();
      providers?.();
    };
  },
  openInstallUI: (plugin) => {
    openScribeSettings(
      plugin.app,
      plugin.app.workspace.getMostRecentLeaf()?.view.containerEl.ownerDocument.defaultView ??
        window,
      "quickActions"
    );
  },
  dataDestination(settings) {
    const id = getNativeDefaultModelId(settings);
    const model = settings.configuredModels.find((candidate) => candidate.configuredModelId === id);
    const provider = model && settings.providers[model.providerId];
    return provider ? providerDestination(provider) : { kind: "cloud", label: t("Model provider") };
  },
  async applySelection(session, selection) {
    if (session.getState()?.model?.current.baseModelId !== selection.baseModelId)
      await session.applyModelWireId(selection.baseModelId);
    await session.setConfigOption("effort", selection.effort ?? "default");
  },
  getModeMapping: () => ({
    kind: "setMode",
    canonical: { default: "default", plan: "plan", auto: "auto", full: "full" },
  }),
  createBackendProcess({ plugin, app }) {
    if (!isAgentBackendEnabled(getSettings(), "native")) throw new Error("This agent is disabled.");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const directory = path.join(getScribeDataPath(app), "chats", "v2");
    const attachments = new NodeAttachmentStorage(path.join(getScribeDataPath(app), "attachments"));
    return new NativeBackendProcess({
      getSubagents,
      getManuallyInvokedSkill: (name, cwd) => {
        const skill = getNativeScopedSkills(cwd).find((entry) => entry.name === name);
        if (!skill) return null;
        if (!skill.enabledAgents.includes("native") || skill.userInvocable === false)
          throw new Error(t("This skill is disabled or does not permit manual use."));
        return skill;
      },
      getModels: () => getNativeModelEntries(getSettings()),
      getDefaultModelId: () => getNativeDefaultModelId(getSettings()),
      createModel: (id) => createNativeModel(app, id),
      getSystemPrompt: async (input) => {
        await SubagentManager.getInstance(app).refresh();
        return buildNativeSystemPrompt(app, input);
      },
      createTools(context) {
        const commandTasks = new NativeCommandTasks({
          cwd: context.cwd,
          sessionId: context.sessionId,
          emit: (update) => context.emit(update),
          flush: () => context.flush?.() ?? Promise.resolve(),
          beforeStart: (task) => context.beforeTaskStart?.(task) ?? Promise.resolve(),
          getEnv: buildObsidianCommandEnv,
          outputDirectory: path.join(directory, "tasks"),
        });
        const advanced = createNativeAdvancedTools({
          ...context,
          app,
          reviewSkillDraft: (draft, signal) => reviewSkillDraft(app, draft, signal),
          skills: () =>
            getNativeScopedSkills(context.cwd).filter(
              (skill) => skill.enabledAgents.includes("native") && !skill.disableModelInvocation
            ),
        }).filter(
          (tool) => !EXCALIDRAW_TOOL_NAMES.has(tool.name) || getExcalidrawApi(app) !== null
        );
        return {
          tools: [...createNativeTools({ ...context, app, commandTasks }), ...advanced],
          stopTask: (taskId) => commandTasks.stop(taskId),
          shutdown: () => commandTasks.shutdown(),
        };
      },
      storage: new NodeNativeSessionStorage(directory, attachments),
      attachments,
      getExtensionRuntime: readNativeExtensionRuntime,
      getVaultConfigDir: () => app.vault.configDir,
      maxSteps: () => getSettings().agentMode.backends.native?.maxSteps,
    });
  },
};
