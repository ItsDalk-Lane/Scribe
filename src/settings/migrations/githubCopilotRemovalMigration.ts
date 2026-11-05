import { type ScribeSettings, setSettings } from "@/settings/model";

const REMOVED_PROVIDER = "github-copilot";

function referencesRemovedProvider(modelKey: string | undefined): boolean {
  return modelKey?.endsWith(`|${REMOVED_PROVIDER}`) ?? false;
}

export function planRetiredModelsAndSelectionsRemoval(
  settings: ScribeSettings
): Partial<ScribeSettings> | null {
  const patch: Partial<ScribeSettings> = {};

  const models = settings.activeModels ?? [];
  const keptModels = models.filter((model) => model.provider !== REMOVED_PROVIDER);
  if (keptModels.length !== models.length) patch.activeModels = keptModels;

  if (referencesRemovedProvider(settings.defaultModelKey)) patch.defaultModelKey = "";

  if (referencesRemovedProvider(settings.quickCommandModelKey))
    patch.quickCommandModelKey = undefined;

  return Object.keys(patch).length > 0 ? patch : null;
}

export function executeRetiredModelsAndSelectionsRemoval(settings: ScribeSettings): void {
  const patch = planRetiredModelsAndSelectionsRemoval(settings);
  if (patch) setSettings(patch);
}
