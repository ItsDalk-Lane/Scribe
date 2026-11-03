import { randomBytes } from "node:crypto";
import type { AssistantMessage, Context } from "@earendil-works/pi-ai";
import type { CustomModel } from "@/aiParams";
import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import { collectReply, collectText, sse } from "@/LLMProviders/testing/piFixtures";
import * as obsidianModule from "obsidian";

jest.mock("@/logger");

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const apiKey = randomBytes(24).toString("hex");
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
interface RecordedRequest {
  url: string;
  body: Record<string, unknown>;
  headers: Headers;
  signal?: AbortSignal | null;
}

function googleModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "gemini-2.5-flash",
    provider: "google",
    providerNpm: "@ai-sdk/google",
    baseUrl: "https://google.fixture.invalid/v1beta",
    enabled: true,
    enableCors: false,
    apiKey,
    ...overrides,
  };
}

function googleChunk(text: string, finishReason = "STOP", continuationToken?: string) {
  return {
    candidates: [{ content: { parts: [{ text }] }, finishReason, continuationToken }],
  };
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((complete) => (resolve = complete));
  return { promise, resolve };
}

describe("httpChatApis", () => {
  const originalFetch = window.fetch;
  const requests: RecordedRequest[] = [];
  let respond: (request: RecordedRequest, index: number) => Promise<Response>;

  beforeEach(() => {
    requests.length = 0;
    respond = async () => new Response(sse([googleChunk("Reply")]));
    window.fetch = jest.fn(async (input, init) => {
      const request: RecordedRequest = {
        url: typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        body: JSON.parse(init?.body as string) as Record<string, unknown>,
        headers: new Headers(init?.headers),
        signal: init?.signal,
      };
      requests.push(request);
      return respond(request, requests.length - 1);
    });
    setRequestUrlImpl(
      async (input: { url: string; body: string; headers: Record<string, string> }) => {
        const request: RecordedRequest = {
          url: input.url,
          body: JSON.parse(input.body) as Record<string, unknown>,
          headers: new Headers(input.headers),
        };
        requests.push(request);
        const response = await respond(request, requests.length - 1);
        return {
          status: response.status,
          text: await response.text(),
          headers: Object.fromEntries(response.headers.entries()),
          arrayBuffer: new ArrayBuffer(0),
        };
      }
    );
  });

  afterEach(() => {
    window.fetch = originalFetch;
    setRequestUrlImpl(undefined);
  });

  describe("streamGoogle()", () => {
    it.each([false, true])(
      `sends bare and models-qualified IDs to the same configured endpoint with CORS=%s (${issue})`,
      async (enableCors) => {
        for (const name of ["gemini-2.5-flash", "models/gemini-2.5-flash"]) {
          const client = await createProviderChatModel(googleModel({ name, enableCors }));
          expect(await collectText(client)).toBe("Reply");
        }
        expect(requests.map((request) => request.url)).toEqual([
          "https://google.fixture.invalid/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
          "https://google.fixture.invalid/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
        ]);
        expect(requests.map((request) => request.headers.get("x-goog-api-key"))).toEqual([
          apiKey,
          apiKey,
        ]);
      }
    );

    it.each([
      ["tunedModels/personal model", "/tunedModels/personal%20model"],
      ["publishers/google/models/gemini-2.5-flash", "/publishers/google/models/gemini-2.5-flash"],
      [
        "projects/example/locations/us-central1/publishers/google/models/gemini-2.5-flash",
        "/projects/example/locations/us-central1/publishers/google/models/gemini-2.5-flash",
      ],
      ["private/model", "/models/private%2Fmodel"],
      ["https://untrusted.invalid/model", "/models/https%3A%2F%2Funtrusted.invalid%2Fmodel"],
    ])(
      `preserves legal resource paths and encodes an ordinary model ID: %s (${issue})`,
      async (name, path) => {
        const client = await createProviderChatModel(googleModel({ name }));
        await collectText(client);
        expect(requests[0].url).toBe(
          `https://google.fixture.invalid/v1beta${path}:streamGenerateContent?alt=sse`
        );
        expect(new URL(requests[0].url).hostname).toBe("google.fixture.invalid");
      }
    );

    it(`keeps the configured Vertex project, region and access token (${issue})`, async () => {
      const client = await createProviderChatModel(
        googleModel({
          providerNpm: "@ai-sdk/google-vertex",
          providerCatalogId: "google-vertex",
          baseUrl: "https://aiplatform.googleapis.com",
          apiKey: "synthetic-access-token",
          providerOptions: {
            GOOGLE_VERTEX_PROJECT: "fixture-project",
            GOOGLE_VERTEX_LOCATION: "us-central1",
          },
        })
      );
      await collectText(client);
      expect(requests[0].url).toBe(
        "https://us-central1-aiplatform.googleapis.com/v1/projects/fixture-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse"
      );
      expect(requests[0].headers.get("authorization")).toBe("Bearer synthetic-access-token");
    });

    it.each([
      [
        "projects/fixture-project/locations/us-central1/publishers/google/models/gemini-2.5-flash",
        "https://aiplatform.googleapis.com",
        "https://us-central1-aiplatform.googleapis.com/v1/projects/fixture-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
      ],
      [
        "publishers/google/models/gemini-2.5-flash",
        "https://aiplatform.googleapis.com",
        "https://us-central1-aiplatform.googleapis.com/v1/projects/fixture-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
      ],
      [
        "projects/fixture-project/locations/us-central1/publishers/google/models/gemini-2.5-flash",
        "https://vertex.fixture.invalid/proxy/v1/projects/fixture-project/locations/us-central1/publishers/google",
        "https://vertex.fixture.invalid/proxy/v1/projects/fixture-project/locations/us-central1/publishers/google/models/gemini-2.5-flash:streamGenerateContent?alt=sse",
      ],
    ])(
      `avoids duplicating the Vertex resource prefix for a qualified ID: %s (${issue})`,
      async (name, baseUrl, url) => {
        const client = await createProviderChatModel(
          googleModel({
            name,
            providerNpm: "@ai-sdk/google-vertex",
            providerCatalogId: "google-vertex",
            baseUrl,
            apiKey: "synthetic-access-token",
            providerOptions: {
              GOOGLE_VERTEX_PROJECT: "fixture-project",
              GOOGLE_VERTEX_LOCATION: "us-central1",
            },
          })
        );
        expect(await collectText(client)).toBe("Reply");
        expect(requests[0].url).toBe(url);
        expect(requests[0].headers.get("authorization")).toBe("Bearer synthetic-access-token");
      }
    );

    it.each(["gemma-3-27b-it", "models/gemma-3-27b-it"])(
      `sends the unchanged Gemma instruction once in the initial user message on first and follow-up turns: %s (${issue})`,
      async (name) => {
        const client = await createProviderChatModel(googleModel({ name }));
        const context: Context = {
          systemPrompt: "Only edit the supplied text.\nKeep every heading.",
          messages: [{ role: "user", content: "First question", timestamp: 0 }],
        };
        const reply = await collectReply(client, context);
        await collectReply(client, {
          ...context,
          messages: [
            ...context.messages,
            reply,
            { role: "user", content: "Follow-up", timestamp: 1 },
          ],
        });
        for (const request of requests) {
          expect(request.body).not.toHaveProperty("systemInstruction");
          expect((request.body.contents as unknown[])[0]).toEqual({
            role: "user",
            parts: [
              { text: "Only edit the supplied text.\nKeep every heading.\n\n" },
              { text: "First question" },
            ],
          });
          expect(JSON.stringify(request.body).split("Only edit the supplied text.")).toHaveLength(
            2
          );
        }
        expect((requests[1].body.contents as unknown[]).slice(1)).toEqual([
          { role: "model", parts: [{ text: "Reply" }] },
          { role: "user", parts: [{ text: "Follow-up" }] },
        ]);
      }
    );

    it(`keeps Gemini instructions in their supported system field (${issue})`, async () => {
      const client = await createProviderChatModel(googleModel());
      await collectReply(client, {
        systemPrompt: "Keep this instruction unchanged.",
        messages: [{ role: "user", content: "Question", timestamp: 0 }],
      });
      expect(requests[0].body).toEqual({
        contents: [{ role: "user", parts: [{ text: "Question" }] }],
        systemInstruction: { parts: [{ text: "Keep this instruction unchanged." }] },
      });
    });

    it.each([false, true])(
      `continues a long answer in order and reuses context, authentication and transport with CORS=%s (${issue})`,
      async (enableCors) => {
        respond = async (_request, index) =>
          new Response(
            sse([
              index === 0 ? googleChunk("First", "CONTINUATION", "next-1") : googleChunk(" second"),
            ])
          );
        const client = await createProviderChatModel(googleModel({ enableCors, maxTokens: 12000 }));
        const chunks: string[] = [];
        let reply: AssistantMessage | undefined;
        const context: Context = {
          systemPrompt: "Original instruction",
          messages: [{ role: "user", content: "Original synthetic note", timestamp: 0 }],
        };
        for await (const event of client.stream(context, {
          headers: { "x-turn": "same-turn" },
          maxRetries: 0,
        })) {
          if (event.type === "text_delta") chunks.push(event.delta);
          if (event.type === "done") reply = event.message;
        }
        expect(chunks).toEqual(["First", " second"]);
        expect(reply?.content).toEqual([{ type: "text", text: "First second" }]);
        expect(requests).toHaveLength(2);
        expect(requests[1].url).toBe(requests[0].url);
        expect(requests[1].body).toEqual({ ...requests[0].body, continuationToken: "next-1" });
        expect([...requests[1].headers.entries()]).toEqual([...requests[0].headers.entries()]);
        if (!enableCors) expect(requests[1].signal).toBe(requests[0].signal);
        await collectReply(client, {
          ...context,
          messages: [
            ...context.messages,
            reply!,
            { role: "user", content: "Follow-up", timestamp: 1 },
          ],
        });
        expect((requests[2].body.contents as unknown[])[1]).toEqual({
          role: "model",
          parts: [{ text: "First second" }],
        });
        expect(requests[2].body).not.toHaveProperty("continuationToken");
      }
    );

    it(`displays the first segment before requesting continuation (${issue})`, async () => {
      let finishFirst!: () => void;
      respond = async (_request, index) =>
        index === 0
          ? new Response(
              new ReadableStream<Uint8Array>({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      sse([{ candidates: [{ content: { parts: [{ text: "First" }] } }] }])
                    )
                  );
                  finishFirst = () => {
                    controller.enqueue(
                      new TextEncoder().encode(sse([googleChunk("", "CONTINUATION", "next-1")]))
                    );
                    controller.close();
                  };
                },
              })
            )
          : new Response(sse([googleChunk(" second")]));
      const client = await createProviderChatModel(googleModel());
      const stream = client.stream({ messages: [{ role: "user", content: "Note", timestamp: 0 }] });
      const iterator = stream[Symbol.asyncIterator]();
      let event = await iterator.next();
      while (!event.done && event.value.type !== "text_delta") event = await iterator.next();
      expect(event.value).toMatchObject({ type: "text_delta", delta: "First" });
      expect(requests).toHaveLength(1);
      finishFirst();
      const remaining: string[] = [];
      for (event = await iterator.next(); !event.done; event = await iterator.next()) {
        if (event.value.type === "text_delta") remaining.push(event.value.delta);
      }
      expect(remaining).toEqual([" second"]);
      expect(requests).toHaveLength(2);
    });

    it(`does not begin continuation when stopped after the visible first segment (${issue})`, async () => {
      const cancelled = deferred<void>();
      respond = async () =>
        new Response(
          new ReadableStream<Uint8Array>({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(sse([googleChunk("First", "CONTINUATION", "next-1")]))
              );
            },
            cancel() {
              cancelled.resolve();
            },
          })
        );
      const client = await createProviderChatModel(googleModel());
      const controller = new AbortController();
      const stream = client.stream(
        { messages: [{ role: "user", content: "Note", timestamp: 0 }] },
        { signal: controller.signal }
      );
      const iterator = stream[Symbol.asyncIterator]();
      let event = await iterator.next();
      while (!event.done && event.value.type !== "text_delta") event = await iterator.next();
      expect(event.value).toMatchObject({ type: "text_delta", delta: "First" });
      controller.abort();
      await expect(iterator.next()).rejects.toMatchObject({ name: "AbortError" });
      await cancelled.promise;
      expect(requests).toHaveLength(1);
    });

    it.each([
      [undefined, "continuation token", 1],
      ["same-token", "repeated", 2],
    ])(
      `rejects an unusable continuation token without an unbounded request loop: %s (${issue})`,
      async (token, error, count) => {
        respond = async () => new Response(sse([googleChunk("Partial", "CONTINUATION", token)]));
        const client = await createProviderChatModel(googleModel());
        await expect(collectText(client, "Note", { maxRetries: 0 })).rejects.toThrow(String(error));
        expect(requests).toHaveLength(count);
      }
    );

    it(`bounds continuation requests even when a gateway keeps returning fresh tokens (${issue})`, async () => {
      respond = async (_request, index) =>
        new Response(sse([googleChunk("Partial", "CONTINUATION", `next-${index}`)]));
      const client = await createProviderChatModel(googleModel());
      await expect(collectText(client, "Note", { maxRetries: 0 })).rejects.toThrow(
        "continuation request limit"
      );
      expect(requests).toHaveLength(33);
    });

    it(`combines usage across continued requests without counting intermediate snapshots twice (${issue})`, async () => {
      respond = async (_request, index) =>
        new Response(
          sse([
            { usageMetadata: { promptTokenCount: 2, candidatesTokenCount: 1, totalTokenCount: 3 } },
            {
              ...googleChunk(
                index === 0 ? "First" : " second",
                index === 0 ? "CONTINUATION" : "STOP",
                index === 0 ? "next-1" : undefined
              ),
              usageMetadata: {
                promptTokenCount: index === 0 ? 5 : 8,
                candidatesTokenCount: index === 0 ? 3 : 4,
                thoughtsTokenCount: 1,
                cachedContentTokenCount: 2,
                totalTokenCount: index === 0 ? 9 : 13,
              },
            },
          ])
        );
      const client = await createProviderChatModel(googleModel());
      const reply = await collectReply(client);
      expect(reply.content).toEqual([{ type: "text", text: "First second" }]);
      expect(reply.usage).toMatchObject({
        input: 9,
        output: 9,
        reasoning: 2,
        cacheRead: 4,
        totalTokens: 22,
      });
    });

    it(`fails a broken continuation without replaying its first segment or publishing success (${issue})`, async () => {
      respond = async (_request, index) =>
        index === 0
          ? new Response(sse([googleChunk("First", "CONTINUATION", "next-1")]))
          : new Response("Continuation unavailable", { status: 503 });
      const client = await createProviderChatModel(googleModel());
      const chunks: string[] = [];
      let done = false;
      await expect(
        (async () => {
          for await (const event of client.stream(
            { messages: [{ role: "user", content: "Note", timestamp: 0 }] },
            { maxRetries: 0 }
          )) {
            if (event.type === "text_delta") chunks.push(event.delta);
            if (event.type === "done") done = true;
          }
        })()
      ).rejects.toThrow("Continuation unavailable");
      expect(chunks).toEqual(["First"]);
      expect(done).toBe(false);
      expect(requests).toHaveLength(2);
    });

    it.each(["STOP", "MAX_TOKENS", "SAFETY"])(
      `preserves the terminal meaning of %s without starting continuation (${issue})`,
      async (finishReason) => {
        respond = async () => new Response(sse([googleChunk("Reply", finishReason)]));
        const client = await createProviderChatModel(googleModel());
        if (finishReason === "SAFETY") await expect(collectReply(client)).rejects.toThrow("SAFETY");
        else
          expect((await collectReply(client)).stopReason).toBe(
            finishReason === "MAX_TOKENS" ? "length" : "stop"
          );
        expect(requests).toHaveLength(1);
      }
    );
  });
});
