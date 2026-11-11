import type { AgentTask } from "@/agentMode/session/AgentSession";
import { StatusBadge } from "@/agentMode/ui/ActionCard";
import {
  taskBadgeStatus,
  taskDisplayStatus,
  taskLabel,
  taskStatusLabel,
  type TaskDisplayStatus,
} from "@/agentMode/ui/taskDisplay";
import { AgentActivityCard } from "@/components/chat-components/AgentActivityCard";
import { cn } from "@/lib/utils";
import { t } from "@/lib/i18n";
import { Bot, Terminal } from "lucide-react";
import React from "react";

export interface TaskCardProps {
  task: AgentTask;
  onOpen: (toolCallId: string) => void;
}

export const TaskStatusMark: React.FC<{ status: TaskDisplayStatus; className?: string }> = ({
  status,
  className,
}) => (
  <span className={cn("tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-xs", className)}>
    {status === "needs_approval" ||
    status === "interrupted" ||
    status === "max_turn_requests" ||
    status === "max_task_requests" ||
    status === "queued" ||
    status === "awaiting_approval" ||
    status === "awaiting_input" ||
    status === "stopping" ||
    status === "quota_exhausted" ||
    status === "authentication_error" ||
    status === "context_limit" ||
    status === "request_error" ? (
      taskStatusLabel(status)
    ) : (
      <span className="tw-sr-only">{taskStatusLabel(status)}</span>
    )}
    <StatusBadge status={taskBadgeStatus(status)} />
  </span>
);

export const TaskCard: React.FC<TaskCardProps> = ({ task, onOpen }) => {
  const status = taskDisplayStatus(task, []);
  const label = taskLabel(task);
  return (
    <AgentActivityCard
      icon={task.kind === "command" ? Terminal : Bot}
      isRunning={status === "running"}
      label={
        <span className="tw-truncate">
          {status === "running"
            ? `${t(task.kind === "command" ? "Running command" : "Calling subagent")} · ${label}`
            : label}
        </span>
      }
      trailing={<TaskStatusMark status={status} className="tw-font-normal tw-text-muted" />}
      expandable
      onToggle={() => onOpen(task.toolCallId)}
    />
  );
};
