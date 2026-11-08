import { t } from "@/lib/i18n";

export function formatReportedCount(value: number | undefined): string {
  return value === undefined ? t("Not recorded") : value.toLocaleString();
}

export function formatCompactTokens(value: number | undefined): string {
  if (value === undefined) return t("Not recorded");
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString();
}

export function formatTokenRate(value: number | undefined): string {
  return value === undefined
    ? t("Speed unavailable")
    : t("{rate} token/s", { rate: value.toFixed(1) });
}

export function formatFirstTokenTime(value: number | undefined): string {
  return value === undefined
    ? t("Not recorded")
    : t("{time}s", { time: (value / 1000).toFixed(1) });
}

export function formatCacheHitPercent(value: number | undefined): string {
  return value === undefined ? t("Not recorded") : `${value.toFixed(0)}%`;
}
