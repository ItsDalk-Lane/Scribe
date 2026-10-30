import { Notice, type Plugin } from 'obsidian';

import type { SharedAppStorage } from '@/core/bootstrap/storage';
import { getInstallationKey, type InstallationKey } from '@/core/device/InstallationKey';
import { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';
import type { ScribeSettings } from '@/core/types';

import { ProjectStore } from '../projects/ProjectStore';
import { ScribeSettingsStorage, type StoredScribeSettings } from '../settings/ScribeSettingsStorage';
import { ConversationPersistenceStore } from './ConversationPersistenceStore';
import { migrateSessionSidecars } from './migrateSessionSidecars';
import { SessionStorage } from './SessionStorage';

export class SharedStorageService implements SharedAppStorage {
  readonly installationKey: InstallationKey;
  readonly scribeSettings: ScribeSettingsStorage;
  readonly sessions: SessionStorage;
  readonly conversationPersistence: ConversationPersistenceStore;
  readonly projects: ProjectStore;

  private adapter: VaultFileAdapter;
  private obsoleteSessionInputs: string[] = [];

  constructor(plugin: Plugin, defaultSettings: Readonly<ScribeSettings>) {
    this.adapter = new VaultFileAdapter(plugin.app);
    const deviceKey = this.installationKey = getInstallationKey();
    this.scribeSettings = new ScribeSettingsStorage(this.adapter, defaultSettings);
    this.sessions = new SessionStorage(this.adapter, deviceKey);
    this.conversationPersistence = new ConversationPersistenceStore(this.adapter, deviceKey);
    this.projects = new ProjectStore(this.adapter);
  }

  async initialize(): Promise<{ scribe: Record<string, unknown> }> {
    // Settings and session recovery touch separate files. Join both even if settings fail.
    const [settings] = await Promise.allSettled([
      this.scribeSettings.load(),
      migrateSessionSidecars(this.adapter).then(paths => {
        this.obsoleteSessionInputs = paths;
      }).catch(() => {
        new Notice('Failed to clean up obsolete session files; will retry next launch');
      }),
    ]);
    if (settings.status === 'rejected') throw settings.reason;
    return { scribe: settings.value };
  }

  async cleanupObsoleteSessionInputs(signal: AbortSignal): Promise<void> {
    try {
      for (const file of this.obsoleteSessionInputs) {
        if (signal.aborted) return;
        await this.adapter.delete(file);
      }
      this.obsoleteSessionInputs = [];
    } catch {
      new Notice('Failed to clean up obsolete session files; will retry next launch');
    }
  }

  async saveScribeSettings(settings: Record<string, unknown>): Promise<void> {
    await this.scribeSettings.save(settings as StoredScribeSettings);
  }

  getAdapter(): VaultFileAdapter {
    return this.adapter;
  }
}
