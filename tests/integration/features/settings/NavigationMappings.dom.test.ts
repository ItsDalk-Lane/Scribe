/** @jest-environment jsdom */
import '@/providers';
import '@test/helpers/ObsidianSettingsDOM';

import { deserialize, serialize } from 'node:v8';

import { DEFAULT_CLAUDIAN_SETTINGS } from '@test/helpers/defaultSettings';
import { fireEvent, within } from '@testing-library/dom';
import { axe } from 'jest-axe';

import { SettingsCoordinator } from '@/app/settings/SettingsCoordinator';
import { ClaudianSettingTab } from '@/features/settings/ClaudianSettings';
import { buildNavMappingText } from '@/features/settings/keyboardNavigation';
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

it('keeps and then persists the newer navigation draft when an older save completes', async () => {
  globalThis.structuredClone ??= value => deserialize(serialize(value));
  jest.useFakeTimers();
  let usingFakeTimers = true;
  const settings = { ...structuredClone(DEFAULT_CLAUDIAN_SETTINGS), enableAutoTitleGeneration: false };
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const saved: string[] = [];
  const coordinator = new SettingsCoordinator(settings, async draft => {
    saved.push(buildNavMappingText(draft.keyboardNavigation));
    if (saved.length === 1) await gate;
  });
  const host = { settings, mutateSettings: coordinator.mutate.bind(coordinator) };
  const tab = new ClaudianSettingTab({} as never, {} as never, host as never);
  const container = document.body.createDiv();
  try {
    tab['renderGeneralTab'](container);
    const row = within(container).getByText(t('settings.navMappings.name')).parentElement!;
    const input = within(row).getByRole('textbox') as HTMLTextAreaElement;
    const first = 'map k scrollUp\nmap j scrollDown\nmap f focusInput';
    const latest = 'map u scrollUp\nmap d scrollDown\nmap e focusInput';
    fireEvent.input(input, { target: { value: first } });
    await jest.advanceTimersByTimeAsync(500);
    expect(saved).toEqual([first]);
    fireEvent.input(input, { target: { value: latest } });
    release();
    await coordinator.persistCurrent();
    expect(input.value).toBe(latest);
    await jest.advanceTimersByTimeAsync(500);
    await coordinator.persistCurrent();
    expect(buildNavMappingText(settings.keyboardNavigation)).toBe(latest);
    expect(saved).toContain(latest);
    fireEvent.blur(input);
    await coordinator.persistCurrent();
    expect(input.value).toBe(latest);
    jest.useRealTimers();
    usingFakeTimers = false;
    expect((await axe(row, { runOnly: ['aria-valid-attr', 'aria-valid-attr-value'] })).violations).toEqual([]);
  } finally {
    release();
    if (usingFakeTimers) { jest.clearAllTimers(); jest.useRealTimers(); }
    container.remove();
  }
});
