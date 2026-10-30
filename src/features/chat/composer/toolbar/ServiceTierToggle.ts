import { setIcon } from 'obsidian';

import type { ProviderServiceTierToggleConfig } from '@/core/providers/types';
import { toggleServiceTier } from '@/features/chat/composer/toggleServiceTier';
import type { ToolbarCallbacks } from '@/features/chat/composer/toolbar/types';
import { t } from '@/i18n/i18n';
import type { ModelMenuPart, ModelSelector } from '@/shared/toolbar/ModelSelector';
import { runToolbarAction } from '@/shared/toolbar/ToolbarMenu';

/** Fast-mode switch in the model menu, with an indicator on the model button while active. */
export class ServiceTierToggle {
  private readonly part: ModelMenuPart;
  private callbacks: ToolbarCallbacks;

  constructor(modelSelector: ModelSelector, callbacks: ToolbarCallbacks) {
    this.callbacks = callbacks;
    this.part = modelSelector.attachPart(
      'serviceTier',
      'scribe-toolbar-chip-secondary scribe-service-tier-indicator',
      () => this.updateDisplay(),
    );
    setIcon(this.part.chipEl, 'zap');
    this.part.sectionEl.addClass('scribe-service-tier-toggle');
    this.updateDisplay();
  }

  #getToggleConfig(): ProviderServiceTierToggleConfig | null {
    const uiConfig = this.callbacks.getUIConfig();
    return uiConfig.getServiceTierToggle?.(this.callbacks.getSettings()) ?? null;
  }

  updateDisplay() {
    const toggleConfig = this.#getToggleConfig();
    const sectionEl = this.part.sectionEl;
    sectionEl.empty();
    this.part.chipEl.toggleClass('scribe-hidden', !toggleConfig?.isActive);
    this.part.describe(toggleConfig?.isActive ? t('chat.displayFeedback.fastOn') : null);
    // While the menu browses another provider no model is chosen there, so, as for a model
    // without fast mode, the switch is not offered. The button still shows the current model's state.
    if (!toggleConfig || !this.part.showsCurrentModel()) {
      this.part.showSection(false);
      return;
    }

    this.part.showSection(true);
    const rawLabel = toggleConfig.isActive ? toggleConfig.activeLabel : toggleConfig.inactiveLabel;
    const currentLabel = rawLabel.toLowerCase() === 'standard' ? t('chat.displayFeedback.standard')
      : rawLabel.toLowerCase() === 'fast' ? t('chat.displayFeedback.fast') : rawLabel;
    const itemEl = this.part.menu.createItem(sectionEl, {
      role: 'switch',
      checked: toggleConfig.isActive,
      tabbable: true,
      label: t('chat.displayFeedback.fast'),
      cls: 'scribe-toolbar-popover-switch-row',
      title: [t('chat.displayFeedback.fastTitle', { state: currentLabel }), toggleConfig.description].filter(Boolean).join('\n'),
      leadingIcon: 'zap',
      onSelect: () => {
        runToolbarAction(async () => {
          await this.toggle();
        }, t('chat.displayFeedback.fastFailure'));
      },
    });
    itemEl.createSpan({ cls: `scribe-toggle-switch${toggleConfig.isActive ? ' active' : ''}` });
    this.part.menu.restoreFocus();
  }

  async toggle(): Promise<boolean> {
    const toggled = await toggleServiceTier(this.callbacks);
    if (toggled) {
      this.updateDisplay();
    }
    return toggled;
  }
}
