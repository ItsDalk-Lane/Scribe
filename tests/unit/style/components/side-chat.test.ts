/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import { fireEvent, within } from '@testing-library/dom';

import { SideChatPanel } from '@/features/chat/side-chat/SideChatPanel';

beforeAll(() => {
  Object.assign(HTMLElement.prototype, {
    setText(this: HTMLElement, text: string) { this.textContent = text; },
    toggleClass(this: HTMLElement, name: string, force: boolean) { this.classList.toggle(name, force); },
  });
});

describe('Side chat full height styles', () => {
  // jsdom applies rules in sheet order regardless of specificity; the utilities load last, as in index.css.
  const css = [
    'src/style/base/container.css',
    'src/style/components/tabs.css',
    'src/style/components/messages.css',
    'src/style/components/input.css',
    'src/style/components/side-chat.css',
    'src/style/components/zen-mode.css',
    'src/style/base/visibility.css',
  ]
    .map(file => readFileSync(path.resolve(file), 'utf8'))
    .join('\n');

  afterEach(() => {
    document.head.replaceChildren();
    document.body.replaceChildren();
  });

  /** Mounts a real panel in the view footer's composer slot, as the presentation placement does. */
  function renderView(composerParentSelector = '.scribe-active-input-slot') {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.appendChild(style);
    document.body.innerHTML = `
      <div class="scribe-container">
        <div class="scribe-chat-panel">
          <div class="scribe-tab-content-container">
            <div class="scribe-tab-content"><div class="scribe-messages-wrapper"></div></div>
          </div>
          <div class="scribe-input-footer">
            <div class="scribe-side-chat-chip-slot"></div>
            <div class="scribe-input-nav-row scribe-view-input-nav-row"><div class="scribe-input-nav-content"></div></div>
            <div class="scribe-active-input-slot"></div>
          </div>
        </div>
        <div class="scribe-zen"><div class="scribe-zen-composer"></div></div>
      </div>
    `;
    const composerEl = document.querySelector(composerParentSelector)!
      .appendChild(document.createElement('div'));
    composerEl.className = 'scribe-input-composer scribe-side-chat-expanded';
    const panel = new SideChatPanel(composerEl, { onCollapse: () => {}, onDiscard: () => {}, onExpand: () => {} });
    // The view lends its chat panel only while the composer sits in its footer slot.
    if (composerParentSelector === '.scribe-active-input-slot') {
      panel.setFullHeightHost(document.querySelector<HTMLElement>('.scribe-chat-panel'));
    }
    return {
      panel,
      panelEl: panel.rootEl.querySelector<HTMLElement>('.scribe-side-chat-panel')!,
      transcriptEl: document.querySelector<HTMLElement>('.scribe-tab-content-container')!,
      navRowEl: document.querySelector<HTMLElement>('.scribe-view-input-nav-row')!,
      footerEl: document.querySelector<HTMLElement>('.scribe-input-footer')!,
    };
  }

  it('avoids :has, which forces broad selector invalidation', () => {
    expect(readFileSync(path.resolve('src/style/components/side-chat.css'), 'utf8')).not.toContain(':has(');
  });

  it('gives the main transcript space to the side panel while full height', () => {
    const { panel, panelEl, transcriptEl, navRowEl, footerEl } = renderView();
    expect(window.getComputedStyle(transcriptEl).display).toBe('flex');
    expect(window.getComputedStyle(panelEl).maxHeight).not.toBe('none');

    fireEvent.click(within(panel.rootEl).getByRole('button', { name: 'Full height' }));
    expect(window.getComputedStyle(transcriptEl).display).toBe('none');
    expect(window.getComputedStyle(navRowEl).display).not.toBe('none');
    expect(window.getComputedStyle(footerEl).flexGrow).toBe('1');
    expect(window.getComputedStyle(panelEl).maxHeight).toBe('none');

    fireEvent.click(within(panel.rootEl).getByRole('button', { name: 'Full height' }));
    expect(window.getComputedStyle(transcriptEl).display).toBe('flex');
    expect(window.getComputedStyle(panelEl).maxHeight).not.toBe('none');
  });

  it('restores the main transcript while collapsed and full height again on expansion', () => {
    const { panel, panelEl, transcriptEl } = renderView();
    panel.setCollapsedHost(document.querySelector<HTMLElement>('.scribe-side-chat-chip-slot'));
    fireEvent.click(within(panel.rootEl).getByRole('button', { name: 'Full height' }));
    panel.setExpanded(false);
    // The collapsed chip lives in the same footer as the composer.
    expect(panel.rootEl.closest('.scribe-input-footer')).not.toBeNull();
    expect(window.getComputedStyle(transcriptEl).display).toBe('flex');

    panel.setExpanded(true);
    expect(window.getComputedStyle(transcriptEl).display).toBe('none');
    expect(window.getComputedStyle(panelEl).maxHeight).toBe('none');
  });

  it('offers no full height control in the floating zen composer', () => {
    const { panel } = renderView('.scribe-zen-composer');
    const button = within(panel.rootEl).getByLabelText('Full height');
    expect(window.getComputedStyle(button).display).toBe('none');
    expect(window.getComputedStyle(within(panel.rootEl).getByRole('button', { name: 'Collapse' })).display)
      .not.toBe('none');
  });
});
