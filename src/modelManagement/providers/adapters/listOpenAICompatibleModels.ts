import { openaiCompatibleModelsUrl } from "@/modelManagement/providers/adapters/openaiCompatibleModelsUrl";
import { t } from "@/lib/i18n";
import {
  fetchWithListModelsTimeout,
  parseModelListResponse,
  type ListModelsResponseResult,
  type ListModelsResult,
} from "./listModelsHttp";

export type { ListModelsResult } from "./listModelsHttp";

export interface ListOpenAICompatibleModelsOptions {
  apiKey?: string | null;
  openAIOrgId?: string;
  timeoutMs?: number;
}

export async function listOpenAICompatibleModels(
  baseUrl: string,
  opts: ListOpenAICompatibleModelsOptions = {}
): Promise<ListModelsResult> {
  const trimmed = baseUrl.trim();
  if (!trimmed) {
    return { ok: false, message: t("Enter a base URL before fetching models.") };
  }
  const base = trimmed.replace(/\/+$/, "");

  const headers: Record<string, string> = {};
  if (opts.apiKey) headers["Authorization"] = `Bearer ${opts.apiKey}`;
  if (opts.openAIOrgId) headers["OpenAI-Organization"] = opts.openAIOrgId;

  const result = await attempt(openaiCompatibleModelsUrl(base), headers, opts.timeoutMs);
  if (result.ok) return { ok: true, modelIds: result.modelIds };

  const looksLikeMissingV1 = result.status === 404 && !/\/v1(\/|$)/.test(base);
  const message = looksLikeMissingV1
    ? t("{message} If your endpoint serves the OpenAI API under /v1, add it to the base URL.", {
        message: result.message,
      })
    : result.message;
  return { ok: false, message };
}

async function attempt(
  modelsUrl: string,
  headers: Record<string, string>,
  timeoutMs?: number
): Promise<ListModelsResponseResult> {
  try {
    const response = await fetchWithListModelsTimeout(
      modelsUrl,
      { method: "GET", headers },
      timeoutMs
    );
    return await parseModelListResponse(response, { listKey: "data", idKey: "id" });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err) };
  }
}
