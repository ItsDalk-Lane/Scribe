import { t } from "@/lib/i18n";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import { lastOutputLine } from "@/agentMode/session/taskOutputTail";
import type { PermissionPrompt } from "@/agentMode/session/types";
import { TaskStatusMark } from "@/agentMode/ui/TaskCard";
import { useTaskOutputTail } from "@/agentMode/ui/hooks/useTaskOutputTail";
import { runningTasks, taskDisplayStatus, taskLabel } from "@/agentMode/ui/taskDisplay";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { pluralize } from "@/agentMode/ui/toolSummaries";
import { Bot, ListTodo, Loader2, Square, Terminal } from "lucide-react";
import React, { useRef, useState } from "react";

const ROW_OUTPUT_BYTES = 4096;
export const STOP_UNAVAILABLE_UNTIL_STARTED = "Can stop once the task starts";
const HOVER_CLOSE_MS = 150;

interface RunningTasksIndicatorProps {
  tasks: readonly AgentTask[];
  permissions: readonly PermissionPrompt[];
  onOpenTask: (toolCallId: string) => void;
  onStopTask?: (taskId: string) => void;
  container?: HTMLElement | null;
  defaultOpen?: boolean;
}

export const RunningTasksIndicator: React.FC<RunningTasksIndicatorProps> = ({
  tasks,
  permissions,
  onOpenTask,
  onStopTask,
  container,
  defaultOpen = false,
}) => {
  const [open, setOpen] = useState(defaultOpen);
  const closeTimer = useRef<number | null>(null);
  const running = runningTasks(tasks);
  if (tasks.length === 0) {
    if (open) setOpen(false);
    return null;
  }

  const cancelClose = () => {
    if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
    closeTimer.current = null;
  };
  const show = () => {
    cancelClose();
    setOpen(true);
  };
  const hideSoon = () => {
    cancelClose();
    closeTimer.current = window.setTimeout(() => setOpen(false), HOVER_CLOSE_MS);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost2"
          size="fit"
          className="tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-ui-smaller tw-text-muted hover:tw-text-normal"
          onPointerEnter={show}
          onPointerLeave={hideSoon}
        >
          {running.length > 0 ? (
            <Loader2 className="tw-size-3 tw-animate-spin tw-text-loading" />
          ) : (
            <ListTodo className="tw-size-3" />
          )}
          {running.length > 0
            ? `${pluralize(running.length, "task")} ${t("running")}`
            : pluralize(tasks.length, "task")}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        side="top"
        align="start"
        collisionBoundary={container}
        collisionPadding={8}
        className="tw-max-h-[var(--radix-popover-content-available-height)] tw-w-96 tw-max-w-[var(--radix-popover-content-available-width)] tw-overflow-y-auto tw-p-1"
        onPointerEnter={show}
        onPointerLeave={hideSoon}
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        {["running", "completed"].map((group) => {
          const members = tasks
            .filter((task) => (task.status === "running") === (group === "running"))
            .slice()
            .reverse();
          if (members.length === 0) return null;
          const label = t(group === "running" ? "Running" : "Completed");
          return (
            <section key={group}>
              <h3 className="tw-m-0 tw-px-2 tw-py-1 tw-text-xs tw-font-medium tw-text-muted">
                {label}
              </h3>
              <ul aria-label={label} className="tw-m-0 tw-flex tw-list-none tw-flex-col tw-p-0">
                {members.map((task) => (
                  <li key={task.toolCallId} className="tw-flex tw-items-start tw-gap-1">
                    <RunningTaskRow
                      task={task}
                      status={taskDisplayStatus(task, permissions)}
                      onOpen={() => {
                        setOpen(false);
                        onOpenTask(task.toolCallId);
                      }}
                    />
                    {onStopTask && task.status === "running" ? (
                      <StopTaskButton taskId={task.taskId} onStopTask={onStopTask} />
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </PopoverContent>
    </Popover>
  );
};

const StopTaskButton: React.FC<{
  taskId: string | undefined;
  onStopTask: (taskId: string) => void;
}> = ({ taskId, onStopTask }) => {
  const disabled = taskId === undefined;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost2"
          size="fit"
          className={cn(
            "tw-mt-2 tw-shrink-0 tw-p-1 tw-text-muted",
            disabled ? "tw-cursor-not-allowed tw-opacity-50" : "hover:tw-text-error"
          )}
          aria-label={t("Stop task")}
          aria-disabled={disabled || undefined}
          onClick={() => {
            if (!disabled) onStopTask(taskId);
          }}
        >
          <Square className="tw-size-3 tw-fill-current" />
        </Button>
      </TooltipTrigger>
      {disabled ? (
        <TooltipContent side="left">{STOP_UNAVAILABLE_UNTIL_STARTED}</TooltipContent>
      ) : null}
    </Tooltip>
  );
};

interface RunningTaskRowProps {
  task: AgentTask;
  status: ReturnType<typeof taskDisplayStatus>;
  onOpen: () => void;
}

const RunningTaskRow: React.FC<RunningTaskRowProps> = ({ task, status, onOpen }) => {
  const Icon = task.kind === "command" ? Terminal : Bot;
  return (
    <button
      type="button"
      className={cn(
        "clickable-icon tw-flex tw-h-auto tw-min-w-0 tw-flex-1 tw-flex-col tw-items-stretch tw-gap-0.5",
        "tw-rounded tw-bg-transparent tw-px-2 tw-py-1.5 tw-text-left tw-shadow-none",
        "hover:tw-bg-modifier-hover focus-visible:tw-bg-modifier-hover"
      )}
      onClick={onOpen}
    >
      <span className="tw-flex tw-min-w-0 tw-items-center tw-gap-1.5 tw-text-sm">
        <Icon className="tw-size-3.5 tw-shrink-0 tw-text-normal" />
        <span className="tw-min-w-0 tw-flex-1 tw-truncate tw-text-normal">{taskLabel(task)}</span>
        <TaskStatusMark status={status} className="tw-text-normal" />
      </span>
      {task.kind === "command" ? <CommandOutputLine task={task} /> : null}
    </button>
  );
};

const CommandOutputLine: React.FC<{ task: AgentTask }> = ({ task }) => {
  const output = useTaskOutputTail(task.outputFile, {
    live: task.status === "running",
    maxBytes: ROW_OUTPUT_BYTES,
  });
  const line = lastOutputLine(output.text || task.savedOutput?.text || "");
  return (
    <span className="tw-truncate tw-pl-5 tw-font-mono tw-text-xs tw-text-muted">
      {line || t(task.status === "running" ? "No output yet" : "No output")}
    </span>
  );
};
