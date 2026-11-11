import React from "react";
import { Cpu } from "lucide-react";
import type { UsageMetrics } from "@/agentMode/session/usageMetrics";
import {
  formatReportedCount,
  formatFirstTokenTime,
  formatTokenRate,
  formatCacheHitPercent,
} from "@/agentMode/ui/usageDisplay";
import { t } from "@/lib/i18n";

export interface UsageMetricsDetailsProps {
  metrics?: UsageMetrics;
  showRounds?: boolean;
}

export function UsageMetricsDetails({ metrics, showRounds = false }: UsageMetricsDetailsProps) {
  const models = [...new Set(metrics?.sources.map((source) => source.modelName || source.modelId))];
  const providers = [...new Set(metrics?.sources.map((source) => source.provider).filter(Boolean))];
  const fields = [
    ["Cache read tokens", formatReportedCount(metrics?.cacheReadTokens)],
    ["Time to first token", formatFirstTokenTime(metrics?.ttftMs)],
    ["Model requests", formatReportedCount(metrics?.steps)],
    ["Cache hit rate", formatCacheHitPercent(metrics?.cacheHitPercent)],
  ];

  return (
    <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-3 tw-text-ui-smaller">
      <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
        <Cpu className="tw-size-4 tw-shrink-0 tw-text-accent" />
        <div className="tw-min-w-0 tw-flex-1">
          <div className="tw-break-words tw-font-medium">
            {models.length ? models.join(" · ") : t("Model not recorded")}
          </div>
          {providers.length ? (
            <div className="tw-break-words tw-text-muted">{providers.join(" · ")}</div>
          ) : null}
          {metrics?.partial ? <div className="tw-text-muted">{t("Partial statistics")}</div> : null}
        </div>
      </div>
      <div className="tw-grid tw-grid-cols-3 tw-gap-2">
        {[
          ["Total tokens", formatReportedCount(metrics?.totalTokens)],
          ["Input tokens", formatReportedCount(metrics?.inputTokens)],
          ["Generation speed", formatTokenRate(metrics?.tokensPerSecond)],
        ].map(([label, value]) => (
          <div key={label} className="tw-min-w-0 tw-rounded-md tw-bg-secondary tw-p-2">
            <div className="tw-mb-1 tw-break-words tw-text-xs tw-text-muted">{t(label)}</div>
            <div className="tw-break-words tw-font-semibold tw-tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      <dl className="tw-m-0 tw-grid tw-grid-cols-2 tw-gap-x-3 tw-gap-y-2 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-pt-3">
        {fields.map(([label, value]) => (
          <div key={label} className="tw-min-w-0">
            <dt className="tw-text-muted">{t(label)}</dt>
            <dd className="tw-m-0 tw-break-words tw-tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>
      {showRounds ? (
        <div className="tw-text-muted">
          {t("{rounds} rounds · {steps} steps", {
            rounds: formatReportedCount(metrics?.rounds),
            steps: formatReportedCount(metrics?.steps),
          })}
          {metrics?.activeRounds
            ? ` · ${t("{count} in progress", { count: metrics.activeRounds })}`
            : ""}
        </div>
      ) : null}
    </div>
  );
}
