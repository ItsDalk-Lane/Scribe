import { generateKeyPairSync, randomBytes, webcrypto } from "node:crypto";
import { runInThisContext } from "node:vm";
import type { App } from "obsidian";
import * as obsidian from "obsidian";
import type { CustomModel } from "@/aiParams";
import { ChatModelProviders } from "@/constants";
import { createProviderChatModel } from "@/LLMProviders/createProviderChatModel";
import { collectText, fixtureSse } from "@/LLMProviders/testing/piFixtures";
import { configuredModelToCustomModel } from "@/modelManagement";
import type { Provider, ModelInfo } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { logFileManager } from "@/logFileManager";
import { logError } from "@/logger";
import { getSettings, setSettings } from "@/settings/model";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/8";
const nativeClasses = runInThisContext("({ Headers, Request, Response })") as {
  Headers: typeof Headers;
  Request: typeof Request;
  Response: typeof Response;
};
const { __setRequestUrlImpl: setRequestUrlImpl } = obsidian as unknown as {
  __setRequestUrlImpl: (impl: unknown) => void;
};
const keyPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = keyPair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const privateMarker = privateKey.split("\n")[2];
const secretEntries = new Map<string, string>();
const completion = fixtureSse({
  choices: [
    { index: 0, message: { role: "assistant", content: "fixture success" }, finish_reason: "stop" },
  ],
});

interface CapturedRequest {
  url: string;
  headers: Record<string, string>;
  body?: string;
}

function installNetwork(tokenStatus = 200): CapturedRequest[] {
  const requests: CapturedRequest[] = [];
  function reply(url: string, options: RequestInit = {}) {
    requests.push({
      url,
      headers: Object.fromEntries(new Headers(options.headers).entries()),
      body: options.body as string | undefined,
    });
    const oauth = url === "https://oauth2.googleapis.com/token";
    const iam = url === "https://iam.cloud.ibm.com/identity/token";
    const status = oauth || iam ? tokenStatus : 200;
    const text =
      oauth || iam
        ? JSON.stringify(
            status === 200
              ? { access_token: "short-lived-access-token", expires_in: 3600 }
              : { error: "permission denied", credential: privateKey }
          )
        : url.includes(":streamGenerateContent")
          ? fixtureSse({
              candidates: [
                { content: { parts: [{ text: "fixture success" }] }, finishReason: "STOP" },
              ],
            })
          : url.includes(":streamRawPredict") &&
              typeof options.body === "string" &&
              options.body.includes("anthropic_version")
            ? fixtureSse({
                type: "message",
                role: "assistant",
                model: "fixture-model",
                id: "fixture-message",
                content: [{ type: "text", text: "fixture success" }],
                stop_reason: "end_turn",
                usage: { input_tokens: 1, output_tokens: 1 },
              })
            : completion;
    return {
      status,
      text,
      json: oauth || iam ? (JSON.parse(text) as unknown) : {},
      arrayBuffer: new ArrayBuffer(0),
      headers: { "content-type": oauth || iam ? "application/json" : "text/event-stream" },
    };
  }
  window.fetch = jest.fn(async (input, options) => {
    const result = reply(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      options
    );
    return new Response(result.text, { status: result.status, headers: result.headers });
  });
  setRequestUrlImpl(async (request: RequestInit & { url: string }) => reply(request.url, request));
  return requests;
}

