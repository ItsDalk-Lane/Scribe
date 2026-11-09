import { SecretStore } from "@/services/secretStore";
import { looksLikeEmbeddingModel } from "@/modelManagement/catalog/catalogTransform";
import { listProviderModels } from "@/modelManagement/providers/adapters/listProviderModels";
import type { ModelInfo, ProviderType } from "@/modelManagement/types/catalog";
import type { ConfiguredModel } from "@/modelManagement/types/persisted";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const EMPTY_IDS: readonly string[] = Object.freeze([]);
const EMPTY_DISCOVERY = Object.freeze({ ids: EMPTY_IDS, fetching: false, error: null });

export interface UseModelCandidatePoolArgs {
  mode: "new" | "edit";
  providerType: ProviderType | undefined;
  effectiveBaseUrl: string;
  existingModels: readonly ConfiguredModel[];
  catalogMetadata: Record<string, ModelInfo>;
  apiKey: string;
  apiKeyRef?: string;
  extras: Record<string, unknown>;
  requiresApiKey: boolean;
  providerHydrated: boolean;
  autoDiscover?: boolean;
  initialSelectedIds?: readonly string[];
}

export interface ModelCandidatePool {
  availableModels: readonly ModelInfo[];
  customIds: ReadonlySet<string>;
  selectedWireIds: ReadonlySet<string>;
  removedExistingIds: ReadonlySet<string>;
  fetching: boolean;
  fetchError: string | null;
  resolveModelInfo: (id: string) => ModelInfo;
  buildSelectedModelInfos: () => ModelInfo[];
  toggle: (wireId: string, next: boolean) => void;
  addId: (id: string) => void;
  removeId: (id: string) => void;
  setSelection: (ids: readonly string[]) => void;
  fetchModels: () => Promise<void>;
}

