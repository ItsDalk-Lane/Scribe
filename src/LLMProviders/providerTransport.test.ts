import type { CustomModel } from "@/aiParams";
import { createProviderFetch } from "@/LLMProviders/providerTransport";
import { safeFetchNoThrow } from "@/utils";
import { runInThisContext } from "node:vm";
const {
  Headers: FetchHeaders,
  Request: FetchRequest,
  Response: FetchResponse,
} = runInThisContext("({ Headers, Request, Response })") as {
  Headers: typeof Headers;
  Request: typeof Request;
  Response: typeof Response;
};

jest.mock("@/utils", () => ({ safeFetchNoThrow: jest.fn() }));
jest.mock("./nativeSdk/createVertexAccessToken", () => ({
  ...jest.requireActual<typeof import("./nativeSdk/createVertexAccessToken")>(
    "./nativeSdk/createVertexAccessToken"
  ),
  createVertexAccessToken: jest.fn(),
}));

import { createVertexAccessToken } from "./nativeSdk/createVertexAccessToken";

Object.assign(window, {
  Headers: FetchHeaders,
  Request: FetchRequest,
  Response: FetchResponse,
});

const safeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;
const googleAuth = createVertexAccessToken as jest.MockedFunction<typeof createVertexAccessToken>;
const nativeFetch = jest.fn<Promise<Response>, [RequestInfo | URL, RequestInit?]>();

