import type { App } from "obsidian";
import { getSettings, setSettings } from "@/settings/model";

export const HOME_SHELF_TAB_STORAGE_KEY = "scribe:home-shelf-tab:v1";

export function getHomeShelfTab(_app: App, storageKey: string): string | null {
  return getSettings().homeShelfTabs?.[storageKey] ?? null;
}

export function setHomeShelfTab(_app: App, storageKey: string, id: string): void {
  setSettings((current) => ({ homeShelfTabs: { ...current.homeShelfTabs, [storageKey]: id } }));
}
