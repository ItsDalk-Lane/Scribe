import type { App } from "obsidian";

import { BackendConfigRegistry } from "@/modelManagement/backends/BackendConfigRegistry";
import { ModelManagementCoordinator } from "@/modelManagement/createModelManagement";
import { ConfiguredModelRegistry } from "@/modelManagement/models/ConfiguredModelRegistry";
import { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { ProviderAdapterRegistry } from "@/modelManagement/providers/adapters/ProviderAdapterRegistry";
import { SecretStore } from "@/services/secretStore";
import { resetSettings, setSettings } from "@/settings/model";

export interface TestRegistries {
  app: App;
  providers: ProviderRegistry;
  models: ConfiguredModelRegistry;
  backends: BackendConfigRegistry;
  coordinator: ModelManagementCoordinator;
}

function createFakeApp(): App {
  return { vault: { adapter: {} } } as unknown as App;
}

export function createTestRegistries(): TestRegistries {
  resetSettings();
  setSettings({ providers: {}, configuredModels: [] });
  SecretStore.resetInstance();
  const app = createFakeApp();
  const secrets = new Map<string, string>();
  const store = SecretStore.getInstance(app);
  Object.assign(store, {
    ensureUnlocked: async () => {},
    setSecret: async (id: string, value: string) => {
      secrets.set(id, value);
    },
    deleteSecret: async (id: string) => {
      secrets.delete(id);
    },
    getStatus: (id: string) => (secrets.get(id)?.trim() ? "available" : "missing"),
    withSecret: async <T>(id: string, execute: (value: string) => Promise<T>) => {
      const value = secrets.get(id);
      if (!value) throw new Error("Saved credential is unavailable.");
      return execute(value);
    },
    dispose: () => secrets.clear(),
  });
  const providers = new ProviderRegistry(app, new ProviderAdapterRegistry());
  const models = new ConfiguredModelRegistry();
  const backends = new BackendConfigRegistry(providers, models);
  const coordinator = new ModelManagementCoordinator(providers, models, backends);
  return { app, providers, models, backends, coordinator };
}
