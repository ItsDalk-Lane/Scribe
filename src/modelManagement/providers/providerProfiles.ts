import { t } from "@/lib/i18n";

export interface ProviderParameter {
  key: string;
  label: string;
  required?: boolean;
  placeholder?: string;
  defaultValue?: string;
}

export interface ProviderConnectionProfile {
  npm?: string;
  defaultBaseUrl?: string;
  parameters: readonly ProviderParameter[];
  credentialLabel?: string;
  credentialPlaceholder?: string;
  preferCompatibilityEndpoint?: boolean;
  instructions?: readonly string[];
  requiresBaseUrl?: boolean;
  nativeApiSupported?: boolean;
}

const EMPTY_PARAMETERS: readonly ProviderParameter[] = Object.freeze([]);
const EMPTY_PROFILE: ProviderConnectionProfile = Object.freeze({ parameters: EMPTY_PARAMETERS });
const VERTEX_PARAMETERS: readonly ProviderParameter[] = Object.freeze([
  { key: "GOOGLE_VERTEX_PROJECT", label: "Google Cloud project ID", required: true },
  { key: "GOOGLE_VERTEX_LOCATION", label: "Google Cloud location", defaultValue: "global" },
]);
const CLOUDFLARE_ACCOUNT: ProviderParameter = Object.freeze({
  key: "CLOUDFLARE_ACCOUNT_ID",
  label: "Cloudflare account ID",
  required: true,
});

