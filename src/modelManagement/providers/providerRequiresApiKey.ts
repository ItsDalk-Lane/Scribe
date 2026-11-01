import type { Provider } from "@/modelManagement/types/persisted";

export function providerRequiresApiKey(provider: Provider): boolean {
  return provider.requiresApiKey ?? true;
}

export function providerNeedsResolvedApiKey(provider: Provider): boolean {
  return providerRequiresApiKey(provider) || !!provider.apiKeyKeychainId;
}
