import '@/providers';

import { DEFAULT_SCRIBE_SETTINGS } from '@test/helpers/defaultSettings';

import { SCRIBE_SETTINGS_PATH, ScribeSettingsStorage } from '@/app/settings/ScribeSettingsStorage';
import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import type { VaultFileAdapter } from '@/core/storage/VaultFileAdapter';

function fixture() {
  const retiredPath = '.claude/scribe-settings.json';
  const files = new Map([[retiredPath, JSON.stringify({ userName: 'Retired' })]]);
  const adapter = {
    exists: vi.fn(async (path: string) => files.has(path)),
    read: vi.fn(async (path: string) => files.get(path)!),
    write: vi.fn(async (path: string, content: string) => { files.set(path, content); }),
    delete: vi.fn(async (path: string) => { files.delete(path); }),
  };
  const storage = new ScribeSettingsStorage(adapter as unknown as VaultFileAdapter, DEFAULT_SCRIBE_SETTINGS);
  const settings = structuredClone(DEFAULT_SCRIBE_SETTINGS);
  const coordinator = new SettingsCoordinator(settings, value => storage.save(value));
  return { files, adapter, storage, settings, coordinator, retiredPath };
}

test('loads and saves canonical settings without reading or deleting retired storage', async () => {
  const { files, adapter, settings, coordinator, storage, retiredPath } = fixture();
  expect((await storage.load()).userName).toBe(DEFAULT_SCRIBE_SETTINGS.userName);
  expect(adapter.read).not.toHaveBeenCalled();
  const publish = vi.fn();
  await coordinator.mutate(value => { value.userName = 'Updated'; }, publish);
  expect(settings.userName).toBe('Updated');
  expect((await storage.load()).userName).toBe('Updated');
  expect(publish).toHaveBeenCalledTimes(1);
  expect(files.get(retiredPath)).toBe(JSON.stringify({ userName: 'Retired' }));
  expect(adapter.delete).not.toHaveBeenCalled();
});

test('a canonical write failure rolls back memory without touching retired storage', async () => {
  const { files, adapter, settings, coordinator, retiredPath } = fixture();
  const previousName = settings.userName;
  adapter.write.mockRejectedValueOnce(new Error('Write failed'));
  await expect(coordinator.mutate(value => { value.userName = 'Unsaved'; })).rejects.toThrow('Write failed');
  expect(settings.userName).toBe(previousName);
  expect(files.has(SCRIBE_SETTINGS_PATH)).toBe(false);
  expect(files.has(retiredPath)).toBe(true);
  expect(adapter.delete).not.toHaveBeenCalled();
});
