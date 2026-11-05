export const SCRIBE_SETTINGS_TAB_IDS = [
  "basic",
  "quickActions",
  "myCommands",
  "skills",
  "command",
  "subagents",
  "about",
] as const;

export type ScribeSettingsTabId = (typeof SCRIBE_SETTINGS_TAB_IDS)[number];
