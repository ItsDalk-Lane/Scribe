import { t } from "@/lib/i18n";
import { ScribeSpinner } from "@/components/chat-components/ScribeSpinner";
import { cn } from "@/lib/utils";
import React, { useEffect, useRef, useState } from "react";

interface TurnDurationLayoutProps {
  inline?: boolean;
  label?: string;
  icon?: React.ReactNode;
}

interface RunningTurnDurationProps extends TurnDurationLayoutProps {
  status: "running";
  startedAtMs: number;
}

interface CompletedTurnDurationProps extends TurnDurationLayoutProps {
  status: "complete";
  durationMs: number;
}

type AgentTurnDurationIndicatorProps = RunningTurnDurationProps | CompletedTurnDurationProps;

export function formatWorkedDuration(durationMs: number): string {
  const safeDurationMs = Number.isFinite(durationMs) ? Math.max(0, durationMs) : 0;
  const totalSeconds = Math.floor(safeDurationMs / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = ((Math.floor(safeDurationMs / 100) % 600) / 10).toFixed(1);

  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

export const AgentTurnDurationIndicator: React.FC<AgentTurnDurationIndicatorProps> = (props) => {
  const [now, setNow] = useState(() => Date.now());
  const rootRef = useRef<HTMLDivElement>(null);
  const isRunning = props.status === "running";

  useEffect(() => {
    if (!isRunning) return;
    const intervalWindow = rootRef.current?.win;
    if (!intervalWindow) return;
    const id = intervalWindow.setInterval(() => setNow(Date.now()), 100);
    return () => intervalWindow.clearInterval(id);
  }, [isRunning]);

  // 总计时首帧至少显示十分之一秒，后续仍以真实经过时间计算，不给保存记录添加偏移。https://github.com/ItsDalk-Lane/Scribe/issues/52
  const durationMs = Math.max(100, isRunning ? now - props.startedAtMs : props.durationMs);

  return (
    <div
      ref={rootRef}
      className={cn(
        "tw-text-ui-medium",
        !props.inline && "tw-mb-2 tw-mt-1 tw-w-full max-md:tw-mb-1.5 max-md:tw-mt-0.5"
      )}
    >
      <div
        className={cn(
          "tw-flex tw-items-center tw-gap-1.5 tw-pl-1 tw-text-left tw-text-ui-small tw-text-muted",
          !props.inline && "tw-w-full"
        )}
      >
        <span className="tw-flex tw-size-icon-xs tw-shrink-0 tw-items-center tw-justify-start">
          {props.icon ?? <ScribeSpinner animated={isRunning} />}
        </span>
        <span>
          <span className={isRunning ? "scribe-shimmer-text tw-font-medium" : "tw-font-medium"}>
            {props.label ?? t("Worked for")}
          </span>{" "}
          <span className="tw-tabular-nums">{formatWorkedDuration(durationMs)}</span>
        </span>
        {isRunning ? (
          <span className="tw-sr-only" role="status" aria-live="polite">
            {props.label ?? t("Agent is working")}
          </span>
        ) : null}
      </div>
    </div>
  );
};
