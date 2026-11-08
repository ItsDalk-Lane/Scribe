import { t } from "@/lib/i18n";
import { listBackendDescriptors } from "@/agentMode/backends/registry";
import { buildAgentModelPicker } from "@/agentMode/ui/agentModelPickerHelpers";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { SubagentChatBackend } from "@/agentMode/session/SubagentChatBackend";
import { SUBAGENT_CHAT_DRAFT_PREFIX } from "@/agentMode/session/AgentInputDraftStore";
import { AgentChatInput } from "@/agentMode/ui/AgentChatInput";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import { AgentTasksProvider } from "@/agentMode/ui/AgentTasksContext";
import { QueuedMessageList } from "@/agentMode/ui/QueuedMessageList";
import { subagentRunStatusLabel } from "@/agentMode/ui/subagentDisplay";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { useAgentInputDrafts } from "@/agentMode/ui/hooks/useAgentInputDrafts";
import { useSessionBackendDescriptor } from "@/agentMode/ui/useBackendDescriptor";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChatInputProvider } from "@/context/ChatInputContext";
import { logError } from "@/logger";
import { useSettingsValue } from "@/settings/model";
import { ArrowLeft, MoreHorizontal } from "lucide-react";
import { TFile, type App } from "obsidian";
import type ScribePlugin from "@/main";
import React, { useMemo, useState } from "react";

const EMPTY_TASKS = Object.freeze([]) as unknown as AgentTask[];

const resolveModelEntry = (
  modelId: string,
  manager: AgentSessionManager,
  settings: ReturnType<typeof useSettingsValue>
) => {
  const picker = buildAgentModelPicker({
    manager,
    descriptors: listBackendDescriptors(),
    settings,
  });
  return picker?.models.find((candidate) => candidate.name === modelId);
};

export interface SubagentChatPanelProps {
  app: App;
  plugin: ScribePlugin;
  manager: AgentSessionManager;
  parentBackend: AgentChatBackend;
  subagentId: string;
  onBack: () => void;
}

