import { atom } from "jotai";
import { isChatModelInfo } from "@/modelManagement/chatModel/modelCapabilityFlags";

import { settingsAtom } from "@/settings/model";

import type {
  BackendConfig,
  BackendType,
  ConfiguredModel,
  Provider,
  ProviderOrigin,
} from "@/modelManagement/types/persisted";
import type { EnabledBackendEntry } from "@/modelManagement/types/runtime";

const EMPTY_PICKER_ENTRIES: readonly EnabledBackendEntry[] = Object.freeze([]);

export const providersAtom = atom<Readonly<Record<string, Provider>>>(
  (get) => get(settingsAtom).providers
);

export const configuredModelsAtom = atom<readonly ConfiguredModel[]>(
  (get) => get(settingsAtom).configuredModels
);

export const backendsAtom = atom<Readonly<Partial<Record<BackendType, BackendConfig>>>>(
  (get) => get(settingsAtom).backends
);

function filterByOrigin(
  providers: Readonly<Record<string, Provider>>,
  kind: ProviderOrigin["kind"]
): readonly Provider[] {
  return Object.values(providers).filter((p) => p.origin.kind === kind);
}

export const byokProvidersAtom = atom<readonly Provider[]>((get) =>
  filterByOrigin(get(providersAtom), "byok")
);

const EMPTY_BYOK_PROVIDERS: readonly Provider[] = Object.freeze([]);

export const visibleByokProvidersAtom = atom<readonly Provider[]>((get) => {
  const providers = get(byokProvidersAtom);
  return providers.length === 0 ? EMPTY_BYOK_PROVIDERS : providers;
});

export const chatBackendPickerAtom = atom<readonly EnabledBackendEntry[]>((get) => {
  const config = get(backendsAtom).chat ?? { enabledModels: [] };
  const models = get(configuredModelsAtom);
  const providers = get(providersAtom);
  if (config.enabledModels.length === 0) return EMPTY_PICKER_ENTRIES;
  const entries: EnabledBackendEntry[] = [];
  for (const configuredModelId of config.enabledModels) {
    const configuredModel = models.find((m) => m.configuredModelId === configuredModelId);
    if (configuredModel && !isChatModelInfo(configuredModel.info)) continue;
    const provider = configuredModel ? providers[configuredModel.providerId] : undefined;
    if (configuredModel && provider) {
      entries.push({ configuredModelId, state: "ok", configuredModel, provider });
    } else {
      entries.push({ configuredModelId, state: "broken" });
    }
  }
  return entries.length ? entries : EMPTY_PICKER_ENTRIES;
});
