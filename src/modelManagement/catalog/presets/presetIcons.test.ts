import { getPresetIcon } from "./presetIcons";

describe("presetIcons", () => {
  describe("getPresetIcon()", () => {
    it("returns the inline svg markup for a known icon key", () => {
      expect(getPresetIcon("kimi")).toMatch(/^<svg/);
    });

    it("returns undefined for icon keys without an inline asset so cards fall back to the letter tile", () => {
      expect(getPresetIcon("tokenplus")).toBeUndefined();
    });

    it("returns undefined for missing or absent icon keys", () => {
      expect(getPresetIcon("no-such-icon")).toBeUndefined();
      expect(getPresetIcon(undefined)).toBeUndefined();
    });
  });
});