function model(extra: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "fixture-model",
    provider: "OpenAI Format",
    enabled: true,
    apiKey: "fixture-key",
    ...extra,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function requestHeaders(index: number): Headers {
  return new Headers(safeFetch.mock.calls[index][1]?.headers);
}

const serviceAccount = JSON.stringify({
  type: "service_account",
  project_id: "fixture-project",
  client_email: "fixture@fixture.iam.gserviceaccount.com",
  private_key: "fixture-private-key",
  token_uri: "https://malicious.example/token",
});

describe("providerTransport", () => {
  describe("createProviderFetch()", () => {
    beforeEach(() => {
      safeFetch.mockReset().mockResolvedValue(jsonResponse({ choices: [] }));
      nativeFetch.mockReset().mockResolvedValue(jsonResponse({ choices: [] }));
      window.fetch = nativeFetch;
      googleAuth.mockReset();
    });

    afterEach(() => jest.restoreAllMocks());

    it.each([undefined, true])(
      "uses Obsidian transport by default or when compatibility is %s without changing normal provider identity",
      async (enableCors) => {
        const fetcher = createProviderFetch(model({ enableCors }));
        const signal = new AbortController().signal;
        const response = await fetcher(new URL("https://proxy.example/v1/chat/completions"), {
          method: "POST",
          body: '{"messages":[]}',
          signal,
          headers: { Authorization: "Bearer custom-token", "X-Custom": "preserved" },
        });
        expect(response).toBe(await safeFetch.mock.results[0].value);
        expect(safeFetch.mock.calls[0][0]).toBe("https://proxy.example/v1/chat/completions");
        expect(safeFetch.mock.calls[0][1]).toMatchObject({
          method: "POST",
          body: '{"messages":[]}',
        });
        expect(safeFetch.mock.calls[0][1]?.signal).toBe(signal);
        expect(requestHeaders(0).get("Authorization")).toBe("Bearer custom-token");
        expect(requestHeaders(0).get("X-Custom")).toBe("preserved");
        expect(nativeFetch).not.toHaveBeenCalled();
      }
    );

    it("uses native fetch only for explicitly disabled compatibility and preserves cancellation", async () => {
      const signal = new AbortController().signal;
      await createProviderFetch(model({ enableCors: false }))(
        "https://proxy.example/chat/completions",
        { method: "POST", body: "{}", signal }
      );
      expect(nativeFetch).toHaveBeenCalledWith(
        "https://proxy.example/chat/completions",
        expect.objectContaining({ method: "POST", body: "{}", signal })
      );
      expect(safeFetch).not.toHaveBeenCalled();
    });

    it("reads a Request's URL, method, body, signal and headers while honoring explicit header overrides", async () => {
      const request = new Request("https://proxy.example/chat/completions", {
        method: "POST",
        body: '{"messages":[{"role":"user","content":"原样内容"}]}',
        headers: { Authorization: "Bearer original", "X-Request": "kept" },
      });
      await createProviderFetch(model())(request, {
        headers: new Headers({ Authorization: "Bearer override" }),
      });
      expect(safeFetch.mock.calls[0][1]).toMatchObject({
        method: "POST",
        body: '{"messages":[{"role":"user","content":"原样内容"}]}',
      });
      expect(safeFetch.mock.calls[0][1]?.signal).toBe(request.signal);
      expect(requestHeaders(0).get("Authorization")).toBe("Bearer override");
      expect(requestHeaders(0).get("X-Request")).toBe("kept");
    });

    it("serializes URLSearchParams as a form body for the Obsidian transport", async () => {
      await createProviderFetch(model())("https://proxy.example/token", {
        method: "POST",
        body: new URLSearchParams({ key: "value with space" }),
      });
      expect(safeFetch.mock.calls[0][1]?.body).toBe("key=value+with+space");
    });

    it.each([
      "openai/v1/chat/completions",
      "anthropic/v1/messages",
      "google/v1beta/models/gemini:generateContent",
    ])(
      "adds honest Go identification and a fallback session for official %s requests",
      async (path) => {
        const fetcher = createProviderFetch(model());
        await fetcher(`https://opencode.ai/inference/go/${path}`);
        await fetcher(`https://opencode.ai/inference/go/${path}`);
        expect(requestHeaders(0).get("User-Agent")).toBe("obsidian-scribe/4");
        expect(requestHeaders(0).get("x-opencode-session")).toMatch(/^[0-9a-f-]{36}$/);
        expect(requestHeaders(1).get("x-opencode-session")).toBe(
          requestHeaders(0).get("x-opencode-session")
        );
      }
    );

    it("preserves the caller's stable Go session and explicit headers", async () => {
      await createProviderFetch(model())(
        "https://opencode.ai/inference/go/openai/v1/chat/completions",
        {
          headers: {
            "X-OpenCode-Session": "chat-memory-session",
            "User-Agent": "obsidian-scribe/test",
          },
        }
      );
      expect(requestHeaders(0).get("x-opencode-session")).toBe("chat-memory-session");
      expect(requestHeaders(0).get("User-Agent")).toBe("obsidian-scribe/test");
    });

    it.each([
      "https://custom.example/inference/go/openai/v1/chat/completions",
      "http://opencode.ai/inference/go/openai/v1/chat/completions",
      "https://opencode.ai.evil.example/inference/go/openai/v1/chat/completions",
      "https://opencode.ai/inference/openai/v1/chat/completions",
    ])("does not attach Go-specific identity to %s", async (url) => {
      await createProviderFetch(model())(url);
      expect(requestHeaders(0).has("x-opencode-session")).toBe(false);
    });

    it("adds Cloudflare gateway authentication while preserving explicit gateway headers", async () => {
      const fetcher = createProviderFetch(model({ providerCatalogId: "cloudflare-ai-gateway" }));
      await fetcher("https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions");
      await fetcher(
        "https://gateway.ai.cloudflare.com/v1/account/gateway/compat/chat/completions",
        { headers: { "cf-aig-authorization": "Bearer explicit" } }
      );
      expect(requestHeaders(0).get("cf-aig-authorization")).toBe("Bearer fixture-key");
      expect(requestHeaders(1).get("cf-aig-authorization")).toBe("Bearer explicit");
    });

    it.each(["/chat/completions", "/responses", "/v1/messages"])(
      "exchanges a GitHub user token and preserves the Copilot protocol path %s",
      async (path) => {
        safeFetch.mockResolvedValueOnce(
          jsonResponse({
            token: "copilot-service-token",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            endpoints: { api: "https://api.business.githubcopilot.com" },
          })
        );
        const fetcher = createProviderFetch(
          model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" })
        );
        await fetcher(`https://api.githubcopilot.com${path}`, {
          method: "POST",
          body: "{}",
          headers: { "x-api-key": "ghu_fixture" },
        });
        expect(safeFetch.mock.calls[0][0]).toBe("https://api.github.com/copilot_internal/v2/token");
        expect(requestHeaders(0).get("Authorization")).toBe("Bearer ghu_fixture");
        expect(safeFetch.mock.calls[1][0]).toBe(`https://api.business.githubcopilot.com${path}`);
        expect(requestHeaders(1).get("Authorization")).toBe("Bearer copilot-service-token");
        expect(requestHeaders(1).has("x-api-key")).toBe(false);
        expect(requestHeaders(1).get("User-Agent")).toBe("obsidian-scribe/4");
        expect(requestHeaders(1).get("Editor-Version")).toBe("obsidian-scribe/4");
        expect(requestHeaders(1).get("Editor-Plugin-Version")).toBe("obsidian-scribe/4");
        expect(requestHeaders(1).get("Copilot-Integration-Id")).toBe("obsidian-scribe");
      }
    );

    it("caches a Copilot token until expiry then exchanges the original GitHub key again", async () => {
      const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
      safeFetch.mockResolvedValueOnce(jsonResponse({ token: "service-first", expires_at: 2000 }));
      const fetcher = createProviderFetch(
        model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" })
      );
      await fetcher("https://api.githubcopilot.com/responses");
      await fetcher("https://api.githubcopilot.com/responses");
      now.mockReturnValue(2_000_000);
      safeFetch.mockResolvedValueOnce(
        jsonResponse({ token: "service-refreshed", expires_at: 4000 })
      );
      await fetcher("https://api.githubcopilot.com/responses");
      expect(safeFetch.mock.calls.map(([url]) => url)).toEqual([
        "https://api.github.com/copilot_internal/v2/token",
        "https://api.githubcopilot.com/responses",
        "https://api.githubcopilot.com/responses",
        "https://api.github.com/copilot_internal/v2/token",
        "https://api.githubcopilot.com/responses",
      ]);
      expect(requestHeaders(4).get("Authorization")).toBe("Bearer service-refreshed");
    });

    it("times out a stalled token exchange so a later request can retry", async () => {
      jest.useFakeTimers();
      try {
        safeFetch.mockImplementationOnce(() => new Promise<Response>(() => {}));
        const fetcher = createProviderFetch(
          model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" })
        );
        const first = fetcher("https://api.githubcopilot.com/responses");
        const rejected = expect(first).rejects.toMatchObject({ name: "TimeoutError" });
        await jest.advanceTimersByTimeAsync(15_000);
        await rejected;

        safeFetch.mockResolvedValueOnce(
          jsonResponse({
            token: "recovered-service-token",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
          })
        );
        await fetcher("https://api.githubcopilot.com/responses");
        expect(requestHeaders(2).get("Authorization")).toBe("Bearer recovered-service-token");
      } finally {
        jest.useRealTimers();
      }
    });

    it("accepts an already-issued Copilot service token without exchanging it as a GitHub user token", async () => {
      await createProviderFetch(
        model({
          providerCatalogId: "github-copilot",
          apiKey: "tid=fixture;exp=9999999999;sig=fixture",
        })
      )("https://api.githubcopilot.com/responses");
      expect(safeFetch).toHaveBeenCalledTimes(1);
      expect(requestHeaders(0).get("Authorization")).toBe(
        "Bearer tid=fixture;exp=9999999999;sig=fixture"
      );
    });

    it.each([
      "https://githubcopilot.com.evil.example",
      "http://api.githubcopilot.com",
      "https://user:pass@api.githubcopilot.com",
      "https://api.githubcopilot.com:444",
    ])(
      "rejects the untrusted Copilot service endpoint %s before sending a service token",
      async (api) => {
        safeFetch.mockResolvedValueOnce(
          jsonResponse({
            token: "service-token",
            expires_at: Math.floor(Date.now() / 1000) + 3600,
            endpoints: { api },
          })
        );
        await expect(
          createProviderFetch(
            model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" })
          )("https://api.githubcopilot.com/responses")
        ).rejects.toThrow();
        expect(safeFetch).toHaveBeenCalledTimes(1);
      }
    );

    it("keeps an explicitly configured Copilot inference proxy instead of redirecting it to a vendor metadata host", async () => {
      safeFetch.mockResolvedValueOnce(
        jsonResponse({
          token: "service-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
          endpoints: { api: "https://api.business.githubcopilot.com" },
        })
      );
      await createProviderFetch(
        model({
          providerCatalogId: "github-copilot",
          apiKey: "ghu_fixture",
          baseUrl: "https://proxy.example/copilot",
        })
      )("https://proxy.example/copilot/responses");
      expect(safeFetch.mock.calls[1][0]).toBe("https://proxy.example/copilot/responses");
    });

    it("returns a safe authentication error rather than exposing a failed token response body", async () => {
      safeFetch.mockResolvedValueOnce(jsonResponse({ error: "fixture-secret-must-not-leak" }, 401));
      await expect(
        createProviderFetch(model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" }))(
          "https://api.githubcopilot.com/responses"
        )
      ).rejects.toThrow("HTTP 401");
      expect(safeFetch).toHaveBeenCalledTimes(1);
    });

    it("does not expose a malformed token response body through a JSON parser error", async () => {
      safeFetch.mockResolvedValueOnce(
        new Response("fixture-secret-must-not-leak", { status: 200 })
      );
      await expect(
        createProviderFetch(model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" }))(
          "https://api.githubcopilot.com/responses"
        )
      ).rejects.toThrow("Invalid provider authentication response.");
      expect(safeFetch).toHaveBeenCalledTimes(1);
    });

    it.each([{}, { token: "fixture", expires_at: 0 }, { token: 123, expires_at: 9999999999 }])(
      "rejects unusable successful Copilot token replies %p before inference",
      async (body) => {
        safeFetch.mockResolvedValueOnce(jsonResponse(body));
        await expect(
          createProviderFetch(
            model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" })
          )("https://api.githubcopilot.com/responses")
        ).rejects.toThrow("Invalid provider authentication response.");
        expect(safeFetch).toHaveBeenCalledTimes(1);
      }
    );

    it("retries a later credential acquisition after a failed exchange instead of caching the failed promise", async () => {
      const fetcher = createProviderFetch(
        model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" })
      );
      safeFetch.mockResolvedValueOnce(jsonResponse({}, 503));
      await expect(fetcher("https://api.githubcopilot.com/responses")).rejects.toThrow("HTTP 503");
      safeFetch.mockResolvedValueOnce(
        jsonResponse({ token: "service-token", expires_at: Math.floor(Date.now() / 1000) + 3600 })
      );
      await fetcher("https://api.githubcopilot.com/responses");
      expect(requestHeaders(2).get("Authorization")).toBe("Bearer service-token");
    });

    it.each([false, true])(
      "converts Watsonx chat with stream=%s and obtains a real IAM bearer token",
      async (stream) => {
        safeFetch.mockResolvedValueOnce(
          jsonResponse({
            access_token: "iam-fixture",
            expiration: Math.floor(Date.now() / 1000) + 3600,
          })
        );
        const messages = [{ role: "user", content: "保持原样" }];
        await createProviderFetch(
          model({
            providerCatalogId: "watsonx",
            providerOptions: { WATSONX_AI_PROJECT_ID: "project-fixture" },
          })
        )("https://us-south.ml.cloud.ibm.com/chat/completions", {
          method: "POST",
          body: JSON.stringify({
            model: "ibm/granite-fixture",
            messages,
            stream,
            stream_options: { include_usage: true },
            max_completion_tokens: 128,
            stop: ["END"],
          }),
        });
        expect(safeFetch.mock.calls[0][0]).toBe("https://iam.cloud.ibm.com/identity/token");
        expect(safeFetch.mock.calls[0][1]).toMatchObject({
          method: "POST",
          body: "grant_type=urn%3Aibm%3Aparams%3Aoauth%3Agrant-type%3Aapikey&apikey=fixture-key",
        });
        expect(requestHeaders(0).get("Content-Type")).toBe("application/x-www-form-urlencoded");
        expect(safeFetch.mock.calls[1][0]).toBe(
          `https://us-south.ml.cloud.ibm.com/ml/v1/text/${stream ? "chat_stream" : "chat"}?version=2026-04-20`
        );
        expect(requestHeaders(1).get("Authorization")).toBe("Bearer iam-fixture");
        expect(JSON.parse(safeFetch.mock.calls[1][1]?.body as string)).toEqual({
          model_id: "ibm/granite-fixture",
          project_id: "project-fixture",
          messages,
          max_tokens: 128,
          stop_sequences: ["END"],
        });
      }
    );

    it("refreshes IAM tokens after expiry while retaining a custom Watsonx inference proxy", async () => {
      const now = jest.spyOn(Date, "now").mockReturnValue(1_000_000);
      safeFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "iam-first", expiration: 2000 })
      );
      const fetcher = createProviderFetch(
        model({
          providerCatalogId: "watsonx",
          providerOptions: { WATSONX_AI_PROJECT_ID: "project-fixture" },
        })
      );
      const init = { method: "POST", body: '{"model":"fixture","messages":[]}' };
      await fetcher("https://proxy.example/watsonx/chat/completions", init);
      await fetcher("https://proxy.example/watsonx/chat/completions", init);
      now.mockReturnValue(2_000_000);
      safeFetch.mockResolvedValueOnce(
        jsonResponse({ access_token: "iam-refreshed", expiration: 4000 })
      );
      await fetcher("https://proxy.example/watsonx/chat/completions", init);
      expect(safeFetch.mock.calls[4][0]).toBe(
        "https://proxy.example/watsonx/ml/v1/text/chat?version=2026-04-20"
      );
      expect(requestHeaders(4).get("Authorization")).toBe("Bearer iam-refreshed");
    });

    it("rejects missing Watsonx project context before requesting a token", async () => {
      await expect(
        createProviderFetch(model({ providerCatalogId: "watsonx" }))(
          "https://us-south.ml.cloud.ibm.com/chat/completions",
          { body: "{}" }
        )
      ).rejects.toThrow("project");
      expect(safeFetch).not.toHaveBeenCalled();
    });

    it("sends the Google OAuth exchange without recursively applying inference authentication", async () => {
      await createProviderFetch(
        model({ providerCatalogId: "google-vertex", apiKey: serviceAccount })
      )("https://oauth2.googleapis.com/token", {
        method: "POST",
        body: "grant_type=jwt-bearer&assertion=fixture",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      });
      expect(requestHeaders(0).get("Authorization")).toBeNull();
      expect(googleAuth).not.toHaveBeenCalled();
    });

    it("uses a supplied Vertex OAuth token without importing service-account identity", async () => {
      await createProviderFetch(
        model({ providerCatalogId: "google-vertex", apiKey: "ya29.fixture" })
      )(
        "https://aiplatform.googleapis.com/v1/projects/p/locations/global/endpoints/openapi/chat/completions",
        { headers: { Authorization: "Bearer provider-managed-auth" } }
      );
      expect(requestHeaders(0).get("Authorization")).toBe("Bearer ya29.fixture");
      expect(googleAuth).not.toHaveBeenCalled();
    });

    it("uses the Google library to refresh service-account access tokens and ignores a credential-supplied token host", async () => {
      const getAccessToken = jest
        .fn()
        .mockResolvedValueOnce("ya29.first")
        .mockResolvedValueOnce("ya29.refreshed");
      googleAuth.mockReturnValue(getAccessToken);
      const fetcher = createProviderFetch(
        model({ providerCatalogId: "google-vertex", apiKey: serviceAccount })
      );
      const url =
        "https://aiplatform.googleapis.com/v1/projects/p/locations/global/endpoints/openapi/chat/completions";
      await fetcher(url, { headers: { Authorization: "Bearer provider-managed-auth" } });
      await fetcher(url, { headers: { Authorization: "Bearer provider-managed-auth" } });
      expect(googleAuth).toHaveBeenCalledTimes(1);
      expect(googleAuth).toHaveBeenCalledWith(
        "fixture@fixture.iam.gserviceaccount.com",
        "fixture-private-key",
        expect.any(Function),
        undefined
      );
      expect(requestHeaders(0).get("Authorization")).toBe("Bearer ya29.first");
      expect(requestHeaders(1).get("Authorization")).toBe("Bearer ya29.refreshed");
    });

    it.each([undefined, "Bearer", "Basic fixture"])(
      "obtains Vertex authorization when the SDK did not supply a real bearer token: %p",
      async (authorization) => {
        await createProviderFetch(
          model({ providerCatalogId: "google-vertex", apiKey: "ya29.fixture" })
        )("https://aiplatform.googleapis.com/v1/chat/completions", {
          headers: authorization ? { Authorization: authorization } : {},
        });
        expect(requestHeaders(0).get("Authorization")).toBe("Bearer ya29.fixture");
      }
    );

    it("coalesces concurrent Copilot credential exchanges without serializing inference requests", async () => {
      safeFetch.mockResolvedValueOnce(
        jsonResponse({ token: "service-token", expires_at: Math.floor(Date.now() / 1000) + 3600 })
      );
      const fetcher = createProviderFetch(
        model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" })
      );
      await Promise.all([
        fetcher("https://api.githubcopilot.com/responses"),
        fetcher("https://api.githubcopilot.com/responses"),
      ]);
      expect(safeFetch.mock.calls.filter(([url]) => url.includes("copilot_internal"))).toHaveLength(
        1
      );
      expect(safeFetch.mock.calls.filter(([url]) => url.endsWith("/responses"))).toHaveLength(2);
    });

    it("returns provider inference failures unchanged for the SDK to interpret", async () => {
      const response = jsonResponse({ error: { message: "fixture permission denied" } }, 403);
      safeFetch.mockResolvedValueOnce(response);
      expect(await createProviderFetch(model())("https://proxy.example/chat/completions")).toBe(
        response
      );
    });

    it.each(["file:///tmp/provider", "https://key:secret@proxy.example/v1"])(
      "rejects unsafe request URL %s before forwarding credentials",
      async (url) => {
        await expect(createProviderFetch(model())(url)).rejects.toThrow();
        expect(safeFetch).not.toHaveBeenCalled();
      }
    );

    it.each([401, 403])(
      "preserves authentication HTTP %s without exposing a token response body",
      async (status) => {
        safeFetch.mockResolvedValueOnce(
          jsonResponse({ secret: "fixture-secret-must-not-leak" }, status)
        );
        await expect(
          createProviderFetch(
            model({ providerCatalogId: "github-copilot", apiKey: "ghu_fixture" })
          )("https://api.githubcopilot.com/responses")
        ).rejects.toMatchObject({ status });
        expect(safeFetch).toHaveBeenCalledTimes(1);
      }
    );

    it.each([false, true])(
      "routes Vertex Mistral stream=%s through its official model prediction method and preserves the payload",
      async (stream) => {
        const body = JSON.stringify({
          model: "mistral-large-2411@001",
          messages: [{ role: "user", content: "保持原样" }],
          stream,
        });
        await createProviderFetch(
          model({
            providerCatalogId: "google-vertex",
            providerNpm: "@ai-sdk/mistral",
            name: "mistral-large-2411@001",
            apiKey: "ya29.fixture",
          })
        )(
          "https://us-central1-aiplatform.googleapis.com/v1/projects/project/locations/us-central1/publishers/mistralai/models/chat/completions",
          { method: "POST", body, headers: { Authorization: "Bearer provider-managed-auth" } }
        );
        expect(safeFetch.mock.calls[0][0]).toBe(
          `https://us-central1-aiplatform.googleapis.com/v1/projects/project/locations/us-central1/publishers/mistralai/models/mistral-large-2411%40001:${stream ? "streamRawPredict" : "rawPredict"}`
        );
        expect(safeFetch.mock.calls[0][1]?.body).toBe(body);
        expect(requestHeaders(0).get("Authorization")).toBe("Bearer ya29.fixture");
      }
    );

    it("keeps a custom Vertex Mistral endpoint unchanged when it does not match the model prediction path", async () => {
      const url = "https://custom.example/mistral/v1/chat/completions";
      await createProviderFetch(
        model({
          providerCatalogId: "google-vertex",
          providerNpm: "@ai-sdk/mistral",
          apiKey: "ya29.fixture",
        })
      )(url, { method: "POST", body: '{"model":"fixture","messages":[],"stream":true}' });
      expect(safeFetch.mock.calls[0][0]).toBe(url);
    });

    it.each([
      [{ max_tokens: 128 }, { max_completion_tokens: 128 }],
      [{ max_tokens: 128, max_completion_tokens: 64 }, { max_completion_tokens: 64 }],
      [{ max_completion_tokens: 64 }, { max_completion_tokens: 64 }],
      [{}, {}],
    ])(
      "sends Snowflake limits %p successfully to a service that rejects deprecated max_tokens",
      async (limits, expectedLimits) => {
        safeFetch.mockImplementation(async (_url, init) => {
          const payload = JSON.parse(init?.body as string) as Record<string, unknown>;
          return "max_tokens" in payload
            ? jsonResponse({ error: "max_tokens is deprecated; use max_completion_tokens" }, 400)
            : jsonResponse({
                choices: [{ message: { role: "assistant", content: "fixture success" } }],
              });
        });
        const messages = [
          { role: "system", content: "系统内容保持原样" },
          { role: "user", content: "用户内容保持原样" },
        ];
        const response = await createProviderFetch(
          model({ providerCatalogId: "snowflake-cortex" })
        )("https://account.snowflakecomputing.com/api/v2/cortex/v1/chat/completions", {
          method: "POST",
          body: JSON.stringify({ model: "fixture-model", messages, ...limits }),
        });
        expect(response.ok).toBe(true);
        expect(JSON.parse(safeFetch.mock.calls[0][1]?.body as string)).toEqual({
          model: "fixture-model",
          messages,
          ...expectedLimits,
        });
      }
    );

    it("keeps max_tokens unchanged for providers other than Snowflake", async () => {
      const body = '{"model":"fixture","max_tokens":128,"messages":[]}';
      await createProviderFetch(model())("https://proxy.example/chat/completions", {
        method: "POST",
        body,
      });
      expect(safeFetch.mock.calls[0][1]?.body).toBe(body);
    });

    it.each<[string, Record<string, string>]>([
      [
        "go/anthropic/v1/messages",
        { "x-api-key": "fixture-key", "anthropic-version": "2023-06-01" },
      ],
      ["anthropic/v1/messages", { "x-api-key": "fixture-key", "anthropic-version": "2023-06-01" }],
      [
        "go/google/v1beta/models/gemini:generateContent?key=fixture-key&alt=sse",
        { "x-goog-api-key": "fixture-key", "x-goog-api-client": "fixture-sdk" },
      ],
      [
        "google/v1beta/models/gemini:streamGenerateContent?alt=sse",
        { "x-goog-api-key": "fixture-key", "x-goog-api-client": "fixture-sdk" },
      ],
    ])(
      "authenticates official OpenCode %s against a service that strictly requires Bearer credentials",
      async (route, sdkHeaders) => {
        safeFetch.mockImplementation(async (url, options) => {
          const headers = new Headers(options?.headers);
          const target = new URL(url);
          return headers.get("Authorization") === "Bearer fixture-key" &&
            !headers.has("x-api-key") &&
            !headers.has("x-goog-api-key") &&
            !target.searchParams.has("key")
            ? jsonResponse({ accepted: true })
            : jsonResponse({ error: "OpenCode requires Bearer authentication" }, 401);
        });
        const body = '{"messages":[{"role":"user","content":"内容保持原样"}]}';
        const response = await createProviderFetch(model())(
          `https://opencode.ai/inference/${route}`,
          { method: "POST", body, headers: sdkHeaders }
        );
        expect(response.ok).toBe(true);
        expect(safeFetch.mock.calls[0][1]?.body).toBe(body);
        const expectedUrl = new URL(`https://opencode.ai/inference/${route}`);
        expectedUrl.searchParams.delete("key");
        expect(safeFetch.mock.calls[0][0]).toBe(expectedUrl.toString());
        if ("anthropic-version" in sdkHeaders)
          expect(requestHeaders(0).get("anthropic-version")).toBe("2023-06-01");
        if ("x-goog-api-client" in sdkHeaders)
          expect(requestHeaders(0).get("x-goog-api-client")).toBe("fixture-sdk");
      }
    );

    it("preserves native SDK credentials for a custom proxy even when its path resembles OpenCode", async () => {
      const url =
        "https://proxy.example/inference/go/google/v1beta/models/gemini:generateContent?key=fixture-key";
      await createProviderFetch(model())(url, { headers: { "x-goog-api-key": "fixture-key" } });
      expect(requestHeaders(0).get("x-goog-api-key")).toBe("fixture-key");
      expect(requestHeaders(0).has("Authorization")).toBe(false);
      expect(safeFetch.mock.calls[0][0]).toBe(url);
    });

    it("rejects an official OpenCode request when the configured credential is missing instead of sending an anonymous request", async () => {
      await expect(
        createProviderFetch(model({ apiKey: undefined }))(
          "https://opencode.ai/inference/go/anthropic/v1/messages",
          { headers: { "x-api-key": "sdk-placeholder" } }
        )
      ).rejects.toThrow("credentials are missing");
      expect(safeFetch).not.toHaveBeenCalled();
    });

    it("preserves an existing native Vertex SDK bearer token without parsing or replacing credentials", async () => {
      await createProviderFetch(
        model({ providerCatalogId: "google-vertex-anthropic", apiKey: "invalid-json-is-not-used" })
      )(
        "https://aiplatform.googleapis.com/v1/projects/p/locations/global/publishers/anthropic/models/claude:streamRawPredict",
        { headers: { Authorization: "Bearer sdk-real-token" } }
      );
      expect(requestHeaders(0).get("Authorization")).toBe("Bearer sdk-real-token");
      expect(googleAuth).not.toHaveBeenCalled();
    });
  });
});
