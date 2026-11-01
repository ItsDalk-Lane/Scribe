import { t } from "@/lib/i18n";
import type { CustomModel } from "@/aiParams";
import { createProviderFetch } from "@/LLMProviders/providerTransport";
import { NativeSdkChatModel } from "./NativeSdkChatModel";
import { LazyProviderChatModel } from "./LazyProviderChatModel";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { v4 as uuidv4 } from "uuid";
import { createSapLanguageModel } from "./createSapLanguageModel";
import { createGitlabAccessToken } from "./createGitlabAccessToken";
import { gitlabModelMappings } from "./gitlabModelMappings";

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

async function vertexModel(model: CustomModel, anthropic: boolean): Promise<BaseChatModel> {
  const secret = model.apiKey?.trim() ?? "";
  if (!secret)
    throw new Error(t("Google Vertex requires service-account JSON or an OAuth access token."));
  requiredOption(model, "GOOGLE_VERTEX_PROJECT");
  const baseURL = vertexBaseUrl(model, anthropic ? "anthropic" : "google");
  const transport = createProviderFetch(model);
  let accessToken: (signal?: AbortSignal) => Promise<string> = async () =>
    secret.replace(/^Bearer\s+/i, "");
  if (secret.startsWith("{")) {
    const credentials = secretObject(secret);
    if (typeof credentials.client_email !== "string" || typeof credentials.private_key !== "string")
      throw new Error(t("Google service-account JSON requires client_email and private_key."));
    const { createVertexAccessToken } = await import("./createVertexAccessToken");
    accessToken = createVertexAccessToken(
      credentials.client_email,
      credentials.private_key,
      transport,
      typeof credentials.private_key_id === "string" ? credentials.private_key_id : undefined
    );
  }
  if (anthropic) {
    return new LazyProviderChatModel(async (options) => {
      const token = await accessToken(options.signal);
      const { ChatAnthropic } = await import("@langchain/anthropic");
      const vertexFetch: typeof fetch = (input, init) => {
        const payload = JSON.parse(typeof init?.body === "string" ? init.body : "{}") as Record<
          string,
          unknown
        >;
        const body = { ...payload };
        delete body.model;
        const headers = new Headers(init?.headers);
        for (const [key, value] of Object.entries({
          ...options.options?.headers,
          ...options.headers,
        }))
          headers.set(key, value);
        headers.delete("x-api-key");
        headers.set("Authorization", `Bearer ${token}`);
        return transport(
          `${baseURL}/${encodeURIComponent(model.name)}:${body.stream ? "streamRawPredict" : "rawPredict"}`,
          {
            ...init,
            headers,
            body: JSON.stringify({ ...body, anthropic_version: "vertex-2023-10-16" }),
          }
        );
      };
      return new ChatAnthropic({
        model: model.name,
        apiKey: token,
        anthropicApiUrl: baseURL,
        maxTokens: model.maxTokens ?? 4096,
        clientOptions: { fetch: vertexFetch },
        maxRetries: 3,
      });
    });
  }
  const { GoogleLanguageModel } = await import("./googleSdk");
  return new NativeSdkChatModel(
    async (options) =>
      new GoogleLanguageModel(model.name, {
        provider: "google.vertex.chat",
        baseURL,
        headers: async () => ({ Authorization: `Bearer ${await accessToken(options.signal)}` }),
        fetch: transport,
        generateId: uuidv4,
      }),
    model.maxTokens
  );
}

export async function createNativeSdkChatModel(model: CustomModel): Promise<BaseChatModel> {
  const transport = createProviderFetch(model);
  let native: ConstructorParameters<typeof NativeSdkChatModel>[0];
  switch (model.providerNpm) {
    case "@ai-sdk/google": {
      const { GoogleLanguageModel } = await import("./googleSdk");
      const base = model.baseUrl?.trim().replace(/\/+$/, "");
      const baseURL = base && !/\/v1(?:beta)?$/.test(base) ? `${base}/v1beta` : base;
      native = new GoogleLanguageModel(model.name, {
        provider: "google.generative-ai",
        baseURL: baseURL || "https://generativelanguage.googleapis.com/v1beta",
        headers: { "x-goog-api-key": model.apiKey },
        fetch: transport,
        generateId: uuidv4,
      });
      break;
    }
    case "@ai-sdk/cohere": {
      const { createCohere } = await import("./cohereSdk");
      native = createCohere({
        apiKey: model.apiKey,
        baseURL: model.baseUrl || "https://api.cohere.com/v2",
        fetch: transport,
      }).languageModel(model.name);
      break;
    }
    case "@ai-sdk/google-vertex":
    case "@ai-sdk/google-vertex/anthropic":
      return vertexModel(model, model.providerNpm.endsWith("/anthropic"));
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
      return new LazyProviderChatModel(async (options) => {
        const token = await getToken(options.signal);
        const headers = new Headers(token.headers);
        headers.delete("x-api-key");
        headers.set("Authorization", `Bearer ${token.token}`);
        const authenticatedFetch: typeof fetch = (input, init) => {
          const requestHeaders = new Headers(init?.headers);
          for (const [key, value] of Object.entries({
            ...options.options?.headers,
            ...options.headers,
          }))
            requestHeaders.set(key, value);
          requestHeaders.delete("x-api-key");
          requestHeaders.set("Authorization", `Bearer ${token.token}`);
          return transport(input, { ...init, headers: requestHeaders });
        };
        if (mapping.provider === "anthropic") {
          const { ChatAnthropic } = await import("@langchain/anthropic");
          return new ChatAnthropic({
            model: mapping.model,
            apiKey: token.token,
            anthropicApiUrl: `${gateway}/ai/v1/proxy/anthropic/`,
            maxTokens: model.maxTokens ?? 8192,
            clientOptions: {
              fetch: authenticatedFetch,
              defaultHeaders: Object.fromEntries(headers.entries()),
            },
            maxRetries: 3,
          });
        }
        const { ChatOpenAI } = await import("@langchain/openai");
        return new ChatOpenAI({
          model: mapping.model,
          apiKey: token.token,
          useResponsesApi: "openaiApiType" in mapping && mapping.openaiApiType === "responses",
          maxTokens: model.maxTokens,
          configuration: {
            baseURL: `${gateway}/ai/v1/proxy/openai/v1`,
            fetch: authenticatedFetch,
            defaultHeaders: Object.fromEntries(headers.entries()),
          },
          maxRetries: 3,
        });
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
      native = createSapLanguageModel(model, {
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
      break;
    }
    default:
      throw new Error(
        t("Unsupported native provider package: {provider}", { provider: model.providerNpm ?? "" })
      );
  }
  return new NativeSdkChatModel(native, model.maxTokens);
}
