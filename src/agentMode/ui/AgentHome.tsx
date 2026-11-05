import { t } from "@/lib/i18n";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentChatControls } from "@/agentMode/ui/AgentChatControls";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import AgentContextMeter from "@/agentMode/ui/AgentContextMeter";
import AgentContextSection, { buildContextSummary } from "@/agentMode/ui/AgentContextSection";
import { AgentLandingStack } from "@/agentMode/ui/AgentLandingStack";
import { CreateProjectPanel } from "@/agentMode/ui/CreateProjectPanel";
import { AgentModeStatus } from "@/agentMode/ui/AgentModeStatus";
import { AgentProjectHeader } from "@/agentMode/ui/AgentProjectHeader";
import { ProjectInfoPopover } from "@/agentMode/ui/ProjectInfoPopover";
import { AgentTabStrip } from "@/agentMode/ui/AgentTabStrip";
import { AgentTasksProvider } from "@/agentMode/ui/AgentTasksContext";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { RunningTasksIndicator } from "@/agentMode/ui/RunningTasksIndicator";
import { openTaskModal } from "@/agentMode/ui/TaskDetailModal";
import { AgentWelcomeCard } from "@/agentMode/ui/AgentWelcomeCard";
import { ScribeBrandIcon } from "@/components/ui/ScribeBrandIcon";
import { AgentHomeShelf, type AgentHomeShelfSection } from "@/agentMode/ui/AgentHomeShelf";
import { GlobalRecentChatsSection } from "@/agentMode/ui/GlobalRecentChatsSection";
import {
  getHomeShelfTab,
  setHomeShelfTab,
  HOME_SHELF_TAB_STORAGE_KEY,
} from "@/agentMode/ui/homeShelfPrefs";
import { ProjectPickerList } from "@/agentMode/ui/ProjectPickerList";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { useManagerSetSnapshot } from "@/agentMode/ui/hooks/useManagerSetSnapshot";
import { useAgentHistoryControls } from "@/agentMode/ui/hooks/useAgentHistoryControls";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useAttentionChatIds } from "@/agentMode/ui/hooks/useAttentionChatIds";
import { useRunningChatIds } from "@/agentMode/ui/hooks/useRunningChatIds";
import { useChatInputAutoFocus } from "@/agentMode/ui/hooks/useChatInputAutoFocus";
import { useRefreshEmptyLandingOnContextSourceChange } from "@/agentMode/ui/hooks/useRefreshEmptyLandingOnContextSourceChange";
import { useAgentModelPicker } from "@/agentMode/ui/useAgentModelPicker";
import { useAgentModePicker } from "@/agentMode/ui/useAgentModePicker";
import { useSessionBackendDescriptor } from "@/agentMode/ui/useBackendDescriptor";
import { pickRandomGreeting } from "@/agentMode/ui/landingGreetings";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { GLOBAL_SCOPE } from "@/agentMode/session/scope";
import { type ProjectConfig } from "@/aiParams";
import { makeNewProjectConfig } from "@/agentMode/ui/AgentProjectCreateForm";
import { TruncatedText } from "@/components/TruncatedText";
import { AppContext } from "@/context";
import { ChatInputProvider } from "@/context/ChatInputContext";
import { useChatFileDrop } from "@/hooks/useChatFileDrop";
import { cn } from "@/lib/utils";
import { logError, logWarn } from "@/logger";
import type ScribePlugin from "@/main";
import { ProjectFileManager } from "@/projects/ProjectFileManager";
import { getProjectLandingCaptureSignature } from "@/projects/projectContextSignature";
import { getCachedProjectRecordById, useProjects } from "@/projects/state";
import {
  getModelKeyFromModel,
  getSettings,
  updateSetting,
  useSettingsValue,
} from "@/settings/model";
import { Files, Folder, MessageSquare } from "lucide-react";
import { Notice } from "obsidian";
import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { safeAsyncHandler } from "@/utils/safeAsyncHandler";

