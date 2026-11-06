import { randomBytes } from "node:crypto";
import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import { createProviderFetch } from "@/LLMProviders/providerTransport";
import { collectText, fixtureSse } from "@/LLMProviders/testing/piFixtures";
import * as obsidian from "obsidian";

jest.mock("@/logger");

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
const completion = fixtureSse({
  choices: [{ index: 0, message: { content: "fixture success" }, finish_reason: "stop" }],
});

interface CapturedRequest {
  url: string;
  body?: string;
  headers: Headers;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function githubProviderModel(enableCors: boolean): CustomModel {
  return {
    name: "synthetic-model",
    provider: ChatModelProviders.OPENAI_FORMAT,
    providerNpm: "@ai-sdk/openai-compatible",
    providerCatalogId: "github-copilot",
    baseUrl: "https://api.githubcopilot.com",
    apiKey: `github_pat_${randomBytes(16).toString("hex")}`,
    enabled: true,
    enableCors,
  };
}

function pausedNetwork() {
  const tokenStarted = deferred<void>();
  const releaseToken = deferred<void>();
  const requests: CapturedRequest[] = [];
  async function respond(url: string, init: RequestInit = {}) {
    const token = url === "https://api.github.com/copilot_internal/v2/token";
    if (!token && init.signal?.aborted) throw new DOMException("Aborted", "AbortError");
    requests.push({
      url,
      body: init.body as string | undefined,
      headers: new Headers(init.headers),
    });
    if (token) {
      tokenStarted.resolve();
      await releaseToken.promise;
    }
    const text = token
      ? JSON.stringify({
          token: "short-lived-provider-token",
          expires_at: Math.floor(Date.now() / 1000) + 3600,
        })
      : completion;
    return {
      status: 200,
      text,
      json: token ? (JSON.parse(text) as unknown) : {},
      arrayBuffer: new ArrayBuffer(0),
      headers: { "content-type": token ? "application/json" : "text/event-stream" },
    };
  }
  setRequestUrlImpl(async (request: RequestInit & { url: string }) => {
    return respond(request.url, request);
  });
  window.fetch = jest.fn(async (input, init) => {
    const result = await respond(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      init
    );
    return new Response(result.text, { status: result.status, headers: result.headers });
  });
  return {
    tokenStarted: tokenStarted.promise,
    releaseToken: () => releaseToken.resolve(),
    requests,
  };
}

describe("providerTransport cancellation integration", () => {
  const originalFetch = window.fetch;
  afterEach(() => {
    window.fetch = originalFetch;
    setRequestUrlImpl(undefined);
  });

  describe("createProviderFetch()", () => {
    it.each([false, true])(
      `does not send a cancelled note after shared authentication finishes with compatibility=%s (${issue})`,
      async (enableCors) => {
        const network = pausedNetwork();
        const controller = new AbortController();
        const fetcher = createProviderFetch(githubProviderModel(enableCors));
        const result = fetcher("https://api.githubcopilot.com/chat/completions", {
          method: "POST",
          body: '{"messages":[{"role":"user","content":"Synthetic cancelled note"}]}',
          signal: controller.signal,
        });
        await network.tokenStarted;
        controller.abort();
        network.releaseToken();
        await expect(result).rejects.toMatchObject({ name: "AbortError" });
        expect(
          network.requests.filter((request) => request.url.endsWith("/chat/completions"))
        ).toEqual([]);
      }
    );

    it(`honors the signal carried by a Request before a compatibility request is dispatched (${issue})`, async () => {
      const network = pausedNetwork();
      const controller = new AbortController();
      const request = new Request("https://api.githubcopilot.com/chat/completions", {
        method: "POST",
        body: '{"messages":[{"role":"user","content":"Synthetic Request note"}]}',
        signal: controller.signal,
      });
      const result = createProviderFetch(githubProviderModel(true))(request);
      await network.tokenStarted;
      controller.abort();
      network.releaseToken();
      await expect(result).rejects.toMatchObject({ name: "AbortError" });
      expect(network.requests).toHaveLength(1);
    });

    it(`rejects an already cancelled request locally before starting authentication (${issue})`, async () => {
      const network = pausedNetwork();
      const controller = new AbortController();
      controller.abort();
      const result = createProviderFetch(githubProviderModel(true))(
        "https://api.githubcopilot.com/chat/completions",
        {
          signal: controller.signal,
        }
      );
      network.releaseToken();
      await expect(result).rejects.toMatchObject({ name: "AbortError" });
      expect(network.requests).toEqual([]);
    });
  });

  describe("createProviderChatModel()", () => {
    it.each([false, true])(
      `returns a stopped turn before token release and sends only its live sibling with compatibility=%s (${issue})`,
      async (enableCors) => {
        const network = pausedNetwork();
        const model = await createProviderChatModel(githubProviderModel(enableCors));
        const controller = new AbortController();
        const first = collectText(model, "Synthetic cancelled note", {
          signal: controller.signal,
          maxRetries: 0,
        });
        const stopped = expect(first).rejects.toMatchObject({ name: "AbortError" });
        await network.tokenStarted;
        const second = collectText(model, "Synthetic live note", { maxRetries: 0 });
        controller.abort();
        await stopped;
        network.releaseToken();
        expect(await second).toBe("fixture success");
        const inference = network.requests.filter((request) =>
          request.url.endsWith("/chat/completions")
        );
        expect(
          network.requests.filter((request) => request.url.includes("copilot_internal"))
        ).toHaveLength(2);
        expect(
          inference.map((request) => (JSON.parse(request.body!) as { messages: unknown }).messages)
        ).toEqual([[{ role: "user", content: "Synthetic live note" }]]);
        expect(inference[0].headers.get("authorization")).toBe("Bearer short-lived-provider-token");
      }
    );
  });
});
