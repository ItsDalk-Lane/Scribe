import { findModelEntry } from "@/agentMode/session/translateBackendState";
import type { BackendState, EnabledModelEntry, ModelSelection } from "@/agentMode/session/types";

export const ENABLED_MODEL_WAIT_MS = 10_000;
export const EMPTY_ENABLED_MODELS: readonly EnabledModelEntry[] = Object.freeze([]);

export interface EnabledModelPick {
  target: ModelSelection | null;
  settled: boolean;
}

export function pickEnabledModel(
  enabled: readonly EnabledModelEntry[],
  model: BackendState["model"] | undefined,
  seed: ModelSelection | null
): EnabledModelPick {
  const usable = enabled.filter((entry) => entry.credentialState === "ok");
  const offers = (baseModelId: string): boolean => findModelEntry(model, baseModelId) !== undefined;
  const seedUsable =
    seed !== null && usable.some((entry) => entry.baseModelId === seed.baseModelId);
  if (seedUsable && offers(seed.baseModelId)) return { target: seed, settled: true };
  const fallback = usable.find((entry) => offers(entry.baseModelId));
  const target = fallback ? { baseModelId: fallback.baseModelId, effort: null } : null;
  return { target, settled: !seedUsable && (target !== null || usable.length === 0) };
}

export function noEnabledModelError(displayName: string): Error {
  return new Error(
    `No configured model for ${displayName} is available. Check the model and its credentials in Models.`
  );
}
