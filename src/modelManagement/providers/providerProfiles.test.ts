import { readFileSync } from "fs";
import { chineseTranslations, setInterfaceLocale } from "@/lib/i18n";
import { join } from "path";
import { transformWireToCatalog } from "@/modelManagement/catalog/catalogTransform";
import type { WireCatalog } from "@/modelManagement/catalog/modelsDevWire";
import { expandProviderUrl, getProviderConnectionProfile } from "./providerProfiles";

jest.mock("@/settings/model", () => ({ getSettings: () => ({ debug: false }) }));

const catalogFixture = JSON.parse(
  readFileSync(join(__dirname, "__fixtures__/modelsDevProviderInventory.json"), "utf8")
) as WireCatalog;

describe("providerProfiles", () => {
  describe("getProviderConnectionProfile()", () => {
    it("keeps all 232 visible catalog providers and supplies complete URL-template inputs without concealing unsupported protocols", () => {
      const catalog = transformWireToCatalog(catalogFixture);
      expect(catalog).toHaveLength(232);
      for (const provider of catalog) {
        const profile = getProviderConnectionProfile(provider.id, provider.npm);
        const template = profile.preferCompatibilityEndpoint
          ? profile.defaultBaseUrl
          : (provider.defaultBaseUrl ?? profile.defaultBaseUrl);
        if (!template) {
          expect(["sap-ai-core", "qvac"]).toContain(provider.id);
          expect(profile.credentialLabel ?? profile.credentialPlaceholder).toBeTruthy();
          continue;
        }
        const values = Object.fromEntries(
          profile.parameters.map((parameter) => [
            parameter.key,
            parameter.key === "NEON_AI_GATEWAY_BASE_URL"
              ? "https://gateway.example"
              : "fixture-account",
          ])
        );
        expect(() => expandProviderUrl(template, values)).not.toThrow();
      }
    });

    it.each([
      "vercel",
      "cohere",
      "aihubmix",
      "salad-cloud",
      "merge-gateway",
      "qvac",
      "cloudflare-ai-gateway",
    ])(
      "uses the documented unified compatibility endpoint for %s instead of mixing native per-model protocols",
      (id) => expect(getProviderConnectionProfile(id).preferCompatibilityEndpoint).toBe(true)
    );

    it.each(["google-vertex", "google-vertex-anthropic", "github-copilot", "opencode-go"])(
      "preserves native per-model protocol selection for %s",
      (id) => expect(getProviderConnectionProfile(id).preferCompatibilityEndpoint).not.toBe(true)
    );

    it.each([
      ["openai", "https://api.openai.com/v1"],
      ["anthropic", "https://api.anthropic.com"],
      ["google", "https://generativelanguage.googleapis.com"],
      ["mistral", "https://api.mistral.ai/v1"],
      ["groq", "https://api.groq.com/openai/v1"],
      ["aihubmix", "https://aihubmix.com/v1"],
      ["vercel", "https://ai-gateway.vercel.sh/v1"],
      ["xai", "https://api.x.ai/v1"],
      ["cohere", "https://api.cohere.ai/compatibility/v1"],
      ["cerebras", "https://api.cerebras.ai/v1"],
      ["togetherai", "https://api.together.xyz/v1"],
      ["perplexity", "https://api.perplexity.ai"],
      ["deepinfra", "https://api.deepinfra.com/v1/openai"],
      ["venice", "https://api.venice.ai/api/v1"],
      ["salad-cloud", "https://ai.salad.cloud/v1"],
      ["google-vertex", "https://aiplatform.googleapis.com"],
      ["google-vertex-anthropic", "https://aiplatform.googleapis.com"],
      ["watsonx", "https://us-south.ml.cloud.ibm.com"],
      ["gitlab", "https://gitlab.com"],
      ["github-copilot", "https://api.githubcopilot.com"],
    ])("provides the documented default endpoint for %s", (id, expected) => {
      expect(getProviderConnectionProfile(id).defaultBaseUrl).toBe(expected);
    });

    it("uses the SDK profile for a new catalog provider ID with a known SDK", () => {
      expect(getProviderConnectionProfile("new-mistral", "@ai-sdk/mistral")).toBe(
        getProviderConnectionProfile("mistral")
      );
    });

    it("prefers the catalog provider profile over an SDK fallback", () => {
      expect(getProviderConnectionProfile("google-vertex-anthropic", "@ai-sdk/anthropic").npm).toBe(
        "@ai-sdk/google-vertex/anthropic"
      );
    });

    it("keeps one stable empty profile for unknown and custom providers without guessing an address", () => {
      const profile = getProviderConnectionProfile();
      expect(profile.parameters).toEqual([]);
      expect(profile.defaultBaseUrl).toBeUndefined();
      expect(getProviderConnectionProfile("custom", "unknown-sdk")).toBe(profile);
    });

    it("offers native API selection only for the implemented Cohere native route (https://github.com/logancyang/obsidian-copilot/issues/3147)", () => {
      expect(
        transformWireToCatalog(catalogFixture)
          .filter(
            (provider) => getProviderConnectionProfile(provider.id, provider.npm).nativeApiSupported
          )
          .map((provider) => provider.id)
      ).toEqual(["cohere"]);
    });

    it("provides Chinese text for every public profile label, credential hint and setup instruction", () => {
      for (const provider of transformWireToCatalog(catalogFixture)) {
        const profile = getProviderConnectionProfile(provider.id, provider.npm);
        const messages = [
          profile.credentialLabel,
          profile.credentialPlaceholder,
          ...profile.parameters.map((parameter) => parameter.label),
          ...(profile.instructions ?? []),
        ];
        for (const message of messages) {
          if (message)
            expect(Object.prototype.hasOwnProperty.call(chineseTranslations, message)).toBe(true);
        }
      }
    });

    it("requires QVAC's running server address rather than inventing a local port", () => {
      expect(getProviderConnectionProfile("qvac").defaultBaseUrl).toBeUndefined();
      expect(getProviderConnectionProfile("qvac").requiresBaseUrl).toBe(true);
      expect(getProviderConnectionProfile("qvac").credentialPlaceholder).toBeTruthy();
    });

    it.each(["google-vertex", "google-vertex-anthropic"])(
      "exposes project and location for %s and keeps service account credentials out of parameters",
      (id) => {
        const profile = getProviderConnectionProfile(id);
        expect(profile.parameters).toEqual([
          expect.objectContaining({ key: "GOOGLE_VERTEX_PROJECT", required: true }),
          expect.objectContaining({ key: "GOOGLE_VERTEX_LOCATION", defaultValue: "global" }),
        ]);
        expect(profile.credentialLabel).toContain("service account");
      }
    );

    it("exposes Watsonx project, SAP deployment, and GitLab instance context without secret inputs", () => {
      expect(getProviderConnectionProfile("watsonx").parameters).toEqual([
        expect.objectContaining({ key: "WATSONX_AI_PROJECT_ID", required: true }),
      ]);
      expect(getProviderConnectionProfile("sap-ai-core").parameters).toEqual([
        expect.objectContaining({ key: "AICORE_RESOURCE_GROUP", defaultValue: "default" }),
        expect.objectContaining({ key: "AICORE_DEPLOYMENT_ID" }),
      ]);
      expect(getProviderConnectionProfile("sap-ai-core").credentialLabel).toContain("service key");
      expect(getProviderConnectionProfile("gitlab").parameters).toEqual([
        expect.objectContaining({
          key: "GITLAB_AI_GATEWAY_URL",
          defaultValue: "https://cloud.gitlab.com",
        }),
      ]);
    });

    it("exposes account and gateway identifiers for the Cloudflare URL template", () => {
      const profile = getProviderConnectionProfile("cloudflare-ai-gateway");
      expect(profile.defaultBaseUrl).toBe(
        "https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_GATEWAY_ID}/compat"
      );
      expect(profile.parameters.map((parameter) => parameter.key)).toEqual([
        "CLOUDFLARE_ACCOUNT_ID",
        "CLOUDFLARE_GATEWAY_ID",
      ]);
    });
  });

  describe("expandProviderUrl()", () => {
    it.each([
      [
        "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
        { CLOUDFLARE_ACCOUNT_ID: "account-1" },
        "https://api.cloudflare.com/client/v4/accounts/account-1/ai/v1",
      ],
      [
        "https://api.infomaniak.com/2/ai/${INFOMANIAK_PRODUCT_ID}/openai/v1",
        { INFOMANIAK_PRODUCT_ID: "123" },
        "https://api.infomaniak.com/2/ai/123/openai/v1",
      ],
      [
        "https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/v1",
        { SNOWFLAKE_ACCOUNT: "org-account" },
        "https://org-account.snowflakecomputing.com/api/v2/cortex/v1",
      ],
      [
        "${NEON_AI_GATEWAY_BASE_URL}/v1",
        { NEON_AI_GATEWAY_BASE_URL: "https://neon.example/gateway/" },
        "https://neon.example/gateway/v1",
      ],
      [
        "https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1",
        { DATABRICKS_HOST: "workspace.cloud.databricks.com" },
        "https://workspace.cloud.databricks.com/ai-gateway/mlflow/v1",
      ],
    ])("expands the existing provider URL template %s", (template, values, expected) => {
      expect(expandProviderUrl(template, values)).toBe(expected);
    });

    it("translates its own parameter error while preserving the exact parameter identifier", () => {
      setInterfaceLocale("zh-CN");
      try {
        expect(() => expandProviderUrl("https://api.example/${ACCOUNT}/v1", {})).toThrow(
          "缺少必填连接参数：ACCOUNT。"
        );
      } finally {
        setInterfaceLocale("en");
      }
    });

    it("accepts explicit local HTTP addresses and trims surrounding whitespace", () => {
      expect(expandProviderUrl("  http://localhost:1234/v1  ", {})).toBe(
        "http://localhost:1234/v1"
      );
    });

    it("encodes path parameters without allowing them to replace the endpoint host or path structure", () => {
      expect(
        expandProviderUrl("https://api.example/accounts/${ACCOUNT}/v1", {
          ACCOUNT: "a/b@evil.example",
        })
      ).toBe("https://api.example/accounts/a%2Fb%40evil.example/v1");
    });

    it.each([undefined, null, "", "   ", {}, []])(
      "rejects missing or non-string URL parameters: %p",
      (value) => {
        expect(() =>
          expandProviderUrl("https://api.example/${ACCOUNT}/v1", { ACCOUNT: value })
        ).toThrow("ACCOUNT");
      }
    );

    it.each([
      "",
      "relative/v1",
      "file:///tmp/model",
      "javascript:alert(1)",
      "https://user:password@api.example/v1",
      "https://api.example/v1#fragment",
      "https://api.example/v1?api_key=secret",
      "https://api.example\\@evil.example/v1",
    ])("rejects unsafe or non-HTTP endpoint addresses: %s", (template) => {
      expect(() => expandProviderUrl(template, {})).toThrow();
    });

    it.each([
      "https://evil.example/a",
      "user@evil.example",
      "safe.example/path",
      "safe.example?x=1",
    ])("rejects an injected hostname component: %s", (host) => {
      expect(() =>
        expandProviderUrl("https://${DATABRICKS_HOST}/v1", { DATABRICKS_HOST: host })
      ).toThrow();
    });

    it.each([".", ".."])("rejects traversal parameter %s", (value) => {
      expect(() =>
        expandProviderUrl("https://api.example/accounts/${ACCOUNT}/v1", { ACCOUNT: value })
      ).toThrow();
    });

    it("rejects a template that appends another hostname to a whole-base URL parameter", () => {
      expect(() =>
        expandProviderUrl("${NEON_AI_GATEWAY_BASE_URL}.evil.example/v1", {
          NEON_AI_GATEWAY_BASE_URL: "https://neon.example",
        })
      ).toThrow();
    });

    it.each([
      "file:///tmp/model",
      "https://key:secret@neon.example",
      "https://neon.example?key=secret",
    ])("rejects an unsafe full-base parameter: %s", (value) => {
      expect(() =>
        expandProviderUrl("${NEON_AI_GATEWAY_BASE_URL}/v1", { NEON_AI_GATEWAY_BASE_URL: value })
      ).toThrow();
    });
  });
});
