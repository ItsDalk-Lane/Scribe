import type { ModelCallObservation, UsageMetrics } from "@/LLMProviders/modelUsageMetrics";
export * from "@/LLMProviders/modelUsageMetrics";

function summarize(calls: readonly ModelCallObservation[]): UsageMetrics {
  const result: UsageMetrics = { partial: false, sources: [] };
  if (!calls.length) return result;
  for (const key of [
    "totalTokens",
    "inputTokens",
    "outputTokens",
    "cacheReadTokens",
    "cacheWriteTokens",
  ] as const) {
    const known = calls.flatMap((call) => (call.usage[key] === undefined ? [] : [call.usage[key]]));
    if (known.length) result[key] = known.reduce((sum, value) => sum + value, 0);
  }
  result.partial = calls.some(
    (call) =>
      call.status === "running" ||
      call.usagePartial === true ||
      call.usage.totalTokens === undefined ||
      call.usage.cacheReadTokens === undefined
  );
  const knownSteps = new Set(calls.flatMap((call) => call.requestIds)).size;
  if (knownSteps > 0 || !calls.some((call) => call.dispatchUnknown)) result.steps = knownSteps;
  const started = calls.flatMap((call) => (call.startedAt === undefined ? [] : [call.startedAt]));
  const first = calls.flatMap((call) =>
    call.firstTokenAt === undefined ? [] : [call.firstTokenAt]
  );
  if (started.length && first.length)
    result.ttftMs = Math.max(0, Math.min(...first) - Math.min(...started));
  const timed = calls.filter(
    (call) =>
      call.status !== "running" &&
      (call.generationOutputTokens ?? call.usage.outputTokens) !== undefined &&
      call.generationMs !== undefined &&
      call.generationMs > 0
  );
  if (timed.length)
    result.tokensPerSecond =
      (timed.reduce(
        (sum, call) => sum + (call.generationOutputTokens ?? call.usage.outputTokens ?? 0),
        0
      ) /
        timed.reduce((sum, call) => sum + call.generationMs!, 0)) *
      1000;
  if (timed.length !== calls.length) result.partial = true;
  const thoughts = calls.flatMap((call) =>
    call.thinkingDurationMs === undefined ? [] : [call.thinkingDurationMs]
  );
  if (thoughts.length) result.thinkingDurationMs = thoughts.reduce((sum, value) => sum + value, 0);
  if (
    calls.every(
      (call) =>
        !call.usagePartial &&
        call.usage.inputTokens !== undefined &&
        call.usage.cacheReadTokens !== undefined
    ) &&
    result.inputTokens! > 0
  )
    result.cacheHitPercent = (result.cacheReadTokens! / result.inputTokens!) * 100;
  result.hasActiveWork = calls.some((call) => call.status === "running");
  return result;
}

export function aggregateUsageMetrics(observations: readonly ModelCallObservation[]): UsageMetrics {
  const calls = [...new Map(observations.map((entry) => [entry.id, entry])).values()];
  const result = summarize(calls);
  const groups = new Map<string, ModelCallObservation[]>();
  for (const call of calls) {
    const key = JSON.stringify([
      call.sourceId,
      call.modelSourceId ?? call.provider ?? "",
      call.modelId,
      call.purpose,
    ]);
    const group = groups.get(key) ?? [];
    group.push(call);
    groups.set(key, group);
  }
  result.sources = [...groups].map(([key, group]) => {
    const first = group[0];
    return {
      ...summarize(group),
      sourceId: key,
      sourceName: first.sourceName,
      kind: first.kind,
      purpose: first.purpose,
      modelId: first.modelId,
      modelName: first.modelName,
      modelSourceId: first.modelSourceId,
      provider: first.provider,
    };
  });
  return result;
}
