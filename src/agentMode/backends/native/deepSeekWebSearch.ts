import type { App } from "obsidian";
import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { RequestRedactor } from "@/LLMProviders/requestRedaction";
import { SecretStore } from "@/services/secretStore";
import { DEEPSEEK_API_ORIGIN } from "@/settings/webSearchProvider";
import { safeFetchNoThrow } from "@/utils";
import { WebSearchOutcomeUnknown, type WebSearchAttempt } from "@/agentMode/sdk/webSearchRouter";
import { isRecord } from "@/utils/obsidianInternals";

export async function searchDeepSeek(
  app: App,
  credential: string,
  query: string,
  signal: AbortSignal,
  beforeDispatch?: () => void
): Promise<WebSearchAttempt> {
  signal.throwIfAborted();
  if (!query.trim() || Array.from(query).length > 128)
    throw new Error("DeepSeek search queries must contain 1–128 characters.");

  return raceWithAbortSignal(
    SecretStore.getInstance(app).withSecret(credential, async (key) => {
      signal.throwIfAborted();
      beforeDispatch?.();
      const redactor = new RequestRedactor([key]);
      try {
        const response = await safeFetchNoThrow(`${DEEPSEEK_API_ORIGIN}/v1/tools/search`, {
          method: "POST",
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal,
        });
        if (!response.ok) return { failure: `DeepSeek search failed (HTTP ${response.status}).` };
        const result: unknown = await response.json().catch(() => null);
        if (!isRecord(result) || !Array.isArray(result.results))
          return { failure: "DeepSeek search returned an invalid response." };
        return { text: redactor.redact(JSON.stringify({ results: result.results })) };
      } catch (error) {
        const safe = redactor.error(error);
        throw new WebSearchOutcomeUnknown(safe instanceof Error ? safe.message : String(safe));
      }
    }),
    signal
  );
}
