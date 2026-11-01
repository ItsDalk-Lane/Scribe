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
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    pending ??= (async () => {
      const response = await transport(
        `${instanceUrl.replace(/\/+$/, "")}/api/v4/ai/third_party_agents/direct_access`,
        {
          method: "POST",
          signal,
          headers: {
            Authorization: `Bearer ${apiKey.replace(/^Bearer\s+/i, "")}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ feature_flags: { DuoAgentPlatformNext: true } }),
        }
      );
      if (!response.ok)
        throw Object.assign(new Error(`${t("Unexpected response")} (${response.status})`), {
          statusCode: response.status,
        });
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
        throw new Error(t("Unexpected response"));
      cached = { value, expiresAt: Date.now() + 25 * 60 * 1000 };
      return value;
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
