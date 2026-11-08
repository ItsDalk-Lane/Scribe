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

  describe("getSkillUsageLedger()", () => {
    it("returns the same frozen empty ledger before initialization", () => {
      expect(getSkillUsageLedger()).toBe(getSkillUsageLedger());
      expect(Object.isFrozen(getSkillUsageLedger())).toBe(true);
    });
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

    it("retains both invocations when the previous ledger is still loading https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
      const { app } = fakeApp({
        [SKILL_USAGE_PATH]: JSON.stringify({
          "note-format": { count: 7, lastUsedAt: 123, lastSource: "user" },
        }),
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const exists = app.vault.adapter.exists.bind(app.vault.adapter);
      jest.spyOn(app.vault.adapter, "exists").mockImplementation(async (path) => {
        if (path === SKILL_USAGE_PATH) await gate;
        return exists(path);
      });
      initializeSkillUsageStore(app);
      recordSkillUsage(app, "note-format", "user");
      recordSkillUsage(app, "note-format", "model");
      release();
      await jest.runAllTimersAsync();
      expect(getSkillUsageLedger()["note-format"]).toMatchObject({ count: 9, lastSource: "model" });
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
      await act(async () => {
        initializeSkillUsageStore(app);
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

    it("does not restore a deleted skill when the previous ledger is still loading https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
      const { app, files } = fakeApp({
        [SKILL_USAGE_PATH]: JSON.stringify({
          old: { count: 4, lastUsedAt: 10, lastSource: "user" },
        }),
      });
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const exists = app.vault.adapter.exists.bind(app.vault.adapter);
      jest.spyOn(app.vault.adapter, "exists").mockImplementation(async (path) => {
        if (path === SKILL_USAGE_PATH) await gate;
        return exists(path);
      });
      initializeSkillUsageStore(app);
      forgetSkillUsage("old");
      recordSkillUsage(app, "new", "model");
      release();
      await flushSkillUsageStore();
      expect(getSkillUsageLedger()).not.toHaveProperty("old");
      expect(JSON.parse(files[SKILL_USAGE_PATH])).not.toHaveProperty("old");
    });
  });

  describe("flushSkillUsageStore()", () => {
    it("writes later usage after an earlier slow save instead of overwriting it https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
      const { app, files } = fakeApp();
      let release!: () => void;
      let started!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const firstWrite = new Promise<void>((resolve) => {
        started = resolve;
      });
      const write = app.vault.adapter.write.bind(app.vault.adapter);
      let writes = 0;
      jest.spyOn(app.vault.adapter, "write").mockImplementation(async (path, content) => {
        if (++writes === 1) {
          started();
          await gate;
        }
        return write(path, content);
      });
      initializeSkillUsageStore(app);
      recordSkillUsage(app, "note-format", "user");
      const firstFlush = flushSkillUsageStore();
      await firstWrite;
      recordSkillUsage(app, "note-format", "model");
      await jest.advanceTimersByTimeAsync(30_000);
      release();
      await firstFlush;
      await flushSkillUsageStore();
      expect(JSON.parse(files[SKILL_USAGE_PATH])["note-format"]).toMatchObject({
        count: 2,
        lastSource: "model",
      });
    });
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

    it("waits for the initial ledger read before saving pending usage https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
      const { app, files } = fakeApp();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const exists = app.vault.adapter.exists.bind(app.vault.adapter);
      jest.spyOn(app.vault.adapter, "exists").mockImplementation(async (path) => {
        if (path === SKILL_USAGE_PATH) await gate;
        return exists(path);
      });
      initializeSkillUsageStore(app);
      recordSkillUsage(app, "note-format", "user");
      const flushed = flushSkillUsageStore();
      release();
      await flushed;
      expect(JSON.parse(files[SKILL_USAGE_PATH])["note-format"].count).toBe(1);
    });
  });

  describe("initializeSkillUsageStore()", () => {
    it("loads existing usage before any new invocation https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
      const { app } = fakeApp({
        [SKILL_USAGE_PATH]: JSON.stringify({
          old: { count: 4, lastUsedAt: 10, lastSource: "user" },
        }),
      });
      initializeSkillUsageStore(app);
      await flushSkillUsageStore();
      expect(getSkillUsageLedger().old?.count).toBe(4);
    });

    it("does not publish or write the previous vault's pending load into a new vault https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
      const first = fakeApp({
        [SKILL_USAGE_PATH]: JSON.stringify({
          first: { count: 4, lastUsedAt: 10, lastSource: "user" },
        }),
      });
      const second = fakeApp();
      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const exists = first.app.vault.adapter.exists.bind(first.app.vault.adapter);
      jest.spyOn(first.app.vault.adapter, "exists").mockImplementation(async (path) => {
        if (path === SKILL_USAGE_PATH) await gate;
        return exists(path);
      });
      initializeSkillUsageStore(first.app);
      recordSkillUsage(first.app, "first", "user");
      initializeSkillUsageStore(second.app);
      recordSkillUsage(second.app, "second", "model");
      release();
      await flushSkillUsageStore();
      expect(getSkillUsageLedger()).toMatchObject({ second: { count: 1, lastSource: "model" } });
      expect(getSkillUsageLedger()).not.toHaveProperty("first");
      expect(JSON.parse(second.files[SKILL_USAGE_PATH])).not.toHaveProperty("first");
      expect(JSON.parse(first.files[SKILL_USAGE_PATH]).first.count).toBe(5);
    });

    it("preserves an unreadable existing ledger when new usage is recorded https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
      const damaged = "{ incomplete";
      const { app, files } = fakeApp({ [SKILL_USAGE_PATH]: damaged });
      initializeSkillUsageStore(app);
      recordSkillUsage(app, "note-format", "user");
      await flushSkillUsageStore();
      expect(files[SKILL_USAGE_PATH]).toBe(damaged);
    });
  });
});
