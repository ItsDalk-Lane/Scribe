import type { SubagentRunStatus, SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";
import { groupSubagentSessions, subagentRunStatusLabel } from "@/agentMode/ui/subagentDisplay";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { v4 as uuidv4 } from "uuid";
import React, { useRef, useState } from "react";

const latestRunStatus = (session: SubagentSessionSnapshot): SubagentRunStatus | undefined =>
  session.runs[session.runs.length - 1]?.status;

export interface SubagentSessionsPanelProps {
  sessions: readonly SubagentSessionSnapshot[];
  onOpen: (subagentId: string) => void;
  onRefresh: () => Promise<void>;
}

export interface SubagentSessionsButtonProps extends SubagentSessionsPanelProps {
  container?: HTMLElement | null;
}

export function SubagentSessionsButton({ container, ...props }: SubagentSessionsButtonProps) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost2" size="fit" className="tw-text-ui-smaller tw-text-muted">
          {t("Subagents")} ({props.sessions.length})
        </Button>
      </PopoverTrigger>
      <PopoverContent
        container={container}
        side="top"
        align="start"
        collisionBoundary={container}
        collisionPadding={8}
        className="tw-max-h-[var(--radix-popover-content-available-height)] tw-w-96 tw-max-w-[var(--radix-popover-content-available-width)] tw-overflow-y-auto tw-p-0"
      >
        <SubagentSessionsPanel
          {...props}
          onOpen={(subagentId) => {
            setOpen(false);
            props.onOpen(subagentId);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

export interface TaskBudgetContinuationProps {
  onContinue: (requestId: string) => Promise<void>;
}

export function TaskBudgetContinuation({ onContinue }: TaskBudgetContinuationProps) {
  const [requestId] = useState(() => uuidv4());
  const [pending, setPending] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  return (
    <div className="tw-flex tw-flex-col tw-gap-1 tw-p-2">
      {accepted ? (
        <span role="status" className="tw-text-xs tw-text-muted">
          {t(
            "Request allowance added. Explicitly continue when you are ready; saved history is unchanged."
          )}
        </span>
      ) : (
        <>
          <Button
            variant="secondary"
            size="fit"
            disabled={pending}
            onClick={() => {
              // 重复点击不得给同一任务重复加额：https://github.com/ItsDalk-Lane/Scribe/issues/50
              if (inFlight.current) return;
              inFlight.current = true;
              setPending(true);
              setError("");
              void onContinue(requestId)
                .then(
                  () => setAccepted(true),
                  (failure: unknown) =>
                    setError(failure instanceof Error ? failure.message : String(failure))
                )
                .finally(() => {
                  inFlight.current = false;
                  setPending(false);
                });
            }}
          >
            {t("Add model requests for this task")}
          </Button>
          <span className="tw-text-xs tw-text-muted">
            {t("Adds the configured request allowance without automatically running the task.")}
          </span>
        </>
      )}
      {error ? (
        <span role="alert" className="tw-break-words tw-text-xs tw-text-error">
          {error}
        </span>
      ) : null}
    </div>
  );
}

interface SubagentSessionRowProps {
  session: SubagentSessionSnapshot;
  onOpen: (subagentId: string) => void;
}

const SubagentSessionRow: React.FC<SubagentSessionRowProps> = ({ session, onOpen }) => {
  const status = latestRunStatus(session);
  return (
    <Button
      variant="ghost2"
      size="fit"
      className={cn(
        "tw-flex tw-w-full tw-items-center tw-justify-between tw-gap-2 tw-rounded-md tw-px-2 tw-py-1 tw-text-left"
      )}
      onClick={() => onOpen(session.id)}
    >
      <span className="tw-min-w-0 tw-flex-1 tw-truncate">{session.name}</span>
      <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-1 tw-text-xs tw-text-muted">
        {session.recoveryBlocked ? (
          <span className="tw-text-warning">{t("Recovery blocked")}</span>
        ) : null}
        {session.retention === "archived" ? <span>{t("Archived")}</span> : null}
        {status ? <span>{subagentRunStatusLabel(status)}</span> : null}
      </span>
    </Button>
  );
};

export function SubagentSessionsPanel({ sessions, onOpen, onRefresh }: SubagentSessionsPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const groups = groupSubagentSessions(sessions);
  const refresh = (): void => {
    setPending(true);
    setError("");
    void onRefresh()
      .catch((failure: unknown) => {
        setError(failure instanceof Error ? failure.message : String(failure));
      })
      .finally(() => setPending(false));
  };
  const renderGroup = (
    title: string,
    items: readonly SubagentSessionSnapshot[]
  ): React.ReactNode =>
    items.length > 0 ? (
      <section aria-label={title} className="tw-flex tw-min-w-0 tw-flex-col tw-gap-1">
        <h3 className="tw-m-0 tw-px-1 tw-text-xs tw-font-semibold tw-text-muted">{title}</h3>
        {items.map((session) => (
          <SubagentSessionRow key={session.id} session={session} onOpen={onOpen} />
        ))}
      </section>
    ) : null;

  return (
    <div className="tw-flex tw-max-h-[70vh] tw-min-h-0 tw-flex-col tw-gap-2 tw-overflow-y-auto tw-p-3">
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-2">
        <span className="tw-px-1 tw-text-sm tw-font-semibold">{t("Subagents")}</span>
        <Button variant="ghost2" size="fit" disabled={pending} onClick={refresh}>
          {t("Refresh child sessions")}
        </Button>
      </div>
      {error ? (
        <div
          role="alert"
          className="tw-whitespace-pre-wrap tw-break-words tw-text-sm tw-text-error"
        >
          {error}
        </div>
      ) : null}
      {sessions.length === 0 ? (
        <p className="tw-m-0 tw-px-1 tw-text-sm tw-text-muted">{t("No child sessions yet.")}</p>
      ) : (
        <>
          {renderGroup(t("Running"), groups.running)}
          {renderGroup(t("Completed"), groups.completed)}
        </>
      )}
    </div>
  );
}
