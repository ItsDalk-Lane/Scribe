import type { PromptContent, StoredAgentDisplayMessage } from "@/agentMode/session/types";

export type SubagentRunStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "awaiting_input"
  | "stopping"
  | "completed"
  | "failed"
  | "interrupted"
  | "stopped";

export type SubagentRetention = "retained" | "archived";
export type SubagentSendMode = "enqueue" | "wake" | "interrupt";
export type SubagentMessageKind =
  | "instruction"
  | "progress"
  | "discovery"
  | "question"
  | "blocked"
  | "result";

export interface SubagentUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
}

export interface SubagentMessagePayload {
  content: PromptContent[];
  context?: StoredAgentDisplayMessage["context"];
}

export interface SubagentMessage {
  roundId?: string;
  promptId?: string;
  id: string;
  sequence: number;
  subagentId: string;
  runId?: string;
  taskGenerationId: string;
  direction: "to_parent" | "to_child";
  sender: "main" | "user" | "subagent";
  kind: SubagentMessageKind;
  text: string;
  payload?: SubagentMessagePayload;
  state: "accepted" | "delivered" | "withdrawn" | "replied";
  acceptedAt: number;
  deliveredAt?: number;
  deliverySeq?: number;
  replyTo?: string;
}

export interface SubagentRunSnapshot {
  roundId?: string;
  promptId?: string;
  id: string;
  taskGenerationId: string;
  toolCallId: string;
  status: SubagentRunStatus;
  createdAt: number;
  startedAt?: number;
  endedAt?: number;
  resultId?: string;
  resultDelivered?: boolean;
  deliveryBlocked?: boolean;
  result?: string;
  stopReason?: string;
  usage: SubagentUsage;
}

export interface SubagentSessionSnapshot {
  id: string;
  parentSessionId: string;
  projectId?: string;
  name: string;
  modelId: string;
  cwd: string;
  retention: SubagentRetention;
  createdAt: number;
  updatedAt: number;
  runs: readonly SubagentRunSnapshot[];
  messages: readonly SubagentMessage[];
  recoveryBlocked?: string;
}

export interface SubagentSendInput {
  sessionId: string;
  subagentId: string;
  text: string;
  mode: SubagentSendMode;
  messageId?: string;
  payload?: SubagentMessagePayload;
  skills?: string[];
}

export interface SubagentDispatchResult {
  subagentId: string;
  runId?: string;
  messageId?: string;
  status: SubagentRunStatus | "enqueued";
}

export interface SubagentWaitResult {
  reason: "message" | "completed" | "user_input" | "cancelled" | "timeout";
  sequence: number;
  subagentId?: string;
  runId?: string;
  message?: SubagentMessage;
}
