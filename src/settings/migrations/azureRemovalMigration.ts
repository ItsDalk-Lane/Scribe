import type { ModelManagementApi } from "@/modelManagement";
import type { ScribeSettings } from "@/settings/model";
import {
  executeRetiredProviderRemoval,
  planRetiredProviderRemoval,
  type RetiredProviderRemovalPlan,
} from "./retiredProviderRemovalMigration";

const REMOVED_PROVIDER_TYPE = "azure";

const REMOVED_LEGACY_PROVIDERS = ["azure openai", "azure_openai"] as const;

const REMOVED_LEGACY_SECRET_FIELD = "azureOpenAIApiKey";

export type AzureRemovalPlan = RetiredProviderRemovalPlan;

export function planAzureRemoval(settings: ScribeSettings): AzureRemovalPlan | null {
  return planRetiredProviderRemoval(settings, REMOVED_PROVIDER_TYPE, REMOVED_LEGACY_PROVIDERS);
}

export async function executeAzureRemoval(
  api: ModelManagementApi,
  settings: ScribeSettings
): Promise<void> {
  await executeRetiredProviderRemoval(
    api,
    planAzureRemoval(settings),
    REMOVED_LEGACY_SECRET_FIELD,
    "azure-removal"
  );
}
