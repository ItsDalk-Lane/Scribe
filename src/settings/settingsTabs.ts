export const COPILOT_SETTINGS_TAB_IDS = [
  "basic",
  "quickActions",
  "agents",
  "skills",
  "command",
  "subagents",
] as const;

export type CopilotSettingsTabId = (typeof COPILOT_SETTINGS_TAB_IDS)[number];
