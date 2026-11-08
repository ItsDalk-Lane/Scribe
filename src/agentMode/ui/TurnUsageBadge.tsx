import React, { useRef } from "react";
import { Database } from "lucide-react";
import type { UsageMetrics } from "@/agentMode/session/usageMetrics";
import { UsageMetricsDetails } from "@/agentMode/ui/UsageMetricsDetails";
import { formatCompactTokens, formatTokenRate } from "@/agentMode/ui/usageDisplay";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { t } from "@/lib/i18n";

export interface TurnUsageBadgeProps {
  metrics?: UsageMetrics;
}

export function TurnUsageBadge({ metrics }: TurnUsageBadgeProps) {
  const trigger = useRef<HTMLButtonElement>(null);
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          ref={trigger}
          variant="ghost2"
          size="fit"
          className="tw-flex tw-min-w-0 tw-max-w-full tw-items-center tw-gap-1 tw-text-xs tw-text-muted"
          aria-label={t("This reply's usage")}
        >
          <Database className="tw-size-3 tw-shrink-0" />
          <span className="tw-truncate tw-tabular-nums">
            {metrics?.totalTokens === undefined
              ? t("Usage unavailable")
              : `${formatCompactTokens(metrics.totalTokens)} token`}
            {" · "}
            {formatTokenRate(metrics?.tokensPerSecond)}
            {metrics?.partial ? ` · ${t("Partial statistics")}` : ""}
          </span>
        </Button>
      </PopoverTrigger>
      {/* 用量详情固定向上展开，空间不足时按定位器给出的上方高度滚动。https://github.com/ItsDalk-Lane/Scribe/issues/52 */}
      <PopoverContent
        side="top"
        avoidCollisions={false}
        align="start"
        container={trigger.current?.doc.body}
        className="tw-box-border tw-max-h-[min(32rem,75vh,var(--radix-popover-content-available-height))] tw-w-[28rem] tw-max-w-[calc(100vw-2rem)] tw-overflow-y-auto"
      >
        <UsageMetricsDetails metrics={metrics} />
      </PopoverContent>
    </Popover>
  );
}
