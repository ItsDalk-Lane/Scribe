import type { Model } from "@earendil-works/pi-ai";
import { createSapLanguageModel } from "@/LLMProviders/nativeSdk/createSapLanguageModel";
import { createProviderFetch } from "@/LLMProviders/providerTransport";
import { createPiChatModel } from "@/LLMProviders/piChatModel";
import { collectReply, sse } from "@/LLMProviders/testing/piFixtures";
import { ChatModelProviders } from "@/constants";

jest.mock("@/LLMProviders/providerTransport");
jest.mock("@/logger");

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const customModel = { name: "gpt-4.1", provider: ChatModelProviders.OPENAI_FORMAT, enabled: true };
const credentials = {
  clientId: "fixture-client",
  clientSecret: "fixture-secret",
  tokenUrl: "https://auth.fixture.invalid",
  apiUrl: "https://api.fixture.invalid",
  resourceGroup: "my-resource-group",
  deploymentId: "",
};
const descriptor: Model<"scribe-sap"> = {
  id: "gpt-4.1",
  name: "SAP model",
  provider: "sap-ai",
  api: "scribe-sap",
  baseUrl: "",
  input: ["text"],
  reasoning: false,
  contextWindow: 0,
  maxTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

describe("createSapLanguageModel", () => {
  describe("createSapLanguageModel", () => {
    let transport: jest.MockedFunction<typeof fetch>;
    let tokenCount: number;
    beforeEach(() => {
      tokenCount = 0;
      transport = jest.fn(async (input) => {
        const url = input as string;
        if (url.endsWith("/oauth/token")) {
          tokenCount++;
          return new Response(
            JSON.stringify({ access_token: `fixture-token-${tokenCount}`, expires_in: 3600 })
          );
        }
        if (url.includes("/deployments?"))
          return new Response(JSON.stringify({ resources: [{ id: "discovered-deployment" }] }));
        return new Response(
          sse(
            [
              {
                final_result: {
                  choices: [{ delta: { content: "Stream reply" }, finish_reason: "stop" }],
                  usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
                },
              },
            ],
            true
          )
        );
      });
      jest.mocked(createProviderFetch).mockReturnValue(transport);
    });
    afterEach(() => jest.restoreAllMocks());

    it(`preserves SAP authorization, discovery, prompt text, usage and refresh while using pi-ai streams (${issue})`, async () => {
      const now = jest.spyOn(Date, "now").mockReturnValue(100_000);
      const resolve = createSapLanguageModel(customModel, credentials);
      const chat = createPiChatModel(descriptor, async (options) => ({
        stream: await resolve(options),
        options: { fetch: transport, maxRetries: 0 },
      }));
      const reply = await collectReply(chat, "Original private input");
      expect(reply.content).toEqual([{ type: "text", text: "Stream reply" }]);
      expect(reply.usage).toMatchObject({ input: 1, output: 2, totalTokens: 3 });
      expect(transport.mock.calls[0][0]).toBe("https://auth.fixture.invalid/oauth/token");
      expect(new URLSearchParams(transport.mock.calls[0][1]?.body as string).get("client_id")).toBe(
        "fixture-client"
      );
      expect(transport.mock.calls[1][0]).toBe(
        "https://api.fixture.invalid/v2/lm/deployments?scenarioId=orchestration&status=RUNNING"
      );
      const request = transport.mock.calls[2];
      expect(request[0]).toBe(
        "https://api.fixture.invalid/v2/inference/deployments/discovered-deployment/v2/completion"
      );
      expect(new Headers(request[1]?.headers).get("authorization")).toBe("Bearer fixture-token-1");
      expect(new Headers(request[1]?.headers).get("ai-resource-group")).toBe("my-resource-group");
      expect(JSON.parse(request[1]?.body as string)).toMatchObject({
        config: {
          modules: {
            prompt_templating: {
              prompt: { template: [{ role: "user", content: "Original private input" }] },
            },
          },
        },
      });
      await collectReply(chat, "Cached token");
      expect(tokenCount).toBe(1);
      now.mockReturnValue(3_700_000);
      await collectReply(chat, "Refreshed token");
      expect(tokenCount).toBe(2);
      expect(
        transport.mock.calls.filter(([url]) => (url as string).includes("/deployments?"))
      ).toHaveLength(1);
      expect(new Headers(transport.mock.calls.at(-1)?.[1]?.headers).get("authorization")).toBe(
        "Bearer fixture-token-2"
      );
    });

    it(`preserves the authorization failure status and never attempts inference (${issue})`, async () => {
      transport.mockResolvedValueOnce(new Response("Denied", { status: 401 }));
      await expect(createSapLanguageModel(customModel, credentials)({})).rejects.toMatchObject({
        message: "SAP authorization failed (401).",
        statusCode: 401,
      });
      expect(transport).toHaveBeenCalledTimes(1);
    });

    it.each([
      { access_token: "", expires_in: 3600 },
      { access_token: "fixture", expires_in: 0 },
    ])(
      `rejects invalid token data %j instead of caching unusable credentials (${issue})`,
      async (payload) => {
        transport.mockResolvedValueOnce(new Response(JSON.stringify(payload)));
        await expect(createSapLanguageModel(customModel, credentials)({})).rejects.toThrow(
          "valid access token and expiration"
        );
        expect(transport).toHaveBeenCalledTimes(1);
      }
    );

    it(`reports a missing running deployment without sending an inference request (${issue})`, async () => {
      transport
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ access_token: "fixture", expires_in: 3600 }))
        )
        .mockResolvedValueOnce(new Response(JSON.stringify({ resources: [] })));
      await expect(createSapLanguageModel(customModel, credentials)({})).rejects.toThrow(
        "no running orchestration deployment"
      );
      expect(transport).toHaveBeenCalledTimes(2);
    });

    it(`keeps one shared credential refresh alive when a concurrent caller stops (${issue})`, async () => {
      let finishToken!: (response: Response) => void;
      const pendingToken = new Promise<Response>((resolve) => {
        finishToken = resolve;
      });
      transport.mockImplementationOnce(() => pendingToken);
      const resolve = createSapLanguageModel(customModel, {
        ...credentials,
        deploymentId: "fixed-deployment",
      });
      const controller = new AbortController();
      const first = resolve({ signal: controller.signal });
      const second = resolve({});
      controller.abort();
      expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0][1]?.signal?.aborted).toBe(false);
      finishToken(new Response(JSON.stringify({ access_token: "fixture", expires_in: 3600 })));
      const streams = await Promise.all([first, second]);
      expect(streams.every((stream) => typeof stream === "function")).toBe(true);
      expect(transport).toHaveBeenCalledTimes(1);
    });
  });
});
