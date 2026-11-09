import { raceWithAbortSignal } from "@earendil-works/pi-ai/utils/abort";
import { t } from "@/lib/i18n";
import type { CustomModel } from "@/aiParams";
import { observeProviderResponse } from "@/LLMProviders/providerResponse";
import {
  classifyProviderFailure,
  ProviderRequestError,
  type ProviderRequestFailure,
} from "@/LLMProviders/providerRequestFailure";
import { TimeoutError } from "@/error";
import { safeFetchNoThrow } from "@/utils";
import { isDesktopRuntime } from "@/utils/desktopRuntime";
import { loadDesktopStreamingFetch } from "@/utils/desktopStreamingFetch";
import { isRecord } from "@/utils/obsidianInternals";
import { v4 as uuidv4 } from "uuid";

interface ProviderToken {
  value: string;
  expiresAt: number;
  apiEndpoint?: URL;
}

const CLIENT_ID = "obsidian-scribe/4";
const PROVIDER_TOKEN_TIMEOUT_MS = 15_000;

function isGitHubInferenceHost(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "githubcopilot.com" || url.hostname.endsWith(".githubcopilot.com")) &&
    !url.port &&
    !url.username &&
    !url.password
  );
}

// 宿主断网可能只抛普通异常，认证与推理必须在真实网络边界使用相同的可重试分类。https://github.com/ItsDalk-Lane/Scribe/issues/58
function throwProviderTransportError(error: unknown, signal?: AbortSignal | null): never {
  signal?.throwIfAborted();
  if (error instanceof ProviderRequestError || error instanceof TimeoutError) throw error;
  throw new ProviderRequestError(error instanceof Error ? error.message : String(error), {
    kind: "transient",
  });
}

async function requestProviderToken(
  model: CustomModel,
  apiKey: string,
  signal?: AbortSignal
): Promise<ProviderToken> {
  const isGitHubProvider = model.providerCatalogId === "github-copilot";
  const response = await safeFetchNoThrow(
    isGitHubProvider
      ? "https://api.github.com/copilot_internal/v2/token"
      : "https://iam.cloud.ibm.com/identity/token",
    isGitHubProvider
      ? {
          method: "GET",
          signal,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            Accept: "application/json",
            "User-Agent": CLIENT_ID,
            "Editor-Version": CLIENT_ID,
            "Editor-Plugin-Version": CLIENT_ID,
            "Copilot-Integration-Id": "obsidian-scribe",
          },
        }
      : {
          method: "POST",
          signal,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Accept: "application/json",
          },
          body: new URLSearchParams({
            grant_type: "urn:ibm:params:oauth:grant-type:apikey",
            apikey: apiKey,
          }).toString(),
        }
  ).catch((error: unknown) => throwProviderTransportError(error, signal));
  if (!response.ok) {
    let failure: ProviderRequestFailure | undefined;
    await observeProviderResponse(
      response,
      (value) => {
        failure = value;
      },
      signal
    );
    throw new ProviderRequestError(
      t("Provider authentication failed (HTTP {status}).", { status: response.status }),
      failure ?? classifyProviderFailure({ status: response.status })
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new ProviderRequestError(t("Invalid provider authentication response."), {
      kind: "auth",
    });
  }
  if (!isRecord(data))
    throw new ProviderRequestError(t("Invalid provider authentication response."), {
      kind: "auth",
    });
  const value = isGitHubProvider ? data.token : data.access_token;
  const epoch = isGitHubProvider ? data.expires_at : data.expiration;
  const expiresAt =
    typeof epoch === "number"
      ? epoch * 1000
      : !isGitHubProvider && typeof data.expires_in === "number"
        ? Date.now() + data.expires_in * 1000
        : 0;
  if (
    typeof value !== "string" ||
    !value ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new ProviderRequestError(t("Invalid provider authentication response."), {
      kind: "auth",
    });
  }
  let apiEndpoint: URL | undefined;
  const endpoint = isGitHubProvider && isRecord(data.endpoints) ? data.endpoints.api : undefined;
  if (endpoint !== undefined) {
    if (typeof endpoint !== "string") throw new Error(t("Invalid Copilot API endpoint."));
    try {
      apiEndpoint = new URL(endpoint);
    } catch {
      throw new Error(t("Invalid Copilot API endpoint."));
    }
    if (
      !isGitHubInferenceHost(apiEndpoint) ||
      apiEndpoint.pathname !== "/" ||
      apiEndpoint.search ||
      apiEndpoint.hash
    ) {
      throw new Error(t("Invalid Copilot API endpoint."));
    }
  }
  return { value, expiresAt, apiEndpoint };
}

function requestBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== "string") throw new Error(t("Invalid chat request body."));
  const parsed: unknown = JSON.parse(body);
  if (!isRecord(parsed) || Array.isArray(parsed)) throw new Error(t("Invalid chat request body."));
  return parsed;
}

function watsonxRequest(url: URL, body: BodyInit | null | undefined, model: CustomModel): string {
  const project = model.providerOptions?.WATSONX_AI_PROJECT_ID;
  if (typeof project !== "string" || !project.trim()) {
    throw new Error(t("A Watsonx project ID is required."));
  }
  const payload = requestBody(body);
  const stream = payload.stream === true || url.pathname.endsWith("/chat_stream");
  const method = stream ? "chat_stream" : "chat";
  if (url.pathname.endsWith("/chat/completions")) {
    url.pathname = url.pathname.replace(
      /(?:\/ml\/v1)?\/chat\/completions$/,
      `/ml/v1/text/${method}`
    );
  } else if (/\/ml\/v1\/text\/chat(?:_stream)?$/.test(url.pathname)) {
    url.pathname = url.pathname.replace(/chat(?:_stream)?$/, method);
  } else {
    throw new Error(t("Watsonx requires the chat completions API."));
  }
  if (!url.searchParams.has("version")) url.searchParams.set("version", "2026-04-20");
  payload.model_id = payload.model ?? payload.model_id ?? model.name;
  payload.project_id = project.trim();
  if (payload.max_completion_tokens !== undefined) {
    payload.max_tokens = payload.max_completion_tokens;
    delete payload.max_completion_tokens;
  }
  if (payload.stop !== undefined) {
    payload.stop_sequences = payload.stop;
    delete payload.stop;
  }
  delete payload.model;
  delete payload.stream;
  delete payload.stream_options;
  return JSON.stringify(payload);
}

// 短期令牌与 Vertex 解析器按连接身份在调用之间共享；凭据值变更或整体失效后重新换取。
// 仅保存在内存，不落盘。https://github.com/ItsDalk-Lane/Scribe/issues/61
interface SharedTokenEntry {
  apiKey: string;
  token?: ProviderToken;
  pending?: Promise<ProviderToken>;
}
const sharedTokens = new Map<string, SharedTokenEntry>();
const vertexResolvers = new Map<
  string,
  { apiKey: string; resolver?: (signal?: AbortSignal) => Promise<string> }
>();

function sharedTokenKey(model: CustomModel): string {
  return `${model.providerCatalogId ?? "legacy"}|${model.configuredModelId ?? model.name}`;
}

export function clearProviderTokenCaches(): void {
  sharedTokens.clear();
  vertexResolvers.clear();
}

