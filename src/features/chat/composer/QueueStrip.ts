import { setIcon } from 'obsidian';

import type { QueuedMessage } from '@/features/chat/state/types';
import { t } from '@/i18n/i18n';

export type QueueStripView =
  | { kind: 'queued'; message: QueuedMessage; canSteer: boolean }
  | { kind: 'steering'; message: QueuedMessage };

export interface QueueStripActions {
  steer(): void;
  edit(): void;
  discard(): void;
}

/** Renders the follow-up attached to the top of the composer; the queue owns every action. */
export function renderQueueStrip(el: HTMLElement, view: QueueStripView | null, actions: QueueStripActions): void {
  el.empty();
  if (!view) {
    el.removeClass('scribe-visible-flex');
    el.addClass('scribe-hidden');
    return;
  }

  el.createSpan({
    cls: 'scribe-input-queue-strip-tag',
    text: view.kind === 'steering' ? t('chat.queue.steering') : t('chat.queue.queued'),
  });
  el.createSpan({
    cls: 'scribe-queue-indicator-text',
    text: formatQueuedMessagePreview(view.message),
  });

  if (view.kind === 'queued') {
    const actionsEl = el.createDiv({ cls: 'scribe-queue-indicator-actions' });

    if (view.canSteer) {
      const steerButton = actionsEl.createEl('button', {
        cls: 'scribe-queue-indicator-action',
        text: t('chat.queue.steerNow'),
      });
      steerButton.setAttribute('type', 'button');
      steerButton.addEventListener('click', (event) => {
        event.stopPropagation();
        actions.steer();
      });
    }

    createIconButton(actionsEl, 'pencil', t('chat.queue.edit')).addEventListener('click', (event) => {
      event.stopPropagation();
      actions.edit();
    });
    createIconButton(actionsEl, 'trash-2', t('chat.queue.discard')).addEventListener('click', (event) => {
      event.stopPropagation();
      actions.discard();
    });
  }

  el.addClass('scribe-visible-flex');
  el.removeClass('scribe-hidden');
}

function formatQueuedMessagePreview(message: QueuedMessage): string {
  const rawContent = (message.content || message.turnRequest.draftContent || '').trim();
  const preview = rawContent.length > 40
    ? rawContent.slice(0, 40) + '...'
    : rawContent;
  if ((message.turnRequest.images?.length ?? 0) > 0) {
    return preview ? `${preview} ${t('chat.queue.images')}` : t('chat.queue.images');
  }
  return preview;
}

function createIconButton(parentEl: HTMLElement, icon: string, label: string): HTMLElement {
  const button = parentEl.createEl('button', {
    cls: 'scribe-queue-indicator-icon-action',
    attr: {
      'aria-label': label,
      type: 'button',
    },
  });
  setIcon(button, icon);
  return button;
}
