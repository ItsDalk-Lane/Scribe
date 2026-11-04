import { t } from "@/lib/i18n";
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

function formatTokens(count: number): string {
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return count.toLocaleString();
}

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

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="ghost2"
          size="icon"
          className={cn(isWarning ? "tw-text-warning" : "tw-text-accent")}
          aria-label={t("Usage")}
        >
          {!hasUsage || hasContext ? <ContextRing fraction={fraction} /> : formatTokens(used)}
        </Button>
      </TooltipTrigger>
      <TooltipContent align="end" side="top" className="tw-w-80">
        <div className="tw-flex tw-flex-col tw-gap-2">
          {hasUsage && (
            <>
              <div className="tw-flex tw-items-center tw-justify-between tw-gap-3 tw-text-ui-smaller">
                <span className="tw-whitespace-nowrap tw-text-muted">{t("Context window")}</span>
                <span
                  className={cn(
                    "tw-whitespace-nowrap tw-tabular-nums",
                    isWarning && "tw-text-warning"
                  )}
                >
                  {hasContext
                    ? `${formatTokens(used)} / ${formatTokens(contextWindow)} (${percent}%)`
                    : formatTokens(used)}
                </span>
              </div>
              {hasContext && <Progress value={percent} className="tw-h-1.5" />}
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
