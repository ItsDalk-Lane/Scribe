import { t } from "@/lib/i18n";
import type { CustomModel } from "@/aiParams";
import { TimeoutError } from "@/error";
import { safeFetchNoThrow } from "@/utils";
import { isRecord } from "@/utils/obsidianInternals";
import { v4 as uuidv4 } from "uuid";

interface ProviderToken {
  value: string;
  expiresAt: number;
  apiEndpoint?: URL;
}

const CLIENT_ID = "obsidian-scribe/4";
const PROVIDER_TOKEN_TIMEOUT_MS = 15_000;

function copilotHost(url: URL): boolean {
  return (
    url.protocol === "https:" &&
    (url.hostname === "githubcopilot.com" || url.hostname.endsWith(".githubcopilot.com")) &&
    !url.port &&
    !url.username &&
    !url.password
  );
}

async function requestProviderToken(
  model: CustomModel,
  apiKey: string,
  signal?: AbortSignal
): Promise<ProviderToken> {
  const copilot = model.providerCatalogId === "github-copilot";
  const response = await safeFetchNoThrow(
    copilot
      ? "https://api.github.com/copilot_internal/v2/token"
      : "https://iam.cloud.ibm.com/identity/token",
    copilot
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
  );
  if (!response.ok) {
    throw Object.assign(
      new Error(t("Provider authentication failed (HTTP {status}).", { status: response.status })),
      {
        status: response.status,
      }
    );
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    throw new Error(t("Invalid provider authentication response."));
  }
  if (!isRecord(data)) throw new Error(t("Invalid provider authentication response."));
  const value = copilot ? data.token : data.access_token;
  const epoch = copilot ? data.expires_at : data.expiration;
  const expiresAt =
    typeof epoch === "number"
      ? epoch * 1000
      : !copilot && typeof data.expires_in === "number"
        ? Date.now() + data.expires_in * 1000
        : 0;
  if (
    typeof value !== "string" ||
    !value ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= Date.now()
  ) {
    throw new Error(t("Invalid provider authentication response."));
  }
  let apiEndpoint: URL | undefined;
  const endpoint = copilot && isRecord(data.endpoints) ? data.endpoints.api : undefined;
  if (endpoint !== undefined) {
    if (typeof endpoint !== "string") throw new Error(t("Invalid Copilot API endpoint."));
    try {
      apiEndpoint = new URL(endpoint);
    } catch {
      throw new Error(t("Invalid Copilot API endpoint."));
    }
    if (
      !copilotHost(apiEndpoint) ||
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

export function createProviderFetch(model: CustomModel): typeof fetch {
  const apiKey = model.apiKey?.trim() ?? "";
  const catalogId = model.providerCatalogId;
  const vertex =
    catalogId === "google-vertex" ||
    catalogId === "google-vertex-anthropic" ||
    model.providerNpm === "@ai-sdk/google-vertex" ||
    model.providerNpm === "@ai-sdk/google-vertex/anthropic";
  let fallbackSession: string | undefined;
  let token: ProviderToken | undefined;
  let pendingToken: Promise<ProviderToken> | undefined;
  let vertexAuth: Promise<(signal?: AbortSignal) => Promise<string>> | undefined;

  async function managedToken(): Promise<ProviderToken> {
    if (!apiKey) throw new Error(t("Provider credentials are missing."));
    if (catalogId === "github-copilot" && !/^(?:gh[opusr]_|github_pat_)/.test(apiKey)) {
      return { value: apiKey, expiresAt: Infinity };
    }
    if (token && token.expiresAt > Date.now() + 60_000) return token;
    pendingToken ??= (() => {
      const controller = new AbortController();
      let timer: number | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = window.setTimeout(() => {
          controller.abort();
          reject(new TimeoutError("Provider token request", PROVIDER_TOKEN_TIMEOUT_MS));
        }, PROVIDER_TOKEN_TIMEOUT_MS);
      });
      return Promise.race([
        requestProviderToken(model, apiKey, controller.signal),
        timeout,
      ]).finally(() => {
        window.clearTimeout(timer);
        pendingToken = undefined;
      });
    })();
    token = await pendingToken;
    return token;
  }

  async function vertexToken(signal?: AbortSignal): Promise<string> {
    if (!apiKey) throw new Error(t("Provider credentials are missing."));
    if (!apiKey.startsWith("{")) return apiKey;
    vertexAuth ??= (async () => {
      const credentials: unknown = JSON.parse(apiKey);
      if (
        !isRecord(credentials) ||
        credentials.type !== "service_account" ||
        typeof credentials.client_email !== "string" ||
        typeof credentials.private_key !== "string"
      ) {
        throw new Error(t("A Google service account JSON or access token is required."));
      }
      const { createVertexAccessToken } = await import("./nativeSdk/createVertexAccessToken");
      return createVertexAccessToken(
        credentials.client_email,
        credentials.private_key,
        createProviderFetch(model),
        typeof credentials.private_key_id === "string" ? credentials.private_key_id : undefined
      );
    })();
    const accessToken = await (await vertexAuth)(signal);
    if (!accessToken) throw new Error(t("Google did not return an access token."));
    return accessToken;
  }

  return async (input, init) => {
    const request = typeof input !== "string" && "url" in input ? input : undefined;
    const inputUrl =
      typeof input === "string" ? input : request ? request.url : (input as URL).href;
    const url = new URL(inputUrl);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      throw new Error(t("Invalid provider request URL."));
    }
    const headers = new Headers(request?.headers);
    new Headers(init?.headers).forEach((value, name) => headers.set(name, value));
    // 本机无密钥服务不能收到客户端为初始化而填入的占位凭据。https://github.com/logancyang/obsidian-copilot/issues/2946
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
      if (!apiKey) throw new Error(t("OpenCode credentials are missing."));
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
      const credential = await managedToken();
      if (credential.apiEndpoint && copilotHost(url)) {
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
      headers.set("Authorization", `Bearer ${(await managedToken()).value}`);
      headers.set("Content-Type", "application/json");
    }
    const bearer = headers.get("Authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (
      vertex &&
      !(url.origin === "https://oauth2.googleapis.com" && url.pathname === "/token") &&
      (!bearer || bearer === "provider-managed-auth" || bearer.startsWith("{"))
    ) {
      headers.set(
        "Authorization",
        `Bearer ${await vertexToken(init?.signal ?? request?.signal ?? undefined)}`
      );
    }
    const options: RequestInit = {
      ...init,
      method,
      headers,
      body,
      signal: init?.signal !== undefined ? init.signal : request?.signal,
    };
    return model.enableCors === false
      ? fetch(url.toString(), options)
      : safeFetchNoThrow(url.toString(), options);
  };
}
