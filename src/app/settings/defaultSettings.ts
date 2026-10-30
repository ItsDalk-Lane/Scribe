import { DEFAULT_REASONING_VALUE } from '../../core/providers/reasoning';
import type { ProviderConfigMap,ScribeSettings } from '../../core/types/settings';

/**
 * Application defaults. Provider-owned defaults are assembled by the composition
 * root and injected, so app settings never import concrete providers.
 */
export function createDefaultScribeSettings(providerConfigs: ProviderConfigMap): ScribeSettings {
  return structuredClone({ ...DEFAULT_SCRIBE_SETTINGS, providerConfigs });
}

/** Provider-neutral defaults; `providerConfigs` stays empty until providers inject theirs. */
export const DEFAULT_SCRIBE_SETTINGS: ScribeSettings = {
  userName: '',

  permissionMode: 'auto',

  model: 'haiku',
  effortLevel: DEFAULT_REASONING_VALUE,
  serviceTier: 'default',
  enableAutoTitleGeneration: true,
  titleGenerationLocale: '',
  titleGenerationModel: '',

  excludedTags: [],
  mediaFolder: '',
  systemPrompt: '',

  sharedEnvironmentVariables: '',
  envSnippets: [],
  customContextLimits: {},

  keyboardNavigation: {
    scrollUpKey: 'w',
    scrollDownKey: 's',
    focusInputKey: 'i',
  },
  requireCommandOrControlEnterToSend: false,

  locale: 'en',

  providerConfigs: {},

  settingsProvider: 'claude',
  lastSelectedChatModel: null,
  inlineEditModel: null,
  savedProviderModel: {},
  savedProviderEffort: {},
  savedProviderServiceTier: {},
  savedProviderPermissionMode: {},
  pendingProviderSessionInvalidations: {},

  enableAutoScroll: true,
  showMessageTimestamps: false,
  deferMathRenderingDuringStreaming: true,
  pluginRenderedFenceLanguages: [],
  expandFileEditsByDefault: false,
  chatViewPlacement: 'right-sidebar',
  enableZenMode: true,
  zenModePosition: null,
  enableDualPane: true,
  dualPaneSide: 'right',
  restoreTabsOnStartup: true,
  skillsSynced: false,
  sessionManagerOrganization: 'list',
  sessionManagerSort: 'last-updated',
  sessionAutoArchiveAfter: 'off',
  pinnedLinkedContentPaths: [],

  hiddenCommands: [],
};
