import { buildCurrentProjectContext } from "@/context/manifestBuilder";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { reviewSkillDraft } from "@/agentMode/skills/ui/SkillDraftModal";
import { publishSkillCatalogStatus } from "@/agentMode/skills/modelCatalogState";
import { checkSkillDependencies } from "@/agentMode/skills/skillDependencyCheck";
import { recordSkillUsage } from "@/agentMode/skills/skillUsageStore";
import {
  SkillManager,
  getManagedSkills,
  computeSkillSetSignature,
} from "@/agentMode/skills/SkillManager";
import { SubagentManager, getSubagents } from "@/agentMode/subagents/SubagentManager";
import { getMcpServerManager } from "@/agentMode/mcp/McpServerManager";
import { createMcpTools, MCP_TOOL_NAME_PREFIX } from "@/agentMode/mcp/mcpTools";
import { DeferredMcpToolRegistry, resolveMcpLoadingState } from "@/agentMode/mcp/deferredMcpTools";
import { createToolSearchTool } from "@/agentMode/sdk/nativeToolSearch";
import { ScribeBrandIcon } from "@/components/ui/ScribeBrandIcon";
import { t } from "@/lib/i18n";
import { getDeepSeekSearchCredential } from "@/settings/webSearchProvider";
import { searchDeepSeek } from "@/agentMode/backends/native/deepSeekWebSearch";
import { searchWithMcp } from "@/agentMode/backends/native/mcpWebSearch";
import { searchWithSkill } from "@/agentMode/backends/native/skillWebSearch";
import { NativeBackendProcess } from "@/agentMode/sdk/NativeBackendProcess";
import { SubagentScheduler } from "@/agentMode/sdk/subagentLimits";
import { DEFAULT_SUBAGENT_LIMITS } from "@/constants";
import { resolveScopeCwd } from "@/agentMode/session/sessionScope";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import { NodeAttachmentStorage } from "@/agentMode/sdk/AttachmentStorage";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
import { createNativeAdvancedTools } from "@/agentMode/sdk/nativeAdvancedTools";
import { EXCALIDRAW_TOOL_NAMES } from "@/excalidraw/excalidrawTools";
import { getExcalidrawApi } from "@/excalidraw/excalidrawApi";
import type { App } from "obsidian";
import type { BackendDescriptor, InstallState } from "@/agentMode/session/types";
import {
  createNativeModel,
  getNativeDefaultModelId,
  getNativeEnabledModelEntries,
  getNativeModelEntries,
  getNativeModelReadiness,
} from "@/agentMode/backends/native/nativeModels";
import { buildNativeSystemPromptState } from "@/agentMode/backends/native/nativeSystemPrompt";
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
import { isRecord } from "@/utils/obsidianInternals";
import { buildObsidianCommandEnv } from "@/agentMode/backends/shared/obsidianCommandEnv";
import type { NativeToolContext } from "@/agentMode/sdk/NativeBackendProcess";

const READY: InstallState = Object.freeze({ kind: "ready", source: "managed" });
const SUBAGENT_SCHEDULERS = new WeakMap<App, SubagentScheduler>();

type McpExtensionServerStatus =
  | "connected"
  | "failed"
  | "needs-auth"
  | "pending"
  | "unconfirmed"
  | "disabled";

function toExtensionMcpStatus(
  status: "connected" | "connecting" | "error" | "disabled"
): McpExtensionServerStatus {
  if (status === "connecting") return "pending";
  if (status === "error") return "failed";
  return status;
}

function createMcpToolsBundle(app: App, context: NativeToolContext) {
  const manager = getMcpServerManager(app);
  if (!manager) return { tools: EMPTY_MCP_TOOLS, autoApprovedTools: EMPTY_MCP_AUTO_APPROVE };
  const settings = getSettings().agentMode;
  const reserved = settings.webSearch?.mcp;
  // 子代理角色显式点名 MCP 工具时保持全量注册；延迟检索无法表达点名资格。https://github.com/ItsDalk-Lane/Scribe/issues/65
  if ((context.allowedTools ?? []).some((name) => name.startsWith(MCP_TOOL_NAME_PREFIX)))
    return createMcpTools(manager, undefined, reserved);
  const registry = DeferredMcpToolRegistry.fromManager(manager, reserved);
  if (resolveMcpLoadingState(manager, settings, reserved) === "full")
    return createMcpTools(manager, undefined, reserved);
  const selections = context.mcpToolSelections;
  const bundle = createMcpTools(manager, { registry, selectedNames: selections.names() });
  return {
    ...bundle,
    tools: [
      ...bundle.tools,
      createToolSearchTool({
        catalog: registry,
        registerTool: (tool, autoApproved) => context.registerTool(tool, autoApproved),
        selections,
      }),
    ],
  };
}

