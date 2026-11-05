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
  const models = get(configuredModelsAtom);
  const providers = get(providersAtom);
  const entries: EnabledBackendEntry[] = [];
  // 配置后的聊天模型应直接可用，旧独立开关不能锁住已配置模型。https://github.com/ItsDalk-Lane/Scribe/issues/31
  for (const configuredModel of models) {
    if (!isChatModelInfo(configuredModel.info)) continue;
    const configuredModelId = configuredModel.configuredModelId;
    const provider = providers[configuredModel.providerId];
    if (!provider) entries.push({ configuredModelId, state: "broken" });
    else if (provider.origin.kind === "byok")
      entries.push({ configuredModelId, state: "ok", configuredModel, provider });
  }
  return entries.length ? entries : EMPTY_PICKER_ENTRIES;
});
