import { t } from "@/lib/i18n";
import { UsageMetricsDetails } from "@/agentMode/ui/UsageMetricsDetails";
import { formatCompactTokens, formatCacheHitPercent } from "@/agentMode/ui/usageDisplay";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { SessionUsage } from "@/agentMode/session/types";
import { useSessionUsage } from "@/agentMode/ui/hooks/useSessionUsage";
import { TokenCounter } from "@/components/chat-components/TokenCounter";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import * as React from "react";

interface AgentContextMeterProps {
  backend: AgentChatBackend;
}

const WARNING_THRESHOLD = 0.85;

const RING_RADIUS = 6;
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS;

function ContextRing({ fraction }: { fraction: number }) {
  const dashOffset = RING_CIRCUMFERENCE * (1 - fraction);
  return (
    <svg
      className="tw-size-4 -tw-rotate-90"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <circle
        cx={8}
        cy={8}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        className="tw-opacity-20"
      />
      <circle
        cx={8}
        cy={8}
        r={RING_RADIUS}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeDasharray={RING_CIRCUMFERENCE}
        strokeDashoffset={dashOffset}
      />
    </svg>
  );
}

export interface UsageMeterProps {
  usage: SessionUsage | null;
  contextWindow: number | null;
}

export function UsageMeter({ usage, contextWindow }: UsageMeterProps) {
  const hasUsage = !!usage;
  const hasContext = contextWindow !== null;
  const used = hasUsage && Number.isFinite(usage.usedTokens) ? usage.usedTokens : 0;
  const fraction = hasContext ? Math.min(1, Math.max(0, used / contextWindow)) : 0;
  const percent = Math.round(fraction * 100);
  const isWarning = hasContext && fraction >= WARNING_THRESHOLD;
  const cumulative = usage?.metrics?.totalTokens ?? usage?.cumulativeTotalTokens;
  const hasCumulative =
    typeof cumulative === "number" && Number.isFinite(cumulative) && cumulative >= 0;

  const hasLedger = hasCumulative || usage?.metrics !== undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost2"
          size={hasLedger ? "fit" : "icon"}
          className={cn(
            "tw-flex tw-items-center tw-gap-1",
            isWarning ? "tw-text-warning" : "tw-text-muted"
          )}
          aria-label={t("Usage")}
        >
          {!hasUsage || hasContext || hasLedger ? (
            <ContextRing fraction={fraction} />
          ) : (
            formatCompactTokens(used)
          )}
          {hasLedger ? (
            <span className="tw-whitespace-nowrap tw-text-xs">
              {formatCompactTokens(cumulative)} token ·{" "}
              {t("Cache hit {percent}", {
                percent: formatCacheHitPercent(usage?.metrics?.cacheHitPercent),
              })}
            </span>
          ) : null}
        </Button>
      </TooltipTrigger>
      <TooltipContent
        align="end"
        side="top"
        className="tw-max-h-[75vh] tw-w-[28rem] tw-max-w-[calc(100vw-2rem)] tw-overflow-y-auto"
      >
        <div className="tw-flex tw-flex-col tw-gap-2">
          {hasUsage && (
            <>
              {hasContext || used > 0 ? (
                <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-ui-smaller">
                  <span className="tw-whitespace-nowrap tw-text-muted">{t("Context window")}</span>
                  <span
                    className={cn(
                      "tw-whitespace-nowrap tw-tabular-nums",
                      isWarning && "tw-text-warning"
                    )}
                  >
                    {hasContext
                      ? `${formatCompactTokens(used)} / ${formatCompactTokens(contextWindow)} (${percent}%)`
                      : formatCompactTokens(used)}
                  </span>
                </div>
              ) : (
                <span className="tw-text-ui-smaller tw-text-muted">
                  {t("Current context usage is unavailable")}
                </span>
              )}
              {hasContext && <Progress value={percent} className="tw-h-1.5" />}
              {usage.metrics ? (
                <UsageMetricsDetails metrics={usage.metrics} showRounds />
              ) : hasCumulative ? (
                <>
                  <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-ui-smaller">
                    <span className="tw-text-muted">{t("Total tokens")}</span>
                    <span>{formatCompactTokens(cumulative)}</span>
                  </div>
                  <div className="tw-text-ui-smaller tw-text-muted">
                    {t("Cache hit {percent}", { percent: t("Not recorded") })}
                  </div>
                  {(
                    [
                      ["Cumulative input", usage.cumulativeInputTokens],
                      ["Cumulative output", usage.cumulativeOutputTokens],
                      ["Cumulative cache read", usage.cumulativeCacheReadTokens],
                      ["Cumulative cache write", usage.cumulativeCacheWriteTokens],
                    ] as const
                  ).map(([label, value]) =>
                    typeof value === "number" && Number.isFinite(value) ? (
                      <div
                        key={label}
                        className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-ui-smaller"
                      >
                        <span className="tw-text-muted">{t(label)}</span>
                        <span>{formatCompactTokens(value)}</span>
                      </div>
                    ) : null
                  )}
                </>
              ) : null}
            </>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  );
}

export default function AgentContextMeter({ backend }: AgentContextMeterProps) {
  const usage = useSessionUsage(backend);

  const rawWindow = usage?.contextWindow;
  const contextWindow =
    typeof rawWindow === "number" && Number.isFinite(rawWindow) && rawWindow > 0 ? rawWindow : null;
  const hasTokens = usage !== null && usage.usedTokens > 0;
  const cumulative = usage?.metrics?.totalTokens ?? usage?.cumulativeTotalTokens;
  if (
    usage?.metrics ||
    (typeof cumulative === "number" && Number.isFinite(cumulative) && cumulative >= 0)
  )
    return <UsageMeter usage={usage} contextWindow={contextWindow} />;

  if (contextWindow !== null) {
    return (
      <UsageMeter
        usage={hasTokens || contextWindow !== null ? usage : null}
        contextWindow={contextWindow}
      />
    );
  }

  if (!hasTokens) return null;
  return <TokenCounter tokenCount={usage.usedTokens} />;
}
