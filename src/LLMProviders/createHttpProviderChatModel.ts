import type { Api, Model, StreamOptions } from "@earendil-works/pi-ai";
import type { CustomModel } from "@/aiParams";
import { createPiChatModel, type ProviderChatModel } from "@/LLMProviders/piChatModel";
import { streamCohere, streamGoogle, streamOllama } from "@/LLMProviders/httpChatApis";
import { createSapLanguageModel } from "@/LLMProviders/nativeSdk/createSapLanguageModel";
import { createGitlabAccessToken } from "@/LLMProviders/nativeSdk/createGitlabAccessToken";
import { createVertexAccessToken } from "@/LLMProviders/nativeSdk/createVertexAccessToken";
import { gitlabModelMappings } from "@/LLMProviders/nativeSdk/gitlabModelMappings";
import { t } from "@/lib/i18n";

function option(model: CustomModel, key: string, fallback = ""): string {
  const value = model.providerOptions?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function requiredOption(model: CustomModel, key: string): string {
  const value = option(model, key);
  if (!value) throw new Error(t("The provider requires {parameter}.", { parameter: key }));
  return value;
}

function secretObject(secret: string): Record<string, unknown> {
  let value: unknown;
  try {
    value = JSON.parse(secret);
  } catch {
    throw new Error(t("The provider credentials must be valid JSON."));
  }
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(t("The provider credentials must be a JSON object."));
  return value as Record<string, unknown>;
}

function vertexBaseUrl(model: CustomModel, publisher: string): string {
  const project = requiredOption(model, "GOOGLE_VERTEX_PROJECT");
  const location = option(model, "GOOGLE_VERTEX_LOCATION", "global");
  const endpoint = option(
    model,
    "GOOGLE_VERTEX_ENDPOINT",
    location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`
  );
  const base = model.baseUrl?.replace(/\/+$/, "");
  const host =
    base && base !== "https://aiplatform.googleapis.com"
      ? base
      : /^https?:\/\//.test(endpoint)
        ? endpoint
        : `https://${endpoint}`;
  const prefix =
    new URL(host).pathname !== "/"
      ? host.replace(/\/models$/, "")
      : `${host}/v1/projects/${encodeURIComponent(project)}/locations/${encodeURIComponent(location)}/publishers/${publisher}`;
  return publisher === "anthropic" ? `${prefix}/models` : prefix;
}

export async function createHttpProviderChatModel(
  model: CustomModel,
  descriptor: Model<Api>,
  defaults: StreamOptions
): Promise<ProviderChatModel> {
  const transport = defaults.fetch;
  if (!transport) throw new Error("A provider transport is required.");
  if (descriptor.api === "scribe-ollama")
    return createPiChatModel(descriptor, async () => ({
      stream: streamOllama,
      options: {
        ...defaults,
        headers: { Authorization: `Bearer ${model.apiKey || "default-key"}` },
      },
    }));
  switch (model.providerNpm) {
    case "@ai-sdk/google":
      // pi-ai's built-in Google API rejects custom fetch, which would break requestUrl and mobile auth. https://github.com/ItsDalk-Lane/Scribe/issues/8
      return createPiChatModel(descriptor, async () => ({
        stream: streamGoogle,
        options: { ...defaults, headers: { "x-goog-api-key": model.apiKey || "" } },
      }));
    case "@ai-sdk/cohere":
      return createPiChatModel(descriptor, async () => ({
        stream: streamCohere,
        options: { ...defaults, headers: { Authorization: `Bearer ${model.apiKey}` } },
      }));
    case "@ai-sdk/google-vertex":
    case "@ai-sdk/google-vertex/anthropic": {
      const anthropic = model.providerNpm.endsWith("/anthropic");
      descriptor.baseUrl = vertexBaseUrl(model, anthropic ? "anthropic" : "google");
      const secret = model.apiKey?.trim() ?? "";
      if (!secret)
        throw new Error(t("Google Vertex requires service-account JSON or an OAuth access token."));
      let accessToken = async () => secret.replace(/^Bearer\s+/i, "");
      if (secret.startsWith("{")) {
        const credentials = secretObject(secret);
        if (
          typeof credentials.client_email !== "string" ||
          typeof credentials.private_key !== "string"
        )
          throw new Error(t("Google service-account JSON requires client_email and private_key."));
        accessToken = createVertexAccessToken(
          credentials.client_email,
          credentials.private_key,
          transport,
          typeof credentials.private_key_id === "string" ? credentials.private_key_id : undefined
        );
      }
      return createPiChatModel(descriptor, async () => {
        const token = await accessToken();
        if (!anthropic)
          return {
            stream: streamGoogle,
            options: { ...defaults, headers: { Authorization: `Bearer ${token}` } },
          };
        const { stream } = await import("@earendil-works/pi-ai/api/anthropic-messages");
        const vertexFetch: typeof fetch = (input, init) => {
          const body = JSON.parse(init?.body as string) as Record<string, unknown>;
          delete body.model;
          const headers = new Headers(init?.headers);
          headers.delete("x-api-key");
          headers.set("Authorization", `Bearer ${token}`);
          return transport(
            `${descriptor.baseUrl}/${encodeURIComponent(model.name)}:streamRawPredict`,
            {
              ...init,
              headers,
              body: JSON.stringify({ ...body, anthropic_version: "vertex-2023-10-16" }),
            }
          );
        };
        return { stream, options: { ...defaults, fetch: vertexFetch } };
      });
    }
    case "gitlab-ai-provider": {
      const mapping = gitlabModelMappings[model.name as keyof typeof gitlabModelMappings];
      if (!mapping || mapping.provider === "workflow")
        throw new Error(t("Unsupported GitLab chat model: {model}", { model: model.name }));
      const getToken = createGitlabAccessToken(
        option(model, "GITLAB_INSTANCE_URL", model.baseUrl || "https://gitlab.com"),
        model.apiKey || "",
        transport
      );
      const gateway = option(model, "GITLAB_AI_GATEWAY_URL", "https://cloud.gitlab.com").replace(
        /\/+$/,
        ""
      );
      descriptor.id = mapping.model;
      descriptor.api =
        mapping.provider === "anthropic"
          ? "anthropic-messages"
          : "openaiApiType" in mapping && mapping.openaiApiType === "responses"
            ? "openai-responses"
            : "openai-completions";
      descriptor.baseUrl =
        mapping.provider === "anthropic"
          ? `${gateway}/ai/v1/proxy/anthropic`
          : `${gateway}/ai/v1/proxy/openai/v1`;
      descriptor.maxTokens = model.maxTokens ?? 8192;
      return createPiChatModel(descriptor, async (options) => {
        const token = await getToken(options.signal);
        const authenticatedFetch: typeof fetch = (input, init) => {
          const headers = new Headers(init?.headers);
          headers.delete("x-api-key");
          headers.set("Authorization", `Bearer ${token.token}`);
          return transport(input, { ...init, headers });
        };
        const api =
          descriptor.api === "anthropic-messages"
            ? await import("@earendil-works/pi-ai/api/anthropic-messages")
            : descriptor.api === "openai-responses"
              ? await import("@earendil-works/pi-ai/api/openai-responses")
              : await import("@earendil-works/pi-ai/api/openai-completions");
        return {
          stream: api.stream,
          options: { ...defaults, fetch: authenticatedFetch, headers: token.headers },
        };
      });
    }
    case "@jerome-benoit/sap-ai-provider-v2": {
      const credentials = secretObject(model.apiKey || "");
      if (
        typeof credentials.clientid !== "string" ||
        typeof credentials.clientsecret !== "string" ||
        typeof credentials.url !== "string"
      )
        throw new Error(t("SAP service-key JSON requires clientid, clientsecret and url."));
      const serviceurls = credentials.serviceurls;
      if (
        !serviceurls ||
        typeof serviceurls !== "object" ||
        !("AI_API_URL" in serviceurls) ||
        typeof serviceurls.AI_API_URL !== "string"
      )
        throw new Error(t("SAP service-key JSON requires serviceurls.AI_API_URL."));
      const resolve = createSapLanguageModel(model, {
        clientId: credentials.clientid,
        clientSecret: credentials.clientsecret,
        tokenUrl: credentials.url,
        apiUrl: serviceurls.AI_API_URL,
        resourceGroup: option(
          model,
          "AICORE_RESOURCE_GROUP",
          option(model, "SAP_RESOURCE_GROUP", "default")
        ),
        deploymentId: option(model, "AICORE_DEPLOYMENT_ID", option(model, "SAP_DEPLOYMENT_ID")),
      });
      return createPiChatModel(descriptor, async (options) => ({
        stream: await resolve(options),
        options: defaults,
      }));
    }
    default:
      throw new Error(
        t("Unsupported native provider package: {provider}", { provider: model.providerNpm ?? "" })
      );
  }
}