const EMPTY_MCP_AUTO_APPROVE: ReadonlySet<string> = Object.freeze(new Set<string>());
const EMPTY_MCP_TOOLS = Object.freeze([]) as unknown as ReturnType<typeof createMcpTools>["tools"];

// 目录条目按调用资格标注状态：目录过滤与可改道错误共用同一判定。
// https://github.com/ItsDalk-Lane/Scribe/issues/41
function skillToolEntries(cwd: string) {
  return getNativeScopedSkills(cwd).map((skill) => ({
    name: skill.name,
    description: skill.description,
    body: skill.body,
    ...(skill.dirPath ? { dirPath: skill.dirPath } : {}),
    status: !skill.enabledAgents.includes("native")
      ? ("disabled" as const)
      : skill.disableModelInvocation
        ? ("manual-only" as const)
        : ("available" as const),
    ...(skill.source?.kind === "builtin" ? { builtin: true } : {}),
  }));
}

// Obsidian 插件版本经清单只读探测，避免依赖未公开类型。https://github.com/ItsDalk-Lane/Scribe/issues/46
function readPluginVersion(app: App, id: string): string | undefined {
  const plugins = (app as unknown as { plugins?: unknown }).plugins;
  const manifests = isRecord(plugins) ? plugins.manifests : undefined;
  const manifest = isRecord(manifests) ? manifests[id] : undefined;
  const version = isRecord(manifest) ? manifest.version : undefined;
  return typeof version === "string" ? version : undefined;
}

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
    const assertScope = (input: { cwd: string; projectId?: string }): void => {
      if (!input.projectId) return;
      const current = resolveScopeCwd(path.dirname(getScribeDataPath(app)), input.projectId);
      // 已撤销的项目位置不能通过旧子会话或迟到批准继续使用。https://github.com/ItsDalk-Lane/Scribe/issues/50
      if (path.resolve(current) !== path.resolve(input.cwd))
        throw new Error("项目工作位置已改变，请重新打开当前项目后再继续。");
    };
    const attachments = new NodeAttachmentStorage(path.join(getScribeDataPath(app), "attachments"));
    const getSubagentLimits = () => getSettings().agentMode.subagents ?? DEFAULT_SUBAGENT_LIMITS;
    let scheduler = SUBAGENT_SCHEDULERS.get(app);
    if (!scheduler) {
      scheduler = new SubagentScheduler(getSubagentLimits);
      SUBAGENT_SCHEDULERS.set(app, scheduler);
    }
    const admission = scheduler;
    return new NativeBackendProcess({
      assertScope,
      getSubagentLimits,
      acquireSubagentSlot: (signal?: AbortSignal) => admission.acquire(signal),
      reserveSubagentSlot: (signal?: AbortSignal) => admission.reserve(signal),
      getCapabilityRevision: (cwd) =>
        JSON.stringify([
          computeSkillSetSignature(getNativeScopedSkills(cwd), "native"),
          getExcalidrawApi(app) !== null,
          getSubagents().map(({ id, enabled, revision }) => [id, enabled, revision]),
          getMcpServerManager(app)?.signature() ?? "",
          getSettings().agentMode.webSearch,
          getSettings().agentMode.webSearchProviderId,
        ]),
      getSubagents,
      getManuallyInvokedSkill: (name, cwd) => {
        const skill = getNativeScopedSkills(cwd).find((entry) => entry.name === name);
        if (!skill) return null;
        if (!skill.enabledAgents.includes("native") || skill.userInvocable === false)
          throw new Error(t("This skill is disabled or does not permit manual use."));
        return skill;
      },
      getRestorableSkill: (name, cwd) => {
        const skill = getNativeScopedSkills(cwd).find((entry) => entry.name === name);
        return skill?.enabledAgents.includes("native") && skill.userInvocable !== false
          ? skill
          : null;
      },
      getModelInvocableSkill: (name, cwd) => {
        const skill = skillToolEntries(cwd).find((entry) => entry.name === name);
        return skill?.status === "available" ? skill : null;
      },
      // 依赖就绪解析只做只读检测并按依赖缓存，绝不触发安装。https://github.com/ItsDalk-Lane/Scribe/issues/46
      resolveSkillDependencies: async (name) => {
        const skill = SkillManager.hasInstance()
          ? getManagedSkills().find((entry) => entry.name === name)
          : undefined;
        if (!skill?.dependencies?.length) return [];
        const readings = await checkSkillDependencies(skill.dependencies, {
          pluginVersion: (id) => readPluginVersion(app, id),
        });
        return readings.map((reading) => ({ ...reading }));
      },
      // 两条投递路径分别计入台账来源：模型自动与用户手动。https://github.com/ItsDalk-Lane/Scribe/issues/48
      onManualSkillInvoked: (name) => recordSkillUsage(app, name, "user"),
      getModels: () => getNativeModelEntries(getSettings()),
      getDefaultModelId: () => getNativeDefaultModelId(getSettings()),
      createModel: (id) => createNativeModel(app, id),
      getRequestContext: (input) =>
        input.projectId && input.projectId !== GLOBAL_SCOPE
          ? buildCurrentProjectContext(app, input.projectId)
          : "",
      getSystemPrompt: async (input) => {
        assertScope(input);
        await SubagentManager.getInstance(app).refresh();
        return buildNativeSystemPromptState(app, input);
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
          skillCatalogLifecycle: context.skillCatalog,
          app,
          getWebSearchRoutes: () => {
            const { agentMode, providers } = getSettings();
            const providerId = agentMode.webSearchProviderId;
            const { preferred = "builtin", mcp, skill } = agentMode.webSearch ?? {};
            return {
              preferred,
              routes: {
                ...(providerId && {
                  builtin: async (_id, query, signal) => {
                    const credential = getDeepSeekSearchCredential(providers[providerId]);
                    return credential
                      ? searchDeepSeek(app, credential, query, signal, () =>
                          context.assertCanExecute?.("web_search")
                        )
                      : {
                          failure: t(
                            "Set up the selected official DeepSeek account under Models, or change the web search engine in Agent configuration."
                          ),
                        };
                  },
                }),
                ...(mcp && {
                  mcp: (id, query, signal) =>
                    searchWithMcp(getMcpServerManager(app), context, mcp, id, query, signal),
                }),
                ...(skill && {
                  skill: (id, query, signal) =>
                    searchWithSkill(
                      app,
                      context,
                      getNativeScopedSkills(context.cwd).find((entry) => entry.name === skill),
                      id,
                      query,
                      signal
                    ),
                }),
              },
            };
          },
          reviewSkillDraft: (draft, signal) => reviewSkillDraft(app, draft, signal),
          skills: () => skillToolEntries(context.cwd),
          readSkillFile: (name, relativePath) => {
            const skill = getNativeScopedSkills(context.cwd).find((entry) => entry.name === name);
            if (!skill)
              throw new Error(
                `The skill is not registered in this session: ${name}. Call invoke_skill with no arguments to list every registered skill.`
              );
            return SkillManager.getInstance().readSkillFile(skill, relativePath);
          },
          catalogBudget: {
            contextWindow: context.contextWindow,
            percent: getSettings().agentMode.skills.catalogBudgetPercent,
            maxTokens: getSettings().agentMode.skills.catalogBudgetMaxTokens,
          },
          onCatalogBuilt: (status) => publishSkillCatalogStatus(status),
          onSkillInvoked: (name) => recordSkillUsage(app, name, "model"),
        }).filter(
          (tool) => !EXCALIDRAW_TOOL_NAMES.has(tool.name) || getExcalidrawApi(app) !== null
        );
        const mcpBundle = createMcpToolsBundle(app, context);
        return {
          tools: [
            ...createNativeTools({ ...context, app, commandTasks }),
            ...advanced,
            ...mcpBundle.tools,
          ],
          autoApproveTools: mcpBundle.autoApprovedTools,
          stopTask: (taskId) => commandTasks.stop(taskId),
          shutdown: () => commandTasks.shutdown(),
        };
      },
      storage: new NodeNativeSessionStorage(directory, attachments),
      attachments,
      getMcpServerStatus: () => {
        const manager = getMcpServerManager(app);
        return manager
          ? manager.listServerStatuses().map((server) => ({
              name: server.name,
              status: toExtensionMcpStatus(server.status),
              toolCount: server.toolCount,
            }))
          : null;
      },
      getExtensionRuntime: (cwd) => {
        const snapshot = readNativeExtensionRuntime(cwd);
        const manager = getMcpServerManager(app);
        if (!manager) return snapshot;
        return {
          ...snapshot,
          mcpServers: manager.listServerStatuses().map((server) => ({
            name: server.name,
            status: toExtensionMcpStatus(server.status),
            toolCount: server.toolCount,
          })),
        };
      },
      getVaultConfigDir: () => app.vault.configDir,
      maxSteps: () => getSettings().agentMode.backends.native?.maxSteps,
    });
  },
};
