import { t } from "@/lib/i18n";
import { initializeInterfaceLanguage } from "@/services/interfaceLanguage";
import { releaseCursorAssociation } from "@/editor/releaseCursorAssociation";
import { registerNoteHeaderAction } from "@/editor/registerNoteHeaderAction";
import type { AgentSessionManager, SkillManager } from "@/agentMode";
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
import { CopilotFolderMigration } from "@/components/modals/CopilotFolderMigration";
import React from "react";

import { registerContextMenu } from "@/commands/contextMenu";
import { CustomCommandRegister } from "@/commands/customCommandRegister";
import { migrateCommands } from "@/commands/migrator";
import { migrateSystemPromptsFromSettings } from "@/system-prompts/migration";
import { ProjectRegister } from "@/projects/projectRegister";
import {
  AGENT_CHAT_MODE,
  CHAT_AGENT_VIEWTYPE,
  COPILOT_AGENT_ICON_ID,
  COPILOT_AGENT_ICON_SVG,
  DEFAULT_OPEN_AREA,
  DESKTOP_VIEW_TYPES,
  EVENT_NAMES,
  PLAN_PREVIEW_VIEW_TYPE,
  SHARED_VIEW_TYPES,
} from "@/constants";
import { logError, logFatalError, logInfo, logWarn } from "@/logger";
import { logFileManager } from "@/logFileManager";
import { createModelManagement, type ModelManagementApi } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { backupLegacyCredentials } from "@/services/legacyCredentialBackup";
import {
  persistSettings,
  loadSettingsWithKeychain,
  flushPersistence,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import {
  getWebViewerService,
  startActiveWebTabTracking,
} from "@/services/webViewerService/webViewerServiceSingleton";
import { WebSelectionTracker } from "@/services/webViewerService/webViewerServiceSelection";
import { runSettingsMigrations } from "@/settings/migrations";
import { CopilotSettingTab } from "@/settings/SettingsPage";
import {
  getSettings,
  setSettings,
  subscribeToSettingsChange,
  updateSetting,
} from "@/settings/model";
import { ensureCopilotSubfolders } from "@/settings/copilotFolder";
import { revealHiddenCopilotFolder } from "@/settings/revealCopilotFolder";
import { buildUpgradeRelocationEntries } from "@/settings/upgradeNotice";
import { getDeviceId } from "@/utils/deviceId";
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
  FileSystemAdapter,
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
  shouldClearCredentialRecovery,
  shouldClearFolderRelocation,
  type StartupMigrationItem,
  type StartupMigrationTask,
} from "@/services/startupMigration";
import { extractChatLastAccessedAtMs, extractChatTitle } from "@/utils/chatHistoryUtils";
import { RecentUsageManager } from "@/utils/recentUsageManager";
import { readFrontmatterViaAdapter, trashFile } from "@/utils/vaultAdapterUtils";
import { withTimeout } from "@/utils";
import { StartupLoadingView, type CopilotStartup } from "@/components/StartupLoadingView";

const PENDING_TEARDOWN = Symbol.for("obsidian-scribe:pending-teardown");
const PREVIOUS_TEARDOWN_TIMEOUT_MS = 10_000;

interface TeardownHandoff {
  [PENDING_TEARDOWN]?: Promise<void>;
}

export default class CopilotPlugin extends Plugin implements CopilotStartup {
  userMessageHistory: string[] = [];
  customCommandRegister: CustomCommandRegister;
  projectRegister: ProjectRegister;
  settingsUnsubscriber?: () => void;
  agentSessionManager?: AgentSessionManager;
  skills?: SkillManager;
  private CopilotAgentView?: typeof import("@/agentMode").CopilotAgentView;
  private PlanPreviewView?: typeof import("@/agentMode").PlanPreviewView;
  modelManagement!: ModelManagementApi;
  private ribbonIconEl?: HTMLElement;
  quickAskController: QuickAskController;
  chatSelectionHighlightController: ChatSelectionHighlightController;
  private webSelectionTracker?: WebSelectionTracker;
  private readonly chatHistoryLastAccessedAtManager = new RecentUsageManager<string>();
  private startupMigrationItems: StartupMigrationItem[] = [];
  private loadedCopilotFolder: unknown;
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

