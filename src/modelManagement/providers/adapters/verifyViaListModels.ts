import { t } from "@/lib/i18n";
import { isPlainObject } from "@/modelManagement/catalog/modelsDevWire";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import {
  fetchWithListModelsTimeout,
  ListModelsTimeoutError,
  readBodySnippet,
  parseModelListResponse,
} from "./listModelsHttp";

export type VerificationResponseShape = "models" | "google-models" | "openrouter-key";

export interface VerifyViaListModelsOptions {
  responseShape: VerificationResponseShape;
  timeoutMs?: number;
}

export async function verifyViaListModels(
  url: string,
  headers: Record<string, string>,
  opts: VerifyViaListModelsOptions
): Promise<VerificationResult> {
  try {
    const response = await fetchWithListModelsTimeout(
      url,
      { method: "GET", headers },
      opts.timeoutMs
    );
    return await mapResponse(response, opts.responseShape);
  } catch (err) {
    return {
      ok: false,
      code: err instanceof ListModelsTimeoutError ? "timeout" : "network",
      message: err instanceof Error ? err.message : String(err),
      checkedAt: Date.now(),
    };
  }
}

async function mapResponse(
  response: Response,
  responseShape: VerificationResponseShape
): Promise<VerificationResult> {
  const { status } = response;
  const checkedAt = Date.now();
  if (status >= 200 && status < 300) {
    if (responseShape === "openrouter-key") {
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        return {
          ok: false,
          code: "invalid_response",
          message: t("Endpoint returned an unreadable response."),
          checkedAt,
        };
      }
      if (!isPlainObject(payload) || payload.error || !isPlainObject(payload.data)) {
        return {
          ok: false,
          code: "invalid_response",
          message: t("Endpoint did not return a valid verification response."),
          checkedAt,
        };
      }
      return { ok: true, checkedAt };
    }
    const result = await parseModelListResponse(
      response,
      responseShape === "google-models"
        ? { listKey: "models", idKey: "name" }
        : { listKey: "data", idKey: "id" }
    );
    return result.ok
      ? { ok: true, checkedAt }
      : { ok: false, code: "invalid_response", message: result.message, checkedAt };
  }
  if (status === 401) {
    return {
      ok: false,
      code: "invalid_api_key",
      message: t("Authentication failed — check your API key."),
      checkedAt,
    };
  }
  if (status === 403) {
    const detail = await readBodySnippet(response);
    const message = t("Access denied (HTTP 403). Check your account permissions.");
    return {
      ok: false,
      code: "permission_denied",
      message: detail ? `${message} ${detail}` : message,
      checkedAt,
    };
  }
  if (status === 429) {
    return {
      ok: false,
      code: "rate_limited",
      message: t("Rate limited — try again in a moment."),
      checkedAt,
    };
  }
  const snippet = await readBodySnippet(response);
  if (status === 404) {
    const message = t(
      "The check endpoint was not found (HTTP 404). Check the base URL; your API key and model access have not been verified."
    );
    return {
      ok: false,
      code: "verification_unavailable",
      message: snippet ? `${message} ${snippet}` : message,
      checkedAt,
    };
  }
  return {
    ok: false,
    code: "http_error",
    message: snippet ? `HTTP ${status}: ${snippet}` : `HTTP ${status}`,
    checkedAt,
  };
}