export function createProviderFetch(
  model: CustomModel,
  redactionValues?: string[],
  onDispatch?: () => void
): typeof fetch {
  const apiKey = model.apiKey?.trim() ?? "";
  const catalogId = model.providerCatalogId;
  const vertex =
    catalogId === "google-vertex" ||
    catalogId === "google-vertex-anthropic" ||
    model.providerNpm === "@ai-sdk/google-vertex" ||
    model.providerNpm === "@ai-sdk/google-vertex/anthropic";
  let fallbackSession: string | undefined;

  async function managedToken(signal?: AbortSignal): Promise<ProviderToken> {
    signal?.throwIfAborted();
    if (!apiKey)
      throw new ProviderRequestError(t("Provider credentials are missing."), { kind: "auth" });
    if (catalogId === "github-copilot" && !/^(?:gh[opusr]_|github_pat_)/.test(apiKey)) {
      return { value: apiKey, expiresAt: Infinity };
    }
    const key = sharedTokenKey(model);
    const current = sharedTokens.get(key);
    const entry: SharedTokenEntry = current?.apiKey === apiKey ? current : { apiKey };
    sharedTokens.set(key, entry);
    if (entry.token && entry.token.expiresAt > Date.now() + 60_000) return entry.token;
    entry.pending ??= (() => {
      const controller = new AbortController();
      let timer: number | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          controller.abort();
          reject(new TimeoutError("Provider token request", PROVIDER_TOKEN_TIMEOUT_MS));
        }, PROVIDER_TOKEN_TIMEOUT_MS);
      });
      return Promise.race([requestProviderToken(model, apiKey, controller.signal), timeout])
        .then((value) => {
          entry.token = value;
          return value;
        })
        .finally(() => {
          window.clearTimeout(timer);
          entry.pending = undefined;
        });
    })();
    return signal ? raceWithAbortSignal(entry.pending, signal) : entry.pending;
  }

  async function vertexToken(signal?: AbortSignal): Promise<string> {
    if (!apiKey)
      throw new ProviderRequestError(t("Provider credentials are missing."), { kind: "auth" });
    const { createVertexAccessToken, parseVertexCredentials } =
      await import("./nativeSdk/createVertexAccessToken");
    const credentials = parseVertexCredentials(apiKey);
    if (typeof credentials === "string") return credentials;
    if (
      !isRecord(credentials) ||
      credentials.type !== "service_account" ||
      typeof credentials.client_email !== "string" ||
      typeof credentials.private_key !== "string"
    ) {
      throw new Error(t("A Google service account JSON or access token is required."));
    }
    const identity = `${credentials.client_email}|${
      typeof credentials.private_key_id === "string" ? credentials.private_key_id : ""
    }`;
    const entry = vertexResolvers.get(identity);
    const shared = entry && entry.apiKey === apiKey ? entry : { apiKey };
    shared.resolver ??= createVertexAccessToken(
      credentials.client_email,
      credentials.private_key,
      createProviderFetch(model, redactionValues),
      typeof credentials.private_key_id === "string" ? credentials.private_key_id : undefined
    );
    vertexResolvers.set(identity, shared);
    const accessToken = await shared.resolver(signal);
    if (!accessToken)
      throw new ProviderRequestError(t("Google did not return an access token."), { kind: "auth" });
    return accessToken;
  }

  return async (input, init) => {
    const request = typeof input !== "string" && "url" in input ? input : undefined;
    const signal = init?.signal !== undefined ? init.signal : request?.signal;
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const inputUrl =
      typeof input === "string" ? input : request ? request.url : (input as URL).href;
    const url = new URL(inputUrl);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      throw new Error(t("Invalid provider request URL."));
    }
    const headers = new Headers(request?.headers);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    if (
      (model.providerNpm === "@ai-sdk/anthropic" || model.providerNpm === "gitlab-ai-provider") &&
      url.pathname.endsWith("/messages") &&
      url.searchParams.get("beta") === "true"
    )
      url.searchParams.delete("beta");
    if (
      model.requiresApiKey === false &&
      !apiKey &&
      headers.get("Authorization") === "Bearer keyless-endpoint"
    ) {
      headers.delete("Authorization");
    }
    const method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    let body = init?.body;
    if (body === undefined && request && method !== "GET" && method !== "HEAD") {
      body = await request.clone().text();
    }
    if (body instanceof URLSearchParams) {
      body = body.toString();
      if (!headers.has("Content-Type"))
        headers.set("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
    }
    if (catalogId === "snowflake-cortex" && typeof body === "string") {
      const payload = requestBody(body);
      if (payload.max_tokens !== undefined) {
        if (payload.max_completion_tokens === undefined) {
          payload.max_completion_tokens = payload.max_tokens;
        }
        delete payload.max_tokens;
        body = JSON.stringify(payload);
      }
    }
    if (url.origin === "https://opencode.ai" && url.pathname.startsWith("/inference/")) {
      if (!apiKey)
        throw new ProviderRequestError(t("OpenCode credentials are missing."), { kind: "auth" });
      headers.set("Authorization", `Bearer ${apiKey}`);
      headers.delete("x-api-key");
      headers.delete("x-goog-api-key");
      url.searchParams.delete("key");
    }
    if (
      catalogId === "google-vertex" &&
      model.providerNpm === "@ai-sdk/mistral" &&
      /^\/v1\/projects\/[^/]+\/locations\/[^/]+\/publishers\/mistralai\/models\/chat\/completions$/.test(
        url.pathname
      )
    ) {
      const payload = requestBody(body);
      const prediction = payload.stream === true ? "streamRawPredict" : "rawPredict";
      url.pathname = url.pathname.replace(
        /\/chat\/completions$/,
        `/${encodeURIComponent(model.name)}:${prediction}`
      );
    }
    if (
      url.protocol === "https:" &&
      url.hostname === "opencode.ai" &&
      !url.port &&
      url.pathname.startsWith("/inference/go/")
    ) {
      if (!headers.get("User-Agent")?.startsWith("obsidian-scribe/")) {
        headers.set("User-Agent", CLIENT_ID);
      }
      if (!headers.has("x-opencode-session")) {
        fallbackSession ??= uuidv4();
        headers.set("x-opencode-session", fallbackSession);
      }
    }
    if (catalogId === "cloudflare-ai-gateway" && apiKey && !headers.has("cf-aig-authorization")) {
      headers.set("cf-aig-authorization", `Bearer ${apiKey}`);
    }
    if (catalogId === "github-copilot") {
      const credential = await managedToken(signal ?? undefined);
      if (credential.apiEndpoint && isGitHubInferenceHost(url)) {
        url.host = credential.apiEndpoint.host;
      }
      headers.delete("x-api-key");
      headers.set("Authorization", `Bearer ${credential.value}`);
      headers.set("User-Agent", CLIENT_ID);
      headers.set("Editor-Version", CLIENT_ID);
      headers.set("Editor-Plugin-Version", CLIENT_ID);
      headers.set("Copilot-Integration-Id", "obsidian-scribe");
      if (!headers.has("Openai-Intent")) headers.set("Openai-Intent", "conversation-panel");
      if (!headers.has("X-Initiator")) headers.set("X-Initiator", "user");
    }
    if (catalogId === "watsonx" || model.providerNpm === "watsonx-ai-provider") {
      body = watsonxRequest(url, body, model);
      headers.set("Authorization", `Bearer ${(await managedToken(signal ?? undefined)).value}`);
      headers.set("Content-Type", "application/json");
    }
    const bearer = headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (
      vertex &&
      !(url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") &&
      (!bearer || bearer === "provider-managed-auth" || bearer.startsWith("{"))
    ) {
      headers.set("Authorization", `Bearer ${await vertexToken(signal ?? undefined)}`);
    }
    if (redactionValues)
      headers.forEach((value, name) => {
        if (/(?:authorization|api[-_]?key|token|secret)$/i.test(name)) redactionValues.push(value);
      });
    const options: RequestInit = {
      ...init,
      method,
      headers,
      body,
      signal,
    };
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const desktop = isDesktopRuntime();
    const transport = desktop ? loadDesktopStreamingFetch(onDispatch) : safeFetchNoThrow;
    try {
      // 桌面浏览器请求会被部分模型服务的跨域限制拦截，缓冲连接又会丢失流式显示。https://github.com/ItsDalk-Lane/Scribe/issues/51
      const response = transport(url.toString(), options);
      // 凭据解析和保存准备不是模型调用；只在实际传输启动后登记请求步数。https://github.com/ItsDalk-Lane/Scribe/issues/52
      if (!desktop) onDispatch?.();
      return await response;
    } catch (error) {
      throwProviderTransportError(error, signal);
    }
  };
}