export const SubagentChatPanel: React.FC<SubagentChatPanelProps> = ({
  app,
  plugin,
  manager,
  parentBackend,
  subagentId,
  onBack,
}) => {
  const backend = useMemo(
    () =>
      new SubagentChatBackend(parentBackend, subagentId, (path) => {
        const file = app.vault.getAbstractFileByPath(path);
        return file instanceof TFile ? file : null;
      }),
    [app, parentBackend, subagentId]
  );
  const settings = useSettingsValue();
  const descriptor = useSessionBackendDescriptor(manager);
  const runtime = useAgentChatRuntimeState(backend);
  const draft = useAgentInputDrafts({
    store: manager.drafts,
    chatInputId: `${SUBAGENT_CHAT_DRAFT_PREFIX}${subagentId}`,
  });
  const [actionError, setActionError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  const snapshot = backend.getSnapshot();
  const activeRun = backend.getActiveRun();
  const isReplyRunning = runtime.isReplyRunning;
  const archived = snapshot?.retention === "archived";
  const recoveryBlocked = !!snapshot?.recoveryBlocked;
  const blocked = !snapshot || archived || recoveryBlocked;
  const isLoading = draft.loading || runtime.isTurnInFlight;
  const delivering = backend.getDeliveringPrompts();
  const held = backend.getHeldPrompts();

  const runAction = (operation: () => Promise<void>): void => {
    setActionError(null);
    operation().catch((failure: unknown) => {
      logError("[SubagentChatPanel] action failed", failure);
      setActionError(failure instanceof Error ? failure.message : String(failure));
    });
  };

  const confirmDelete = (): void => {
    if (!snapshot) return;
    new ConfirmModal(
      app,
      () => runAction(() => backend.remove()),
      t(
        "This deletes this child's saved context and run history after stopping its work. Messages already quoted in the parent chat remain. This cannot be undone."
      ),
      t("Delete child session"),
      t("Confirm deletion"),
      t("Cancel deletion")
    ).open();
  };

  const statusLabel = archived
    ? t("Archived")
    : recoveryBlocked
      ? t("Recovery blocked")
      : activeRun
        ? subagentRunStatusLabel(activeRun.status)
        : undefined;

  const modelEntry = snapshot ? resolveModelEntry(snapshot.modelId, manager, settings) : undefined;
  const modelLabel = modelEntry?.displayName || snapshot?.modelId || "";

  const heldMessages = held.map((prompt) => ({ ...prompt, rawInput: prompt.text }));
  const queuedNode =
    delivering.length > 0 || held.length > 0 ? (
      <div>
        <QueuedMessageList
          delivering={delivering}
          held={heldMessages}
          heldCaption={t("Waiting for the child to start.")}
        />
        {held.length > 0 && !blocked && (
          <Button
            variant="secondary"
            size="fit"
            className="tw-mx-2 tw-mb-1"
            disabled={retrying}
            onClick={() => {
              setRetrying(true);
              setActionError(null);
              void backend
                .sendWaitingNow()
                .catch((failure: unknown) => {
                  logError("[SubagentChatPanel] retry failed", failure);
                  setActionError(failure instanceof Error ? failure.message : String(failure));
                })
                .finally(() => setRetrying(false));
            }}
          >
            {t("Retry waiting messages")}
          </Button>
        )}
      </div>
    ) : null;

  return (
    <div className="tw-flex tw-size-full tw-flex-col tw-overflow-hidden">
      <div className="scribe-divider-b tw-flex tw-shrink-0 tw-items-center tw-gap-2 tw-px-2 tw-py-1.5">
        <Button variant="ghost2" size="icon" aria-label={t("Back to chat")} onClick={onBack}>
          <ArrowLeft className="tw-size-4" />
        </Button>
        <div className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-sm tw-font-medium">
          {snapshot?.name ?? t("This child session no longer exists.")}
        </div>
        {statusLabel ? (
          <span className="tw-shrink-0 tw-rounded tw-bg-secondary tw-px-2 tw-py-0.5 tw-text-xs tw-text-muted">
            {statusLabel}
          </span>
        ) : null}
        {modelLabel ? (
          <span className="tw-shrink-0 tw-text-xs tw-text-muted">{modelLabel}</span>
        ) : null}
        {snapshot ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost2"
                size="icon"
                aria-label={t("Child session actions")}
                className="tw-shrink-0"
              >
                <MoreHorizontal className="tw-size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {isReplyRunning ? (
                <DropdownMenuItem onSelect={() => runAction(() => backend.stop())}>
                  {t("Stop this child")}
                </DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onSelect={() => runAction(() => backend.setArchived(!archived))}>
                {t(archived ? "Unarchive child session" : "Archive child session")}
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={confirmDelete}>
                {t("Delete child session")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      {actionError ? (
        <div
          role="alert"
          className="tw-shrink-0 tw-whitespace-pre-wrap tw-break-words tw-px-3 tw-py-1 tw-text-sm tw-text-error"
        >
          {actionError}
        </div>
      ) : null}
      {recoveryBlocked ? (
        <div className="tw-flex tw-shrink-0 tw-flex-col tw-gap-2 tw-px-3 tw-py-2">
          <div
            role="alert"
            className="tw-whitespace-pre-wrap tw-break-words tw-text-sm tw-text-warning"
          >
            {t("Recovery blocked")}: {snapshot?.recoveryBlocked}
          </div>
          <Button
            variant="secondary"
            size="fit"
            className="tw-self-start"
            onClick={() => runAction(() => backend.confirmRecovery())}
          >
            {t("I checked the actual files and tasks")}
          </Button>
        </div>
      ) : null}
      {!snapshot ? (
        <div className="tw-flex tw-flex-1 tw-flex-col tw-items-center tw-justify-center tw-gap-3 tw-px-6">
          <p className="tw-m-0 tw-text-sm tw-text-muted">
            {t("This child session no longer exists.")}
          </p>
          <Button variant="secondary" size="fit" onClick={onBack}>
            {t("Back to chat")}
          </Button>
        </div>
      ) : (
        <ChatInputProvider>
          <AgentTasksProvider tasks={EMPTY_TASKS} openTask={() => {}}>
            <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col">
              <AgentChatMessages
                key={subagentId}
                messages={runtime.messages}
                plugin={plugin}
                currentPlan={null}
                pendingToolPermissions={runtime.pendingToolPermissions}
                pendingAskUserQuestions={runtime.pendingAskUserQuestions}
                chatBackend={backend}
                isLoading={isLoading}
              />
              {queuedNode}
              <AgentChatInput
                backend={backend}
                plugin={plugin}
                chatInputId={`${SUBAGENT_CHAT_DRAFT_PREFIX}${subagentId}`}
                skillScope={{
                  cwd: snapshot.cwd ?? null,
                  projectDirectory: descriptor.skillsProjectDir,
                }}
                draft={draft}
                app={app}
                updateUserMessageHistory={(message) => plugin.updateUserMessageHistory(message)}
                isStarting={runtime.isStarting}
                isLoading={isLoading}
                isReplyRunning={isReplyRunning}
                queuedPrompts={runtime.queuedPrompts}
                acceptsMidTurnMessages={true}
                hasPendingPlanPermission={false}
                modelPickerOverride={undefined}
                modePickerOverride={undefined}
                showModelPicker={false}
                acceptanceOnly
                modelIdOverride={snapshot?.modelId}
                modelEntryOverride={modelEntry}
                onCycleMode={() => {}}
                disabled={blocked}
                sendDisabled={blocked}
              />
            </div>
          </AgentTasksProvider>
        </ChatInputProvider>
      )}
    </div>
  );
};
