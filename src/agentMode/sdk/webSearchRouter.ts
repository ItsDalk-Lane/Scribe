import type { WebSearchSource } from "@/settings/webSearchProvider";

export type WebSearchAttempt = { text: string } | { failure: string };
export type WebSearchRoute = (
  id: string,
  query: string,
  signal: AbortSignal
) => Promise<WebSearchAttempt>;

export class WebSearchOutcomeUnknown extends Error {}

const SOURCE_ORDER: readonly WebSearchSource[] = ["builtin", "mcp", "skill"];

export async function routeWebSearch(
  preferred: WebSearchSource,
  routes: Partial<Record<WebSearchSource, WebSearchRoute>>,
  id: string,
  query: string,
  signal: AbortSignal,
  beforeAttempt?: () => void
): Promise<{ text: string; source: WebSearchSource; failures: string[] }> {
  const failures: string[] = [];
  for (const source of [preferred, ...SOURCE_ORDER.filter((item) => item !== preferred)]) {
    signal.throwIfAborted();
    const route = routes[source];
    if (!route && source !== preferred) continue;
    beforeAttempt?.();
    const attempt = route
      ? await route(id, query, signal)
      : { failure: "No search source configured." };
    signal.throwIfAborted();
    // 只有来源明确失败才允许换来源；异常退出可能意味着远端仍在处理。https://github.com/ItsDalk-Lane/Scribe/issues/70
    if ("failure" in attempt) failures.push(`${source}: ${attempt.failure}`);
    else return { text: attempt.text, source, failures };
  }
  throw new Error(`Web search failed. ${failures.join(" ")}`);
}
