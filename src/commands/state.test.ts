import {
  getCachedCustomCommands,
  isCustomCommandEnabled,
  subscribeToCustomCommands,
  updateCachedCommands,
  addPendingFileWrite,
  removePendingFileWrite,
  isFileWritePending,
} from "./state";
import { EMPTY_COMMAND } from "./constants";

describe("state", () => {
  describe("isFileWritePending()", () => {
    it("keeps a path pending until every overlapping writer has finished", () => {
      addPendingFileWrite("commands/Review.md");
      addPendingFileWrite("commands/Review.md");
      removePendingFileWrite("commands/Review.md");
      expect(isFileWritePending("commands/Review.md")).toBe(true);
      removePendingFileWrite("commands/Review.md");
      expect(isFileWritePending("commands/Review.md")).toBe(false);
    });
  });
  describe("isCustomCommandEnabled()", () => {
    it("treats missing enabled settings as on and rejects a stale item after it is disabled", () => {
      const stale = { ...EMPTY_COMMAND, title: "Review" };
      updateCachedCommands([]);
      expect(isCustomCommandEnabled(stale)).toBe(true);
      updateCachedCommands([{ ...stale, enabled: false }]);
      expect(isCustomCommandEnabled(stale)).toBe(false);
      expect(isCustomCommandEnabled({ ...stale, enabled: false })).toBe(false);
      updateCachedCommands([]);
    });
  });
  describe("subscribeToCustomCommands()", () => {
    it("notifies registration listeners when a command is disabled and stops after unsubscribe", () => {
      const listener = jest.fn();
      const unsubscribe = subscribeToCustomCommands(listener);
      updateCachedCommands([{ ...EMPTY_COMMAND, title: "Review", enabled: false }]);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(getCachedCustomCommands()[0].enabled).toBe(false);
      unsubscribe();
      updateCachedCommands([]);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
