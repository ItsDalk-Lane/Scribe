import { RequestRedactor } from "@/LLMProviders/requestRedaction";
import type { Api, Model, StreamOptions, SimpleStreamOptions } from "@earendil-works/pi-ai";
import type { CustomModel } from "@/aiParams";
import {
  createPiChatModel,
  type ProviderChatModel,
  type PiRequest,
} from "@/LLMProviders/piChatModel";
import { streamCohere, streamGoogle, streamOllama } from "@/LLMProviders/httpChatApis";
import { createSapLanguageModel } from "@/LLMProviders/nativeSdk/createSapLanguageModel";
import { createGitlabAccessToken } from "@/LLMProviders/nativeSdk/createGitlabAccessToken";
import {
  createVertexAccessToken,
  parseVertexCredentials,
} from "@/LLMProviders/nativeSdk/createVertexAccessToken";
import { gitlabModelMappings } from "@/LLMProviders/nativeSdk/gitlabModelMappings";
import { t } from "@/lib/i18n";
import { createProviderFetch } from "@/LLMProviders/providerTransport";
import { withModelCredentials } from "@/LLMProviders/modelCredentials";

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

// 供应商解析器按稳定身份跨调用复用：每次调用重建会丢失其内部的令牌缓存与进行中合并。
// 键不含明文密钥，条目保存换取时所用的凭据值做一致性比较；仅保存在内存。https://github.com/ItsDalk-Lane/Scribe/issues/61
interface SharedResolverEntry<R> {
  apiKey: string;
  resolver?: Promise<R>;
}

function sharedResolver<R>(
  cache: Map<string, SharedResolverEntry<R>>,
  identity: string,
  apiKey: string,
  build: () => Promise<R>
): Promise<R> {
  const entry = cache.get(identity) ?? { apiKey };
  if (entry.apiKey !== apiKey) {
    entry.apiKey = apiKey;
    entry.resolver = undefined;
  }
  entry.resolver ??= build();
  cache.set(identity, entry);
  return entry.resolver;
}

type GitlabTokenResolver = Awaited<ReturnType<typeof createGitlabAccessToken>>;
type SapModelResolver = ReturnType<typeof createSapLanguageModel>;
const vertexAccessResolvers = new Map<
  string,
  SharedResolverEntry<(signal?: AbortSignal) => Promise<string>>
>();
const gitlabResolvers = new Map<string, SharedResolverEntry<GitlabTokenResolver>>();
const sapResolvers = new Map<string, SharedResolverEntry<SapModelResolver>>();

export function clearProviderResolverCaches(): void {
  vertexAccessResolvers.clear();
  gitlabResolvers.clear();
  sapResolvers.clear();
}

export async function createHttpProviderChatModel(
  model: CustomModel,
  descriptor: Model<Api>,
  defaults: StreamOptions
): Promise<ProviderChatModel> {
  if (
    model.providerNpm === "@ai-sdk/google-vertex" ||
    model.providerNpm === "@ai-sdk/google-vertex/anthropic"
  ) {
    descriptor.baseUrl = vertexBaseUrl(
      model,
      model.providerNpm.endsWith("/anthropic") ? "anthropic" : "google"
    );
  }
  if (model.providerNpm === "gitlab-ai-provider") {
    const mapping = gitlabModelMappings[model.name as keyof typeof gitlabModelMappings];
    if (!mapping || mapping.provider === "workflow")
      throw new Error(t("Unsupported GitLab chat model: {model}", { model: model.name }));
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
    descriptor.compat = {
      ...descriptor.compat,
      supportsDeveloperRole: descriptor.api === "openai-responses",
    };
  }
  const supported =
    descriptor.api === "scribe-ollama" ||
    [
      "@ai-sdk/google",
      "@ai-sdk/cohere",
      "@ai-sdk/google-vertex",
      "@ai-sdk/google-vertex/anthropic",
      "gitlab-ai-provider",
      "@jerome-benoit/sap-ai-provider-v2",
    ].includes(model.providerNpm ?? "");
  if (!supported)
    throw new Error(
      t("Unsupported native provider package: {provider}", { provider: model.providerNpm ?? "" })
    );
  return createPiChatModel(
    descriptor,
    async (options) => {
      options.signal?.throwIfAborted();
      return withModelCredentials(model, async (requestModel) => {
        options.signal?.throwIfAborted();
        const redactionValues = [requestModel.apiKey ?? ""];
        try {
          const request = await resolveHttpProviderRequest(
            requestModel,
            descriptor,
            {
              ...defaults,
              apiKey: defaults.apiKey ?? requestModel.apiKey ?? "keyless-endpoint",
              fetch:
                defaults.fetch ??
                createProviderFetch(requestModel, redactionValues, options.onProviderDispatch),
            },
            options,
            redactionValues
          );
          return { ...request, redactionValues, observesDispatch: true };
        } catch (error) {
          throw new RequestRedactor(redactionValues).error(error);
        }
      });
    },
    model.configuredModelId,
    model.providerDisplayName
  );
}

