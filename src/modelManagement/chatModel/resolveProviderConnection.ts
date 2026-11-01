import type { ModelInfo } from "@/modelManagement/types/catalog";
import type { Provider } from "@/modelManagement/types/persisted";
import {
  expandProviderUrl,
  getProviderConnectionProfile,
} from "@/modelManagement/providers/providerProfiles";

export interface ProviderConnection {
  npm: string;
  baseUrl?: string;
  shape?: "responses" | "completions";
  options: Record<string, unknown>;
}

export function resolveProviderConnection(
  provider: Provider,
  model: ModelInfo
): ProviderConnection {
  const catalogId = provider.origin.kind === "byok" ? provider.origin.catalogProviderId : undefined;
  const extras = provider.extras ?? {};
  const storedNpm = typeof extras.npm === "string" ? extras.npm : undefined;
  const profile = getProviderConnectionProfile(catalogId);
  const options: Record<string, unknown> = {
    ...Object.fromEntries(
      profile.parameters.map((parameter) => [parameter.key, parameter.defaultValue])
    ),
    ...extras,
  };
  const location =
    typeof options.GOOGLE_VERTEX_LOCATION === "string" && options.GOOGLE_VERTEX_LOCATION
      ? options.GOOGLE_VERTEX_LOCATION
      : "global";
  options.GOOGLE_VERTEX_ENDPOINT ||=
    location === "global" ? "aiplatform.googleapis.com" : `${location}-aiplatform.googleapis.com`;
  const catalogBase =
    typeof extras.catalogBaseUrl === "string" ? extras.catalogBaseUrl : profile.defaultBaseUrl;
  const storedBase = provider.baseUrl?.trim();
  const customEndpoint =
    !!storedBase &&
    (!catalogBase || storedBase.replace(/\/+$/, "") !== catalogBase.trim().replace(/\/+$/, ""));
  const compatibility =
    profile.preferCompatibilityEndpoint &&
    !(profile.nativeApiSupported && extras.apiProtocol === "native");
  const defaultNpm =
    provider.providerType === "anthropic"
      ? "@ai-sdk/anthropic"
      : provider.providerType === "google"
        ? "@ai-sdk/google"
        : "@ai-sdk/openai-compatible";
  const npm = compatibility
    ? "@ai-sdk/openai-compatible"
    : (model.provider?.npm ?? storedNpm ?? profile.npm ?? defaultNpm);
  const template = customEndpoint
    ? storedBase
    : compatibility
      ? profile.defaultBaseUrl
      : (model.provider?.api ?? storedBase ?? catalogBase);
  return {
    npm,
    ...(template ? { baseUrl: expandProviderUrl(template, options) } : {}),
    shape: compatibility ? "completions" : model.provider?.shape,
    options,
  };
}
