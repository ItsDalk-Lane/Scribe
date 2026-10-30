/** @vitest-environment jsdom */

import { readFileSync } from 'node:fs';
import path from 'node:path';

describe('inline-edit.css', () => {
  let styles: HTMLStyleElement[] = [];

  beforeEach(() => {
    // One sheet per file, as the build concatenates them: jsdom drops the rest of a sheet after an
    // at-rule it cannot parse, such as model-selector.css's @container.
    styles = ['base/variables.css', 'toolbar/model-selector.css', 'features/inline-edit.css'].map((file) => {
      const style = document.createElement('style');
      style.textContent = readFileSync(path.resolve('src/style', file), 'utf8');
      document.head.appendChild(style);
      return style;
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    for (const style of styles) style.remove();
  });

  function mountComposer(providerId: string): HTMLElement {
    const container = document.createElement('div');
    container.className = 'scribe-inline-input-container';
    container.dataset.provider = providerId;
    container.innerHTML = '<div class="scribe-inline-input-wrap"><div class="scribe-inline-spinner"></div></div>';
    document.body.appendChild(container);
    return container;
  }

  it('spins in the Obsidian accent rather than the provider brand', () => {
    const spinner = mountComposer('claude').querySelector<HTMLElement>('.scribe-inline-spinner')!;

    expect(window.getComputedStyle(spinner).borderTopColor).toBe('var(--interactive-accent)');
  });

  it('colours the model chip logo for the provider running the edit', () => {
    const composer = mountComposer('deepseek');

    expect(window.getComputedStyle(composer).getPropertyValue('--scribe-provider-logo').trim())
      .toBe('var(--scribe-brand-deepseek)');
  });

  it('uses the floating menu viewport placement outside the clipped editor in provider colours', () => {
    document.body.innerHTML = '<div class="scribe-inline-menu-layer" data-provider="deepseek">'
      + '<div class="scribe-toolbar-popover scribe-toolbar-popover--floating"></div></div>';
    const menu = window.getComputedStyle(document.querySelector('.scribe-toolbar-popover')!);
    // jsdom does not inherit custom properties, so the layer the menu inherits from is read directly.
    const layer = window.getComputedStyle(document.querySelector('.scribe-inline-menu-layer')!);

    // ToolbarMenu supplies the chosen edge and available height; CSS must consume all three.
    expect(menu.position).toBe('fixed');
    expect(menu.top).toBe('var(--scribe-toolbar-popover-top, auto)');
    expect(menu.maxHeight).toBe('min(var(--scribe-toolbar-popover-max-height, 420px), 60vh)');
    expect(menu.bottom).toBe('var(--scribe-toolbar-popover-bottom)');
    expect(layer.getPropertyValue('--scribe-provider-logo').trim()).toBe('var(--scribe-brand-deepseek)');
  });

  it('keeps the review gutter bars inside the widget box, which Obsidian clips', () => {
    document.body.innerHTML = '<div class="scribe-inline-diff-preview"><div class="scribe-inline-diff-preview-body">'
      + '<div class="scribe-diff-block scribe-diff-del"></div></div></div>';

    for (const selector of ['.scribe-inline-diff-preview-body', '.scribe-diff-block']) {
      const style = window.getComputedStyle(document.querySelector(selector)!);
      // jsdom keeps logical margins as declared, so a negative bleed shows up as a minus sign.
      expect(`${style.marginLeft} ${style.getPropertyValue('margin-inline')}`).not.toMatch(/-\d/);
    }
  });

  it('separates the composer from the selected text below with padding, since Obsidian zeroes widget margins', () => {
    const host = document.createElement('style');
    host.textContent = '.markdown-source-view.mod-cm6 .cm-content > * { margin: 0 !important; }';
    document.head.appendChild(host);
    for (const style of styles) document.head.appendChild(style);
    styles.push(host);
    document.body.innerHTML = '<div class="markdown-source-view mod-cm6"><div class="cm-content">'
      + '<div class="scribe-inline-input-container" contenteditable="false"></div></div></div>';
    const composer = window.getComputedStyle(document.querySelector('.scribe-inline-input-container')!);

    expect(parseFloat(composer.marginBottom || '0') + parseFloat(composer.paddingBottom || '0')).toBeGreaterThanOrEqual(8);
  });

  it('gates the ::highlight rule, since an ungated one adds a highlight style to every element restyle', () => {
    const css = readFileSync(path.resolve('src/style/features/inline-edit.css'), 'utf8');
    const highlightSelectors = css.match(/^[^{}\n]*::highlight\([^{]*/gm) ?? [];

    expect(highlightSelectors.map(selector => selector.trim()))
      .toEqual(['body.scribe-selection-highlight-active ::highlight(scribe-selection)']);
  });
});
