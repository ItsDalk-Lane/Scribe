import { t } from "@/lib/i18n";
import type { CustomModel } from "@/aiParams";
import { createProviderFetch } from "@/LLMProviders/providerTransport";
import { createSapHttpModel } from "./SapLanguageModel";
import type { NativeLanguageModel, NativeSdkCallOptions } from "./NativeSdkChatModel";

interface SapCredentials {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  apiUrl: string;
  resourceGroup: string;
  deploymentId: string;
}

export function createSapLanguageModel(
  model: CustomModel,
  credentials: SapCredentials
): (options: NativeSdkCallOptions) => Promise<NativeLanguageModel> {
  const transport = createProviderFetch(model);
  let cachedToken: { value: string; expiresAt: number } | undefined;
  let pendingToken: Promise<string> | undefined;
  let deploymentId = credentials.deploymentId;
  const token = async (): Promise<string> => {
    if (cachedToken && cachedToken.expiresAt > Date.now()) return cachedToken.value;
    if (!pendingToken) {
      pendingToken = (async () => {
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 15_000);
        try {
          const response = await transport(
            `${credentials.tokenUrl.replace(/\/+$/, "")}/oauth/token`,
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                grant_type: "client_credentials",
                client_id: credentials.clientId,
                client_secret: credentials.clientSecret,
              }).toString(),
              signal: controller.signal,
            }
          );
          if (!response.ok)
            throw Object.assign(
              new Error(t("SAP authorization failed ({status}).", { status: response.status })),
              {
                statusCode: response.status,
              }
            );
          const result = (await response.json()) as Record<string, unknown>;
          if (
            typeof result.access_token !== "string" ||
            !result.access_token ||
            typeof result.expires_in !== "number" ||
            result.expires_in <= 0
          )
            throw new Error(
              t("SAP authorization did not return a valid access token and expiration.")
            );
          cachedToken = {
            value: result.access_token,
            expiresAt: Date.now() + Math.max(0, result.expires_in * 1000 - 30000),
          };
          return result.access_token;
        } finally {
          window.clearTimeout(timer);
        }
      })().finally(() => {
        pendingToken = undefined;
      });
    }
    return pendingToken;
  };
  return async (options) => {
    const accessToken = await token();
    const api = new URL(model.baseUrl || credentials.apiUrl);
    if (api.pathname === "/") api.pathname = "/v2";
    const base = api.href.replace(/\/+$/, "");
    const headers = {
      Authorization: `Bearer ${accessToken}`,
      "AI-Resource-Group": credentials.resourceGroup,
    };
    if (!deploymentId) {
      const response = await transport(
        `${base}/lm/deployments?scenarioId=orchestration&status=RUNNING`,
        { headers, signal: options.signal }
      );
      if (!response.ok)
        throw Object.assign(new Error(`${t("Unexpected response")} (${response.status})`), {
          statusCode: response.status,
        });
      const deployments = (await response.json()) as { resources?: Array<{ id?: string }> };
      deploymentId = deployments.resources?.[0]?.id || "";
      if (!deploymentId)
        throw new Error(
          t("SAP AI Core has no running orchestration deployment in this resource group.")
        );
    }
    return createSapHttpModel(
      model.name,
      `${base}/inference/deployments/${encodeURIComponent(deploymentId)}/v2/completion`,
      headers,
      transport
    );
  };
}
