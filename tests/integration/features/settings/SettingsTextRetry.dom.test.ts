/** @jest-environment jsdom */
import '@/providers';
import '@test/helpers/ObsidianSettingsDOM';

import { deserialize, serialize } from 'node:v8';

import { DesktopVault } from '@test/helpers/core/DesktopVault';
import { DEFAULT_CLAUDIAN_SETTINGS } from '@test/helpers/defaultSettings';
import { fireEvent, waitFor, within } from '@testing-library/dom';
import { axe } from 'jest-axe';
import { Notice } from 'obsidian';

import { ClaudianSettingsStorage } from '@/app/settings/ClaudianSettingsStorage';
import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import { t } from '@/i18n/i18n';

jest.mock('@/shared/settings/EnvironmentSettingsSection', () => ({ renderEnvironmentSettingsSection() {} }));
jest.mock('obsidian', () => {
  const dom = jest.requireActual('@test/helpers/ObsidianSettingsDOM');
  class Setting extends dom.Setting {
    setHeading() { return this; }
    addToggle(callback: (control: unknown) => void) {
      const toggleEl = this.settingEl.createEl('input', { attr: { type: 'checkbox' } });
      const toggle = {
        toggleEl,
        setValue(value: boolean) { toggleEl.checked = value; return this; },
        onChange(change: (value: boolean) => void) { toggleEl.addEventListener('change', () => change(toggleEl.checked)); return this; },
      };
      callback(toggle); return this;
    }
  }
  return { ...jest.requireActual('@test/__mocks__/obsidian'), ...dom, Setting };
});

afterEach(() => { document.body.replaceChildren(); jest.clearAllMocks(); });

it('retries an unchanged user-name draft on the next blur after a rejected save', async () => {
  globalThis.structuredClone ??= value => deserialize(serialize(value));
  const settings = { ...structuredClone(DEFAULT_CLAUDIAN_SETTINGS), userName: 'Before', enableAutoTitleGeneration: false };
  let saved = JSON.stringify(settings);
  const persist = jest.fn().mockRejectedValueOnce(new Error('Disk unavailable')).mockImplementation(async draft => {
    saved = JSON.stringify(draft);
  });
  const coordinator = new SettingsCoordinator(settings, persist);
  const runProviderExecutionTransition = jest.fn(async () => undefined);
  const host = { settings, mutateSettings: coordinator.mutate.bind(coordinator), providerHost: { runProviderExecutionTransition } };
  const tab = new ClaudianSettingTab({} as never, {} as never, host as never);
  const container = document.body.createDiv();
  tab['renderGeneralTab'](container);
  const row = within(container).getByText(t('settings.userName.name')).parentElement!;
  const input = within(row).getByRole('textbox') as HTMLInputElement;
  fireEvent.input(input, { target: { value: 'After' } });
  fireEvent.blur(input);
  await waitFor(() => expect(Notice).toHaveBeenCalledWith('Failed to save settings'));
  expect(settings.userName).toBe('Before');
  expect(JSON.parse(saved).userName).toBe('Before');
  expect(input.value).toBe('After');
  expect(runProviderExecutionTransition).not.toHaveBeenCalled();

  fireEvent.focus(input);
  fireEvent.blur(input);

  await waitFor(() => expect(JSON.parse(saved).userName).toBe('After'));
  expect(settings.userName).toBe('After');
  expect(input.value).toBe('After');
  expect(persist).toHaveBeenCalledTimes(2);
  await waitFor(() => expect(runProviderExecutionTransition).toHaveBeenCalledTimes(1));
  expect((await axe(row, { runOnly: ['aria-valid-attr', 'aria-valid-attr-value'] })).violations).toEqual([]);
});


it.each([false, true])('shows the newest text draft when settings reopen before a successful save finishes (newer edit: %s)', async newerEdit => {
  const vault = await DesktopVault.create();
  const settings = { ...structuredClone(DEFAULT_CLAUDIAN_SETTINGS), userName: 'Before', enableAutoTitleGeneration: false };
  const storage = new ClaudianSettingsStorage(vault.files, DEFAULT_CLAUDIAN_SETTINGS);
  await storage.save(settings);
  let started!: () => void;
  let finish!: () => void;
  const writing = new Promise<void>(resolve => { started = resolve; });
  const gate = new Promise<void>(resolve => { finish = resolve; });
  let writes = 0;
  const coordinator = new SettingsCoordinator(settings, async draft => {
    if (++writes === 1) { started(); await gate; }
    await storage.save(draft);
  });
  const host = {
    settings, mutateSettings: coordinator.mutate.bind(coordinator), storage: { getAdapter: () => vault.files },
    providerHost: { runProviderExecutionTransition: async () => undefined },
  };
  const tab = new ClaudianSettingTab({} as never, {} as never, host as never);
  const first = document.body.createDiv();
  let cleanup = tab['renderSettings'](first);
  const userName = (container: HTMLElement) => within(within(container).getByText(t('settings.userName.name')).parentElement!).getByRole<HTMLInputElement>('textbox');
  try {
    fireEvent.input(userName(first), { target: { value: 'After' } });
    fireEvent.blur(userName(first));
    await writing;
    // Obsidian disposes a setting section, removes its DOM, then renders it again on reopening.
    cleanup();
    first.remove();
    let reopened = document.body.createDiv();
    cleanup = tab['renderSettings'](reopened);
    expect(settings.userName).toBe('Before');
    expect(writes).toBe(1);
    if (newerEdit) {
      fireEvent.input(userName(reopened), { target: { value: 'Newest' } });
      cleanup();
      reopened.remove();
      reopened = document.body.createDiv();
      cleanup = tab['renderSettings'](reopened);
    }
    const expected = newerEdit ? 'Newest' : 'After';
    finish();
    await waitFor(() => expect(settings.userName).toBe(expected));
    await coordinator.persistCurrent();
    expect((await storage.load()).userName).toBe(expected);
    expect(userName(reopened).value).toBe(expected);
    fireEvent.input(userName(reopened), { target: { value: `${userName(reopened).value} Smith` } });
    fireEvent.blur(userName(reopened));
    await waitFor(() => expect(settings.userName).toBe(`${expected} Smith`));
    await coordinator.persistCurrent();
    expect((await storage.load()).userName).toBe(`${expected} Smith`);
  } finally { finish(); cleanup(); await coordinator.persistCurrent(); await vault.dispose(); }
});
