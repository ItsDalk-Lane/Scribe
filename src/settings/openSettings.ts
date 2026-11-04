import type { ScribeSettingsTabId } from "@/settings/settingsTabs";
import { callMethod, isRecord, readProperty } from "@/utils/obsidianInternals";
import type { App } from "obsidian";

let requestedScribeSettingsTab: ScribeSettingsTabId | null = null;

interface ObsidianSettingsController {
  open: () => void;
  openTabById: (id: string) => void;
}

export function openScribeSettings(app: App, ownerWindow: Window, tab: ScribeSettingsTabId): void {
  const settings = (app as unknown as { setting: ObsidianSettingsController }).setting;
  requestedScribeSettingsTab = tab;
  settings.open();
  ownerWindow.requestAnimationFrame(() => {
    if (requestedScribeSettingsTab !== null) settings.openTabById("scribe");
  });
}

export function openCorePluginSettings(app: App, pluginName: string): void {
  const settings = readProperty(app, "setting");
  callMethod(settings, "open");
  callMethod(settings, "openTabById", "plugins");
  const search = callMethod(
    readProperty(readProperty(settings, "activeTab"), "containerEl"),
    "querySelector",
    'input[type="search"]'
  );
  if (!isRecord(search)) return;
  search.value = pluginName;
  callMethod(search, "dispatchEvent", new Event("input"));
}

export function consumeRequestedScribeSettingsTab(): ScribeSettingsTabId {
  const requestedTab = requestedScribeSettingsTab ?? "basic";
  requestedScribeSettingsTab = null;
  return requestedTab;
}
