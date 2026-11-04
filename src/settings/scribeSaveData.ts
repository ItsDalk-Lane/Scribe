import type { ScribeSettings } from "@/settings/model";
import type { App } from "obsidian";

export function getScribeSaveData(app: App): (data: ScribeSettings) => Promise<void> {
  return async (data: ScribeSettings) => {
    const { plugins } = app as unknown as {
      plugins: {
        getPlugin: (id: string) => { saveData: (data: ScribeSettings) => Promise<void> } | null;
      };
    };
    const scribePlugin = plugins.getPlugin("scribe");
    if (!scribePlugin) throw new Error("Scribe plugin not found");
    await scribePlugin.saveData(data);
  };
}
