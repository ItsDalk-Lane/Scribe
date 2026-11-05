import { MissingApiKeyError, TimeoutError } from "@/error";
import { isRecord } from "@/utils/obsidianInternals";

export type ProviderFailureKind =
  | "quota"
  | "auth"
  | "context"
  | "transient"
  | "request"
  | "cancelled";

export interface ProviderRequestFailure {
  kind: ProviderFailureKind;
  status?: number;
  code?: string;
  retryAfterMs?: number;
}

export interface ProviderFailureInput {
  status?: number;
  payload?: unknown;
  cause?: unknown;
  headers?: Headers;
}

export class ProviderRequestError extends Error {
  readonly status?: number;
  readonly statusCode?: number;
  constructor(
    message: string,
    readonly failure: ProviderRequestFailure
  ) {
    super(message);
    this.name = failure.kind === "cancelled" ? "AbortError" : "ProviderRequestError";
    this.status = failure.status;
    this.statusCode = failure.status;
  }
}

const QUOTA_CODES = new Set([
  "insufficient_quota",
  "billing_error",
  "credit_balance_exhausted",
  "project_spend_limit_exceeded",
  "organization_spend_limit_exceeded",
  "organization_usage_limit_exceeded",
  "session_budget_exceeded",
  "billing_hard_limit_reached",
  "billing_not_active",
  "credit_balance_too_low",
  "credits_exhausted",
  "usage_limit_reached",
  "insufficient_balance",
  "insufficient_credits",
  "monthly_limit_exceeded",
  "quota_exceeded",
  "budget_exceeded",
  "usage_limit_exceeded",
  "insufficient_funds",
]);
const AUTH_CODES = new Set([
  "authentication_error",
  "invalid_api_key",
  "unauthenticated",
  "permission_denied",
]);
const CONTEXT_CODES = new Set([
  "context_length_exceeded",
  "context_window_exceeded",
  "max_context_length",
  "prompt_too_long",
  "input_too_long",
  "too_many_tokens",
]);
const TRANSIENT_CODES = new Set([
  "rate_limit_exceeded",
  "rate_limit_error",
  "overloaded_error",
  "server_error",
  "api_error",
  "server_overloaded",
  "server_is_overloaded",
  "service_unavailable_error",
  "slow_down",
  "internal_server_error",
  "temporarily_unavailable",
  "unavailable",
]);

export function classifyProviderFailure(input: ProviderFailureInput): ProviderRequestFailure {
  if (input.cause instanceof ProviderRequestError) return input.cause.failure;
  if (input.cause instanceof MissingApiKeyError) return { kind: "auth" };
  if (input.cause instanceof TimeoutError) return { kind: "transient" };
  const cause = isRecord(input.cause) ? input.cause : undefined;
  if (cause?.name === "AbortError") return { kind: "cancelled" };
  const envelope = isRecord(input.payload) ? input.payload : cause;
  const response = isRecord(envelope?.response) ? envelope.response : undefined;
  const payload = isRecord(envelope?.error)
    ? envelope.error
    : isRecord(response?.error)
      ? response.error
      : envelope;
  const status =
    input.status ??
    (typeof cause?.status === "number" ? cause.status : undefined) ??
    (typeof cause?.statusCode === "number" ? cause.statusCode : undefined) ??
    (typeof payload?.code === "number" ? payload.code : undefined);
  const details = Array.isArray(payload?.details) ? payload.details : [];
  const codes = [
    payload?.code,
    payload?.type,
    payload?.status,
    ...details.flatMap((detail: unknown) => (isRecord(detail) ? [detail.reason] : [])),
  ]
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.toLowerCase());
  const code =
    codes.find(
      (value) =>
        QUOTA_CODES.has(value) ||
        AUTH_CODES.has(value) ||
        CONTEXT_CODES.has(value) ||
        TRANSIENT_CODES.has(value)
    ) ?? codes[0];
  // 429 也可能是余额不足；信息不足时停止，避免重复消耗额度。https://github.com/ItsDalk-Lane/Scribe/issues/31
  const structuredKind: ProviderFailureKind | undefined = codes.some((value) =>
    QUOTA_CODES.has(value)
  )
    ? "quota"
    : codes.some((value) => AUTH_CODES.has(value))
      ? "auth"
      : codes.some((value) => CONTEXT_CODES.has(value))
        ? "context"
        : codes.some((value) => TRANSIENT_CODES.has(value))
          ? "transient"
          : undefined;
  const kind: ProviderFailureKind =
    structuredKind ??
    (status === 402
      ? "quota"
      : status === 401 || status === 403
        ? "auth"
        : status === 408 ||
            status === 409 ||
            (status !== undefined && status >= 500 && status <= 599)
          ? "transient"
          : "request");
  const retryMs = input.headers?.get("retry-after-ms");
  const retrySeconds = input.headers?.get("retry-after");
  const delay =
    retryMs !== null && retryMs !== undefined
      ? Number(retryMs)
      : retrySeconds
        ? Number.isFinite(Number(retrySeconds))
          ? Number(retrySeconds) * 1000
          : Date.parse(retrySeconds) - Date.now()
        : undefined;
  return {
    kind,
    ...(status === undefined ? {} : { status }),
    ...(code ? { code } : {}),
    ...(delay !== undefined && Number.isFinite(delay) && delay >= 0 ? { retryAfterMs: delay } : {}),
  };
}

export function waitForProviderRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    const timer = window.setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delayMs);
    signal?.addEventListener("abort", abort, { once: true });
    if (signal?.aborted) abort();
  });
}
