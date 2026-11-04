import { isObsidianCliEnabled } from "@/services/obsidianCli/ObsidianCliClient";

interface TestRequireContainer {
  require?: (id: string) => unknown;
}

describe("ObsidianCliClient", () => {
  let originalRequire: ((id: string) => unknown) | undefined;

  beforeEach(() => {
    originalRequire = (window as unknown as TestRequireContainer).require;
  });

  afterEach(() => {
    const container = window as unknown as TestRequireContainer;
    if (originalRequire) {
      container.require = originalRequire;
    } else {
      delete container.require;
    }
    jest.clearAllMocks();
  });

  describe("isObsidianCliEnabled", () => {
    function installCliToggle(reply: unknown): jest.Mock {
      const sendSync = jest.fn(() => reply);
      (window as unknown as TestRequireContainer).require = jest.fn((id: string) =>
        id === "electron" ? { ipcRenderer: { sendSync } } : {}
      );
      return sendSync;
    }

    it("reads Obsidian's command line interface toggle without changing it", () => {
      const sendSync = installCliToggle(true);

      expect(isObsidianCliEnabled()).toBe(true);
      expect(sendSync).toHaveBeenCalledWith("cli", null);
    });

    it("returns false while the toggle is off", () => {
      installCliToggle(false);

      expect(isObsidianCliEnabled()).toBe(false);
    });

    it("returns false on Obsidian releases that do not answer the toggle message", () => {
      installCliToggle(undefined);

      expect(isObsidianCliEnabled()).toBe(false);
    });
  });
});
