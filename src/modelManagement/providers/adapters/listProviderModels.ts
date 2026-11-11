import { t } from "@/lib/i18n";
import { RequestRedactor } from "@/LLMProviders/requestRedaction";
import type { ProviderType } from "@/modelManagement/types/catalog";
import { listAnthropicModels } from "./listAnthropicModels";
import { listGoogleModels } from "./listGoogleModels";
import type { ListModelsResult } from "./listOpenAICompatibleModels";
import { listOpenAICompatibleModels } from "./listOpenAICompatibleModels";

export interface ListProviderModelsOptions {
  apiKey?: string | null;
  extras?: Record<string, unknown>;
  timeoutMs?: number;
}

export async function listProviderModels(
  providerType: ProviderType,
  baseUrl: string,
  opts: ListProviderModelsOptions = {}
): Promise<ListModelsResult> {
  const redactor = new RequestRedactor([opts.apiKey ?? ""]);
  try {
    const result = await list();
    if (!result.ok) return { ...result, message: redactor.redact(result.message) };
    if (result.modelIds.some((id) => redactor.redact(id) !== id))
      return { ok: false, message: t("Model list contains credential values and was not loaded.") };
    return result;
  } catch (error) {
    throw redactor.error(error);
  }

  async function list(): Promise<ListModelsResult> {
    switch (providerType) {
      case "openai-compatible": {
        const openAIOrgId =
          typeof opts.extras?.openAIOrgId === "string" ? opts.extras.openAIOrgId : undefined;
        return listOpenAICompatibleModels(baseUrl, {
          apiKey: opts.apiKey,
          openAIOrgId,
          timeoutMs: opts.timeoutMs,
        });
      }
      case "anthropic":
        return listAnthropicModels(baseUrl, { apiKey: opts.apiKey, timeoutMs: opts.timeoutMs });
      case "google":
        return listGoogleModels(baseUrl, { apiKey: opts.apiKey, timeoutMs: opts.timeoutMs });
    }
  }
}
