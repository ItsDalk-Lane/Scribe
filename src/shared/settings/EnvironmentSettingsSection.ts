import { Notice, Setting } from 'obsidian';

import { getEnvironmentReviewKeysForScope } from '../../core/providers/providerEnvironment';
import type { ProviderHost } from '../../core/providers/ProviderHost';
import type { EnvironmentScope } from '../../core/types/settings';
import { t } from '../../i18n/i18n';
import { refreshCLIInstallations } from './CLIInstallationSetting';
import { EnvSnippetManager } from './EnvSnippetManager';

interface EnvironmentSettingsSectionOptions {
  container: HTMLElement;
  plugin: ProviderHost;
  scope: EnvironmentScope;
  heading?: string;
  name: string;
  desc: string;
  placeholder: string;
  renderCustomContextLimits?: (container: HTMLElement) => void;
}

export function renderEnvironmentSettingsSection(
  options: EnvironmentSettingsSectionOptions,
): void {
  const {
    container,
    plugin,
    scope,
    heading,
    name,
    desc,
    placeholder,
    renderCustomContextLimits,
  } = options;

  if (heading) {
    new Setting(container).setName(heading).setHeading();
  }

  const refreshInstallations = (): void => {
    refreshCLIInstallations(container.closest('.scribe-settings') ?? container);
  };

  let envTextarea: HTMLTextAreaElement | null = null;
  const reviewEl = container.createDiv({
    cls: 'scribe-env-review-warning scribe-setting-validation scribe-setting-validation-warning scribe-hidden',
  });

  const updateReviewWarning = () => {
    const reviewKeys = getEnvironmentReviewKeysForScope(envTextarea?.value ?? '', scope);
    if (reviewKeys.length === 0) {
      reviewEl.toggleClass('scribe-hidden', true);
      reviewEl.empty();
      return;
    }

    reviewEl.setText(t('settings.ui.environmentReview', { keys: reviewKeys.join(', ') }));
    reviewEl.toggleClass('scribe-hidden', false);
  };

  new Setting(container)
    .setName(name)
    .setDesc(desc)
    .setClass('scribe-settings-textarea')
    .addTextArea((text) => {
      text
        .setPlaceholder(placeholder)
        .setValue(plugin.getEnvironmentVariablesForScope(scope));
      text.inputEl.rows = 6;
      text.inputEl.cols = 50;
      text.inputEl.addClass('scribe-settings-env-textarea');
      text.inputEl.setAttribute('aria-label', name);
      text.inputEl.dataset.envScope = scope;
      text.inputEl.addEventListener('input', () => updateReviewWarning());
      text.inputEl.addEventListener('blur', () => {
        void (async (): Promise<void> => {
          try {
            await plugin.applyEnvironmentVariables(scope, text.inputEl.value);
            refreshInstallations();
            renderCustomContextLimits?.(contextLimitsContainer);
            updateReviewWarning();
          } catch {
            new Notice(t('settings.ui.environmentUpdateFailed'));
          }
        })();
      });
      envTextarea = text.inputEl;
    });

  updateReviewWarning();

  const contextLimitsContainer = container.createDiv({ cls: 'scribe-context-limits-container' });
  renderCustomContextLimits?.(contextLimitsContainer);

  const envSnippetsContainer = container.createDiv({ cls: 'scribe-env-snippets-container' });
  new EnvSnippetManager(envSnippetsContainer, plugin, scope, () => {
    refreshInstallations();
    renderCustomContextLimits?.(contextLimitsContainer);
  });
}
