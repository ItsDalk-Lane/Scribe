import { readFileSync } from "fs";
import { join } from "path";
import { transformWireToCatalog } from "@/modelManagement/catalog/catalogTransform";
import { getProviderConnectionProfile } from "@/modelManagement/providers/providerProfiles";
import { configuredModelToCustomModel } from "@/modelManagement/chatModel/configuredModelToCustomModel";
import { isChatModelInfo } from "@/modelManagement/chatModel/modelCapabilityFlags";
import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import { collectText, fixtureSse } from "@/LLMProviders/testing/piFixtures";
import type { Provider } from "@/modelManagement/types/persisted";
import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { WireCatalog } from "@/modelManagement/catalog/modelsDevWire";
import * as obsidianModule from "obsidian";

jest.mock("@/logger");
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => true }));
jest.mock("@/utils/desktopStreamingFetch", () => ({
  loadDesktopStreamingFetch: () =>
    jest.requireActual<typeof import("@/utils")>("@/utils").safeFetchNoThrow,
}));
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidianModule as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
const fixture = JSON.parse(
  readFileSync(join(__dirname, "../providers/__fixtures__/modelsDevProviderInventory.json"), "utf8")
) as WireCatalog;
const catalog = transformWireToCatalog(fixture);
const nativePackages = new Set([
  "@ai-sdk/google",
  "@ai-sdk/cohere",
  "@ai-sdk/google-vertex",
  "@ai-sdk/google-vertex/anthropic",
  "@jerome-benoit/sap-ai-provider-v2",
  "gitlab-ai-provider",
]);
const routes = catalog.flatMap((source) =>
  Object.values(source.models)
    .filter(isChatModelInfo)
    .map((info) => ({ source, info }))
);
Object.defineProperty(window, "fetch", {
  configurable: true,
  writable: true,
  value: jest.fn().mockRejectedValue(new Error("Native network disabled in provider matrix")),
});
let requests: Array<{ url: string; headers?: Record<string, string>; body?: string }> = [];

function configuration(source: (typeof catalog)[number]): Provider {
  const profile = getProviderConnectionProfile(source.id);
  const extras: Record<string, unknown> = {
    npm: source.npm,
    catalogBaseUrl: source.defaultBaseUrl ?? profile.defaultBaseUrl,
  };
  for (const parameter of profile.parameters)
    extras[parameter.key] =
      parameter.defaultValue ??
      (parameter.key.endsWith("_URL") ? "https://gateway.fixture.invalid" : "fixture-account");
  return {
    providerId: source.id,
    providerType: source.providerType,
    displayName: source.displayName,
    origin: { kind: "byok", catalogProviderId: source.id },
    baseUrl:
      source.defaultBaseUrl ??
      profile.defaultBaseUrl ??
      (source.id === "qvac" ? "http://localhost:8800/v1" : undefined),
    extras,
    requiresApiKey: true,
    addedAt: 0,
  };
}

function jsonReply(url: string): Record<string, unknown> {
  if (url.includes("iam.cloud.ibm.com")) return { access_token: "fixture-iam", expires_in: 3600 };
  if (url.includes("copilot_internal/v2/token"))
    return { token: "fixture-service-token", expires_at: Math.floor(Date.now() / 1000) + 3600 };
  if (url.endsWith("/messages"))
    return {
      id: "m",
      type: "message",
      role: "assistant",
      model: "fixture",
      content: [{ type: "text", text: "ok" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
    };
  if (url.endsWith("/responses"))
    return {
      id: "r",
      object: "response",
      created_at: 1,
      model: "fixture",
      status: "completed",
      output: [
        {
          type: "message",
          id: "m",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text: "ok", annotations: [] }],
        },
      ],
      usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    };
  return {
    id: "c",
    object: "chat.completion",
    created: 1,
    model: "fixture",
    choices: [{ index: 0, message: { role: "assistant", content: "ok" }, finish_reason: "stop" }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  };
}

describe("providerCoverage", () => {
  describe("createProviderChatModel", () => {
    beforeEach(() => {
      requests = [];
      setRequestUrlImpl(
        (request: { url: string; headers?: Record<string, string>; body?: string }) => {
          requests.push(request);
          const json = jsonReply(request.url);
          return Promise.resolve({
            status: 200,
            json,
            text: json.access_token || json.token ? JSON.stringify(json) : fixtureSse(json),
            headers: {
              "content-type":
                json.access_token || json.token ? "application/json" : "text/event-stream",
            },
            arrayBuffer: new ArrayBuffer(0),
          });
        }
      );
    });
    it("retains all 232 visible suppliers with at least one supported chat route", () => {
      expect(catalog).toHaveLength(232);
      const covered = new Set(routes.map(({ source }) => source.id));
      expect(
        catalog.filter((source) => !covered.has(source.id)).map((source) => source.id)
      ).toEqual([]);
    });
    it.each(routes.map(({ source, info }) => [source.id, info.id, source, info] as const))(
      "builds %s / %s from the same saved configuration used by Quick tools",
      async (_id, _modelId, source, info: ModelInfo) => {
        const provider = configuration(source);
        const key =
          source.id === "sap-ai-core"
            ? JSON.stringify({
                clientid: "fixture",
                clientsecret: "fixture",
                url: "https://login.fixture.invalid",
                serviceurls: { AI_API_URL: "https://sap.fixture.invalid" },
              })
            : source.id === "github-copilot"
              ? "ghu_fixture_token"
              : "fixture-access-token";
        const custom = configuredModelToCustomModel({
          provider,
          configuredModel: {
            configuredModelId: `${source.id}/${info.id}`,
            providerId: source.id,
            info,
            configuredAt: 0,
          },
          apiKey: key,
        });
        const model = await createProviderChatModel({ ...custom, stream: false });
        expect(model).toBeDefined();
        if (nativePackages.has(custom.providerNpm!)) {
          expect(requests).toHaveLength(0);
        } else {
          expect(await collectText(model, "Connection fixture")).toBe("ok");
          const inference = requests[requests.length - 1];
          expect(inference).toBeDefined();
          expect(inference.body).toContain("Connection fixture");
          expect(inference.url).not.toContain("${");
          expect(new URL(inference.url).hostname).toBe(new URL(custom.baseUrl!).hostname);
        }
      }
    );
  });
});