export function useModelCandidatePool({
  mode,
  providerType,
  effectiveBaseUrl,
  existingModels,
  catalogMetadata,
  apiKey,
  apiKeyRef,
  extras,
  requiresApiKey,
  providerHydrated,
  autoDiscover,
  initialSelectedIds,
}: UseModelCandidatePoolArgs): ModelCandidatePool {
  const [selectedWireIds, setSelectedWireIds] = useState<Set<string>>(() =>
    mode === "edit"
      ? new Set(existingModels.map((m) => m.info.id))
      : new Set(initialSelectedIds ?? [])
  );
  const connectionKey = JSON.stringify([providerType, effectiveBaseUrl, apiKey, apiKeyRef, extras]);
  const currentConnectionKey = useRef(connectionKey);
  const requestNumber = useRef(0);
  if (currentConnectionKey.current !== connectionKey) {
    currentConnectionKey.current = connectionKey;
    requestNumber.current++;
  }
  const [discovery, setDiscovery] = useState<{
    connectionKey: string;
    ids: readonly string[];
    fetching: boolean;
    error: string | null;
  }>(() => ({ connectionKey, ids: EMPTY_IDS, fetching: false, error: null }));
  const currentDiscovery = discovery.connectionKey === connectionKey ? discovery : EMPTY_DISCOVERY;
  const fetchedIds = currentDiscovery.ids;
  const [manualIds, setManualIds] = useState<string[]>(() =>
    mode === "edit" ? [] : [...(initialSelectedIds ?? [])]
  );
  const [removedExistingIds, setRemovedExistingIds] = useState<Set<string>>(() => new Set());

  const existingByWireId = useMemo(
    () => new Map(existingModels.map((m) => [m.info.id, m.info])),
    [existingModels]
  );

  const resolveModelInfo = useCallback(
    (id: string): ModelInfo => {
      const catalog = catalogMetadata[id];
      const existing = existingByWireId.get(id);
      if (catalog && existing) return { ...existing, ...catalog };
      return (
        catalog ??
        existing ?? {
          id,
          displayName: id,
          ...(looksLikeEmbeddingModel(id) ? { isEmbedding: true } : {}),
        }
      );
    },
    [catalogMetadata, existingByWireId]
  );

  const availableModels = useMemo<readonly ModelInfo[]>(() => {
    const seen = new Set<string>();
    const out: ModelInfo[] = [];
    const push = (id: string): void => {
      if (seen.has(id)) return;
      seen.add(id);
      out.push(resolveModelInfo(id));
    };
    for (const m of existingModels) {
      if (removedExistingIds.has(m.info.id)) continue;
      push(m.info.id);
    }
    for (const id of selectedWireIds) push(id);
    for (const id of fetchedIds) push(id);
    for (const id of manualIds) push(id);
    for (const id of Object.keys(catalogMetadata)) push(id);
    return out;
  }, [
    existingModels,
    selectedWireIds,
    fetchedIds,
    manualIds,
    catalogMetadata,
    resolveModelInfo,
    removedExistingIds,
  ]);

  const customIds = useMemo<ReadonlySet<string>>(() => {
    const set = new Set<string>(manualIds);
    const fetched = new Set(fetchedIds);
    for (const m of existingModels) {
      if (removedExistingIds.has(m.info.id)) continue;
      if (!catalogMetadata[m.info.id] && !fetched.has(m.info.id)) {
        set.add(m.info.id);
      }
    }
    return set;
  }, [manualIds, fetchedIds, existingModels, catalogMetadata, removedExistingIds]);

  const fetchModels = useCallback(async (): Promise<void> => {
    if (!providerType || !effectiveBaseUrl) return;
    const request = ++requestNumber.current;
    setDiscovery((previous) => ({
      connectionKey,
      ids: previous.connectionKey === connectionKey ? previous.ids : EMPTY_IDS,
      fetching: true,
      error: null,
    }));
    try {
      const list = async (key: string | null) =>
        listProviderModels(providerType, effectiveBaseUrl, { apiKey: key, extras });
      const result =
        apiKey || !apiKeyRef
          ? await list(apiKey || null)
          : await SecretStore.getInstance().withSecret(apiKeyRef, list);
      if (request !== requestNumber.current || currentConnectionKey.current !== connectionKey)
        return;
      setDiscovery((previous) => ({
        connectionKey,
        ids: result.ok ? [...new Set(result.modelIds)] : previous.ids,
        fetching: false,
        error: result.ok ? null : result.message,
      }));
    } catch (err) {
      if (request !== requestNumber.current || currentConnectionKey.current !== connectionKey)
        return;
      setDiscovery((previous) => ({
        ...previous,
        fetching: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [providerType, effectiveBaseUrl, apiKey, apiKeyRef, extras, connectionKey]);

  const initialBaseUrlRef = useRef(effectiveBaseUrl);

  const mountFetchedRef = useRef(false);
  useEffect(() => {
    if (mountFetchedRef.current) return;
    if (!providerType || !effectiveBaseUrl) return;
    if (!(autoDiscover ?? (mode === "new" && !!initialBaseUrlRef.current))) return;
    if (apiKeyRef && !apiKey) return;
    if (!providerHydrated) return;
    if (mode === "new" && requiresApiKey && !apiKey) return;
    mountFetchedRef.current = true;
    void fetchModels();
  }, [
    mode,
    autoDiscover,
    providerHydrated,
    providerType,
    effectiveBaseUrl,
    requiresApiKey,
    apiKey,
    apiKeyRef,
    fetchModels,
  ]);

  const toggle = useCallback((wireId: string, next: boolean): void => {
    setSelectedWireIds((prev) => {
      const nextSet = new Set(prev);
      if (next) nextSet.add(wireId);
      else nextSet.delete(wireId);
      return nextSet;
    });
  }, []);

  const addId = useCallback((id: string): void => {
    setManualIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    setSelectedWireIds((prev) => {
      if (prev.has(id)) return prev;
      const ns = new Set(prev);
      ns.add(id);
      return ns;
    });
  }, []);

  const removeId = useCallback(
    (id: string): void => {
      setDiscovery((previous) => ({
        ...previous,
        ids: previous.ids.filter((value) => value !== id),
      }));
      setManualIds((prev) => prev.filter((x) => x !== id));
      setSelectedWireIds((prev) => {
        if (!prev.has(id)) return prev;
        const ns = new Set(prev);
        ns.delete(id);
        return ns;
      });
      if (existingByWireId.has(id)) {
        setRemovedExistingIds((prev) => {
          if (prev.has(id)) return prev;
          const ns = new Set(prev);
          ns.add(id);
          return ns;
        });
      }
    },
    [existingByWireId]
  );

  const setSelection = useCallback((ids: readonly string[]): void => {
    setManualIds((prev) => {
      const next = [...prev];
      for (const id of ids) {
        if (!next.includes(id)) next.push(id);
      }
      return next;
    });
    setSelectedWireIds(new Set(ids));
  }, []);

  const buildSelectedModelInfos = useCallback(
    (): ModelInfo[] => [...selectedWireIds].map((id) => resolveModelInfo(id)),
    [selectedWireIds, resolveModelInfo]
  );

  return {
    availableModels,
    customIds,
    selectedWireIds,
    removedExistingIds,
    fetching: currentDiscovery.fetching,
    fetchError: currentDiscovery.error,
    resolveModelInfo,
    buildSelectedModelInfos,
    toggle,
    addId,
    removeId,
    setSelection,
    fetchModels,
  };
}
