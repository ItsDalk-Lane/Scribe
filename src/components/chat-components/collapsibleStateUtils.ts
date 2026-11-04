const SCRIBE_COLLAPSIBLE_DOM_ID_PREFIX = "scribe-collapsible";

declare global {
  interface Window {
    __scribeCollapsibleStates?: Map<string, Map<string, boolean>>;
  }
}

const getCollapsibleStateRegistry = (): Map<string, Map<string, boolean>> => {
  if (!window.__scribeCollapsibleStates) {
    window.__scribeCollapsibleStates = new Map<string, Map<string, boolean>>();
  }
  return window.__scribeCollapsibleStates;
};

export const getMessageCollapsibleStates = (messageId: string): Map<string, boolean> => {
  const registry = getCollapsibleStateRegistry();
  let states = registry.get(messageId);
  if (!states) {
    states = new Map<string, boolean>();
    registry.set(messageId, states);
  }
  return states;
};

export const buildScribeCollapsibleDomId = (
  messageInstanceId: string,
  sectionKey: string
): string => {
  const safeMessageId = messageInstanceId.replace(/[^a-zA-Z0-9_-]/g, "_");
  return `${SCRIBE_COLLAPSIBLE_DOM_ID_PREFIX}-${safeMessageId}-${sectionKey}`;
};

export const captureScribeCollapsibleOpenStates = (
  root: HTMLElement,
  stateById: Map<string, boolean>,
  options: { overwriteExisting?: boolean } = {}
): void => {
  const overwriteExisting = options.overwriteExisting ?? true;
  const detailsList = root.querySelectorAll<HTMLDetailsElement>(
    `details[id^="${SCRIBE_COLLAPSIBLE_DOM_ID_PREFIX}-"]`
  );
  detailsList.forEach((details) => {
    const id = details.id;
    if (!id) {
      return;
    }
    if (!overwriteExisting && stateById.has(id)) {
      return;
    }
    stateById.set(id, details.open);
  });
};

export const getScribeCollapsibleDetailsFromEvent = (
  event: Event,
  root: HTMLElement
): HTMLDetailsElement | null => {
  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  for (const entry of path) {
    if (entry instanceof HTMLElement && entry.tagName === "DETAILS") {
      const details = entry as HTMLDetailsElement;
      if (details.id.startsWith(`${SCRIBE_COLLAPSIBLE_DOM_ID_PREFIX}-`) && root.contains(details)) {
        return details;
      }
    }
  }

  const target = event.target;
  if (!(target instanceof Element)) {
    return null;
  }

  const details = target.closest(`details[id^="${SCRIBE_COLLAPSIBLE_DOM_ID_PREFIX}-"]`);
  if (details?.instanceOf(HTMLElement) && details.tagName === "DETAILS" && root.contains(details)) {
    return details as HTMLDetailsElement;
  }

  return null;
};

export const isEventWithinDetailsSummary = (event: Event, details: HTMLDetailsElement): boolean => {
  const summary = details.querySelector("summary");
  if (!summary) {
    return false;
  }

  const target = event.target;
  if (target instanceof Node) {
    return summary.contains(target);
  }

  const path = typeof event.composedPath === "function" ? event.composedPath() : [];
  return path.includes(summary);
};