function savedVertexModel(npm: string, enableCors: boolean, pretty: boolean): CustomModel {
  const secret = JSON.stringify(
    {
      type: "service_account",
      project_id: "synthetic-project",
      client_email: "synthetic-account@example.invalid",
      private_key: privateKey,
      private_key_id: "synthetic-key-id",
    },
    null,
    pretty ? 2 : undefined
  );
  const id = `synthetic-${randomBytes(8).toString("hex")}`;
  secretEntries.set(id, secret);
  const provider: Provider = {
    providerId: "saved-vertex",
    providerType: "openai-compatible",
    displayName: "Synthetic Vertex",
    origin: { kind: "byok", catalogProviderId: "google-vertex" },
    addedAt: 0,
    apiKeyKeychainId: id,
    enableCors,
    extras: { GOOGLE_VERTEX_PROJECT: "synthetic-project", GOOGLE_VERTEX_LOCATION: "us-central1" },
  };
  const info: ModelInfo = {
    id: npm === "@ai-sdk/mistral" ? "codestral-2" : "openai/gpt-oss-120b-maas",
    displayName: "Synthetic model",
    provider: {
      npm,
      api:
        npm === "@ai-sdk/mistral"
          ? "https://us-central1-aiplatform.googleapis.com/v1/projects/synthetic-project/locations/us-central1/publishers/mistralai/models"
          : "https://us-central1-aiplatform.googleapis.com/v1/projects/synthetic-project/locations/us-central1/endpoints/openapi",
    },
  };
  return configuredModelToCustomModel({
    provider,
    configuredModel: {
      configuredModelId: "saved-vertex-model",
      providerId: provider.providerId,
      configuredAt: 0,
      info,
    },
    apiKey: KeychainService.getInstance().getSecretById(id),
  });
}

async function attempt(model: CustomModel): Promise<{ reply: string; error?: Error }> {
  try {
    return {
      reply: await collectText(await createProviderChatModel(model), "Synthetic note", {
        maxRetries: 0,
      }),
    };
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    await logFileManager.append("ERROR", "Model request failed", failure);
    return { reply: "", error: failure };
  }
}

