export const SCRIBE_SETTINGS_TAB_IDS = [
  "basic",
  "quickActions",
  "agents",
  "skills",
  "command",
  "subagents",
] as const;

export type ScribeSettingsTabId = (typeof SCRIBE_SETTINGS_TAB_IDS)[number];
