import type { App } from "obsidian";
import {
  DEVICE_UNLOCK_PATH,
  clearDeviceUnlock,
  createDeviceUnlockAccess,
  loadDesktopSafeStorage,
  readDeviceUnlockPassword,
  rememberDeviceUnlock,
  type SafeStorageLike,
} from "@/services/deviceUnlockStore";
import { setSettings } from "@/settings/model";

jest.mock("@/utils/desktopRuntime", () => ({
  isDesktopRuntime: () => mockDesktop,
  requireNodeModule: <T>(id: string): T => {
    if (id !== "electron") throw new Error(`unexpected module ${id}`);
    return mockElectron as unknown as T;
  },
}));
let mockDesktop = true;
let mockElectron: { safeStorage?: unknown; remote?: unknown } = {};

function fixture() {
  const files = new Map<string, string>();
  const folders = new Set<string>();
  const adapter = {
    exists: jest.fn(async (path: string) => files.has(path) || folders.has(path)),
    stat: jest.fn(async (path: string) =>
      folders.has(path) ? { type: "folder" } : files.has(path) ? { type: "file" } : null
    ),
    mkdir: jest.fn(async (path: string) => {
      folders.add(path);
    }),
    read: jest.fn(async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw new Error("missing file");
      return value;
    }),
    write: jest.fn(async (path: string, text: string) => {
      files.set(path, text);
    }),
    rename: jest.fn(async (from: string, to: string) => {
      if (!files.has(from)) throw new Error("missing source");
      files.set(to, files.get(from)!);
      files.delete(from);
    }),
    remove: jest.fn(async (path: string) => {
      files.delete(path);
    }),
  };
  const app = { vault: { adapter } } as unknown as App;
  return { files, adapter, app };
}
function fakeSafeStorage(roundTripWorks = true): SafeStorageLike & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    isEncryptionAvailable: () => true,
    encryptString: (plain: string) => {
      calls.push(`enc:${plain}`);
      return new TextEncoder().encode(`wrapped:${plain}`);
    },
    decryptString: (bytes: Uint8Array) => {
      const text = new TextDecoder().decode(bytes);
      if (!roundTripWorks) throw new Error("OS refused");
      return text.replace(/^wrapped:/, "");
    },
  };
}

describe("deviceUnlockStore", () => {
  beforeEach(() => {
    mockDesktop = true;
    mockElectron = {};
  });
  describe("rememberDeviceUnlock()", () => {
    it("stores an OS-wrapped copy of the master password in the secrets directory", async () => {
      const f = fixture();
      const safeStorage = fakeSafeStorage();
      await rememberDeviceUnlock(f.app, safeStorage, "master-pass");
      const stored = JSON.parse(f.files.get(DEVICE_UNLOCK_PATH) ?? "null") as {
        version?: number;
        blob?: unknown;
      };
      expect(stored).toMatchObject({ version: 1 });
      expect(typeof stored.blob).toBe("string");
      expect(safeStorage.calls).toEqual(["enc:master-pass"]);
    });
  });
  describe("readDeviceUnlockPassword()", () => {
    it("returns the unwrapped password after a successful OS round trip", async () => {
      const f = fixture();
      await rememberDeviceUnlock(f.app, fakeSafeStorage(), "master-pass");
      await expect(readDeviceUnlockPassword(f.app, fakeSafeStorage())).resolves.toBe("master-pass");
    });
    it("returns null for a missing, malformed, or unreadable wrapped blob", async () => {
      const f = fixture();
      await expect(readDeviceUnlockPassword(f.app, fakeSafeStorage())).resolves.toBeNull();
      f.files.set(DEVICE_UNLOCK_PATH, "{not json");
      await expect(readDeviceUnlockPassword(f.app, fakeSafeStorage())).resolves.toBeNull();
      f.files.set(DEVICE_UNLOCK_PATH, JSON.stringify({ version: 1, blob: "AAAA" }));
      await expect(readDeviceUnlockPassword(f.app, fakeSafeStorage(false))).resolves.toBeNull();
    });
  });
  describe("clearDeviceUnlock()", () => {
    it("removes the wrapped blob and tolerates a missing file", async () => {
      const f = fixture();
      await rememberDeviceUnlock(f.app, fakeSafeStorage(), "master-pass");
      await clearDeviceUnlock(f.app);
      expect(f.files.has(DEVICE_UNLOCK_PATH)).toBe(false);
      await expect(clearDeviceUnlock(f.app)).resolves.toBeUndefined();
    });
  });
  describe("loadDesktopSafeStorage()", () => {
    it("adapts the Electron API when the OS encryption service is available", () => {
      mockElectron = {
        safeStorage: {
          isEncryptionAvailable: () => true,
          encryptString: (plain: string) => new TextEncoder().encode(`wrapped:${plain}`),
          decryptString: () => "master-pass",
        },
      };
      const safeStorage = loadDesktopSafeStorage();
      expect(safeStorage).not.toBeNull();
      expect(safeStorage!.isEncryptionAvailable()).toBe(true);
    });
    it("falls back to the main-process bridge when the renderer allowlist omits safeStorage (https://github.com/ItsDalk-Lane/Scribe/issues/37)", () => {
      mockElectron = {
        remote: {
          require: () => ({
            safeStorage: {
              isEncryptionAvailable: () => true,
              encryptString: (plain: string) => new TextEncoder().encode(`wrapped:${plain}`),
              decryptString: (bytes: Uint8Array) =>
                new TextDecoder().decode(bytes).replace(/^wrapped:/, ""),
            },
          }),
        },
      };
      const safeStorage = loadDesktopSafeStorage();
      expect(safeStorage).not.toBeNull();
      const wrapped = safeStorage!.encryptString("probe");
      expect(safeStorage!.decryptString(wrapped)).toBe("probe");
    });
    it("returns null on mobile or when the service is unavailable", () => {
      mockDesktop = false;
      expect(loadDesktopSafeStorage()).toBeNull();
      mockDesktop = true;
      expect(loadDesktopSafeStorage()).toBeNull();
      mockElectron = { safeStorage: { isEncryptionAvailable: () => false } };
      expect(loadDesktopSafeStorage()).toBeNull();
    });
  });
  describe("createDeviceUnlockAccess()", () => {
    afterEach(() => setSettings({ secretsRememberOnDevice: true }));
    it("restores and re-wraps through the file store while remembering is enabled (https://github.com/ItsDalk-Lane/Scribe/issues/37)", async () => {
      const f = fixture();
      const access = createDeviceUnlockAccess(f.app, fakeSafeStorage());
      await expect(access.remember("master-pass")).resolves.toBe(true);
      await expect(access.restore()).resolves.toBe("master-pass");
      await access.forget();
      expect(f.files.has(DEVICE_UNLOCK_PATH)).toBe(false);
    });
    it("keeps every operation inert while remembering is disabled or the OS service is missing (https://github.com/ItsDalk-Lane/Scribe/issues/37)", async () => {
      const f = fixture();
      setSettings({ secretsRememberOnDevice: false });
      const disabled = createDeviceUnlockAccess(f.app, fakeSafeStorage());
      await expect(disabled.remember("master-pass")).resolves.toBe(false);
      await expect(disabled.restore()).resolves.toBeNull();
      expect(f.files.has(DEVICE_UNLOCK_PATH)).toBe(false);
      setSettings({ secretsRememberOnDevice: true });
      const noService = createDeviceUnlockAccess(f.app, null);
      await expect(noService.remember("master-pass")).resolves.toBe(false);
      await expect(noService.restore()).resolves.toBeNull();
    });
  });
});
