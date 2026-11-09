import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { abortSignalWithDeadline } from "@/utils/abortDeadline";
import { observeProviderResponse } from "@/LLMProviders/providerResponse";
import {
  classifyProviderFailure,
  ProviderRequestError,
  type ProviderRequestFailure,
} from "@/LLMProviders/providerRequestFailure";
import { t } from "@/lib/i18n";

interface GitlabToken {
  token: string;
  headers: Record<string, string>;
}

export function createGitlabAccessToken(
  instanceUrl: string,
  apiKey: string,
  transport: typeof fetch
): (signal?: AbortSignal) => Promise<GitlabToken> {
  let cached: { value: GitlabToken; expiresAt: number } | undefined;
  let pending: Promise<GitlabToken> | undefined;
  return async (signal) => {
    signal?.throwIfAborted();
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    pending ??= (() => {
      const deadline = abortSignalWithDeadline(undefined, 15_000);
      // 共享刷新必须自行结束，且迟到响应不得覆盖后续刷新。https://github.com/ItsDalk-Lane/Scribe/issues/61
      return raceWithAbortSignal(
        (async () => {
          const response = await transport(
            `${instanceUrl.replace(/\/+$/, "")}/api/v4/ai/third_party_agents/direct_access`,
            {
              method: "POST",
              signal: deadline.signal,
              headers: {
                Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ feature_flags: { DuoAgentPlatformNext: true } }),
            }
          );
          if (!response.ok) {
            let failure: ProviderRequestFailure | undefined;
            await observeProviderResponse(
              response,
              (value) => {
                failure = value;
              },
              deadline.signal
            );
            throw new ProviderRequestError(
              `${t("Unexpected response")} (${response.status})`,
              failure ?? classifyProviderFailure({ status: response.status })
            );
          }
          const value = (await response.json()) as GitlabToken;
          if (
            !value ||
            typeof value.token !== "string" ||
            !value.token ||
            !value.headers ||
            typeof value.headers !== "object" ||
            Array.isArray(value.headers) ||
            Object.values(value.headers).some((header) => typeof header !== "string")
          )
            throw new ProviderRequestError(t("Unexpected response"), { kind: "auth" });
          deadline.signal.throwIfAborted();
          cached = { value, expiresAt: Date.now() + 25 * 60 * 1000 };
          return value;
        })(),
        deadline.signal
      ).finally(() => {
        deadline.dispose();
        pending = undefined;
      });
    })();
    return signal ? raceWithAbortSignal(pending, signal) : pending;
  };
}
