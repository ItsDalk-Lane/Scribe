import type { Provider } from "@/modelManagement";

export function planOptionalCustomProviderAuthMigration(
  providers: Record<string, Provider>
): Record<string, Provider> | null {
  let changed = false;
  const next: Record<string, Provider> = {};

  for (const [id, provider] of Object.entries(providers)) {
    const isCustomOpenAICompatible =
      provider.origin.kind === "byok" &&
      !provider.origin.catalogProviderId &&
      provider.providerType === "openai-compatible";

    if (isCustomOpenAICompatible && provider.requiresApiKey !== false) {
      next[id] = { ...provider, requiresApiKey: false };
      changed = true;
    } else {
      next[id] = provider;
    }
  }

  return changed ? next : null;
}
