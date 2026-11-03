import { openaiCompatibleModelsUrl } from "@/modelManagement/providers/adapters/openaiCompatibleModelsUrl";
import { providerNeedsResolvedApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import { t } from "@/lib/i18n";
import * as z from "zod";

import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { AdapterBuildContext, AdapterVerifyContext, ProviderAdapter } from "./ProviderAdapter";
import { verifyPathForCatalogProviderId } from "./openaiCompatibleVerifyPath";
import { verifyViaListModels } from "./verifyViaListModels";

const extrasSchema = z.object({
  openAIOrgId: z.string().optional(),
});

type Extras = z.infer<typeof extrasSchema>;

export const openaiCompatibleAdapter: ProviderAdapter<Extras> = {
  providerType: "openai-compatible",
  extrasSchema,

  buildLangChainClient(ctx: AdapterBuildContext<Extras>): BaseChatModel {
    throw new Error(
      "[modelManagement] openaiCompatibleAdapter.buildLangChainClient not implemented yet"
    );
  },

  verifyCredentials(ctx: AdapterVerifyContext<Extras>): Promise<VerificationResult> {
    const baseUrl = ctx.provider.baseUrl?.trim();
    if (!baseUrl) {
      return Promise.resolve({
        ok: false,
        code: "missing_base_url",
        message: t("A base URL is required to verify this OpenAI-compatible provider."),
        checkedAt: Date.now(),
      });
    }
    // 公开目录可匿名读取时不能将缺失的必需密钥判为已验证。https://github.com/logancyang/obsidian-copilot/issues/3147
    if (!ctx.apiKey?.trim() && providerNeedsResolvedApiKey(ctx.provider)) {
      return Promise.resolve({
        ok: false,
        code: "missing_api_key",
        message: t("API key is missing. Configure this provider to enter it again."),
        checkedAt: Date.now(),
      });
    }
    const base = baseUrl.replace(/\/+$/, "");

    const headers: Record<string, string> = {};
    if (ctx.apiKey) {
      headers["Authorization"] = `Bearer ${ctx.apiKey}`;
    }
    if (ctx.extras.openAIOrgId) {
      headers["OpenAI-Organization"] = ctx.extras.openAIOrgId;
    }

    const catalogProviderId =
      ctx.provider.origin.kind === "byok" ? ctx.provider.origin.catalogProviderId : undefined;
    const verifyPath = verifyPathForCatalogProviderId(catalogProviderId);

    const verifyUrl =
      verifyPath === "models" ? openaiCompatibleModelsUrl(base) : `${base}/${verifyPath}`;
    return verifyViaListModels(verifyUrl, headers, {
      responseShape: verifyPath === "key" ? "openrouter-key" : "models",
    });
  },
};
