import { formatContextWindow } from "./formatModelMetadata";

describe("formatModelMetadata", () => {
  describe("formatContextWindow()", () => {
    it("returns an empty string for a missing or zero context window", () => {
      expect(formatContextWindow(undefined)).toBe("");
      expect(formatContextWindow(0)).toBe("");
    });

    it("shows a context window below 1000 as the plain number", () => {
      expect(formatContextWindow(512)).toBe("512");
    });

    it("shows thousands as a rounded K value", () => {
      expect(formatContextWindow(1000)).toBe("1K");
      expect(formatContextWindow(128000)).toBe("128K");
      expect(formatContextWindow(200000)).toBe("200K");
    });

    it("shows millions as an M value without a trailing .0", () => {
      expect(formatContextWindow(1_000_000)).toBe("1M");
      expect(formatContextWindow(1_500_000)).toBe("1.5M");
      expect(formatContextWindow(2_000_000)).toBe("2M");
    });
  });
});
