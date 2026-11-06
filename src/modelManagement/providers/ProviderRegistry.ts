import { RequestRedactor } from "@/LLMProviders/requestRedaction";
import { t } from "@/lib/i18n";
import type { App } from "obsidian";
import { v4 as uuidv4 } from "uuid";

import { providerNeedsResolvedApiKey } from "@/modelManagement/providers/providerRequiresApiKey";
import { logError } from "@/logger";
import { SecretStore, type SecretStatus } from "@/services/secretStore";
import { getSettings, setSettings } from "@/settings/model";
import { frozenOr, sliceMemo, sliceMemoByKey } from "@/utils/sliceCache";

import type { Provider, ProviderOrigin } from "@/modelManagement/types/persisted";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import type { ProviderAdapterRegistry } from "./adapters/ProviderAdapterRegistry";

const EMPTY_LIST: readonly Provider[] = Object.freeze([]);

export class ProviderRegistry {
  readonly #app: App;
  readonly #adapters: ProviderAdapterRegistry;

  readonly #list = sliceMemo((source: Record<string, Provider>) =>
    frozenOr(Object.values(source), EMPTY_LIST)
  );
  readonly #byOrigin = sliceMemoByKey(
    (source: Record<string, Provider>, kind: ProviderOrigin["kind"]) =>
      frozenOr(
        Object.values(source).filter((p) => p.origin.kind === kind),
        EMPTY_LIST
      )
  );

  readonly #listeners = new Set<(providerId: string) => void>();

  constructor(app: App, adapters: ProviderAdapterRegistry) {
    this.#app = app;
    this.#adapters = adapters;
  }

  subscribe(listener: (providerId: string) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  #emit(providerId: string): void {
    for (const listener of [...this.#listeners]) {
      try {
        listener(providerId);
      } catch (err) {
        logError("[modelManagement] ProviderRegistry listener threw", err);
      }
    }
  }

  list(): readonly Provider[] {
    return this.#list(getSettings().providers);
  }

  get(providerId: string): Provider | undefined {
    return getSettings().providers[providerId];
  }

  listByOrigin(originKind: ProviderOrigin["kind"]): readonly Provider[] {
    return this.#byOrigin(getSettings().providers, originKind);
  }

  async add(input: Omit<Provider, "providerId" | "addedAt" | "apiKeyRef">): Promise<string> {
    const providerId = uuidv4();
    const row: Provider = {
      ...input,
      providerId,
      addedAt: Date.now(),
      apiKeyRef: null,
    };
    setSettings((cur) => ({
      providers: { ...cur.providers, [providerId]: row },
    }));
    this.#emit(providerId);
    return providerId;
  }

  async update(
    providerId: string,
    patch: Partial<
      Omit<Provider, "providerId" | "addedAt" | "apiKeyRef" | "providerType" | "origin">
    >
  ): Promise<void> {
    const existing = getSettings().providers[providerId];
    if (!existing) {
      throw new Error(
        `[modelManagement] ProviderRegistry.update: unknown providerId ${providerId}`
      );
    }
    const safePatch = { ...patch } as Record<string, unknown>;
    delete safePatch.providerId;
    delete safePatch.addedAt;
    delete safePatch.apiKeyRef;
    delete safePatch.providerType;
    delete safePatch.origin;
    for (const key of Object.keys(safePatch)) {
      if (Object.is(existing[key as keyof Provider], safePatch[key])) {
        delete safePatch[key];
      }
    }
    if (Object.keys(safePatch).length === 0) return;
    const affectsAgentProviderConfig = Object.keys(safePatch).some((key) => key !== "enableCors");
    const next: Provider = { ...existing, ...(safePatch as Partial<Provider>) };
    setSettings((cur) => ({
      providers: { ...cur.providers, [providerId]: next },
    }));
    if (affectsAgentProviderConfig) this.#emit(providerId);
  }

  #setApiKeyRef(providerId: string, apiKeyRef: string | null): void {
    const existing = getSettings().providers[providerId];
    if (!existing) return;
    if (existing.apiKeyRef === apiKeyRef) return;
    setSettings((cur) => {
      const current = cur.providers[providerId];
      if (!current) return {};
      return {
        providers: { ...cur.providers, [providerId]: { ...current, apiKeyRef } },
      };
    });
  }

  async remove(providerId: string): Promise<void> {
    const existing = getSettings().providers[providerId];
    if (!existing) return;
    if (existing.apiKeyRef)
      await SecretStore.getInstance(this.#app).deleteSecret(existing.apiKeyRef);
    setSettings((cur) => {
      const next = { ...cur.providers };
      delete next[providerId];
      return { providers: next };
    });
    this.#emit(providerId);
  }

  getApiKeyStatus(providerId: string): SecretStatus {
    const reference = getSettings().providers[providerId]?.apiKeyRef;
    return reference ? SecretStore.getInstance(this.#app).getStatus(reference) : "missing";
  }

  async withApiKey<T>(
    providerId: string,
    execute: (apiKey: string | null) => Promise<T>,
    options?: { interactive?: boolean }
  ): Promise<T> {
    const reference = getSettings().providers[providerId]?.apiKeyRef;
    if (!reference) return execute(null);
    return SecretStore.getInstance(this.#app).withSecret(reference, execute, options);
  }

  async setApiKey(providerId: string, apiKey: string): Promise<void> {
    const row = getSettings().providers[providerId];
    if (!row)
      throw new Error(
        `[modelManagement] ProviderRegistry.setApiKey: unknown providerId ${providerId}`
      );
    const reference = row.apiKeyRef ?? uuidv4();
    await SecretStore.getInstance(this.#app).setSecret(reference, apiKey);
    this.#setApiKeyRef(providerId, reference);
    this.#emit(providerId);
  }

  async clearApiKey(providerId: string): Promise<void> {
    const row = getSettings().providers[providerId];
    if (!row?.apiKeyRef) return;
    await SecretStore.getInstance(this.#app).deleteSecret(row.apiKeyRef);
    this.#setApiKeyRef(providerId, null);
    this.#emit(providerId);
  }

  async verify(providerId: string): Promise<VerificationResult> {
    const provider = this.get(providerId);
    if (!provider) {
      throw new Error(
        `[modelManagement] ProviderRegistry.verify: unknown providerId ${providerId}`
      );
    }
    const status = this.getApiKeyStatus(providerId);
    if (providerNeedsResolvedApiKey(provider) && status === "missing") {
      return {
        ok: false,
        code: "missing_api_key",
        message: t("API key is missing. Configure this provider to enter it again."),
        checkedAt: Date.now(),
      };
    }
    if (status === "locked" || status === "unavailable")
      return {
        ok: false,
        code: "credentials_locked",
        message: t("Unlock your saved key with a connection test before checking this provider."),
        checkedAt: Date.now(),
      };
    return this.withApiKey(
      providerId,
      async (apiKey) => {
        const redactor = new RequestRedactor([apiKey ?? ""]);
        try {
          const result = await this.#adapters.verifyCredentials(provider.providerType, {
            provider,
            apiKey,
            extras: provider.extras ?? {},
          });
          return {
            ...result,
            ...(result.message ? { message: redactor.redact(result.message) } : {}),
          };
        } catch (error) {
          throw redactor.error(error);
        }
      },
      { interactive: false }
    );
  }
}
