import { createDefaultScribeSettings } from '@/app/settings/defaultSettings';
import { getBuiltInProviderDefaultConfigs } from '@/providers/defaultProviderConfigs';

/** Application defaults with the built-in provider defaults that the composition root injects. */
export const DEFAULT_SCRIBE_SETTINGS = createDefaultScribeSettings(getBuiltInProviderDefaultConfigs());
