import { t } from "@/lib/i18n";
import { anthropicHostBaseUrl } from "@/utils/providerBaseUrl";
import * as z from "zod";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyViaListModels } from "./verifyViaListModels";

const DEFAULT_BASE_URL = "https://api.anthropic.com";
const ANTHROPIC_VERSION = "2023-06-01";

const extrasSchema = z.object({});

type Extras = z.infer<typeof extrasSchema>;

export const anthropicAdapter: ProviderAdapter<Extras> = {
  providerType: "anthropic",
  extrasSchema,

  verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    if (!ctx.apiKey) {
      return Promise.resolve({
        ok: false,
        code: "missing_api_key",
        message: t("An API key is required to verify this Anthropic provider."),
        checkedAt: Date.now(),
      });
    }
    const base = anthropicHostBaseUrl(ctx.provider.baseUrl) ?? DEFAULT_BASE_URL;
    return verifyViaListModels(
      `${base}/v1/models`,
      {
        "x-api-key": ctx.apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "anthropic-dangerous-direct-browser-access": "true",
      },
      { responseShape: "models" }
    );
  },
};