describe("providerTransport authentication integration", () => {
  const previousClasses = {
    Headers: window.Headers,
    Request: window.Request,
    Response: window.Response,
  };
  const previousFetch = window.fetch;
  const previousSubtle = window.crypto.subtle;
  const previousDebug = getSettings().debug;

  beforeAll(() => {
    Object.assign(window, nativeClasses);
    Object.defineProperty(window.crypto, "subtle", { configurable: true, value: webcrypto.subtle });
    KeychainService.resetInstance();
    KeychainService.getInstance({
      vault: { adapter: { getBasePath: () => "/synthetic-vault" } },
      secretStorage: { getSecret: (id: string) => secretEntries.get(id) ?? null },
    } as unknown as App);
  });
  beforeEach(async () => {
    secretEntries.clear();
    setSettings({ debug: false });
    await logFileManager.clear();
  });
  afterAll(() => {
    Object.assign(window, previousClasses);
    window.fetch = previousFetch;
    Object.defineProperty(window.crypto, "subtle", { configurable: true, value: previousSubtle });
    setRequestUrlImpl(undefined);
    KeychainService.resetInstance();
    setSettings({ debug: previousDebug });
  });

  describe("createProviderChatModel", () => {
    it.each(
      ["@ai-sdk/mistral", "@ai-sdk/openai-compatible"].flatMap((npm) =>
        [false, true].flatMap((enableCors) =>
          [false, true].map((pretty) => ({ npm, enableCors, pretty }))
        )
      )
    )(
      `exchanges stored Vertex JSON before inference without exposing it for %j (${issue})`,
      async ({ npm, enableCors, pretty }) => {
        const requests = installNetwork();
        const model = savedVertexModel(npm, enableCors, pretty);
        const result = await attempt(model);
        expect(result.reply).toBe("fixture success");
        expect(requests).toHaveLength(2);
        expect(requests[0].url).toBe("https://oauth2.googleapis.com/token");
        expect(requests[0].headers.authorization).toBeUndefined();
        expect(requests[0].body).toContain("assertion=");
        const inference = requests[1];
        expect(inference.headers.authorization).toBe("Bearer short-lived-access-token");
        expect(JSON.parse(inference.body!).messages).toEqual([
          { role: "user", content: "Synthetic note" },
        ]);
        expect(result.error).toBeUndefined();
        for (const observed of [JSON.stringify(requests), logFileManager.exportLogText()]) {
          expect(observed.includes(privateMarker)).toBe(false);
          expect(observed.includes("PRIVATE KEY")).toBe(false);
          expect(observed.includes(model.apiKey!)).toBe(false);
        }
      }
    );

    it.each(
      [
        "@ai-sdk/mistral",
        "@ai-sdk/openai-compatible",
        "@ai-sdk/google-vertex",
        "@ai-sdk/google-vertex/anthropic",
      ].flatMap((npm) =>
        [false, true].flatMap((enableCors) =>
          [false, true].map((bearer) => ({ npm, enableCors, bearer }))
        )
      )
    )(
      `preserves supplied OAuth tokens without a duplicate Bearer prefix for %j (${issue})`,
      async ({ npm, enableCors, bearer }) => {
        const requests = installNetwork();
        const model = savedVertexModel("@ai-sdk/mistral", enableCors, true);
        model.providerNpm = npm;
        if (npm.startsWith("@ai-sdk/google-vertex")) model.baseUrl = undefined;
        model.apiKey = `${bearer ? "Bearer " : ""}ya29.synthetic-access-token`;
        expect((await attempt(model)).reply).toBe("fixture success");
        expect(requests).toHaveLength(1);
        expect(requests[0].headers.authorization).toBe("Bearer ya29.synthetic-access-token");
      }
    );

    it.each(
      [
        "@ai-sdk/mistral",
        "@ai-sdk/openai-compatible",
        "@ai-sdk/google-vertex",
        "@ai-sdk/google-vertex/anthropic",
      ].flatMap((npm) =>
        [false, true].flatMap((enableCors) =>
          ["pretty-array", "compact-array", "bearer-json", "quoted-json"].map((form) => ({
            npm,
            enableCors,
            form,
          }))
        )
      )
    )(
      `rejects incorrectly wrapped Vertex credentials locally without exposing secrets for %j (${issue})`,
      async ({ npm, enableCors, form }) => {
        const requests = installNetwork();
        const model = savedVertexModel("@ai-sdk/mistral", enableCors, true);
        const credentials = JSON.parse(model.apiKey!) as unknown;
        model.providerNpm = npm;
        if (npm.startsWith("@ai-sdk/google-vertex")) model.baseUrl = undefined;
        model.apiKey =
          form === "pretty-array"
            ? JSON.stringify([credentials], null, 2)
            : form === "compact-array"
              ? JSON.stringify([credentials])
              : form === "bearer-json"
                ? `Bearer ${JSON.stringify(credentials, null, 2)}`
                : JSON.stringify(model.apiKey);
        const result = await attempt(model);
        const observed = `${result.error?.message}\n${logFileManager.exportLogText()}`;
        expect(observed.includes(privateMarker)).toBe(false);
        expect(observed.includes("PRIVATE KEY")).toBe(false);
        expect(requests).toEqual([]);
        expect(result.error).toBeDefined();
      }
    );

    it.each([false, true])(
      `rejects a malformed OAuth token without repeating its secret content with compatibility=%s (${issue})`,
      async (enableCors) => {
        installNetwork();
        const model = savedVertexModel("@ai-sdk/mistral", enableCors, true);
        const oauth = { access_token: model.apiKey, expires_in: 3600 };
        setRequestUrlImpl(async () => ({
          status: 200,
          text: JSON.stringify(oauth),
          json: oauth,
          arrayBuffer: new ArrayBuffer(0),
          headers: { "content-type": "application/json" },
        }));
        window.fetch = jest.fn(
          async () =>
            new Response(JSON.stringify(oauth), {
              status: 200,
              headers: { "content-type": "application/json" },
            })
        );
        const result = await attempt(model);
        const observed = `${result.error?.message}\n${logFileManager.exportLogText()}`;
        expect(observed.includes(privateMarker)).toBe(false);
        expect(observed.includes("PRIVATE KEY")).toBe(false);
        expect(result.error?.message).toContain("Google did not return an access token");
      }
    );

    it.each([false, true])(
      `retains an actionable OAuth failure without secrets when compatibility=%s (${issue})`,
      async (enableCors) => {
        const requests = installNetwork(403);
        const model = savedVertexModel("@ai-sdk/mistral", enableCors, true);
        const result = await attempt(model);
        expect(requests).toHaveLength(1);
        expect(result.reply).toBe("");
        expect(result.error?.message).toContain("Google did not return an access token");
        expect(result.error).toMatchObject({ status: 403 });
        const errorAndLog = `${result.error?.message}\n${logFileManager.exportLogText()}`;
        expect(errorAndLog.includes(privateMarker)).toBe(false);
        expect(errorAndLog.includes("PRIVATE KEY")).toBe(false);
        expect(errorAndLog.includes(model.apiKey!)).toBe(false);
      }
    );

    it(`rejects malformed service-account JSON without repeating secret fragments in errors or logs (${issue})`, async () => {
      const requests = installNetwork();
      const model = savedVertexModel("@ai-sdk/openai-compatible", true, true);
      model.apiKey = '{"a":SYNTHETIC_SECRET_MARKER}';
      const result = await attempt(model);
      expect(requests).toEqual([]);
      const observed = `${result.error?.message}\n${logFileManager.exportLogText()}`;
      expect(observed.includes("SYNTHETIC_")).toBe(false);
      expect(result.error?.message).toContain("The provider credentials must be valid JSON");
    });

    it.each([false, true])(
      `keeps Quick Tools errors, debug records and exported logs free of private keys with debug=%s (${issue})`,
      async (debug) => {
        installNetwork(403);
        const result = await attempt(savedVertexModel("@ai-sdk/openai-compatible", true, true));
        const debugOutput = jest.spyOn(console, "error").mockImplementation(() => {});
        const append = jest.spyOn(logFileManager, "append");
        try {
          setSettings({ debug });
          logError("Quick Tools failure", result.error);
          await append.mock.results[0].value;
          expect(debugOutput).toHaveBeenCalledTimes(debug ? 1 : 0);
          const records = [
            result.error?.message,
            result.error?.stack,
            ...debugOutput.mock.calls
              .flat()
              .map((value) =>
                value instanceof Error ? `${value.message}\n${value.stack}` : String(value)
              ),
            logFileManager.exportLogText(),
          ].join("\n");
          expect(records).toContain("Google did not return an access token");
          expect(records.includes(privateMarker)).toBe(false);
          expect(records.includes("PRIVATE KEY")).toBe(false);
          expect(records.includes("service_account")).toBe(false);
        } finally {
          append.mockRestore();
          debugOutput.mockRestore();
          setSettings({ debug: false });
        }
      }
    );

    it.each([false, true])(
      `keeps Watsonx IAM authentication behind the SDK when compatibility=%s (${issue})`,
      async (enableCors) => {
        const requests = installNetwork();
        const model: CustomModel = {
          name: "ibm/synthetic-model",
          provider: ChatModelProviders.OPENAI_FORMAT,
          providerNpm: "watsonx-ai-provider",
          providerCatalogId: "watsonx",
          providerOptions: { WATSONX_AI_PROJECT_ID: "synthetic-project" },
          baseUrl: "https://synthetic.ml.cloud.ibm.com",
          apiKey: `synthetic-iam-${randomBytes(16).toString("hex")}`,
          enableCors,
          enabled: true,
        };
        expect((await attempt(model)).reply).toBe("fixture success");
        expect(requests[0].url).toBe("https://iam.cloud.ibm.com/identity/token");
        expect(requests[0].body).toContain(`apikey=${model.apiKey}`);
        expect(requests[1].url).toContain("/ml/v1/text/chat_stream?");
        expect(requests[1].headers.authorization).toBe("Bearer short-lived-access-token");
        expect(JSON.stringify(requests[1]).includes(model.apiKey!)).toBe(false);
      }
    );

    it(`preserves direct API key authentication (${issue})`, async () => {
      const requests = installNetwork();
      const apiKey = `synthetic-direct-${randomBytes(16).toString("hex")}`;
      expect(
        (
          await attempt({
            name: "synthetic-model",
            provider: ChatModelProviders.OPENAI_FORMAT,
            providerNpm: "@ai-sdk/openai-compatible",
            baseUrl: "https://direct.example.invalid/v1",
            apiKey,
            enabled: true,
          })
        ).reply
      ).toBe("fixture success");
      expect(requests).toHaveLength(1);
      expect(requests[0].headers.authorization).toBe(`Bearer ${apiKey}`);
    });
  });
});
