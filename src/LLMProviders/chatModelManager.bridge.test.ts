import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import { MissingApiKeyError } from "@/error";
import { getSettings, setSettings } from "@/settings/model";
import { collectText, fixtureSse } from "@/LLMProviders/testing/piFixtures";
import ChatModelManager from "@/LLMProviders/chatModelManager";
import * as obsidian from "obsidian";

jest.mock("@/logger");
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const completion = {
  id: "fixture",
  choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
};

function bridgedModel(overrides: Partial<CustomModel> = {}): CustomModel {
  return {
    name: "private-local-model",
    provider: ChatModelProviders.OPENAI_FORMAT,
    enabled: true,
    baseUrl: "http://127.0.0.1:1234/v1",
    ...overrides,
  };
}

describe("chatModelManager", () => {
  describe("ChatModelManager", () => {
    const originalKey = getSettings().openAIApiKey;
    const originalFetch = window.fetch;
    afterEach(() => {
      setSettings({ openAIApiKey: originalKey });
      window.fetch = originalFetch;
      setRequestUrlImpl(undefined);
    });

    describe("getInstance()", () => {
      it("shares the model manager without sharing conversation history", () => {
        expect(ChatModelManager.getInstance()).toBe(ChatModelManager.getInstance());
      });
    });

    describe("createModelInstanceFromBridged()", () => {
      it("does not fall back to a legacy top-level provider key", async () => {
        setSettings({ openAIApiKey: "legacy-key" });
        await expect(
          ChatModelManager.getInstance().createModelInstanceFromBridged(bridgedModel())
        ).rejects.toBeInstanceOf(MissingApiKeyError);
      });

      it.each([false, true])(
        "rejects a required missing key with CORS=%s (https://github.com/logancyang/obsidian-copilot/issues/2946)",
        async (enableCors) => {
          await expect(
            ChatModelManager.getInstance().createModelInstanceFromBridged(
              bridgedModel({ requiresApiKey: true, enableCors })
            )
          ).rejects.toBeInstanceOf(MissingApiKeyError);
        }
      );

      it.each(
        [false, true].flatMap((enableCors) =>
          [false, true].flatMap((stream) =>
            [
              { requiresApiKey: false, apiKey: undefined },
              { requiresApiKey: false, apiKey: "provided-key" },
              { requiresApiKey: true, apiKey: "provided-key" },
            ].map((auth) => ({ enableCors, stream, ...auth }))
          )
        )
      )(
        `streams a private model with its configured auth and transport: %j (${issue})`,
        async ({ enableCors, stream, requiresApiKey, apiKey }) => {
          let sentHeaders: Headers | undefined;
          let sentBody: string | undefined;
          const text = fixtureSse(completion);
          const capture = (options?: RequestInit) => {
            sentHeaders = new Headers(options?.headers);
            sentBody = options?.body as string | undefined;
          };
          const requestUrl = jest.fn(async (options: RequestInit) => {
            capture(options);
            return {
              status: 200,
              text,
              json: completion,
              arrayBuffer: new ArrayBuffer(0),
              headers: { "content-type": "text/event-stream" },
            };
          });
          const nativeFetch = jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>(
            async (_url, options) => {
              capture(options);
              return new Response(text, { headers: { "content-type": "text/event-stream" } });
            }
          );
          window.fetch = nativeFetch;
          setRequestUrlImpl(requestUrl);
          setSettings({ openAIApiKey: "legacy-key-must-not-leak" });
          const client = await ChatModelManager.getInstance().createModelInstanceFromBridged(
            bridgedModel({ enableCors, stream, requiresApiKey, apiKey })
          );
          expect(await collectText(client)).toBe("ok");
          expect(sentHeaders?.get("authorization")).toBe(apiKey ? `Bearer ${apiKey}` : null);
          expect(sentHeaders?.has("dangerously-allow-browser")).toBe(false);
          expect(JSON.parse(sentBody || "{}")).toMatchObject({
            model: "private-local-model",
            stream: true,
          });
          expect(requestUrl).toHaveBeenCalledTimes(enableCors ? 1 : 0);
          expect(nativeFetch).toHaveBeenCalledTimes(enableCors ? 0 : 1);
        }
      );

      it.each([undefined, 8192])(
        "preserves the Groq output limit %s and a versioned proxy without duplicating path segments",
        async (maxTokens) => {
          let captured: { url: string; body: string } | undefined;
          setRequestUrlImpl(async (request: { url: string; body: string }) => {
            captured = request;
            return {
              status: 200,
              text: fixtureSse(completion),
              json: completion,
              headers: { "content-type": "text/event-stream" },
              arrayBuffer: new ArrayBuffer(0),
            };
          });
          const client = await ChatModelManager.getInstance().createModelInstanceFromBridged(
            bridgedModel({
              provider: ChatModelProviders.GROQ,
              baseUrl: "https://api.groq.com/openai/v1",
              apiKey: "fixture",
              enableCors: true,
              maxTokens,
            })
          );
          expect(await collectText(client)).toBe("ok");
          expect(captured?.url).toBe("https://api.groq.com/openai/v1/chat/completions");
          expect(JSON.parse(captured!.body).max_tokens).toBe(maxTokens);
        }
      );
    });

    describe("countTokens()", () => {
      it.each([
        ["", 0],
        ["abcd", 1],
        ["abcde", 2],
        ["笔记中的文字", 2],
      ])("estimates %j as %i tokens without an active chat session", async (input, expected) => {
        await expect(ChatModelManager.getInstance().countTokens(input)).resolves.toBe(expected);
      });
    });
  });
});
