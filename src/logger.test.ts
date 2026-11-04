import type { ScribeSettings } from "@/settings/model";

const mockGetSettings = jest.fn<ScribeSettings, []>();

jest.mock("@/settings/model", () => ({
  getSettings: () => mockGetSettings(),
}));

const mockAppend = jest.fn<Promise<void>, [string, ...unknown[]]>();

jest.mock("@/logFileManager", () => ({
  logFileManager: {
    append: (level: string, ...args: unknown[]) => mockAppend(level, ...args),
  },
}));

import { logError, logFatalError, logInfo, logWarn } from "@/logger";

describe("logger", () => {
  let logSpy: jest.SpyInstance;
  let debugSpy: jest.SpyInstance;
  let warnSpy: jest.SpyInstance;
  let errorSpy: jest.SpyInstance;

  function setDebug(debug: boolean): void {
    mockGetSettings.mockReturnValue({ debug } as ScribeSettings);
  }

  beforeEach(() => {
    jest.clearAllMocks();
    mockAppend.mockResolvedValue(undefined);
    logSpy = jest.spyOn(console, "log").mockImplementation(() => {});
    debugSpy = jest.spyOn(console, "debug").mockImplementation(() => {});
    warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("logInfo()", () => {
    it("writes to console.debug rather than console.log when debug is enabled", () => {
      setDebug(true);

      logInfo("retrieved chunks", 3);

      expect(debugSpy).toHaveBeenCalledWith("retrieved chunks", 3);
      expect(logSpy).not.toHaveBeenCalled();
    });

    it("leaves the console untouched when debug is disabled", () => {
      setDebug(false);

      logInfo("retrieved chunks");

      expect(debugSpy).not.toHaveBeenCalled();
    });

    it("appends an INFO entry to the rolling log file whether or not debug is enabled", () => {
      setDebug(false);
      logInfo("first");
      setDebug(true);
      logInfo("second");

      expect(mockAppend).toHaveBeenNthCalledWith(1, "INFO", "first");
      expect(mockAppend).toHaveBeenNthCalledWith(2, "INFO", "second");
    });
  });

  describe("logWarn()", () => {
    it("writes to console.warn when debug is enabled and appends a WARN entry either way", () => {
      setDebug(false);
      logWarn("rate limited");
      expect(warnSpy).not.toHaveBeenCalled();

      setDebug(true);
      logWarn("rate limited");

      expect(warnSpy).toHaveBeenCalledWith("rate limited");
      expect(mockAppend).toHaveBeenNthCalledWith(1, "WARN", "rate limited");
      expect(mockAppend).toHaveBeenNthCalledWith(2, "WARN", "rate limited");
    });
  });

  describe("logError()", () => {
    it("writes to console.error when debug is enabled and appends an ERROR entry either way", () => {
      const failure = new Error("boom");

      setDebug(false);
      logError(failure);
      expect(errorSpy).not.toHaveBeenCalled();

      setDebug(true);
      logError(failure);

      expect(errorSpy).toHaveBeenCalledWith(failure);
      expect(mockAppend).toHaveBeenNthCalledWith(1, "ERROR", failure);
      expect(mockAppend).toHaveBeenNthCalledWith(2, "ERROR", failure);
    });
  });

  describe("logFatalError()", () => {
    it("writes to console.error and appends an ERROR entry even when debug is disabled", () => {
      const failure = new Error("settings unreadable");
      setDebug(false);

      logFatalError("Scribe failed to start.", failure);

      expect(errorSpy).toHaveBeenCalledWith("Scribe failed to start.", failure);
      expect(mockAppend).toHaveBeenCalledWith("ERROR", "Scribe failed to start.", failure);
    });
  });
});
