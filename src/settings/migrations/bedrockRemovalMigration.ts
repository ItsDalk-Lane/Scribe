import type { ModelManagementApi } from "@/modelManagement";
import type { ScribeSettings } from "@/settings/model";
import {
  executeRetiredProviderRemoval,
  planRetiredProviderRemoval,
  type RetiredProviderRemovalPlan,
} from "./retiredProviderRemovalMigration";

const REMOVED_PROVIDER_TYPE = "bedrock";

const REMOVED_LEGACY_PROVIDERS = ["amazon-bedrock"] as const;

const REMOVED_LEGACY_SECRET_FIELD = "amazonBedrockApiKey";

export type BedrockRemovalPlan = RetiredProviderRemovalPlan;

export function planBedrockRemoval(settings: ScribeSettings): BedrockRemovalPlan | null {
  return planRetiredProviderRemoval(settings, REMOVED_PROVIDER_TYPE, REMOVED_LEGACY_PROVIDERS);
}

export async function executeBedrockRemoval(
  api: ModelManagementApi,
  settings: ScribeSettings
): Promise<void> {
  await executeRetiredProviderRemoval(
    api,
    planBedrockRemoval(settings),
    REMOVED_LEGACY_SECRET_FIELD,
    "bedrock-removal"
  );
}
