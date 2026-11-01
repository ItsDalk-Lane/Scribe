import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import {
  AgentDetailModal,
  closeAgentDetailModals,
  openAgentDetailModal,
} from "@/agentMode/ui/AgentDetailModal";
import { AgentTasksProvider } from "@/agentMode/ui/AgentTasksContext";
import { useAgentChatRuntimeState } from "@/agentMode/ui/hooks/useAgentChatRuntimeState";
import { TaskDetailView } from "@/agentMode/ui/TaskDetailView";
import { taskDisplayStatus } from "@/agentMode/ui/taskDisplay";
import { TooltipProvider } from "@/components/ui/tooltip";
import { CHAT_AGENT_VIEWTYPE } from "@/constants";
import { t } from "@/lib/i18n";
import { logError } from "@/logger";
import { App, Notice } from "obsidian";
import React from "react";

export class TaskDetailModal extends AgentDetailModal {
  constructor(
    app: App,
    private readonly manager: AgentSessionManager,
    private readonly session: AgentSession,
    private readonly backend: AgentChatBackend,
    private readonly toolCallId: string
  ) {
    super(app, taskKey(session.chatInputId, toolCallId), t("Task details"));
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <TaskDetailModalContent
        backend={this.backend}
        chatId={this.session.chatInputId}
        toolCallId={this.toolCallId}
        app={this.app}
        onClose={close}
        onOpenTask={(toolCallId) => {
          void openTaskModal(this.app, this.manager, this.session.internalId, toolCallId).catch(
            (error: unknown) => {
              logError("[TaskDetailModal] could not open task details", error);
              new Notice(t("Unable to open task details."));
            }
          );
        }}
        onOpenChat={() => {
          closeAgentDetailModals(this.app);
          this.manager.setActiveSession(this.session.internalId);
          const chatLeaf = this.app.workspace.getLeavesOfType(CHAT_AGENT_VIEWTYPE)[0];
          if (chatLeaf) this.app.workspace.revealLeaf(chatLeaf);
        }}
      />
    );
  }
}

interface TaskDetailModalContentProps {
  backend: AgentChatBackend;
  chatId: string;
  toolCallId: string;
  app: App;
  onClose: () => void;
  onOpenTask: (toolCallId: string) => void;
  onOpenChat: () => void;
}

const TaskDetailModalContent: React.FC<TaskDetailModalContentProps> = ({
  backend,
  chatId,
  toolCallId,
  app,
  onClose,
  onOpenTask,
  onOpenChat,
}) => {
  const { tasks, pendingToolPermissions, pendingAskUserQuestions } =
    useAgentChatRuntimeState(backend);
  const task = tasks.find((entry) => entry.toolCallId === toolCallId);
  if (!task)
    return (
      <div className="tw-p-3 tw-text-sm tw-text-muted">{t("Task details are unavailable.")}</div>
    );
  return (
    <TooltipProvider>
      <AgentTasksProvider tasks={tasks} openTask={onOpenTask}>
        <TaskDetailView
          task={task}
          status={taskDisplayStatus(task, pendingToolPermissions)}
          messages={backend.getTaskMessages(toolCallId)}
          app={app}
          chatId={chatId}
          onBack={onClose}
          onOpenChat={onOpenChat}
          chatAwaitsAnswer={pendingToolPermissions.length > 0 || pendingAskUserQuestions.length > 0}
        />
      </AgentTasksProvider>
    </TooltipProvider>
  );
};

export async function openTaskModal(
  app: App,
  manager: AgentSessionManager,
  sessionId: string,
  toolCallId: string
): Promise<TaskDetailModal> {
  const session = manager.getSession(sessionId);
  const backend = manager.getChatUIState(sessionId);
  if (!session || !backend) throw new Error("Task source chat is unavailable");
  return openAgentDetailModal(
    app,
    taskKey(session.chatInputId, toolCallId),
    () => new TaskDetailModal(app, manager, session, backend, toolCallId)
  );
}

function taskKey(chatInputId: string, toolCallId: string): string {
  return `task:${chatInputId}\n${toolCallId}`;
}
