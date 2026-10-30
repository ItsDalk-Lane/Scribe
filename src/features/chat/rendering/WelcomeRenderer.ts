import { t } from '@/i18n/i18n';

const WELCOME_BRAND_NAME = 'Scribe';

export function renderWelcomeContent(
  welcomeEl: HTMLElement,
  greeting?: string,
): void {
  welcomeEl.empty();
  welcomeEl.createDiv({
    cls: 'scribe-welcome-brand scribe-welcome-text',
    text: WELCOME_BRAND_NAME,
  });

  if (greeting) {
    welcomeEl.createDiv({
      cls: 'scribe-welcome-greeting scribe-welcome-text',
      text: greeting,
    });
  }

  welcomeEl.createDiv({ cls: 'scribe-welcome-linked-content' });
}

export function createWelcomeElement(
  parentEl: HTMLElement,
  greeting?: string,
): HTMLElement {
  const welcomeEl = parentEl.createDiv({ cls: 'scribe-welcome' });
  renderWelcomeContent(welcomeEl, greeting);
  return welcomeEl;
}

/**
 * Picks a welcome greeting for the day and hour of `now`, personalized when a name is set.
 * `random` is a number in [0, 1) that selects among the candidates.
 */
export function pickWelcomeGreeting(name: string | undefined, now: Date, random: number): string {
  const hour = now.getHours();
  const day = now.getDay(); // 0 = Sunday, 6 = Saturday

  const personalize = (base: string, noNameFallback?: string): string =>
    name ? t('chat.welcome.personalized', { greeting: base, name }) : (noNameFallback ?? base);

  const dayGreetings: Record<number, string[]> = {
    0: [personalize(t('chat.welcome.happySunday')), t('chat.welcome.sundaySession'), t('chat.welcome.weekend')],
    1: [personalize(t('chat.welcome.happyMonday')), personalize(t('chat.welcome.backAtIt'), t('chat.welcome.backAtItExclamation'))],
    2: [personalize(t('chat.welcome.happyTuesday'))],
    3: [personalize(t('chat.welcome.happyWednesday'))],
    4: [personalize(t('chat.welcome.happyThursday'))],
    5: [personalize(t('chat.welcome.happyFriday')), personalize(t('chat.welcome.fridayFeeling'))],
    6: [personalize(t('chat.welcome.happySaturday'), t('chat.welcome.happySaturdayExclamation')), personalize(t('chat.welcome.weekend'))],
  };

  const timeGreetings = (): string[] => {
    if (hour >= 5 && hour < 12) {
      return [personalize(t('chat.welcome.morning')), t('chat.welcome.coffee')];
    } else if (hour >= 12 && hour < 18) {
      return [personalize(t('chat.welcome.afternoon')), personalize(t('chat.welcome.hey')), personalize(t('chat.welcome.howGoing')) + '?'];
    } else if (hour >= 18 && hour < 22) {
      return [personalize(t('chat.welcome.evening')), personalize(t('chat.welcome.eveningShort')), personalize(t('chat.welcome.howWasDay')) + '?'];
    }
    return [t('chat.welcome.nightOwl'), personalize(t('chat.welcome.eveningShort'))];
  };

  const generalGreetings = [
    personalize(t('chat.welcome.hey')),
    name ? t('chat.welcome.hiHowNamed', { name }) : t('chat.welcome.hiHow'),
    personalize(t('chat.welcome.howGoing')) + '?',
    personalize(t('chat.welcome.welcomeBack')) + '!',
    personalize(t('chat.welcome.whatsNew')) + '?',
    ...(name ? [t('chat.welcome.returns', { name })] : []),
    t('chat.welcome.absolutelyRight'),
  ];

  const greetings = [
    ...(dayGreetings[day] || []),
    ...timeGreetings(),
    ...generalGreetings,
  ];

  return greetings[Math.floor(random * greetings.length)];
}
