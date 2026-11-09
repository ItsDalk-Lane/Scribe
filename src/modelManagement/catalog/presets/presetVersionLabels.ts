import { t } from "@/lib/i18n";
import { PRESET_FAMILIES, type PresetPlanKey, type PresetRegionKey } from "./presetFamilies";
import type { ProviderPreset } from "./providerPresets";

const PLAN_LABEL_KEYS: Record<PresetPlanKey, string> = {
  payg: "Pay-as-you-go",
  coding: "Coding subscription",
  codingPlan: "Coding Plan",
  agentPlan: "Agent Plan",
  tokenPlan: "Token Plan",
  enterpriseLite: "Enterprise Lite",
  enterprisePro: "Enterprise Pro",
  stepPlan: "Step Plan",
  aksk: "AKSK",
  apiKey: "API Key",
};

const REGION_LABEL_KEYS: Record<PresetRegionKey, string> = {
  cn: "China",
  intl: "International",
};

export function presetPlanLabel(plan: PresetPlanKey): string {
  return t(PLAN_LABEL_KEYS[plan]);
}

export function presetRegionLabel(region: PresetRegionKey): string {
  return t(REGION_LABEL_KEYS[region]);
}

export function presetVersionLabel(preset: ProviderPreset): string {
  const domain = presetDomain(preset);
  if (!preset.planKey && !preset.regionKey) return domain;
  const parts = [
    preset.planKey ? presetPlanLabel(preset.planKey) : "",
    preset.regionKey ? presetRegionLabel(preset.regionKey) : "",
  ].filter(Boolean);
  return parts.join(" · ") || domain;
}

export function presetDomain(preset: ProviderPreset): string {
  try {
    return new URL(preset.baseUrl).host;
  } catch {
    return preset.baseUrl;
  }
}

export type PresetVersionPickerModel =
  | {
      kind: "grid";
      plans: readonly PresetPlanKey[];
      regions: readonly PresetRegionKey[];
      versionAt: (plan: PresetPlanKey, region: PresetRegionKey) => ProviderPreset | undefined;
    }
  | { kind: "single-dimension"; dimension: "plan"; plans: readonly PresetPlanKey[] }
  | { kind: "single-dimension"; dimension: "region"; regions: readonly PresetRegionKey[] }
  | { kind: "list"; options: readonly { id: string; label: string }[] };

function orderedUnique<T extends string>(
  values: readonly (T | undefined)[],
  order?: readonly T[]
): T[] {
  const remaining = new Set<T>();
  for (const value of values) {
    if (value) remaining.add(value);
  }
  const out: T[] = [];
  if (order) {
    for (const value of order) {
      if (remaining.has(value)) {
        out.push(value);
        remaining.delete(value);
      }
    }
  }
  for (const value of remaining) {
    out.push(value);
  }
  return out;
}

export function presetVersionPickerModel(
  versions: readonly ProviderPreset[]
): PresetVersionPickerModel | null {
  if (versions.length < 2) return null;
  const family = versions[0].family ? PRESET_FAMILIES[versions[0].family] : undefined;
  const familyPlanOrder = family && "planOrder" in family ? family.planOrder : undefined;
  const plans = orderedUnique(
    versions.map((version) => version.planKey),
    familyPlanOrder
  );
  const regions = orderedUnique(versions.map((version) => version.regionKey));
  const versionAt = (plan: PresetPlanKey, region: PresetRegionKey): ProviderPreset | undefined =>
    versions.find((version) => version.planKey === plan && version.regionKey === region);
  if (
    plans.length > 1 &&
    regions.length > 1 &&
    plans.every((plan) => regions.every((region) => versionAt(plan, region)))
  ) {
    return { kind: "grid", plans, regions, versionAt };
  }
  if (plans.length > 1) return { kind: "single-dimension", dimension: "plan", plans };
  if (regions.length > 1) return { kind: "single-dimension", dimension: "region", regions };
  return {
    kind: "list",
    options: versions.map((version) => ({ id: version.id, label: presetVersionLabel(version) })),
  };
}
