import type { TabAttention } from '@/features/chat/state/types';
import { t } from '@/i18n/i18n';
import type { TranslationKey } from '@/i18n/types';

export type HistoryConversationOpenState = 'closed' | 'open' | 'current';

export type HistoryConversationStatus = {
  openState: HistoryConversationOpenState;
  isRunning: boolean;
  attention?: TabAttention;
  location?: 'current-view' | 'other-view';
  tabIndex?: number;
};

export type SessionStatusIndicatorKind = 'action-required' | 'error' | 'running' | 'unread';

/** Surface flags that decide how a session row presents its status. */
export interface SessionStatusDisplay {
  showAttentionState?: boolean;
  showOpenStateLabels?: boolean;
  sessionScope?: 'active' | 'archived';
}

/** A null icon is drawn by the indicator's own styles. */
const INDICATOR_PRESENTATION: Readonly<Record<SessionStatusIndicatorKind, {
  icon: string | null;
  label: TranslationKey;
}>> = {
  'action-required': { icon: 'alert-circle', label: 'chat.sessionManager.needsYourInput' },
  error: { icon: 'x-circle', label: 'chat.sessionManager.stoppedWithError' },
  running: { icon: 'loader-2', label: 'chat.sessionManager.running' },
  unread: { icon: null, label: 'chat.sessionManager.unread' },
};

/** Archived rows never present attention, even when their tab still carries it. */
export function canShowAttention(display: SessionStatusDisplay): boolean {
  return display.showAttentionState === true && display.sessionScope !== 'archived';
}

export function isCompletedReview(attention: TabAttention | undefined): boolean {
  return attention?.kind === 'review' && attention.outcome === 'completed';
}

/**
 * Badges replace open-state labels; they only appear when the surface hides those labels. A row
 * shows its most urgent badge: waiting, then running, then error, then unread.
 */
export function sessionIndicatorKind(
  status: HistoryConversationStatus,
  display: SessionStatusDisplay,
): SessionStatusIndicatorKind | null {
  if (display.showOpenStateLabels !== false) return null;

  const showAttention = canShowAttention(display);
  if (showAttention && status.attention?.kind === 'action-required') {
    return 'action-required';
  }
  if (status.isRunning) return 'running';
  if (showAttention && status.attention?.kind === 'review') {
    return status.attention.outcome === 'error' ? 'error' : 'unread';
  }
  return null;
}

/** A group shows its most urgent member badge, in the same order as a row. */
export function groupIndicatorKind(
  statuses: readonly HistoryConversationStatus[],
  display: SessionStatusDisplay,
): SessionStatusIndicatorKind | null {
  const kinds = statuses.map(status => sessionIndicatorKind(status, display));
  if (kinds.includes('action-required')) return 'action-required';
  if (kinds.includes('running')) return 'running';
  if (kinds.includes('error')) return 'error';
  if (kinds.includes('unread')) return 'unread';
  return null;
}

export function indicatorPresentation(kind: SessionStatusIndicatorKind): {
  icon: string | null;
  label: string;
} {
  const { icon, label } = INDICATOR_PRESENTATION[kind];
  return { icon, label: t(label) };
}

export function sessionItemIcon(
  openState: HistoryConversationOpenState,
  isRunning: boolean,
): string {
  if (isRunning) return 'loader-2';
  if (openState === 'current') return 'message-square-dot';
  return 'message-square';
}

function tabLabel(status: HistoryConversationStatus): string {
  if (typeof status.tabIndex === 'number') return t('chat.sessionManager.tabNumber', { number: status.tabIndex });
  if (status.openState === 'current') return t('chat.sessionManager.currentTab');
  return t('chat.sessionManager.tab');
}

export function sessionStatusText(
  status: HistoryConversationStatus,
  timestamp: number,
  showOpenStateLabels: boolean,
  language?: string,
): string {
  const { openState, isRunning } = status;
  const location = status.location ?? 'current-view';

  if (!showOpenStateLabels) return formatSessionDate(timestamp, undefined, language);
  if (status.attention?.kind === 'action-required') return t('chat.sessionManager.needsInput');

  if (openState !== 'closed' && location === 'other-view') {
    return isRunning ? t('chat.sessionManager.runningOtherPane') : t('chat.sessionManager.openOtherPane');
  }

  if (isRunning) {
    if (openState === 'closed') return t('chat.sessionManager.running');
    return t('chat.sessionManager.runningIn', { tab: tabLabel(status) });
  }

  switch (openState) {
    case 'current':
      return typeof status.tabIndex === 'number'
        ? t('chat.sessionManager.currentTabNumber', { number: status.tabIndex })
        : t('chat.sessionManager.currentSession');
    case 'open':
      return t('chat.sessionManager.openIn', { tab: tabLabel(status) });
    case 'closed':
      return formatSessionDate(timestamp, undefined, language);
  }
}

/** Today's sessions show their time; older sessions show their month and day. */
export function formatSessionDate(timestamp: number, now: Date = new Date(), language?: string): string {
  const date = new Date(timestamp);
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString(language, { hour: '2-digit', minute: '2-digit', hour12: false });
  }
  return date.toLocaleDateString(language, { month: 'short', day: 'numeric' });
}