async function resolveHttpProviderRequest(
  model: CustomModel,
  descriptor: Model<Api>,
  defaults: StreamOptions,
  options: SimpleStreamOptions,
  redactionValues: string[]
): Promise<PiRequest> {
  const transport = defaults.fetch!;
  if (descriptor.api === "scribe-ollama")
    return {
      stream: streamOllama,
      options: {
        ...defaults,
        headers: { Authorization: `Bearer ${model.apiKey || "default-key"}` },
      },
    };
  switch (model.providerNpm) {
    case "@ai-sdk/google":
      return {
        stream: streamGoogle,
        options: { ...defaults, headers: { "x-goog-api-key": model.apiKey || "" } },
      };
    case "@ai-sdk/cohere":
      return {
        stream: streamCohere,
        options: { ...defaults, headers: { Authorization: `Bearer ${model.apiKey}` } },
      };
    case "@ai-sdk/google-vertex":
    case "@ai-sdk/google-vertex/anthropic": {
      const anthropic = model.providerNpm.endsWith("/anthropic");
      const secret = model.apiKey?.trim() ?? "";
      if (!secret)
        throw new Error(t("Google Vertex requires service-account JSON or an OAuth access token."));
      const credentials = parseVertexCredentials(secret);
      let accessToken: (signal?: AbortSignal) => Promise<string>;
      if (typeof credentials === "string") {
        accessToken = async () => credentials;
      } else {
        const clientEmail = credentials.client_email;
        const privateKey = credentials.private_key;
        const keyId =
          typeof credentials.private_key_id === "string" ? credentials.private_key_id : undefined;
        if (typeof clientEmail !== "string" || typeof privateKey !== "string")
          throw new Error(t("Google service-account JSON requires client_email and private_key."));
        accessToken = await sharedResolver(
          vertexAccessResolvers,
          `${clientEmail}|${keyId ?? ""}`,
          secret,
          async () => createVertexAccessToken(clientEmail, privateKey, transport, keyId)
        );
      }
      const token = await accessToken(options.signal);
      redactionValues.push(token);
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
    }
    case "gitlab-ai-provider": {
      const mapping = gitlabModelMappings[model.name as keyof typeof gitlabModelMappings];
      if (!mapping || mapping.provider === "workflow")
        throw new Error(t("Unsupported GitLab chat model: {model}", { model: model.name }));
      const getToken = await sharedResolver(
        gitlabResolvers,
        option(model, "GITLAB_INSTANCE_URL", model.baseUrl || "https://gitlab.com"),
        model.apiKey || "",
        () =>
          Promise.resolve(
            createGitlabAccessToken(
              option(model, "GITLAB_INSTANCE_URL", model.baseUrl || "https://gitlab.com"),
              model.apiKey || "",
              transport
            )
          )
      );
      const token = await getToken(options.signal);
      redactionValues.push(token.token);
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
    }
    case "@jerome-benoit/sap-ai-provider-v2": {
      const credentials = secretObject(model.apiKey || "");
      const clientId = credentials.clientid;
      const clientSecret = credentials.clientsecret;
      const tokenUrl = credentials.url;
      if (
        typeof clientId !== "string" ||
        typeof clientSecret !== "string" ||
        typeof tokenUrl !== "string"
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
      const apiUrl: string = serviceurls.AI_API_URL;
      const resourceGroup = option(
        model,
        "AICORE_RESOURCE_GROUP",
        option(model, "SAP_RESOURCE_GROUP", "default")
      );
      const deploymentId = option(
        model,
        "AICORE_DEPLOYMENT_ID",
        option(model, "SAP_DEPLOYMENT_ID")
      );
      // 解析器持有部署与路由状态，跨连接复用会把请求送入其他资源组。https://github.com/ItsDalk-Lane/Scribe/issues/61
      const resolve = await sharedResolver(
        sapResolvers,
        JSON.stringify([tokenUrl, clientId, model.baseUrl, apiUrl, resourceGroup, deploymentId]),
        model.apiKey || "",
        () =>
          Promise.resolve(
            createSapLanguageModel(
              model,
              {
                clientId,
                clientSecret,
                tokenUrl,
                apiUrl,
                resourceGroup,
                deploymentId,
              },
              transport
            )
          )
      );
      return { stream: await resolve(options), options: defaults };
    }
    default:
      throw new Error(
        t("Unsupported native provider package: {provider}", { provider: model.providerNpm ?? "" })
      );
  }
}
