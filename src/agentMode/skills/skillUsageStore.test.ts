import {
  flushSkillUsageStore,
  forgetSkillUsage,
  getSkillUsageLedger,
  initializeSkillUsageStore,
  recordSkillUsage,
  resetSkillUsageStoreForTesting,
  SKILL_USAGE_PATH,
  useSkillUsageLedger,
} from "@/agentMode/skills/skillUsageStore";
import { act, renderHook } from "@testing-library/react";
import type { App } from "obsidian";

jest.mock("@/logger", () => ({
  logWarn: jest.fn(),
  logInfo: jest.fn(),
  logError: jest.fn(),
}));

// 纯本地台账：区分来源计数、删除清理、写盘节流且失败不影响主路径。
// https://github.com/ItsDalk-Lane/Scribe/issues/48
function fakeApp(files: Record<string, string> = {}) {
  const app = {
    vault: {
      adapter: {
        exists: async (path: string) => path in files,
        read: async (path: string) => {
          if (!(path in files)) throw new Error("missing");
          return files[path];
        },
        write: async (path: string, content: string) => {
          files[path] = content;
        },
        rename: async (from: string, to: string) => {
          files[to] = files[from];
          delete files[from];
        },
      },
    },
  } as unknown as App;
  return { app, files };
}

describe("skillUsageStore", () => {
  beforeEach(() => {
    resetSkillUsageStoreForTesting();
    jest.useFakeTimers();
  });
  afterEach(() => {
    jest.useRealTimers();
  });

  describe("recordSkillUsage()", () => {
    it("counts model and manual invocations separately per skill", async () => {
      const { app } = fakeApp();
      initializeSkillUsageStore(app);
      recordSkillUsage(app, "note-format", "model");
      await jest.runAllTimersAsync();
      recordSkillUsage(app, "note-format", "user");
      await jest.runAllTimersAsync();
      recordSkillUsage(app, "note-format", "model");
      await jest.runAllTimersAsync();
      const entry = getSkillUsageLedger()["note-format"];
      expect(entry.count).toBe(3);
      expect(entry.lastSource).toBe("model");
    });

    it("loads a previous ledger before counting and keeps its other entries", async () => {
      const { app, files } = fakeApp({
        [SKILL_USAGE_PATH]: JSON.stringify({
          "old-skill": { count: 7, lastUsedAt: 123, lastSource: "user" },
        }),
      });
      initializeSkillUsageStore(app);
      recordSkillUsage(app, "new-skill", "model");
      await jest.runAllTimersAsync();
      expect(getSkillUsageLedger()["old-skill"]).toEqual({
        count: 7,
        lastUsedAt: 123,
        lastSource: "user",
      });
      expect(getSkillUsageLedger()["new-skill"].count).toBe(1);
      expect(files[SKILL_USAGE_PATH]).toContain("old-skill");
    });

    it("persists to .scribe through staged writes and survives reload", async () => {
      const { app, files } = fakeApp();
      initializeSkillUsageStore(app);
      recordSkillUsage(app, "note-format", "model");
      await jest.advanceTimersByTimeAsync(31_000);
      const saved = files[SKILL_USAGE_PATH];
      expect(saved).toBeTruthy();
      resetSkillUsageStoreForTesting();
      initializeSkillUsageStore(fakeApp({ [SKILL_USAGE_PATH]: saved }).app);
      recordSkillUsage(null, "note-format", "user");
      await jest.runAllTimersAsync();
      expect(getSkillUsageLedger()["note-format"].count).toBe(2);
    });

    it("does not throw or block delivery when persistence fails", async () => {
      const app = {
        vault: {
          adapter: {
            exists: async () => false,
            read: async () => {
              throw new Error("unreadable");
            },
            write: async () => {
              throw new Error("disk full");
            },
            rename: async () => {
              throw new Error("disk full");
            },
          },
        },
      } as unknown as App;
      initializeSkillUsageStore(app);
      expect(() => recordSkillUsage(app, "note-format", "model")).not.toThrow();
      await jest.advanceTimersByTimeAsync(31_000);
      expect(getSkillUsageLedger()["note-format"].count).toBe(1);
    });

    it("updates React consumers through the ledger hook", async () => {
      const { app } = fakeApp();
      const { result } = renderHook(() => useSkillUsageLedger());
      initializeSkillUsageStore(app);
      await act(async () => {
        recordSkillUsage(app, "note-format", "user");
        await jest.runAllTimersAsync();
      });
      expect(result.current["note-format"]?.lastSource).toBe("user");
    });
  });

  describe("forgetSkillUsage()", () => {
    it("removes a skill's record and its persisted copy", async () => {
      const { app, files } = fakeApp();
      initializeSkillUsageStore(app);
      recordSkillUsage(app, "note-format", "model");
      await jest.runAllTimersAsync();
      forgetSkillUsage("note-format");
      await jest.advanceTimersByTimeAsync(31_000);
      expect(getSkillUsageLedger()["note-format"]).toBeUndefined();
      expect(files[SKILL_USAGE_PATH]).not.toContain("note-format");
    });
  });

  describe("flushSkillUsageStore()", () => {
    it("flushes pending counts immediately", async () => {
      const { app, files } = fakeApp();
      initializeSkillUsageStore(app);
      recordSkillUsage(app, "note-format", "model");
      await jest.runAllTimersAsync();
      recordSkillUsage(app, "note-format", "user");
      await flushSkillUsageStore();
      const saved = JSON.parse(files[SKILL_USAGE_PATH]) as Record<
        string,
        { count: number; lastSource: string }
      >;
      expect(saved["note-format"]).toMatchObject({ count: 2, lastSource: "user" });
    });
  });
});