const PROFILES: ReadonlyMap<string, ProviderConnectionProfile> = new Map([
  [
    "openai",
    {
      npm: "@ai-sdk/openai",
      defaultBaseUrl: "https://api.openai.com/v1",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "anthropic",
    {
      npm: "@ai-sdk/anthropic",
      defaultBaseUrl: "https://api.anthropic.com",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "google",
    {
      npm: "@ai-sdk/google",
      defaultBaseUrl: "https://generativelanguage.googleapis.com",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "mistral",
    {
      npm: "@ai-sdk/mistral",
      defaultBaseUrl: "https://api.mistral.ai/v1",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "groq",
    {
      npm: "@ai-sdk/groq",
      defaultBaseUrl: "https://api.groq.com/openai/v1",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "aihubmix",
    {
      npm: "@aihubmix/ai-sdk-provider",
      defaultBaseUrl: "https://aihubmix.com/v1",
      parameters: EMPTY_PARAMETERS,
      preferCompatibilityEndpoint: true,
    },
  ],
  [
    "vercel",
    {
      npm: "@ai-sdk/gateway",
      defaultBaseUrl: "https://ai-gateway.vercel.sh/v1",
      parameters: EMPTY_PARAMETERS,
      preferCompatibilityEndpoint: true,
    },
  ],
  [
    "xai",
    { npm: "@ai-sdk/xai", defaultBaseUrl: "https://api.x.ai/v1", parameters: EMPTY_PARAMETERS },
  ],
  [
    "cohere",
    {
      npm: "@ai-sdk/cohere",
      defaultBaseUrl: "https://api.cohere.ai/compatibility/v1",
      parameters: EMPTY_PARAMETERS,
      nativeApiSupported: true,
      preferCompatibilityEndpoint: true,
    },
  ],
  [
    "openrouter",
    {
      npm: "@openrouter/ai-sdk-provider",
      defaultBaseUrl: "https://openrouter.ai/api/v1",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "cerebras",
    {
      npm: "@ai-sdk/cerebras",
      defaultBaseUrl: "https://api.cerebras.ai/v1",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "togetherai",
    {
      npm: "@ai-sdk/togetherai",
      defaultBaseUrl: "https://api.together.xyz/v1",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "perplexity",
    {
      npm: "@ai-sdk/perplexity",
      defaultBaseUrl: "https://api.perplexity.ai",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "deepinfra",
    {
      npm: "@ai-sdk/deepinfra",
      defaultBaseUrl: "https://api.deepinfra.com/v1/openai",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "venice",
    {
      npm: "venice-ai-sdk-provider",
      defaultBaseUrl: "https://api.venice.ai/api/v1",
      parameters: EMPTY_PARAMETERS,
    },
  ],
  [
    "salad-cloud",
    {
      npm: "@saladtechnologies-oss/ai-sdk-provider",
      defaultBaseUrl: "https://ai.salad.cloud/v1",
      parameters: EMPTY_PARAMETERS,
      preferCompatibilityEndpoint: true,
    },
  ],
  [
    "merge-gateway",
    {
      npm: "merge-gateway-ai-sdk-provider",
      defaultBaseUrl: "https://api-gateway.merge.dev/v1/ai-sdk",
      parameters: EMPTY_PARAMETERS,
      preferCompatibilityEndpoint: true,
    },
  ],
  [
    "qvac",
    {
      npm: "@qvac/ai-sdk-provider",
      parameters: EMPTY_PARAMETERS,
      credentialPlaceholder: "API key of your running QVAC server",
      requiresBaseUrl: true,
      instructions: Object.freeze([
        "Enter the base URL of your running QVAC server. No default address is assumed.",
      ]),
      preferCompatibilityEndpoint: true,
    },
  ],
  [
    "privatemode-ai",
    {
      npm: "@ai-sdk/openai-compatible",
      defaultBaseUrl: "http://localhost:8080/v1",
      parameters: EMPTY_PARAMETERS,
      instructions: Object.freeze([
        "Start the official Privatemode proxy before connecting to localhost:8080. The proxy handles encryption and verification; when it holds your API key, a placeholder key is enough here.",
      ]),
    },
  ],
  [
    "tinfoil",
    {
      npm: "@ai-sdk/openai-compatible",
      defaultBaseUrl: "https://inference.tinfoil.sh/v1",
      parameters: EMPTY_PARAMETERS,
      instructions: Object.freeze([
        "A normal Tinfoil HTTPS connection does not verify the secure enclave. For verified privacy, run the official Tinfoil proxy and use its local base URL, usually http://127.0.0.1:3301/v1.",
      ]),
    },
  ],
  [
    "google-vertex",
    {
      npm: "@ai-sdk/google-vertex",
      defaultBaseUrl: "https://aiplatform.googleapis.com",
      parameters: VERTEX_PARAMETERS,
      credentialLabel: "Google service account JSON or access token",
    },
  ],
  [
    "google-vertex-anthropic",
    {
      npm: "@ai-sdk/google-vertex/anthropic",
      defaultBaseUrl: "https://aiplatform.googleapis.com",
      parameters: VERTEX_PARAMETERS,
      credentialLabel: "Google service account JSON or access token",
    },
  ],
  [
    "watsonx",
    {
      npm: "watsonx-ai-provider",
      defaultBaseUrl: "https://us-south.ml.cloud.ibm.com",
      parameters: Object.freeze([
        { key: "WATSONX_AI_PROJECT_ID", label: "Watsonx project ID", required: true },
      ]),
      credentialLabel: "IBM Cloud API key",
    },
  ],
  [
    "sap-ai-core",
    {
      npm: "@jerome-benoit/sap-ai-provider-v2",
      parameters: Object.freeze([
        {
          key: "AICORE_RESOURCE_GROUP",
          label: "SAP AI Core resource group",
          defaultValue: "default",
        },
        { key: "AICORE_DEPLOYMENT_ID", label: "SAP AI Core deployment ID" },
      ]),
      credentialLabel: "SAP AI Core service key JSON",
      instructions: Object.freeze([
        "SAP AI Core reads its service address from the service-key JSON; a separate base URL is optional.",
      ]),
    },
  ],
  [
    "gitlab",
    {
      npm: "gitlab-ai-provider",
      defaultBaseUrl: "https://gitlab.com",
      parameters: Object.freeze([
        {
          key: "GITLAB_AI_GATEWAY_URL",
          label: "GitLab AI Gateway URL",
          defaultValue: "https://cloud.gitlab.com",
        },
      ]),
      credentialLabel: "GitLab personal access token or OAuth access token",
    },
  ],
  [
    "github-copilot",
    {
      npm: "@ai-sdk/openai-compatible",
      defaultBaseUrl: "https://api.githubcopilot.com",
      parameters: EMPTY_PARAMETERS,
      credentialLabel: "GitHub Copilot access token",
    },
  ],
  [
    "cloudflare-workers-ai",
    {
      npm: "@ai-sdk/openai-compatible",
      defaultBaseUrl:
        "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/ai/v1",
      parameters: Object.freeze([CLOUDFLARE_ACCOUNT]),
      credentialLabel: "Cloudflare API token",
    },
  ],
  [
    "cloudflare-ai-gateway",
    {
      npm: "@ai-sdk/openai-compatible",
      defaultBaseUrl:
        "https://gateway.ai.cloudflare.com/v1/${CLOUDFLARE_ACCOUNT_ID}/${CLOUDFLARE_GATEWAY_ID}/compat",
      parameters: Object.freeze([
        CLOUDFLARE_ACCOUNT,
        { key: "CLOUDFLARE_GATEWAY_ID", label: "Cloudflare gateway ID", required: true },
      ]),
      credentialLabel: "Cloudflare API token",
      preferCompatibilityEndpoint: true,
    },
  ],
  [
    "infomaniak",
    {
      defaultBaseUrl: "https://api.infomaniak.com/2/ai/${INFOMANIAK_PRODUCT_ID}/openai/v1",
      parameters: Object.freeze([
        { key: "INFOMANIAK_PRODUCT_ID", label: "Infomaniak product ID", required: true },
      ]),
    },
  ],
  [
    "snowflake-cortex",
    {
      defaultBaseUrl: "https://${SNOWFLAKE_ACCOUNT}.snowflakecomputing.com/api/v2/cortex/v1",
      parameters: Object.freeze([
        { key: "SNOWFLAKE_ACCOUNT", label: "Snowflake account identifier", required: true },
      ]),
    },
  ],
  [
    "neon",
    {
      defaultBaseUrl: "${NEON_AI_GATEWAY_BASE_URL}/v1",
      parameters: Object.freeze([
        {
          key: "NEON_AI_GATEWAY_BASE_URL",
          label: "Neon AI Gateway base URL",
          required: true,
          placeholder: "https://your-gateway.example",
        },
      ]),
    },
  ],
  [
    "databricks",
    {
      defaultBaseUrl: "https://${DATABRICKS_HOST}/ai-gateway/mlflow/v1",
      parameters: Object.freeze([
        {
          key: "DATABRICKS_HOST",
          label: "Databricks workspace host",
          required: true,
          placeholder: "workspace.cloud.databricks.com",
        },
      ]),
    },
  ],
]);

const PROFILES_BY_NPM: ReadonlyMap<string, ProviderConnectionProfile> = new Map(
  [...PROFILES.values()]
    .filter((profile) => profile.npm && profile.npm !== "@ai-sdk/openai-compatible")
    .map((profile) => [profile.npm!, profile])
);

export function getProviderConnectionProfile(
  catalogProviderId?: string,
  npm?: string
): ProviderConnectionProfile {
  return (
    (catalogProviderId ? PROFILES.get(catalogProviderId) : undefined) ??
    (npm ? PROFILES_BY_NPM.get(npm) : undefined) ??
    EMPTY_PROFILE
  );
}

function checkedUrl(value: string): URL {
  if (
    [...value].some(
      (character) =>
        character === "\\" || character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127
    )
  ) {
    throw new Error(t("Invalid provider URL."));
  }
  const url = new URL(value);
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error(t("Invalid provider URL."));
  }
  return url;
}

export function expandProviderUrl(template: string, values: Record<string, unknown>): string {
  const trimmed = template.trim();
  const expanded = trimmed.replace(
    /\$\{([A-Z][A-Z0-9_]*)\}/g,
    (match: string, key: string, offset: number) => {
      const value = values[key];
      if (typeof value !== "string" || !value.trim()) {
        throw new Error(t("Missing required connection parameter: {key}.", { key }));
      }
      const parameter = value.trim();
      if (offset === 0) {
        const suffix = trimmed.slice(match.length);
        if (suffix && !suffix.startsWith("/")) throw new Error(t("Invalid provider URL."));
        checkedUrl(parameter);
        return parameter.replace(/\/+$/, "");
      }
      if (parameter === "." || parameter === "..")
        throw new Error(t("Invalid connection parameter: {key}.", { key }));
      return encodeURIComponent(parameter);
    }
  );
  if (expanded.includes("${")) throw new Error(t("Unresolved provider URL parameters."));
  checkedUrl(expanded);
  return expanded;
}
