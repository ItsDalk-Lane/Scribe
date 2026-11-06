import { t } from "@/lib/i18n";
import { initializeInterfaceLanguage } from "@/services/interfaceLanguage";
import { releaseCursorAssociation } from "@/editor/releaseCursorAssociation";
import { registerNoteHeaderAction } from "@/editor/registerNoteHeaderAction";
import { SKILL_CREATOR_SKILL_NAME, type AgentSessionManager, type SkillManager } from "@/agentMode";
import { isNativeChatId, parseNativeChatId } from "@/utils/nativeChatId";
import {
  buildChatDeepLink,
  buildChatMarkdownLink,
  findChatFileByDeepLinkId,
  getSavedChatDeepLinkId,
} from "@/utils/chatDeepLink";
import { clearSelection, reportSelection, subscribeSelection } from "@/selection/selectionStore";
import { watchSelections, webSelectionReport } from "@/selection/selectionWatcher";
import { activeDrawingSelection } from "@/excalidraw/excalidrawApi";
import { registerCommands } from "@/commands";
import { ConfirmModal } from "@/components/modals/ConfirmModal";

import { registerContextMenu } from "@/commands/contextMenu";
import { CustomCommandRegister } from "@/commands/customCommandRegister";
import { ProjectRegister } from "@/projects/projectRegister";
import {
  AGENT_CHAT_MODE,
  CHAT_AGENT_VIEWTYPE,
  SCRIBE_AGENT_ICON_ID,
  SCRIBE_AGENT_ICON_SVG,
  DEFAULT_OPEN_AREA,
  DESKTOP_VIEW_TYPES,
  EVENT_NAMES,
  PLAN_PREVIEW_VIEW_TYPE,
  SHARED_VIEW_TYPES,
} from "@/constants";
import { logError, logFatalError, logInfo, logWarn } from "@/logger";
import { SecretStore } from "@/services/secretStore";
import { assertScribePath } from "@/utils/vaultFileStore";
import { logFileManager } from "@/logFileManager";
import { createModelManagement, type ModelManagementApi } from "@/modelManagement";
import {
  persistSettings,
  loadStoredSettings,
  suppressNextPersistOnce,
  flushPersistence,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import {
  getWebViewerService,
  startActiveWebTabTracking,
} from "@/services/webViewerService/webViewerServiceSingleton";
import { WebSelectionTracker } from "@/services/webViewerService/webViewerServiceSelection";
import { ScribeSettingTab } from "@/settings/SettingsPage";
import { getSettings, setSettings, subscribeToSettingsChange } from "@/settings/model";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { disposeNotificationSound } from "@/utils/notificationSound";
import { installRendererEventsShim } from "@/utils/rendererEventsShim";
import { ContextProcessor } from "@/contextProcessor";
import { CustomCommandManager } from "@/commands/customCommandManager";
import { VaultDataManager } from "@/state/vaultDataAtoms";
import {
  ChatSelectionHighlightController,
  hideChatSelectionHighlight,
  QuickAskController,
  SelectionHighlight,
} from "@/editor";
import {
  addIcon,
  MarkdownView,
  Menu,
  Notice,
  Plugin,
  TFile,
  View,
  ViewCreator,
  WorkspaceLeaf,
} from "obsidian";
import {
  formatStartupMigrationSummary,
  runStartupMigrationSummary,
  type StartupMigrationItem,
  type StartupMigrationTask,
} from "@/services/startupMigration";
import { extractChatLastAccessedAtMs, extractChatTitle } from "@/utils/chatHistoryUtils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { readFrontmatterViaAdapter, trashFile } from "@/utils/vaultAdapterUtils";
import { withTimeout } from "@/utils";
import { StartupLoadingView, type ScribeStartup } from "@/components/StartupLoadingView";

const PENDING_TEARDOWN = Symbol.for("obsidian-scribe:pending-teardown");
const PREVIOUS_TEARDOWN_TIMEOUT_MS = 10_000;

interface TeardownHandoff {
  [PENDING_TEARDOWN]?: Promise<void>;
}

export default class ScribePlugin extends Plugin implements ScribeStartup {
  userMessageHistory: string[] = [];
  customCommandRegister: CustomCommandRegister;
  projectRegister: ProjectRegister;
  settingsUnsubscriber?: () => void;
  agentSessionManager?: AgentSessionManager;
  skills?: SkillManager;
  private ScribeAgentView?: typeof import("@/agentMode").ScribeAgentView;
  private PlanPreviewView?: typeof import("@/agentMode").PlanPreviewView;
  modelManagement!: ModelManagementApi;
  private ribbonIconEl?: HTMLElement;
  quickAskController: QuickAskController;
  chatSelectionHighlightController: ChatSelectionHighlightController;
  private webSelectionTracker?: WebSelectionTracker;
  private readonly chatHistoryLastAccessedAtManager = new RecentUsageManager<string>();
  private startupMigrationItems: StartupMigrationItem[] = [];
  private pluginLifecycleActive = true;
  private initializedReady = false;
  private initialization: Promise<void> = Promise.resolve();
  private readonly startedViewCreators = new Map<string, ViewCreator>();

  public isPluginLifecycleActive(): boolean {
    return this.pluginLifecycleActive;
  }

  whenStarted(): Promise<void> {
    return this.initialization;
  }

  isStarted(): boolean {
    return this.pluginLifecycleActive && this.initializedReady;
  }

  createStartedView(viewType: string, leaf: WorkspaceLeaf): View | undefined {
    if (!this.pluginLifecycleActive) return undefined;
    return this.startedViewCreators.get(viewType)?.(leaf);
  }

  onload(): void {
    initializeInterfaceLanguage();
    installRendererEventsShim();
    this.initialization = this.initialize().catch((error) => {
      logFatalError("Scribe failed to start.", error);
      new Notice(
        t(
          "Scribe failed to start. Back up your files, then disable Scribe until file-safety issues are fixed. Check the developer console for details."
        )
      );
      this.unload();
    });
    const viewTypes = isDesktopRuntime() ? DESKTOP_VIEW_TYPES : SHARED_VIEW_TYPES;
    for (const viewType of viewTypes) {
      this.safeRegisterView(
        viewType,
        (leaf: WorkspaceLeaf) =>
          this.createStartedView(viewType, leaf) ?? new StartupLoadingView(leaf, viewType, this)
      );
    }
    this.addSettingTab(new ScribeSettingTab(this.app, this));
    this.registerObsidianProtocolHandler("scribe-chat", (params) => {
      void this.initialization.then(() => {
        if (this.pluginLifecycleActive) void this.openChatDeepLink(params);
      });
    });
  }

  private async initialize(): Promise<void> {
    await this.waitForPreviousTeardown();
    if (!this.pluginLifecycleActive) return;
    resetPersistenceState();
    SecretStore.resetInstance();
    await this.loadSettings();
    if (!this.pluginLifecycleActive) return;
    this.modelManagement = createModelManagement({
      app: this.app,
    });
    this.settingsUnsubscriber = subscribeToSettingsChange((prev, next) => {
      void (async () => {
        try {
          await persistSettings(next, (data) => this.saveData(data), prev);
        } catch (error) {
          logError("Failed to persist settings.", error);
          new Notice(
            t(
              "Scribe failed to save settings. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
            )
          );
        }
      })();
    });
    await assertScribePath(this.app.vault, ".scribe/chats");
    await SecretStore.getInstance(this.app, {
      onReset: async () => {
        const current = getSettings();
        const providers = Object.fromEntries(
          Object.entries(current.providers).map(([id, provider]) => [
            id,
            { ...provider, apiKeyRef: null },
          ])
        );
        const next = { ...current, providers };
        await persistSettings(next, (data) => super.saveData(data));
        suppressNextPersistOnce();
        setSettings(next);
      },
    }).initialize();
    const agentMode = isDesktopRuntime() ? await import("@/agentMode") : null;
    if (!this.pluginLifecycleActive) return;

    ContextProcessor.getInstance(this.app);
    CustomCommandManager.getInstance(this.app);
    logFileManager.setApp(this.app);

    if (agentMode) {
      const {
        ScribeAgentView,
        PlanPreviewView,
        closeAgentDetailModals,
        closeRestoredTurnDiffs,
        registerTurnDiffCommands,
        createAgentSessionManager,
        SkillManager,
      } = agentMode;
      this.ScribeAgentView = ScribeAgentView;
      this.PlanPreviewView = PlanPreviewView;
      closeRestoredTurnDiffs(this.app.workspace);
      this.register(() => closeAgentDetailModals(this.app));
      registerTurnDiffCommands(this);

      this.agentSessionManager = createAgentSessionManager(this.app, this);
      this.skills = SkillManager.getInstance();
    }

    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.initialize(this.app);

    this.quickAskController = new QuickAskController(this);
    this.registerEditorExtension(this.quickAskController.createExtension());
    this.registerEditorExtension(releaseCursorAssociation);

    this.chatSelectionHighlightController = new ChatSelectionHighlightController(this, {
      closeQuickAskOnChatFocus: false,
    });
    this.chatSelectionHighlightController.initialize();
    this.register(
      subscribeSelection((contexts) =>
        this.chatSelectionHighlightController.clearIfNoNoteContexts(contexts)
      )
    );

    if (isDesktopRuntime()) {
      const { activeLeafRef, layoutRef } = startActiveWebTabTracking(this.app, {
        preserveOnViewTypes: [CHAT_AGENT_VIEWTYPE],
      });
      this.registerEvent(activeLeafRef);
      this.registerEvent(layoutRef);
    }

    addIcon(SCRIBE_AGENT_ICON_ID, SCRIBE_AGENT_ICON_SVG);

    if (isDesktopRuntime()) registerNoteHeaderAction(this);

    if (this.ScribeAgentView && this.PlanPreviewView) {
      const AgentView = this.ScribeAgentView;
      const PreviewView = this.PlanPreviewView;
      this.startedViewCreators.set(CHAT_AGENT_VIEWTYPE, (leaf) => new AgentView(leaf, this));
      this.startedViewCreators.set(PLAN_PREVIEW_VIEW_TYPE, (leaf) => new PreviewView(leaf));
    }

    this.initActiveLeafChangeHandler();

    if (this.canUseAgentView()) {
      this.ribbonIconEl = this.addRibbonIcon(
        SCRIBE_AGENT_ICON_ID,
        t("Open Scribe Agent Chat"),
        () => {
          void this.activateAgentView();
        }
      );
    }

    registerCommands(this);

    this.registerEvent(
      this.app.workspace.on("editor-menu", (menu: Menu) => {
        registerContextMenu(menu, this.app);
      })
    );

    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        this.chatSelectionHighlightController.handleActiveLeafChange(leaf ?? null);
      })
    );

    this.customCommandRegister = new CustomCommandRegister(this, this.app);
    this.projectRegister = new ProjectRegister(this.app);

    this.app.workspace.onLayoutReady(() => {
      void this.runStartupMigrations().catch((error) => {
        logError("Failed to finish startup migrations", error);
        new Notice(
          t(
            "Scribe could not finish startup migration. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
          )
        );
      });
    });

    this.initSelectionHandler();

    this.initWebSelectionWatcher();
    this.initializedReady = true;
  }

  private async waitForPreviousTeardown(): Promise<void> {
    const handoff = window as TeardownHandoff;
    const previousTeardown = handoff[PENDING_TEARDOWN];
    if (!previousTeardown) return;
    try {
      await withTimeout(
        () => previousTeardown,
        PREVIOUS_TEARDOWN_TIMEOUT_MS,
        "Previous Scribe shutdown"
      );
    } catch (error) {
      logWarn("Scribe started before its previous copy finished shutting down.", error);
    }
    if (handoff[PENDING_TEARDOWN] === previousTeardown) delete handoff[PENDING_TEARDOWN];
  }

  private async runStartupMigrations(): Promise<void> {
    const task = (
      result: Promise<StartupMigrationItem | null>,
      failure: StartupMigrationItem,
      notice?: string
    ): StartupMigrationTask => {
      return {
        result,
        failure,
        onFailure: (error) => {
          logError(`${failure.title} startup migration failed`, error);
          if (notice) new Notice(notice);
        },
      };
    };

    const projectTask = task(
      this.projectRegister.initialize(),
      {
        id: "projects",
        title: t("Projects"),
        status: "error",
        summary: t(
          "Projects could not be loaded or migrated. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
        ),
      },
      t("Failed to load projects. Check available logs.")
    );
    const commandsTask = task(
      this.customCommandRegister.initialize().then(() => null),
      {
        id: "custom-commands",
        title: t("Custom commands"),
        status: "error",
        summary: t(
          "Custom commands could not be loaded or migrated. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
        ),
      }
    );
    const promptsTask = task(Promise.resolve(null), {
      id: "system-prompt",
      title: t("System prompt"),
      status: "error",
      summary: t(
        "System prompts could not be loaded or migrated. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
      ),
    });
    await runStartupMigrationSummary({
      initialItems: this.startupMigrationItems,
      tasks: [projectTask, commandsTask, promptsTask],
      present: (items) => {
        new ConfirmModal(
          this.app,
          () => {},
          formatStartupMigrationSummary(items),
          t("Scribe startup report"),
          t("Done"),
          ""
        ).open();
      },
      acknowledge: () => {
        this.startupMigrationItems = [];
      },
    });
  }

  private safeRegisterView(type: string, viewCreator: ViewCreator): void {
    try {
      this.registerView(type, viewCreator);
    } catch (error) {
      logWarn(`Scribe: view type "${type}" already registered; skipping re-registration.`, error);
    }
  }

  onunload(): void {
    this.pluginLifecycleActive = false;
    SecretStore.resetInstance();
    disposeNotificationSound();
    const handoff = window as TeardownHandoff;
    const teardown = this.teardown().catch((error) => {
      logError("Scribe: plugin teardown failed during unload:", error);
    });
    handoff[PENDING_TEARDOWN] = Promise.all([this.initialization, teardown]).then(() => undefined);
  }

  private async teardown(): Promise<void> {
    this.clearAllPersistentSelectionHighlights();

    this.chatSelectionHighlightController?.cleanup();

    await this.agentSessionManager?.shutdown();

    const vaultDataManager = VaultDataManager.getInstance();
    vaultDataManager.cleanup();

    this.customCommandRegister?.cleanup();
    this.projectRegister?.cleanup();
    this.settingsUnsubscriber?.();
    await flushPersistence();

    if (isDesktopRuntime()) {
      const { SkillManager } = await import("@/agentMode");
      if (SkillManager.hasInstance()) {
        SkillManager.getInstance().dispose();
      }
    }

    this.cleanupWebSelectionWatcher();
    clearSelection();

    try {
      const webViewerService = getWebViewerService(this.app);
      webViewerService.stopActiveWebTabTracking();
    } catch (error) {
      logWarn("Could not stop web tab tracking", error);
    }

    this.modelManagement?.dispose();

    await logFileManager.flush();
    logInfo("Scribe plugin unloaded");
  }

  private clearAllPersistentSelectionHighlights(): void {
    try {
      const leaves = this.app.workspace.getLeavesOfType("markdown");
      for (const leaf of leaves) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) continue;
        const cm = view.editor?.cm;
        if (cm) {
          SelectionHighlight.hide(cm);
          hideChatSelectionHighlight(cm);
        }
      }
    } catch (error) {
      logWarn("Failed to clear persistent selection highlights:", error);
    }
  }

  updateUserMessageHistory(newMessage: string) {
    this.userMessageHistory = [...this.userMessageHistory, newMessage];
  }

  emitChatIsVisible() {
    const view = this.app.workspace
      .getLeavesOfType(CHAT_AGENT_VIEWTYPE)
      .map((leaf) => leaf.view)
      .find((view) => this.isScribeAgentView(view));
    if (this.isScribeAgentView(view)) {
      view.eventTarget.dispatchEvent(new CustomEvent(EVENT_NAMES.CHAT_IS_VISIBLE));
    }
  }

  initActiveLeafChangeHandler() {
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) {
          return;
        }
        const activeViewType = leaf.getViewState().type;
        if (activeViewType === CHAT_AGENT_VIEWTYPE) {
          this.emitChatIsVisible();
        }
      })
    );
  }

  initSelectionHandler() {
    watchSelections(this, [activeDrawingSelection]);
  }

  initWebSelectionWatcher() {
    if (!isDesktopRuntime()) {
      return;
    }

    const webViewerService = getWebViewerService(this.app);

    this.webSelectionTracker = new WebSelectionTracker({
      intervalMs: 500,
      emptySelectionDebounceCount: 2,
      isEnabled: () => true,
      getLeaf: () => webViewerService.getActiveLeaf() ?? webViewerService.getLastActiveLeaf(),
      getActiveLeaf: () => webViewerService.getActiveLeaf(),
      onSelectionChange: (context) => {
        reportSelection(webSelectionReport(context));
      },
      onSelectionClear: ({ url }) => {
        reportSelection({ location: url, context: null });
      },
    });

    this.webSelectionTracker.start();
  }

  cleanupWebSelectionWatcher() {
    this.webSelectionTracker?.stop();
    this.webSelectionTracker = undefined;
  }

  async activateChatViewForContext(): Promise<void> {
    await this.activateAgentView();
  }

  toggleAgentView() {
    if (!this.requireAgentView()) return;
    const leaves = this.app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE);
    if (leaves.length > 0) {
      void this.deactivateAgentView();
    } else {
      void this.activateAgentView();
    }
  }

  async activateAgentView(openInRightSidebar = false): Promise<WorkspaceLeaf | null> {
    if (!this.requireAgentView()) return null;
    const leaf = await this.openOrRevealView(CHAT_AGENT_VIEWTYPE, openInRightSidebar);
    const view = leaf?.view;
    if (this.isScribeAgentView(view)) {
      view.eventTarget.queueVisible();
    }
    return leaf;
  }

  async addNoteToAgentChat(note: TFile, openInRightSidebar = false): Promise<void> {
    try {
      const leaf = await this.activateAgentView(openInRightSidebar);
      if (!leaf) return;
      await this.agentSessionManager?.addContextNoteToActiveChat(note);
    } catch (error) {
      logError("Failed to add a note to Agent Chat.", error);
      new Notice(t("Could not add the note to Agent Chat. Check the Scribe log."));
    }
  }

  async deactivateAgentView() {
    this.app.workspace.detachLeavesOfType(CHAT_AGENT_VIEWTYPE);
  }

  async newAgentChat(): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    await this.activateAgentView();
    try {
      await manager.createSession();
    } catch (error) {
      logWarn("[ScribePlugin] Failed to create agent session", error);
      new Notice(t("Failed to start a new chat. Check the Scribe log."));
    }
  }

  async newAgentChatWithDraft(initialDraft: string): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    try {
      const session = await manager.createGlobalSessionWithDraft(initialDraft);
      await session.ready;
      await this.activateAgentView();
    } catch (error) {
      logWarn("[ScribePlugin] Failed to create agent session with draft", error);
      new Notice(t("Failed to start a new chat. Check the Scribe log."));
    }
  }

  async newSkillAuthoringChat(): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    try {
      const session = await manager.createSkillAuthoringSession(
        `/${SKILL_CREATOR_SKILL_NAME} ${t(
          "Describe the workflow you want to turn into a skill. Discuss it with me, show the complete name, description and instructions, then submit the complete draft for my review and confirmation. Do not save files or run commands directly."
        )}`
      );
      await session.ready;
      await this.activateAgentView();
    } catch (error) {
      logWarn("[ScribePlugin] Failed to create skill authoring chat", error);
      new Notice(t("Failed to start a new chat. Check the Scribe log."));
    }
  }

  private async openOrRevealView(
    viewType: string,
    openInRightSidebar = false
  ): Promise<WorkspaceLeaf | null> {
    const leaves = this.app.workspace.getLeavesOfType(viewType);
    if (leaves.length > 0) {
      this.app.workspace.revealLeaf(leaves[0]);
      return leaves[0];
    }
    const leaf =
      openInRightSidebar || getSettings().defaultOpenArea === DEFAULT_OPEN_AREA.VIEW
        ? this.app.workspace.getRightLeaf(false)
        : this.app.workspace.getLeaf(true);
    if (!leaf) return null;
    await leaf.setViewState({ type: viewType, active: true });
    if (openInRightSidebar) this.app.workspace.revealLeaf(leaf);
    return leaf;
  }

  private requireAgentView(): AgentSessionManager | null {
    if (!isDesktopRuntime()) {
      new Notice(t("Agent Chat is not available on mobile."));
      return null;
    }
    if (!this.agentSessionManager) {
      new Notice(t("Agent Chat is not initialized."));
      return null;
    }
    return this.agentSessionManager;
  }

  private canUseAgentView(): boolean {
    return !!this.agentSessionManager && isDesktopRuntime();
  }

  private isScribeAgentView(
    view: unknown
  ): view is InstanceType<NonNullable<typeof this.ScribeAgentView>> {
    const AgentView = this.ScribeAgentView;
    return !!AgentView && view instanceof AgentView;
  }

  async loadSettings() {
    const rawData = (await this.loadData()) as unknown;
    const settings = await loadStoredSettings(rawData, (data) => super.saveData(data));
    setSettings(settings);
  }

  private async touchChatHistoryLastAccessedAt(file: TFile): Promise<void> {
    try {
      this.chatHistoryLastAccessedAtManager.touch(file.path);

      const persistedLastAccessedAtMs = extractChatLastAccessedAtMs(this.app, file);
      const timestampToPersist = this.chatHistoryLastAccessedAtManager.shouldPersist(
        file.path,
        persistedLastAccessedAtMs
      );

      if (timestampToPersist === null) {
        return;
      }

      let persistedAtMs = timestampToPersist;

      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          const existingValue = Number(frontmatter.lastAccessedAt);
          const existingAtMs =
            Number.isFinite(existingValue) && existingValue > 0 ? existingValue : 0;

          persistedAtMs = Math.max(existingAtMs, timestampToPersist);

          if (existingAtMs === persistedAtMs) {
            return;
          }

          frontmatter.lastAccessedAt = persistedAtMs;
        }
      );

      this.chatHistoryLastAccessedAtManager.markPersisted(file.path, persistedAtMs);
    } catch (error) {
      logWarn(`[ScribePlugin] Failed to update chat lastAccessedAt for ${file.path}`, error);
    }
  }

  getChatHistoryLastAccessedAtManager(): RecentUsageManager<string> {
    return this.chatHistoryLastAccessedAtManager;
  }

  async loadChatById(fileId: string): Promise<void> {
    if (isNativeChatId(fileId)) {
      await this.loadNativeAgentChat(fileId);
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (!(file instanceof TFile)) throw new Error("Chat file not found.");

    const cachedMode = this.app.metadataCache.getFileCache(file)?.frontmatter?.mode;
    let mode = typeof cachedMode === "string" ? cachedMode : undefined;
    if (!mode) {
      try {
        const fm = await readFrontmatterViaAdapter(this.app, file.path);
        if (typeof fm?.mode === "string") mode = fm.mode;
      } catch (error) {
        logWarn("Could not read the chat mode from frontmatter", error);
      }
    }
    if (mode === AGENT_CHAT_MODE) {
      // 没有原生会话身份的旧笔记仍可查看，不能假装恢复为可续聊会话。https://github.com/ItsDalk-Lane/Scribe/issues/31
      const identity = await readFrontmatterViaAdapter(this.app, file.path);
      if (typeof identity?.sessionId !== "string" || !identity.sessionId.trim()) {
        await this.app.workspace.getLeaf(true).openFile(file);
        return;
      }
      await this.loadAgentChatHistory(file);
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  async copyChatLink(resolveNotePath: () => Promise<string>): Promise<void> {
    try {
      const chatId = await resolveNotePath();
      const id = isNativeChatId(chatId) ? chatId : await getSavedChatDeepLinkId(this.app, chatId);
      if (!id) throw new Error(`No chat identity to link: "${chatId}"`);
      const file = this.app.vault.getAbstractFileByPath(chatId);
      const title =
        file instanceof TFile
          ? extractChatTitle(this.app, file)
          : ((await this.agentSessionManager?.getChatHistoryItems())?.find(
              (item) => item.id === chatId
            )?.title ?? t("Chat"));
      const url = buildChatDeepLink(this.app.vault.getName(), id);
      await navigator.clipboard.writeText(buildChatMarkdownLink(title, url));
      new Notice(t("Chat link copied."));
    } catch (error) {
      logError("Failed to copy chat link", error);
      new Notice(t("Could not copy chat link."));
    }
  }

  async openChatDeepLink(params: Record<string, string>): Promise<void> {
    const id = params.id ?? "";
    try {
      const chatId = isNativeChatId(id) ? id : (await findChatFileByDeepLinkId(this.app, id))?.path;
      if (!chatId) {
        new Notice(t("Chat link not found."));
        return;
      }
      await this.loadChatById(chatId);
    } catch (error) {
      logError("Failed to open chat link", error);
      new Notice(t("Could not open chat link."));
    }
  }

  private async loadNativeAgentChat(chatId: string): Promise<void> {
    const ref = parseNativeChatId(chatId);
    if (!ref) throw new Error("Chat not found.");
    const manager = this.requireAgentView();
    if (!manager) return;
    const leaf = await this.activateAgentView();
    if (!leaf) return;

    await manager.loadNativeSessionFromHistory(ref.backendId, ref.sessionId);

    if (this.isScribeAgentView(leaf.view)) {
      leaf.view.updateView();
    }
  }

  private async loadAgentChatHistory(file: TFile): Promise<void> {
    const manager = this.requireAgentView();
    if (!manager) return;
    const leaf = await this.activateAgentView();
    if (!leaf) return;

    await manager.loadSessionFromHistory(file);
    void this.touchChatHistoryLastAccessedAt(file);

    if (this.isScribeAgentView(leaf.view)) {
      leaf.view.updateView();
    }
  }

  async updateChatTitle(fileId: string, newTitle: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.fileManager.processFrontMatter(
        file,
        (frontmatter: Record<string, unknown>) => {
          frontmatter.topic = newTitle;
        }
      );

      await new Promise<void>((resolve) => {
        const handler = (updatedFile: TFile) => {
          if (updatedFile.path === fileId) {
            this.app.metadataCache.off("changed", handler);
            window.clearTimeout(timeoutId);
            resolve();
          }
        };

        this.app.metadataCache.on("changed", handler);

        const timeoutId = window.setTimeout(() => {
          this.app.metadataCache.off("changed", handler);
          resolve();
        }, 500);
      });

      new Notice(t("Chat title updated."));
    } else {
      throw new Error("Chat file not found.");
    }
  }

  async deleteChatHistory(fileId: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await trashFile(this.app, file);
      new Notice(t("Chat deleted."));
    } else {
      throw new Error("Chat file not found.");
    }
  }
}
