import { formatReasoningValueLabel } from '@/core/providers/reasoning';
import type { ProviderUIOption } from '@/core/providers/types';
import { t } from '@/i18n/i18n';
import type { ModelMenuPart, ModelSelector } from '@/shared/toolbar/ModelSelector';
import { nextToolbarId, runToolbarAction } from '@/shared/toolbar/ToolbarMenu';
import type { ModelPickerCallbacks } from '@/shared/toolbar/types';

function reasoningLabel(value: string, label: string): string {
  if (value === 'low' && label === 'Low') return t('settings.codex.responseVerbosity.low');
  if (value === 'medium' && label === 'Medium') return t('settings.codex.responseVerbosity.medium');
  if (value === 'high' && label === 'High') return t('settings.codex.responseVerbosity.high');
  return label;
}

/** Bars in each level's strength glyph, however many levels the provider reports. */
const STRENGTH_BARS = 4;

/** Effort: a level on the model button, a list of levels in its popover. */
export class EffortSelector {
  private readonly part: ModelMenuPart;
  private callbacks: ModelPickerCallbacks;

  constructor(modelSelector: ModelSelector, callbacks: ModelPickerCallbacks) {
    this.callbacks = callbacks;
    this.part = modelSelector.attachPart(
      'reasoning',
      'scribe-toolbar-chip-secondary scribe-thinking-current',
      () => this.updateDisplay(),
    );
    this.part.sectionEl.addClass('scribe-thinking-selector');
    this.updateDisplay();
  }

  #hide(): void {
    this.part.chipEl.addClass('scribe-hidden');
    this.part.showSection(false);
    this.part.sectionEl.empty();
    this.part.describe(null);
  }

  updateDisplay() {
    const capabilities = this.callbacks.getCapabilities();
    if (capabilities.reasoningControl === 'none') {
      this.#hide();
      return;
    }

    const settings = this.callbacks.getSettings();
    const model = settings.model;
    const uiConfig = this.callbacks.getUIConfig();
    const options: ProviderUIOption[] = uiConfig.getReasoningOptions(model, settings);
    const defaultValue = uiConfig.getDefaultReasoningValue(model, settings);
    const shouldHide = options.length === 0
      || (options.length === 1 && options[0]?.value === defaultValue);
    if (shouldHide) {
      this.#hide();
      return;
    }

    const current = settings.reasoning;
    const selectedOption = options.find(option => option.value === current);
    const currentLabel = selectedOption
      ? reasoningLabel(selectedOption.value, selectedOption.label)
      : (current ? reasoningLabel(current, formatReasoningValueLabel(current)) : t('toolbar.effort.default'));

    this.part.chipEl.removeClass('scribe-hidden');
    this.part.chipEl.setText(currentLabel);
    this.part.describe(t('toolbar.effort.description', { level: currentLabel }));
    this.part.showSection(true);
    this.#renderLevels(options, defaultValue, current);
    this.part.menu.restoreFocus();
  }

  /** Levels from the deepest at the top to the fastest at the bottom; the provider lists them fastest first. */
  #renderLevels(options: ProviderUIOption[], defaultValue: string, current: string | null): void {
    const sectionEl = this.part.sectionEl;
    sectionEl.empty();
    const headingId = nextToolbarId('heading');
    sectionEl.createDiv({ cls: 'scribe-toolbar-popover-heading', text: t('toolbar.effort.heading'), attr: { id: headingId } });
    const listEl = sectionEl.createDiv({
      cls: 'scribe-thinking-levels',
      attr: { role: 'listbox', 'aria-labelledby': headingId },
    });
    // The list is one tab stop: the current level, else the default, else the top level.
    // No level is chosen while the menu browses another provider's models.
    const chosen = this.part.showsCurrentModel() ? current : null;
    const tabStop = [chosen, defaultValue].find(value => options.some(option => option.value === value))
      ?? options[options.length - 1].value;
    for (let index = options.length - 1; index >= 0; index--) {
      const option = options[index];
      const selected = option.value === chosen;
      const itemEl = this.part.menu.createItem(listEl, {
        role: 'option',
        key: `level:${option.value}`,
        checked: selected,
        tabbable: option.value === tabStop,
        label: reasoningLabel(option.value, option.label),
        cls: `scribe-thinking-level${selected ? ' selected' : ''}`,
        onSelect: () => {
          runToolbarAction(async () => {
            await this.callbacks.onEffortLevelChange(option.value);
            this.updateDisplay();
          }, t('toolbar.effort.changeFailed'));
        },
      });
      // The level's description is announced, not shown: no text under the level and no hover tooltip.
      if (option.description) itemEl.setAttribute('aria-description', option.description);

      const barsEl = itemEl.createSpan({ cls: 'scribe-thinking-strength', attr: { 'aria-hidden': 'true' } });
      const filled = Math.max(1, Math.round(((index + 1) / options.length) * STRENGTH_BARS));
      for (let bar = 0; bar < STRENGTH_BARS; bar++) {
        barsEl.createSpan({ cls: bar < filled ? 'is-filled' : '' });
      }
      itemEl.prepend(barsEl);
    }
  }
}
