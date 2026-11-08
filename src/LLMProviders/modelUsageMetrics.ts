import { isRecord } from "@/utils/obsidianInternals";

export const STOP_REASONS = Object.freeze([
  "end_turn",
  "interrupted",
  "cancelled",
  "refusal",
  "max_tokens",
  "max_turn_requests",
  "max_task_requests",
  "quota_exhausted",
  "authentication_error",
  "context_limit",
  "request_error",
] as const);
export type StopReason = (typeof STOP_REASONS)[number];

export interface TokenUsageMetrics {
  totalTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ModelCallMetrics {
  id: string;
  requestIds: string[];
  requestAttempts?: Record<string, string>;
  startedAt?: number;
  firstTokenAt?: number;
  endedAt?: number;
  generationMs?: number;
  generationOutputTokens?: number;
  usagePartial?: boolean;
  dispatchUnknown?: boolean;
  thinkingDurationMs?: number;
  status: "running" | "completed" | "failed" | "cancelled";
  usage: TokenUsageMetrics;
}

export interface ModelCallObservation extends ModelCallMetrics {
  roundId: string;
  promptId?: string;
  sourceId: string;
  sourceName: string;
  kind: "main" | "subagent";
  purpose: "chat" | "compaction";
  modelId: string;
  modelName: string;
  modelSourceId?: string;
  provider?: string;
  taskGenerationId?: string;
  subagentId?: string;
  runId?: string;
  segmentSeq?: number;
}

export interface UsageMetrics extends TokenUsageMetrics {
  roundId?: string;
  promptId?: string;
  subagentId?: string;
  roundStartedAtMs?: number;
  roundDurationMs?: number;
  roundStopReason?: StopReason;
  cacheHitPercent?: number;
  ttftMs?: number;
  tokensPerSecond?: number;
  thinkingDurationMs?: number;
  toolCallCount?: number;
  hasActiveWork?: boolean;
  finalResponseSegmentSeq?: number;
  steps?: number;
  rounds?: number;
  activeRounds?: number;
  partial: boolean;
  sources: readonly UsageSourceMetrics[];
}

export interface UsageSourceMetrics extends Omit<UsageMetrics, "sources"> {
  sourceId: string;
  sourceName: string;
  kind: "main" | "subagent";
  purpose: "chat" | "compaction";
  modelId: string;
  modelName: string;
  modelSourceId?: string;
  provider?: string;
}

function number(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

// SDK 默认零不能证明服务商报告了零，真实原始字段决定可展示的用量范围。https://github.com/ItsDalk-Lane/Scribe/issues/52
export function reportedTokenUsage(payload: unknown): TokenUsageMetrics {
  if (!isRecord(payload)) return {};
  const message = isRecord(payload.message) ? payload.message : {};
  const response = isRecord(payload.response) ? payload.response : {};
  // 部分供应商把真实用量放在结束事件内，只查顶层会把已报告的读数误标为缺失。https://github.com/ItsDalk-Lane/Scribe/issues/52
  const delta = isRecord(payload.delta) ? payload.delta : {};
  const final = isRecord(payload.final_result) ? payload.final_result : {};
  const raw =
    payload.usageMetadata ??
    payload.usage ??
    message.usage ??
    response.usage ??
    delta.usage ??
    final.usage;
  const usage = isRecord(raw) ? raw : payload;
  const tokens = isRecord(usage.tokens) ? usage.tokens : usage;
  const prompt = isRecord(usage.prompt_tokens_details) ? usage.prompt_tokens_details : {};
  const inputDetails = isRecord(usage.input_tokens_details) ? usage.input_tokens_details : {};
  const read = number(
    prompt.cached_tokens ??
      inputDetails.cached_tokens ??
      usage.prompt_cache_hit_tokens ??
      usage.cached_tokens ??
      usage.cache_read_input_tokens ??
      usage.cachedContentTokenCount
  );
  const write = number(prompt.cache_write_tokens ?? usage.cache_creation_input_tokens);
  const anthropic = "cache_read_input_tokens" in usage || "cache_creation_input_tokens" in usage;
  let input = number(
    usage.prompt_tokens ??
      usage.promptTokenCount ??
      tokens.input_tokens ??
      payload.prompt_eval_count
  );
  if (anthropic && input !== undefined)
    input = read !== undefined && write !== undefined ? input + read + write : undefined;
  let output = number(usage.completion_tokens ?? tokens.output_tokens ?? payload.eval_count);
  const total = number(usage.total_tokens ?? usage.totalTokenCount);
  if ("usageMetadata" in payload) {
    const candidate = number(usage.candidatesTokenCount);
    const thought = number(usage.thoughtsTokenCount);
    output =
      total !== undefined && input !== undefined
        ? Math.max(0, total - input)
        : candidate !== undefined && thought !== undefined
          ? candidate + thought
          : undefined;
  }
  return {
    ...(input === undefined ? {} : { inputTokens: input }),
    ...(output === undefined ? {} : { outputTokens: output }),
    ...(read === undefined ? {} : { cacheReadTokens: read }),
    ...(write === undefined ? {} : { cacheWriteTokens: write }),
    ...(total !== undefined
      ? { totalTokens: total }
      : input !== undefined && output !== undefined
        ? { totalTokens: input + output }
        : {}),
  };
}
