import type { ProviderType } from "./catalog";
import type { ConfiguredModel, Provider } from "./persisted";

export interface VerificationResult {
  ok: boolean;
  message?: string;
  code?: string;
  checkedAt: number;
}

export type EnabledBackendEntry =
  | {
      configuredModelId: string;
      state: "ok";
      configuredModel: ConfiguredModel;
      provider: Provider;
    }
  | {
      configuredModelId: string;
      state: "broken";
    };

export interface ProviderDefinition {
  id: string;
  displayName: string;
  providerType: ProviderType;
  defaultBaseUrl?: string;
  requiresApiKey: boolean;
  modelInputHint: string;
  catalogProviderId?: string;
  npm?: string;
  presetId?: string;
}
