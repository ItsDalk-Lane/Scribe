import type { SubagentMessagePayload } from "@/agentMode/session/subagentTypes";
import { logError, logWarn } from "@/logger";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentSession, AgentTask } from "@/agentMode/session/AgentSession";
import type {
  AgentChatMessage,
  AgentQuestionAnswers,
  AgentTodoListEntry,
  AskUserQuestionPrompt,
  BackendState,
  CurrentPlan,
  PermissionPrompt,
  PlanDecisionAction,
  PromptContent,
  PlanUsage,
  QueuedPrompt,
  SessionUsage,
} from "@/agentMode/session/types";
import type { MessageContext } from "@/types/message";
import type {
  SubagentDispatchResult,
  SubagentSendMode,
  SubagentSessionSnapshot,
} from "@/agentMode/session/subagentTypes";

export class AgentChatUIState implements AgentChatBackend {
  private listeners = new Set<() => void>();
  private currentTurn: Promise<unknown> | null = null;

  constructor(private readonly session: AgentSession) {
    this.session.subscribe({
      onMessagesChanged: () => this.notifyListeners(),
      onStatusChanged: () => this.notifyListeners(),
      onModelChanged: () => this.notifyListeners(),
      onCurrentPlanChanged: () => this.notifyListeners(),
      onCurrentTodoListChanged: () => this.notifyListeners(),
      onQueuedPromptsChanged: () => this.notifyListeners(),
      onTasksChanged: () => this.notifyListeners(),
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(): void {
    for (const l of this.listeners) {
      try {
        l();
      } catch (e) {
        logWarn("[AgentChatUIState] listener threw", e);
      }
    }
  }

  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[]
  ): { id: string; turn: Promise<void> } {
    const { userMessageId, turn } = this.session.sendPrompt(text, context, promptContent);
    this.notifyListeners();
    const wrapped = turn.then(
      () => undefined,
      (err) => {
        logError("[AgentMode] turn failed", err);
      }
    );
    this.currentTurn = turn;
    return { id: userMessageId, turn: wrapped };
  }

  acceptsMidTurnMessages(): boolean {
    return this.session.acceptsMidTurnPrompts();
  }

  getQueuedPrompts(): readonly QueuedPrompt[] {
    return this.session.getQueuedPrompts();
  }

  canWithdrawMessages(): boolean {
    return this.session.canWithdrawPrompts();
  }

  withdrawMessage(id: string): Promise<void> {
    return this.session.withdrawPrompt(id);
  }

  takeWithdrawnPrompts(): readonly QueuedPrompt[] {
    return this.session.takeWithdrawnPrompts();
  }

  async cancel(): Promise<void> {
    await this.session.cancel();
  }

  async sendWaitingNow(): Promise<void> {
    await this.session.cancel({ keepUnread: true });
  }

  isReplyRunning(): boolean {
    return this.session.isReplyRunning();
  }

  async deleteMessage(id: string): Promise<boolean> {
    const status = this.session.getStatus();
    if (status === "running" || status === "awaiting_permission") {
      logWarn("[AgentChatUIState] delete refused while turn is in flight");
      return false;
    }
    const ok = this.session.store.deleteMessage(id);
    if (ok) this.notifyListeners();
    return ok;
  }

  clearMessages(): void {
    this.session.store.clear();
    this.notifyListeners();
  }

  getMessages(): AgentChatMessage[] {
    return this.session.store.getDisplayMessages();
  }

  getTasks(): readonly AgentTask[] {
    return this.session.getTasks();
  }

  getTaskMessages(toolCallId: string): readonly AgentChatMessage[] {
    return this.session.getTaskMessages(toolCallId);
  }

  canStopTasks(): boolean {
    return this.session.canStopTasks();
  }

  stopTask(taskId: string): Promise<void> {
    return this.session.stopTask(taskId);
  }

  getSubagentSessions(): readonly SubagentSessionSnapshot[] {
    return this.session.getSubagentSessions();
  }

  startIndependentTask(): Promise<void> {
    return this.session.startIndependentTask();
  }

  continueTaskBudget(taskGenerationId?: string, requestId?: string): Promise<void> {
    return this.session.continueTaskBudget(taskGenerationId, requestId);
  }

  confirmSubagentRecovery(subagentId: string): Promise<void> {
    return this.session.confirmSubagentRecovery(subagentId);
  }

  refreshSubagentSessions(): Promise<void> {
    return this.session.refreshSubagentSessions();
  }

  sendSubagentMessage(
    subagentId: string,
    text: string,
    mode: SubagentSendMode,
    messageId?: string,
    payload?: SubagentMessagePayload
  ): Promise<SubagentDispatchResult> {
    return payload
      ? this.session.sendSubagentMessage(subagentId, text, mode, messageId, payload)
      : this.session.sendSubagentMessage(subagentId, text, mode, messageId);
  }

  stopSubagent(subagentId: string): Promise<void> {
    return this.session.stopSubagent(subagentId);
  }

  setSubagentArchived(subagentId: string, archived: boolean): Promise<void> {
    return this.session.setSubagentArchived(subagentId, archived);
  }

  deleteSubagentSession(subagentId: string): Promise<void> {
    return this.session.deleteSubagentSession(subagentId);
  }

  isStarting(): boolean {
    return this.session.getStatus() === "starting";
  }

  isTurnInFlight(): boolean {
    const status = this.session.getStatus();
    return status === "running" || status === "awaiting_permission";
  }

  getBackendState(): BackendState | null {
    return this.session.getState();
  }

  canSwitchModel(): boolean | null {
    return this.session.canSwitchModel();
  }

  canSwitchEffort(): boolean | null {
    return this.session.canSwitchEffort();
  }

  canSwitchMode(): boolean | null {
    return this.session.canSwitchMode();
  }

  hasPendingPlanPermission(): boolean {
    return this.session.hasPendingPlanPermission();
  }

  getPendingToolPermissions(): PermissionPrompt[] {
    return this.session.getPendingToolPermissions();
  }

  resolveToolPermission(toolCallId: string, optionId: string): void {
    this.session.resolveToolPermission(toolCallId, optionId);
    this.notifyListeners();
  }

  getPendingAskUserQuestions(): AskUserQuestionPrompt[] {
    return this.session.getPendingAskUserQuestions();
  }

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void {
    this.session.resolveAskUserQuestion(requestId, answers);
    this.notifyListeners();
  }

  getCurrentPlan(): CurrentPlan | null {
    return this.session.getCurrentPlan();
  }

  getCurrentTodoList(): AgentTodoListEntry[] | null {
    return this.session.getCurrentTodoList();
  }

  getSessionUsage(): SessionUsage | null {
    return this.session.getSessionUsage();
  }

  getPlanUsage(): PlanUsage | null {
    return this.session.getPlanUsage();
  }

  async resolvePlanProposal(
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string,
    expectedRevision?: number
  ): Promise<void> {
    const plan = this.session.getCurrentPlan();
    if (
      !plan ||
      plan.id !== proposalId ||
      plan.decision !== "pending" ||
      (expectedRevision !== undefined && plan.revision !== expectedRevision)
    )
      return;
    if (!plan.permissionGated || !plan.pendingToolCallId) {
      logWarn("[AgentChatUIState] non-gated plan card has no resolution path");
      return;
    }
    if (!this.session.hasPendingPlanPermission()) return;
    const trimmedFeedback = decision === "feedback" ? feedbackText?.trim() : undefined;
    const sendNextTurn = !!trimmedFeedback && this.session.planFeedbackDelivery === "next_turn";
    const pendingTurn = this.currentTurn;
    this.session.resolvePlanProposalPermission(
      plan.pendingToolCallId,
      decision === "approve",
      sendNextTurn ? undefined : trimmedFeedback
    );
    this.session.finalizePlanDecision(plan.id, decision, trimmedFeedback);
    this.notifyListeners();
    if (sendNextTurn) {
      await pendingTurn;
      await this.sendMessage(trimmedFeedback).turn;
    }
  }
}
