import { t } from "@/lib/i18n";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentToolStatus, PermissionPrompt } from "@/agentMode/session/types";

export type TaskDisplayStatus =
  | AgentTask["status"]
  | "needs_approval"
  | "interrupted"
  | "max_turn_requests"
  | "quota_exhausted"
  | "authentication_error"
  | "context_limit"
  | "request_error";

const STATUS_LABELS: Record<TaskDisplayStatus, string> = {
  running: "Running",
  needs_approval: "Needs approval",
  completed: "Completed",
  failed: "Failed",
  stopped: "Stopped",
  interrupted: "Interrupted",
  max_turn_requests: "Step limit reached",
  quota_exhausted: "Service quota exhausted",
  authentication_error: "Authentication failed",
  context_limit: "Context limit reached",
  request_error: "Model request failed",
};

const BADGE_STATUS: Record<TaskDisplayStatus, AgentToolStatus> = {
  running: "in_progress",
  needs_approval: "pending",
  completed: "completed",
  failed: "failed",
  stopped: "cancelled",
  interrupted: "cancelled",
  max_turn_requests: "failed",
  quota_exhausted: "failed",
  authentication_error: "failed",
  context_limit: "failed",
  request_error: "failed",
};

export function taskTitle(task: AgentTask): string {
  return task.description || task.subagentType || task.command || t("Task");
}

export function taskLabel(task: AgentTask): string {
  if (task.kind === "command") return taskTitle(task);
  return [taskKindLabel(task), task.description].filter(Boolean).join(" · ");
}

export function taskKindLabel(task: AgentTask): string {
  if (task.kind === "command") return t("Command");
  return task.subagentType ?? t("Subagent");
}

export function taskStatusLabel(status: TaskDisplayStatus): string {
  return t(STATUS_LABELS[status]);
}

export function taskBadgeStatus(status: TaskDisplayStatus): AgentToolStatus {
  return BADGE_STATUS[status];
}

export function runningTasks(tasks: readonly AgentTask[]): AgentTask[] {
  return tasks.filter((task) => task.status === "running");
}

export function taskDisplayStatus(
  task: AgentTask,
  permissions: readonly PermissionPrompt[]
): TaskDisplayStatus {
  if (
    task.stopReason === "max_turn_requests" ||
    task.stopReason === "quota_exhausted" ||
    task.stopReason === "authentication_error" ||
    task.stopReason === "context_limit" ||
    task.stopReason === "request_error"
  )
    return task.stopReason;
  if (task.interrupted) return "interrupted";
  if (task.status !== "running") return task.status;
  const asking = permissions.some(
    (p) => typeof p.requester === "object" && p.requester.taskId === task.taskId
  );
  return asking ? "needs_approval" : "running";
}

export function permissionRequesterName(
  request: PermissionPrompt,
  tasks: readonly AgentTask[]
): string | undefined {
  const requester = request.requester;
  if (typeof requester !== "object") return undefined;
  const task = tasks.find((t) => t.taskId === requester.taskId);
  return task ? `${taskKindLabel(task)} "${taskTitle(task)}"` : undefined;
}
