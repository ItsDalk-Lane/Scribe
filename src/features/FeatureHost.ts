import type { App } from 'obsidian';

import type { SharedAppStorage } from '@/core/bootstrap/storage';
import type { ProviderHost } from '@/core/providers/ProviderHost';
import type { ProviderId } from '@/core/providers/types';
import type {
  ScribeSettings,
  StoredChatModelSelection,
} from '@/core/types';

/** Application capabilities consumed by user-facing features. */
export interface FeatureHost {
  readonly app: App;
  readonly providerHost: ProviderHost;
  readonly settings: Readonly<ScribeSettings>;
  readonly storage: SharedAppStorage;

  getCommittedSettings(): Readonly<ScribeSettings>;

  mutateSettings(
    mutation: (settings: ScribeSettings) => void | Promise<void>,
  ): Promise<void>;
  getActiveEnvironmentVariables(providerId?: ProviderId): string;
  getAgentSkillResourceGeneration(): number;
  notifyAgentSkillsChanged(): Promise<void>;
  notifyProviderChatOptionsChanged(providerId: ProviderId): void;

  /** Selected execution context, without exposing a chat view or runtime. */
  getActiveModelSelection(): StoredChatModelSelection | null;
}
