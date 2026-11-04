import { getScribeSaveData } from "@/settings/scribeSaveData";
import type { ScribeSettings } from "@/settings/model";
import type { App } from "obsidian";

function appWithPlugin(saveData?: (data: ScribeSettings) => Promise<void>): App {
  return {
    plugins: {
      getPlugin: (id: string) => (id === "scribe" && saveData ? { saveData } : null),
    },
  } as unknown as App;
}

describe("scribeSaveData", () => {
  describe("getScribeSaveData()", () => {
    it("returns a writer that delegates to the loaded plugin's saveData", async () => {
      const pluginSave = jest.fn<Promise<void>, [ScribeSettings]>().mockResolvedValue(undefined);
      const write = getScribeSaveData(appWithPlugin(pluginSave));
      const data = { scribeFolder: "team/scribe" } as ScribeSettings;

      await write(data);

      expect(pluginSave).toHaveBeenCalledWith(data);
    });

    it("throws when the Scribe plugin is not loaded", async () => {
      const write = getScribeSaveData(appWithPlugin(undefined));

      await expect(write({} as ScribeSettings)).rejects.toThrow("Scribe plugin not found");
    });
  });
});
