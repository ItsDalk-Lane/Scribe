export function formatContextWindow(context?: number): string {
  if (!context) return "";
  if (context >= 1_000_000) return `${(context / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (context >= 1_000) return `${Math.round(context / 1_000)}K`;
  return String(context);
}
