import type { SubagentMessagePayload } from "@/agentMode/session/subagentTypes";
import type { MessageContext } from "@/types/message";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import type {
  SubagentDispatchResult,
  SubagentSendMode,
  SubagentSessionSnapshot,
} from "@/agentMode/session/subagentTypes";
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
} from "./types";

export interface AgentChatBackend {
  subscribe(listener: () => void): () => void;
  sendMessage(
    text: string,
    context?: MessageContext,
    promptContent?: PromptContent[]
  ): { id: string; turn: Promise<void> };
  acceptsMidTurnMessages(): boolean;
  getQueuedPrompts(): readonly QueuedPrompt[];
  canWithdrawMessages(): boolean;
  withdrawMessage(id: string): Promise<void>;
  takeWithdrawnPrompts(): readonly QueuedPrompt[];
  cancel(): Promise<void>;
  sendWaitingNow(): Promise<void>;
  deleteMessage(id: string): Promise<boolean>;
  clearMessages(): void;
  getMessages(): AgentChatMessage[];
  getTasks(): readonly AgentTask[];
  getTaskMessages(toolCallId: string): readonly AgentChatMessage[];
  canStopTasks(): boolean;
  stopTask(taskId: string): Promise<void>;
  startIndependentTask?(): Promise<void>;
  continueTaskBudget?(taskGenerationId?: string, requestId?: string): Promise<void>;
  confirmSubagentRecovery?(subagentId: string): Promise<void>;
  getSubagentSessions?(): readonly SubagentSessionSnapshot[];
  refreshSubagentSessions?(): Promise<void>;
  sendSubagentMessage?(
    subagentId: string,
    text: string,
    mode: SubagentSendMode,
    messageId?: string,
    payload?: SubagentMessagePayload
  ): Promise<SubagentDispatchResult>;
  stopSubagent?(subagentId: string): Promise<void>;
  setSubagentArchived?(subagentId: string, archived: boolean): Promise<void>;
  deleteSubagentSession?(subagentId: string): Promise<void>;

  isStarting(): boolean;
  isTurnInFlight(): boolean;
  isReplyRunning(): boolean;

  getBackendState(): BackendState | null;
  canSwitchModel(): boolean | null;
  canSwitchEffort(): boolean | null;
  canSwitchMode(): boolean | null;

  resolvePlanProposal(
    proposalId: string,
    decision: PlanDecisionAction,
    feedbackText?: string,
    expectedRevision?: number
  ): Promise<void>;

  getCurrentPlan(): CurrentPlan | null;

  getCurrentTodoList(): AgentTodoListEntry[] | null;

  getSessionUsage(): SessionUsage | null;

  getPlanUsage(): PlanUsage | null;

  hasPendingPlanPermission(): boolean;

  getPendingToolPermissions(): PermissionPrompt[];

  resolveToolPermission(toolCallId: string, optionId: string): void;

  getPendingAskUserQuestions(): AskUserQuestionPrompt[];

  resolveAskUserQuestion(requestId: string, answers: AgentQuestionAnswers): void;
}