  // Obsidian awaits onload before opening the vault and never waits for it before unloading, so
  // startup work runs in the background and registers what needs loaded settings only after its
  // last await. https://github.com/logancyang/obsidian-copilot/issues/3518
  onload(): void {
    initializeInterfaceLanguage();
    installRendererEventsShim();
    this.initialization = this.initialize().catch((error) => {
      // logError prints only when the debug setting is on, which a failed settings load never
      // reads, and this catch keeps Obsidian from logging the failure itself.
      // https://github.com/logancyang/obsidian-copilot/issues/3518
      logFatalError("Scribe failed to start.", error);
      new Notice(t("Scribe failed to start. Check the Scribe log for details."));
      // Obsidian keeps a plugin enabled when work after onload fails, so release whatever
      // startup registered before the failure. https://github.com/logancyang/obsidian-copilot/issues/3518
      this.unload();
    });
    // Restored tabs and the settings tab exist from the start so they show startup progress
    // instead of disappearing. https://github.com/logancyang/obsidian-copilot/issues/3518
    const viewTypes = isDesktopRuntime() ? DESKTOP_VIEW_TYPES : SHARED_VIEW_TYPES;
    for (const viewType of viewTypes) {
      this.safeRegisterView(
        viewType,
        (leaf: WorkspaceLeaf) =>
          this.createStartedView(viewType, leaf) ?? new StartupLoadingView(leaf, viewType, this)
      );
    }
    this.addSettingTab(new CopilotSettingTab(this.app, this));
    // Obsidian dispatches the URI that launched it once its layout loads, which can precede
    // initialization, so the handler exists from the start and waits for the chat managers.
    // https://github.com/logancyang/obsidian-copilot/issues/3271
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
    KeychainService.resetInstance();
    KeychainService.getInstance(this.app);
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
          new Notice(t("Scribe failed to save settings. Check the Scribe log, then try again."));
        }
      })();
    });
    await runSettingsMigrations(this.modelManagement);
    const folderMigration = await revealHiddenCopilotFolder(
      this.app.vault,
      this.loadedCopilotFolder,
      getSettings().copilotFolder
    );
    // The dialog tells the user what to move by hand, so the visible root is saved even when the move failed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/712
    if (folderMigration) {
      setSettings({ copilotFolder: getSettings().copilotFolder });
      this.app.workspace.onLayoutReady(() => {
        new ConfirmModal(
          this.app,
          () => {},
          React.createElement(CopilotFolderMigration, { migration: folderMigration }),
          t("Scribe folder migration"),
          t("OK"),
          ""
        ).open();
      });
    }
    const agentMode = isDesktopRuntime() ? await import("@/agentMode") : null;
    if (!this.pluginLifecycleActive) return;

    const isLegacyUpgrade = getSettings().upgradedToV8FromLegacy;

    ContextProcessor.getInstance(this.app);
    CustomCommandManager.getInstance(this.app);
    logFileManager.setApp(this.app);

    if (agentMode) {
      const {
        CopilotAgentView,
        PlanPreviewView,
        closeAgentDetailModals,
        closeRestoredTurnDiffs,
        registerTurnDiffCommands,
        acpFrameSink,
        createAgentSessionManager,
        setFrameSinkVaultBasePath,
        SkillManager,
      } = agentMode;
      this.CopilotAgentView = CopilotAgentView;
      this.PlanPreviewView = PlanPreviewView;
      closeRestoredTurnDiffs(this.app.workspace);
      this.register(() => closeAgentDetailModals(this.app));
      registerTurnDiffCommands(this);

      const adapter = this.app.vault.adapter;
      setFrameSinkVaultBasePath(
        adapter instanceof FileSystemAdapter ? adapter.getBasePath() : null
      );
      // A log left permissive by an older build is only reachable here when
      // frame logging is off. https://github.com/logancyang/obsidian-copilot-preview/issues/250
      void acpFrameSink.narrowLegacyLogs();

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

    addIcon(COPILOT_AGENT_ICON_ID, COPILOT_AGENT_ICON_SVG);

    if (isDesktopRuntime()) registerNoteHeaderAction(this);

    if (this.CopilotAgentView && this.PlanPreviewView) {
      const AgentView = this.CopilotAgentView;
      const PreviewView = this.PlanPreviewView;
      this.startedViewCreators.set(CHAT_AGENT_VIEWTYPE, (leaf) => new AgentView(leaf, this));
      this.startedViewCreators.set(PLAN_PREVIEW_VIEW_TYPE, (leaf) => new PreviewView(leaf));
    }

    this.initActiveLeafChangeHandler();

    if (this.canUseAgentView()) {
      this.ribbonIconEl = this.addRibbonIcon(
        COPILOT_AGENT_ICON_ID,
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
      void this.runStartupMigrations(isLegacyUpgrade).catch((error) => {
        logError("Failed to finish startup migrations", error);
        new Notice(t("Scribe could not finish startup migration. Reload Obsidian to retry."));
      });
    });

    this.initSelectionHandler();

    this.initWebSelectionWatcher();
    this.initializedReady = true;
  }

  // A disabled or updated copy may still be writing data.json or stopping Agent Mode backends;
  // a hung shutdown must not keep this copy, or any later one, from starting.
  // https://github.com/logancyang/obsidian-copilot/issues/3518
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

  private async collectLegacyUpgradeRelocation(): Promise<StartupMigrationItem | null> {
    if (!getSettings().upgradedToV8FromLegacy) return null;

    const entries = buildUpgradeRelocationEntries(getSettings());
    if (entries.length > 0) {
      await ensureCopilotSubfolders(this.app.vault, getSettings());
    }
    if (entries.length === 0) {
      updateSetting("upgradedToV8FromLegacy", false);
      return null;
    }
    return {
      id: "folders",
      title: t("Scribe folders"),
      status: "action-required",
      summary: t("Scribe now keeps its files under one folder. Existing files were not moved."),
      details: entries.map(({ label, oldPath, newPath }) =>
        t("{label}: move {oldPath} to {newPath}.", {
          label: label,
          oldPath: oldPath,
          newPath: newPath,
        })
      ),
    };
  }

  private async runStartupMigrations(isLegacyUpgrade: boolean): Promise<void> {
    const task = (
      result: Promise<StartupMigrationItem | null>,
      failure: StartupMigrationItem,
      notice?: string
    ): StartupMigrationTask => {
      return {
        result,
        failure: isLegacyUpgrade ? failure : null,
        onFailure: (error) => {
          logError(`${failure.title} startup migration failed`, error);
          if (!isLegacyUpgrade && notice) new Notice(notice);
        },
      };
    };

    const projectTask = task(
      this.projectRegister.initialize(),
      {
        id: "projects",
        title: t("Projects"),
        status: "error",
        summary: t("Projects could not be loaded or migrated. Reload Obsidian to retry."),
      },
      t("Failed to load projects. Check console for details.")
    );
    const commandsTask = task(
      this.customCommandRegister
        .initialize()
        .then(() => this.runUnlessUnloaded(() => migrateCommands(this.app))),
      {
        id: "custom-commands",
        title: t("Custom commands"),
        status: "error",
        summary: t("Custom commands could not be loaded or migrated. Reload Obsidian to retry."),
      }
    );
    const promptsTask = task(
      this.runUnlessUnloaded(() => migrateSystemPromptsFromSettings(this.app)),
      {
        id: "system-prompt",
        title: t("System prompt"),
        status: "error",
        summary: t("System prompts could not be loaded or migrated. Reload Obsidian to retry."),
      }
    );
    const relocationTask = task(this.collectLegacyUpgradeRelocation(), {
      id: "folders",
      title: t("Scribe folders"),
      status: "error",
      summary: t("Folder destinations could not be prepared. Reload Obsidian to retry."),
    });
    await runStartupMigrationSummary({
      initialItems: this.startupMigrationItems,
      tasks: [projectTask, commandsTask, promptsTask, relocationTask],
      present: (items) => {
        new ConfirmModal(
          this.app,
          () => {},
          formatStartupMigrationSummary(items),
          t("Scribe upgrade summary"),
          t("Done"),
          ""
        ).open();
      },
      acknowledge: (items) => {
        this.startupMigrationItems = [];
        const pendingCredentialRecovery = getSettings()._pendingCredentialRecovery;
        if (
          shouldClearCredentialRecovery(
            items,
            pendingCredentialRecovery?.deviceId,
            getDeviceId(this.app)
          )
        ) {
          updateSetting("_pendingCredentialRecovery", undefined);
        }
        if (shouldClearFolderRelocation(items)) {
          updateSetting("upgradedToV8FromLegacy", false);
        }
      },
    });
  }

  // Startup migrations outlive an unload, and a legacy migration finishing in the unloaded copy
  // would write the same files and settings as its successor's.
  // https://github.com/logancyang/obsidian-copilot/issues/3518
  private async runUnlessUnloaded(
    migrate: () => Promise<StartupMigrationItem | null>
  ): Promise<StartupMigrationItem | null> {
    return this.pluginLifecycleActive ? migrate() : null;
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
    // The audio module is shared across hot-reloaded plugin instances, so the outgoing
    // teardown must release its context before a successor can create one. https://github.com/logancyang/obsidian-copilot/issues/2987
    disposeNotificationSound();
    const handoff = window as TeardownHandoff;
    const teardown = this.teardown().catch((error) => {
      logError("Scribe: plugin teardown failed during unload:", error);
    });
    // A copy unloaded mid-startup tears down instantly while its own settings load, and its
    // startup still waits on any older copy's shutdown, so the handoff covers both.
    // https://github.com/logancyang/obsidian-copilot/issues/3518
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
    // The handoff releases the next copy once teardown resolves, so the drain must come after
    // the last settings change can queue a write. https://github.com/logancyang/obsidian-copilot/issues/3518
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
      .find((view) => this.isCopilotAgentView(view));
    if (this.isCopilotAgentView(view)) {
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
    if (this.isCopilotAgentView(view)) {
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
      await manager.createGlobalSessionWithDraft(initialDraft);
      await this.activateAgentView();
    } catch (error) {
      logWarn("[ScribePlugin] Failed to create agent session with draft", error);
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
    // A new right-sidebar leaf can exist while the sidebar remains collapsed.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/579
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

  private isCopilotAgentView(
    view: unknown
  ): view is InstanceType<NonNullable<typeof this.CopilotAgentView>> {
    const AgentView = this.CopilotAgentView;
    return !!AgentView && view instanceof AgentView;
  }

  async loadSettings() {
    const rawData = (await this.loadData()) as unknown;
    this.loadedCopilotFolder = (rawData as { copilotFolder?: unknown } | null)?.copilotFolder;
    const settings = await loadSettingsWithKeychain(
      this.app,
      rawData,
      (d) => super.saveData(d),
      (raw) =>
        backupLegacyCredentials(raw, this.manifest.dir ?? "", {
          exists: (path) => this.app.vault.adapter.exists(path),
          write: (path, contents) => this.app.vault.adapter.write(path, contents),
          rename: (from, to) => this.app.vault.adapter.rename(from, to),
        }),
      (item) => this.startupMigrationItems.push(item)
    );
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
      await this.loadAgentChatHistory(file);
      return;
    }
    await this.app.workspace.getLeaf(true).openFile(file);
  }

  async copyChatLink(resolveNotePath: () => Promise<string>): Promise<void> {
    try {
      const path = await resolveNotePath();
      const file = path ? this.app.vault.getAbstractFileByPath(path) : null;
      const id = file instanceof TFile ? await getSavedChatDeepLinkId(this.app, file.path) : null;
      if (!(file instanceof TFile) || !id) throw new Error(`No saved chat note to link: "${path}"`);
      const url = buildChatDeepLink(this.app.vault.getName(), id);
      await navigator.clipboard.writeText(
        buildChatMarkdownLink(extractChatTitle(this.app, file), url)
      );
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

    if (this.isCopilotAgentView(leaf.view)) {
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

    if (this.isCopilotAgentView(leaf.view)) {
      leaf.view.updateView();
    }
  }

  async openChatSourceFile(fileId: string): Promise<void> {
    if (isNativeChatId(fileId)) {
      new Notice(
        t(
          "This chat has no saved note. Turn on Autosave chats as Markdown to save chats as notes in your vault."
        )
      );
      return;
    }
    const file = this.app.vault.getAbstractFileByPath(fileId);
    if (file instanceof TFile) {
      await this.app.workspace.getLeaf(true).openFile(file);
    } else {
      throw new Error("Chat file not found.");
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
