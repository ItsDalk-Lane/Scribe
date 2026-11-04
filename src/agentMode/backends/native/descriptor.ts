import { ScribeBrandIcon } from "@/components/ui/ScribeBrandIcon";
import { NativeBackendProcess } from "@/agentMode/sdk/NativeBackendProcess";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
import { createNativeAdvancedTools } from "@/agentMode/sdk/nativeAdvancedTools";
import { EXCALIDRAW_TOOL_NAMES } from "@/excalidraw/excalidrawTools";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import { NativeSettingsPanel } from "@/agentMode/backends/native/NativeSettingsPanel";
import {
  createNativeModel,
  getNativeDefaultModelId,
  getNativeEnabledModelEntries,
  getNativeModelEntries,
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
import { scribeAppDataDir, getVaultId } from "@/utils/appPaths";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { isChatModelInfo, providerDestination } from "@/modelManagement";
import { buildBuiltinSkillEnv } from "@/agentMode/backends/shared/builtinSkillEnv";

const READY: InstallState = Object.freeze({ kind: "ready", source: "managed" });
const NO_MODELS: InstallState = Object.freeze({
  kind: "error",
  message: "请在现有模型设置中配置并启用聊天模型。",
});

export const NativeBackendDescriptor: BackendDescriptor = {
  id: "native",
  displayName: "Scribe",
  Icon: ScribeBrandIcon,
  usesConfiguredModels: true,
  setupDescription: "使用已配置的聊天模型，在 Scribe 内执行笔记任务。",
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
  getInstallState: (settings) =>
    settings.configuredModels.some(
      (model) =>
        settings.providers[model.providerId]?.origin.kind === "byok" && isChatModelInfo(model.info)
    )
      ? READY
      : NO_MODELS,
  subscribeInstallState: (_plugin, listener) => subscribeToSettingsChange(() => listener()),
  openInstallUI: (plugin) =>
    openScribeSettings(
      plugin.app,
      plugin.app.workspace.getMostRecentLeaf()?.view.containerEl.ownerDocument.defaultView ??
        window,
      "quickActions"
    ),
  SettingsPanel: NativeSettingsPanel,
  dataDestination(settings) {
    const id = getNativeDefaultModelId(settings);
    const model = settings.configuredModels.find((candidate) => candidate.configuredModelId === id);
    const provider = model && settings.providers[model.providerId];
    return provider ? providerDestination(provider) : { kind: "cloud", label: "BYOK" };
  },
  async applySelection(session, selection) {
    if (session.getState()?.model?.current.baseModelId !== selection.baseModelId)
      await session.applyModelWireId(selection.baseModelId);
    await session.setConfigOption("effort", selection.effort ?? "default");
  },
  getModeMapping: () => ({
    kind: "setMode",
    canonical: { default: "default", plan: "plan", auto: "auto" },
  }),
  createBackendProcess({ plugin, app }) {
    if (!isAgentBackendEnabled(getSettings(), "native")) throw new Error("This agent is disabled.");
    const path = requireNodeModule<typeof import("node:path")>("path");
    const os = requireNodeModule<typeof import("node:os")>("os");
    const directory = path.join(scribeAppDataDir(os.homedir()), getVaultId(app), "native-agent");
    return new NativeBackendProcess({
      getModels: () => getNativeModelEntries(getSettings()),
      getDefaultModelId: () => getNativeDefaultModelId(getSettings()),
      createModel: (id) => createNativeModel(app, id),
      getSystemPrompt: (input) => buildNativeSystemPrompt(app, input),
      createTools(context) {
        const commandTasks = new NativeCommandTasks({
          cwd: context.cwd,
          sessionId: context.sessionId,
          emit: (update) => context.emit(update),
          getEnv: buildBuiltinSkillEnv,
          outputDirectory: path.join(directory, "tasks"),
        });
        const advanced = createNativeAdvancedTools({
          ...context,
          app,
          skills: () =>
            getNativeScopedSkills(context.cwd).filter(
              (skill) => skill.enabledAgents.includes("native") && !skill.disableModelInvocation
            ),
          offerFeedback: (draft) =>
            plugin.agentSessionManager
              ?.getSessionByBackendId(context.sessionId)
              ?.offerFeedback(draft) ?? "unattributed",
        }).filter(
          (tool) => !EXCALIDRAW_TOOL_NAMES.has(tool.name) || getExcalidrawApi(app) !== null
        );
        return {
          tools: [...createNativeTools({ ...context, app, commandTasks }), ...advanced],
          stopTask: (taskId) => commandTasks.stop(taskId),
          shutdown: () => commandTasks.shutdown(),
        };
      },
      storage: new NodeNativeSessionStorage(path.join(directory, "sessions")),
      getExtensionRuntime: readNativeExtensionRuntime,
      getVaultConfigDir: () => app.vault.configDir,
      maxSteps: () => getSettings().agentMode.backends.native?.maxSteps,
    });
  },
};
