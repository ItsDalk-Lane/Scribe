import { TimeoutError } from "@/error";

export interface AbortSignalDeadline {
  signal: AbortSignal;
  dispose(): void;
}

// 目标运行时不能依赖 AbortSignal.any/timeout（移动端 WebView 兼容），这里手工组合外部取消与超时中止。
// https://github.com/ItsDalk-Lane/Scribe/issues/59
export function abortSignalWithDeadline(
  signal: AbortSignal | undefined,
  deadlineMs: number
): AbortSignalDeadline {
  const controller = new AbortController();
  const forward = () => controller.abort(signal?.reason);
  signal?.addEventListener("abort", forward, { once: true });
  if (signal?.aborted) forward();
  const timer =
    deadlineMs > 0
      ? window.setTimeout(
          () => controller.abort(new TimeoutError("Provider response", deadlineMs)),
          deadlineMs
        )
      : undefined;
  return {
    signal: controller.signal,
    dispose() {
      if (timer !== undefined) window.clearTimeout(timer);
      signal?.removeEventListener("abort", forward);
    },
  };
}