interface AgentHomeProps {
  backend: AgentChatBackend;
  sessionId: string;
  chatInputId: string;
  manager: AgentSessionManager;
  plugin: ScribePlugin;
  updateUserMessageHistory: (newMessage: string) => void;
}

const EMPTY_PROJECT_NAMES_BY_ID: Readonly<Record<string, string>> = Object.freeze({});

const AgentHomeInternal: React.FC<AgentHomeProps> = ({
  backend,
  sessionId,
  chatInputId,
  manager,
  plugin,
  updateUserMessageHistory,
}) => {
  const appContext = useContext(AppContext);
  const app = plugin.app || appContext;
  const settings = useSettingsValue();
  const draft = useAgentInputDrafts({ store: manager.drafts, chatInputId });

  useChatInputAutoFocus();

  const {
    messages,
    isStarting,
    isTurnInFlight,
    hasPendingPlanPermission,
    currentPlan,
    currentTodoList,
    pendingToolPermissions,
    pendingAskUserQuestions,
    queuedPrompts,
    tasks,
    isReplyRunning,
  } = useAgentChatRuntimeState(backend);
  const isLoading = draft.loading || isTurnInFlight;
  const replyRunning = draft.loading || isReplyRunning;

  const [rootEl, setRootEl] = useState<HTMLDivElement | null>(null);
  const handleForkMessage = useCallback(
    (messageId: string) => manager.forkSessionAtMessage(sessionId, messageId).then(() => undefined),
    [manager, sessionId]
  );
  const handleOpenTask = useCallback(
    (toolCallId: string) => {
      void openTaskModal(app, manager, sessionId, toolCallId).catch((error: unknown) => {
        logError("[AgentMode] could not open task details", error);
        new Notice(t("Unable to open task details."));
      });
    },
    [app, manager, sessionId]
  );
  const handleStopTask = useCallback(
    (taskId: string) => {
      backend.stopTask(taskId).catch((e: unknown) => logWarn("[AgentMode] stop task failed", e));
    },
    [backend]
  );
  const chatContainerRef = useRef<HTMLDivElement>(null);

  const handleNewChat = useCallback(() => {
    if (manager.getIsStarting()) return;
    const active = manager.getActiveSession();
    if (!active || !active.hasUserVisibleMessages()) return;
    const oldId = active.internalId;
    void (async () => {
      try {
        await manager.replaceSessionInPlace(oldId, active.backendId);
      } catch (e) {
        logError("[AgentMode] new chat failed", e);
        new Notice(t("Failed to start a new chat. Please try again."));
      }
    })();
  }, [manager]);

  const descriptor = useSessionBackendDescriptor(manager);
  const handleInstall = useCallback(() => {
    descriptor.openInstallUI(plugin);
  }, [descriptor, plugin]);

  const projects = useProjects();
  const projectNamesById = useMemo<Readonly<Record<string, string>>>(() => {
    if (projects.length === 0) return EMPTY_PROJECT_NAMES_BY_ID;
    return Object.fromEntries(projects.map((project) => [project.id, project.name]));
  }, [projects]);

  const projectUsageManager = useMemo(
    () => ProjectFileManager.getInstance(app).getProjectUsageTimestampsManager(),
    [app]
  );

  const activeProjectId = manager.getActiveProjectId();
  const isProjectScope = activeProjectId !== GLOBAL_SCOPE;
  const activeProject = isProjectScope ? projects.find((p) => p.id === activeProjectId) : undefined;
  const isOrphanedProject = isProjectScope && !activeProject;
  const projectName = activeProject?.name ?? "";
  const lastProjectHeaderRef = useRef({
    name: projectName,
    orphaned: isOrphanedProject,
  });
  if (isProjectScope) {
    lastProjectHeaderRef.current = {
      name: projectName,
      orphaned: isOrphanedProject,
    };
  }
  const headerName = isProjectScope ? projectName : lastProjectHeaderRef.current.name;
  const headerOrphaned = isProjectScope ? isOrphanedProject : lastProjectHeaderRef.current.orphaned;

  const {
    chatHistoryItems,
    chatHistorySettled,
    loadChatHistory: handleLoadChatHistory,
    loadChat: handleLoadChat,
    updateChatTitle: handleUpdateChatTitle,
    deleteChat: handleDeleteChat,
    setChatPinned: handleSetChatPinned,
    copyChatLink: handleCopyHistoryChatLink,
    getChatBookmarkState,
    setChatBookmarked: handleSetChatBookmarked,
    setActiveChatBookmarked: handleSetActiveChatBookmarked,
  } = useAgentHistoryControls(manager, plugin, activeProjectId);

  const handleCloseSession = useCallback(
    async (id: string) => {
      try {
        await manager.closeChatSession(id);
      } catch (error) {
        logError("[AgentMode] close chat session failed", error);
        new Notice(
          t("Could not close chat: {p0}", {
            p0: error instanceof Error ? error.message : t("Try again."),
          })
        );
      }
    },
    [manager]
  );

  const handleLoadChatHistorySafely = safeAsyncHandler(handleLoadChatHistory);

  const openChatIds = useManagerSetSnapshot(manager, (m) => m.getOpenChatIds());
  const runningChatIds = useRunningChatIds(manager);
  const attentionChatIds = useAttentionChatIds(manager);

  const handleExitProject = useCallback(() => {
    manager.exitProject().catch((e) => {
      logError("[AgentMode] exit project failed", e);
      new Notice(t("Failed to leave project. Please try again."));
    });
  }, [manager]);

  const handleProjectDeleted = useCallback(
    (deletedId: string) => {
      if (manager.getActiveProjectId() === deletedId) {
        manager.exitProject().catch((e) => {
          logError("[AgentMode] exit after delete failed", e);
        });
      }
    },
    [manager]
  );

  const handleSelectProject = useCallback(
    (project: ProjectConfig) => {
      manager.enterProject(project.id).catch((e) => {
        logError("[AgentMode] enter project failed", e);
        new Notice(t("Failed to open project. Please try again."));
      });
    },
    [manager]
  );

  const [createAnchor, setCreateAnchor] = useState<HTMLElement | null>(null);
  const handleCreateProject = useCallback((anchorEl: HTMLElement) => {
    setCreateAnchor(anchorEl);
  }, []);

  const persistCreateProject = useCallback(
    async ({ name }: { name: string }) => {
      const project = makeNewProjectConfig(name);
      try {
        await ProjectFileManager.getInstance(app).createProject(project);
        await manager.enterProject(project.id);
      } catch (e) {
        logError("[AgentMode] create project failed", e);
        throw e;
      }
      setCreateAnchor(null);
    },
    [app, manager]
  );

  const handleDismissWelcome = useCallback(() => {
    updateSetting("agentMode", { ...getSettings().agentMode, welcomeDismissed: true });
  }, []);

  useEffect(() => {
    if (isOrphanedProject) new Notice(t("This project no longer exists."));
  }, [isOrphanedProject]);

  const modelPickerOverride = useAgentModelPicker(manager, plugin);
  const selectedModel = modelPickerOverride?.models.find(
    (model) => getModelKeyFromModel(model) === modelPickerOverride.value
  );
  const modePickerOverride = useAgentModePicker(manager);

  const handleCycleMode = useCallback(() => {
    if (!modePickerOverride || modePickerOverride.disabled) return;
    const { options, value, onChange } = modePickerOverride;
    if (options.length === 0) return;
    const currentIdx = options.findIndex((o) => o.value === value);
    const next = options[(currentIdx + 1) % options.length];
    if (next.value !== value) onChange(next.value);
  }, [modePickerOverride]);

  const { isDragActive } = useChatFileDrop({
    app,
    isAgentMode: true,
    contextNotes: draft.contextNotes,
    setContextNotes: draft.setContextNotes,
    selectedImages: draft.images,
    onAddImage: draft.addImages,
    containerRef: chatContainerRef,
  });

  const isLanding = !manager.getActiveSession()?.hasUserVisibleMessages();
  const isProjectLanding = isLanding && isProjectScope;

  const refreshContextForEmptyLanding = useCallback(async (): Promise<boolean> => {
    const active = manager.getActiveSession();
    if (!active || active.hasUserVisibleMessages()) return false;
    const draftEmpty =
      draft.input.trim() === "" &&
      draft.images.length === 0 &&
      draft.contextNotes.length === 0 &&
      draft.webTabs.length === 0 &&
      draft.queue.length === 0;
    if (!draftEmpty) return false;
    try {
      await manager.replaceSessionInPlace(active.internalId, active.backendId, {
        preserveChatInput: true,
      });
      return true;
    } catch (e) {
      logError("[AgentMode] refresh landing context failed", e);
      return false;
    }
  }, [manager, draft]);

  const draftIsEmpty =
    draft.input.trim() === "" &&
    draft.images.length === 0 &&
    draft.contextNotes.length === 0 &&
    draft.webTabs.length === 0 &&
    draft.queue.length === 0;
  const activeProjectLandingCaptureSignature = useMemo(() => {
    if (!isProjectScope) return null;
    const record = getCachedProjectRecordById(activeProjectId);
    return record ? getProjectLandingCaptureSignature(app, record) : null;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- projects intentionally re-derives metadata read through the project cache
  }, [app, isProjectScope, activeProjectId, projects]);
  useRefreshEmptyLandingOnContextSourceChange({
    activeProjectId,
    signature: activeProjectLandingCaptureSignature,
    isLanding,
    draftEmpty: draftIsEmpty,
    refresh: refreshContextForEmptyLanding,
  });

  const landingVisitKey = isProjectLanding ? `${activeProjectId}\0${sessionId}` : null;
  const placementRef = useRef<{ key: string; standalone: boolean } | null>(null);
  if (landingVisitKey === null) {
    placementRef.current = null;
  } else if (chatHistorySettled) {
    const hasChats = chatHistoryItems.length > 0;
    if (placementRef.current?.key !== landingVisitKey) {
      placementRef.current = { key: landingVisitKey, standalone: !hasChats };
    } else if (placementRef.current.standalone && hasChats) {
      placementRef.current = { key: landingVisitKey, standalone: false };
    }
  } else if (placementRef.current?.key !== landingVisitKey) {
    placementRef.current = null;
  }
  const projectPlacement = placementRef.current;

  // eslint-disable-next-line react-hooks/exhaustive-deps -- sessionId intentionally re-rolls the otherwise argument-free greeting factory
  const greeting = useMemo(() => pickRandomGreeting(), [sessionId]);

  useEffect(() => {
    if (isLanding) void handleLoadChatHistory();
  }, [isLanding, handleLoadChatHistory]);

  const [globalShelfTab, setGlobalShelfTabState] = useState<string | null>(() =>
    getHomeShelfTab(app, HOME_SHELF_TAB_STORAGE_KEY)
  );
  const setGlobalShelfTab = useCallback(
    (id: string) => {
      setGlobalShelfTabState(id);
      setHomeShelfTab(app, HOME_SHELF_TAB_STORAGE_KEY, id);
    },
    [app]
  );

  const landingSections = useMemo<AgentHomeShelfSection[]>(
    () => [
      {
        id: "chats",
        icon: <MessageSquare className="tw-size-4" />,
        title: t("Recent chats"),
        renderBody: () => (
          <GlobalRecentChatsSection
            items={chatHistoryItems}
            onLoadChat={handleLoadChat}
            onUpdateTitle={handleUpdateChatTitle}
            onDeleteChat={handleDeleteChat}
            onCloseSession={handleCloseSession}
            openChatIds={openChatIds}
            onCopyChatLink={handleCopyHistoryChatLink}
            onSetChatPinned={handleSetChatPinned}
            getChatBookmarkState={getChatBookmarkState}
            onSetChatBookmarked={handleSetChatBookmarked}
            onLoadHistory={handleLoadChatHistorySafely}
            runningChatIds={runningChatIds}
            attentionChatIds={attentionChatIds}
            projectNamesById={projectNamesById}
            sortStrategy={settings.chatHistorySortStrategy}
          />
        ),
      },
      {
        id: "projects",
        icon: <Folder className="tw-size-4" />,
        title: t("Projects"),
        count: projects.length,
        renderBody: () => (
          <ProjectPickerList
            projects={projects}
            onSelect={handleSelectProject}
            onCreate={handleCreateProject}
            app={app}
            onProjectDeleted={handleProjectDeleted}
            projectUsageTimestampsManager={projectUsageManager}
          />
        ),
      },
    ],
    [
      projects,
      projectNamesById,
      chatHistoryItems,
      app,
      projectUsageManager,
      handleSelectProject,
      handleCreateProject,
      handleProjectDeleted,
      handleLoadChat,
      handleUpdateChatTitle,
      handleDeleteChat,
      handleSetChatPinned,
      handleCopyHistoryChatLink,
      getChatBookmarkState,
      handleSetChatBookmarked,
      handleLoadChatHistorySafely,
      openChatIds,
      handleCloseSession,
      runningChatIds,
      attentionChatIds,
      settings.chatHistorySortStrategy,
    ]
  );

  const contextSummary = useMemo(() => buildContextSummary(activeProject), [activeProject]);

  const projectLandingSections = useMemo<AgentHomeShelfSection[]>(
    () => [
      {
        id: "project-chats",
        icon: <MessageSquare className="tw-size-4" />,
        title: t("Recent chats"),
        renderBody: () => (
          <GlobalRecentChatsSection
            items={chatHistoryItems}
            variant="project"
            onLoadChat={handleLoadChat}
            onUpdateTitle={handleUpdateChatTitle}
            onDeleteChat={handleDeleteChat}
            onCloseSession={handleCloseSession}
            openChatIds={openChatIds}
            onCopyChatLink={handleCopyHistoryChatLink}
            onSetChatPinned={handleSetChatPinned}
            getChatBookmarkState={getChatBookmarkState}
            onSetChatBookmarked={handleSetChatBookmarked}
            onLoadHistory={handleLoadChatHistorySafely}
            runningChatIds={runningChatIds}
            attentionChatIds={attentionChatIds}
            sortStrategy={settings.chatHistorySortStrategy}
          />
        ),
      },
      {
        id: "project-context",
        icon: <Files className="tw-size-4" />,
        title: t("Context"),
        count: contextSummary.totalItems,
        renderBody: () => (
          <AgentContextSection app={app} projectId={activeProjectId} popoverContainer={rootEl} />
        ),
      },
    ],
    [
      chatHistoryItems,
      contextSummary.totalItems,
      app,
      activeProjectId,
      rootEl,
      handleLoadChat,
      handleUpdateChatTitle,
      handleDeleteChat,
      handleSetChatPinned,
      handleCopyHistoryChatLink,
      getChatBookmarkState,
      handleSetChatBookmarked,
      handleLoadChatHistorySafely,
      openChatIds,
      handleCloseSession,
      runningChatIds,
      attentionChatIds,
      settings.chatHistorySortStrategy,
    ]
  );

  const composerNode = (
    <AgentChatInput
      backend={backend}
      plugin={plugin}
      chatInputId={chatInputId}
      skillScope={{
        cwd: manager.getSession(sessionId)?.cwd ?? null,
        projectDirectory: descriptor.skillsProjectDir,
      }}
      draft={draft}
      app={app}
      updateUserMessageHistory={updateUserMessageHistory}
      isStarting={isStarting}
      isLoading={isLoading}
      isReplyRunning={replyRunning}
      queuedPrompts={queuedPrompts}
      acceptsMidTurnMessages={backend.acceptsMidTurnMessages()}
      hasPendingPlanPermission={hasPendingPlanPermission}
      modelPickerOverride={modelPickerOverride ?? undefined}
      modePickerOverride={modePickerOverride ?? undefined}
      onCycleMode={handleCycleMode}
      disabled={isOrphanedProject}
      sendDisabled={
        // 已有聊天也必须遵守当前模型就绪状态，避免发送失败后消耗草稿。https://github.com/ItsDalk-Lane/Scribe/issues/21
        descriptor.getInstallState(settings).kind !== "ready" ||
        Boolean(modelPickerOverride && (!selectedModel || selectedModel._disabledReason))
      }
    />
  );

  const { queue: heldMessages, setQueue: setHeldMessages } = draft;
  const handleRemoveHeldMessage = useCallback(
    (id: string) => setHeldMessages((queue) => queue.filter((m) => m.id !== id)),
    [setHeldMessages]
  );
  const handleWithdrawMessage = useCallback(
    (id: string) => {
      backend.withdrawMessage(id).catch((e: unknown) => logError("[AgentMode] withdraw failed", e));
    },
    [backend]
  );
  const handleSendWaitingNow = useCallback(() => {
    backend.sendWaitingNow().catch((e: unknown) => logError("[AgentMode] send now failed", e));
  }, [backend]);
  const queuedMessagesNode =
    queuedPrompts.length > 0 || heldMessages.length > 0 ? (
      <QueuedMessageList
        delivering={queuedPrompts}
        held={heldMessages}
        onRemove={handleRemoveHeldMessage}
        onWithdraw={backend.canWithdrawMessages() ? handleWithdrawMessage : undefined}
        onSendNow={replyRunning ? handleSendWaitingNow : undefined}
      />
    ) : null;

  const showProjectHero = isProjectLanding && !isOrphanedProject;
  const heroText = showProjectHero ? t("Chat in {p0}", { p0: projectName }) : greeting;
  const hero = (
    <div className="tw-flex tw-min-w-0 tw-items-center tw-justify-center tw-gap-3">
      <ScribeBrandIcon className="tw-size-6 tw-shrink-0 tw-text-normal" />
      <TruncatedText
        className="tw-min-w-0 tw-text-3xl tw-font-[330] tw-text-normal"
        tooltipContent={heroText}
      >
        {heroText}
      </TruncatedText>
    </div>
  );

  const activeSession = manager.getSession(sessionId);
  const handleCopyChatLink = () =>
    handleCopyHistoryChatLink(manager.getSessionHistoryId(sessionId));

  const getActiveChatBookmarkState = useCallback(
    () => getChatBookmarkState(manager.getSessionHistoryId(sessionId)),
    [getChatBookmarkState, manager, sessionId]
  );

  return (
    <div ref={setRootEl} className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div
        className={cn(
          "tw-grid tw-shrink-0 tw-transition-[grid-template-rows,opacity] tw-duration-200 tw-ease-out motion-reduce:tw-transition-none",
          isProjectScope
            ? "tw-grid-rows-[1fr] tw-opacity-100"
            : "tw-pointer-events-none tw-grid-rows-[0fr] tw-opacity-0"
        )}
        aria-hidden={!isProjectScope}
      >
        <div className="tw-min-h-0 tw-overflow-hidden">
          <AgentProjectHeader
            projectName={headerName}
            onExit={handleExitProject}
            orphaned={headerOrphaned}
            menu={
              activeProject ? (
                <ProjectInfoPopover
                  app={app}
                  project={activeProject}
                  todoList={currentTodoList}
                  container={rootEl}
                />
              ) : undefined
            }
          />
        </div>
      </div>
      <AgentTabStrip manager={manager} />
      {createAnchor && (
        <CreateProjectPanel
          anchorEl={createAnchor}
          onClose={() => setCreateAnchor(null)}
          onSave={persistCreateProject}
        />
      )}
      <div className="tw-min-h-0 tw-flex-1">
        <div ref={chatContainerRef} className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
          <div className="tw-h-full">
            <div className="tw-relative tw-flex tw-h-full tw-flex-col">
              {isDragActive && (
                <div className="tw-pointer-events-none tw-absolute tw-inset-0 tw-z-modal tw-flex tw-items-center tw-justify-center tw-rounded-md tw-border tw-border-dashed tw-bg-primary tw-opacity-80">
                  <span>{t("Drop files here...")}</span>
                </div>
              )}
              <div
                className={
                  isLanding
                    ? "tw-flex tw-size-full tw-flex-col tw-overflow-y-auto tw-px-2"
                    : "tw-relative tw-flex tw-size-full tw-flex-col tw-overflow-hidden"
                }
                data-agent-landing={
                  isProjectLanding ? "project" : isLanding ? "global" : "conversation"
                }
              >
                <AgentModeStatus manager={manager} plugin={plugin} onInstallClick={handleInstall} />
                {isLanding ? (
                  <AgentLandingStack
                    hero={hero}
                    composer={
                      <>
                        {queuedMessagesNode}
                        {composerNode}
                      </>
                    }
                    floating={
                      !isProjectLanding &&
                      projects.length === 0 &&
                      !settings.agentMode.welcomeDismissed ? (
                        <AgentWelcomeCard
                          onCreate={handleCreateProject}
                          onDismiss={handleDismissWelcome}
                        />
                      ) : undefined
                    }
                    context={
                      isProjectLanding && !isOrphanedProject && projectPlacement?.standalone ? (
                        <div className="tw-px-2 tw-pb-1 tw-pt-3">
                          <AgentContextSection
                            app={app}
                            projectId={activeProjectId}
                            popoverContainer={rootEl}
                          />
                        </div>
                      ) : undefined
                    }
                    shelf={
                      isProjectLanding ? (
                        projectPlacement && !projectPlacement.standalone ? (
                          <AgentHomeShelf key={activeProjectId} sections={projectLandingSections} />
                        ) : null
                      ) : (
                        <AgentHomeShelf
                          sections={landingSections}
                          activeSectionId={globalShelfTab}
                          onSectionSelect={setGlobalShelfTab}
                        />
                      )
                    }
                  />
                ) : (
                  <AgentTasksProvider tasks={tasks} openTask={handleOpenTask}>
                    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
                      <AgentChatMessages
                        sourcePath={manager.getSessionSourcePath(sessionId)}
                        key={sessionId}
                        messages={messages}
                        plugin={plugin}
                        currentPlan={currentPlan}
                        pendingToolPermissions={pendingToolPermissions}
                        pendingAskUserQuestions={pendingAskUserQuestions}
                        chatBackend={backend}
                        onForkMessage={handleForkMessage}
                        isLoading={isLoading}
                      />
                      {queuedMessagesNode}
                      <AgentChatControls
                        onCopyChatLink={
                          activeSession?.hasUserVisibleMessages() ? handleCopyChatLink : undefined
                        }
                        getChatBookmarkState={
                          activeSession?.hasUserVisibleMessages()
                            ? getActiveChatBookmarkState
                            : undefined
                        }
                        onSetChatBookmarked={handleSetActiveChatBookmarked}
                        onNewChat={handleNewChat}
                        chatHistoryItems={chatHistoryItems}
                        onLoadHistory={handleLoadChatHistory}
                        onLoadChat={handleLoadChat}
                        onUpdateChatTitle={handleUpdateChatTitle}
                        onDeleteChat={handleDeleteChat}
                        onCloseSession={handleCloseSession}
                        openChatIds={openChatIds}
                        runningChatIds={runningChatIds}
                        usageMeter={<AgentContextMeter backend={backend} />}
                        tasksIndicator={
                          <RunningTasksIndicator
                            tasks={tasks}
                            permissions={pendingToolPermissions}
                            onOpenTask={handleOpenTask}
                            onStopTask={backend.canStopTasks() ? handleStopTask : undefined}
                            container={rootEl}
                          />
                        }
                      />
                      {composerNode}
                    </div>
                  </AgentTasksProvider>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export const AgentHome: React.FC<AgentHomeProps> = (props) => {
  return (
    <ChatInputProvider>
      <AgentHomeInternal {...props} />
    </ChatInputProvider>
  );
};
