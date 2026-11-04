export type { ModelInfo, ProviderType } from "./types/catalog";
export type {
  AgentType,
  BackendConfig,
  BackendType,
  ConfiguredModel,
  Provider,
  ProviderOrigin,
} from "./types/persisted";
export type { EnabledBackendEntry, VerificationResult } from "./types/runtime";

export { ProviderRegistry } from "./providers/ProviderRegistry";
export { isSelfHostedProvider } from "./providers/isSelfHostedProvider";
export { providerDestination, urlDestination } from "./providers/providerDestination";
export {
  providerNeedsResolvedApiKey,
  providerRequiresApiKey,
} from "./providers/providerRequiresApiKey";
export { BackendConfigRegistry } from "./backends/BackendConfigRegistry";
export {
  configuredModelToCustomModel,
  mapProviderTypeToChatModelProvider,
} from "./chatModel/configuredModelToCustomModel";
export {
  findChatBackendEntry,
  resolveChatModelSelectionId,
  isChatModelSelectionForEntry,
} from "./chatModel/chatModelSelection";
export { capabilitiesFromConfiguredInfo, isChatModelInfo } from "./chatModel/modelCapabilityFlags";

export type { SetupProviderInput } from "./setup/ByokSetupApi";

export { createModelManagement } from "./createModelManagement";
export type { ModelManagementApi } from "./createModelManagement";

export {
  chatBackendPickerAtom,
  backendsAtom,
  configuredModelsAtom,
  providersAtom,
} from "./state/atoms";

export { ModelManagementProvider, useModelManagement } from "./ui/ModelManagementContext";

export { ByokPanel } from "./ui/tabs/ByokPanel";
