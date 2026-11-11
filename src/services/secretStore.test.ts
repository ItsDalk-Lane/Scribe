import type { App } from "obsidian";
import { SecretStore, type SecretUnlockRequest } from "@/services/secretStore";

const cryptoApi = jest.requireActual("node:crypto").webcrypto as Crypto;
const password = "test-only-master-password";

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
    list: jest.fn(async (root: string) => ({
      files: [...files.keys()].filter(
        (path) => path.startsWith(root + "/") && !path.slice(root.length + 1).includes("/")
      ),
      folders: [],
    })),
  };
  const secretStorage = { getSecret: jest.fn(), setSecret: jest.fn(), listSecrets: jest.fn() };
  const app = { vault: { adapter }, secretStorage } as unknown as App;
  const prompt = jest.fn(async (request: SecretUnlockRequest) => request.submit(password));
  const reset = jest.fn(async () => {});
  const createStore = (
    requestUnlock: (request: SecretUnlockRequest) => Promise<void> = prompt,
    deviceUnlock?: {
      restore(): Promise<string | null>;
      remember(password: string): Promise<boolean>;
      forget(): Promise<void>;
    }
  ) => new SecretStore(app, { crypto: cryptoApi, requestUnlock, onReset: reset, deviceUnlock });
  return { files, adapter, secretStorage, app, prompt, reset, createStore };
}

describe("secretStore", () => {
  describe("SecretStore", () => {
    afterEach(() => SecretStore.resetInstance());

    describe("getInstance()", () => {
      it("requires the vault on first initialization and shares that vault's service", () => {
        SecretStore.resetInstance();
        expect(() => SecretStore.getInstance()).toThrow("initialized");
        const f = fixture();
        const store = SecretStore.getInstance(f.app, { crypto: cryptoApi });
        expect(SecretStore.getInstance()).toBe(store);
      });
    });

    describe("resetInstance()", () => {
      it("drops the prior service and permits initialization for the next plugin lifecycle", () => {
        const f = fixture();
        const first = SecretStore.getInstance(f.app);
        SecretStore.resetInstance();
        expect(SecretStore.getInstance(f.app)).not.toBe(first);
      });
    });
    describe("initialize()", () => {
      it("opens a fresh store without creating files, prompting, or reading the old keychain", async () => {
        const f = fixture();
        await f.createStore().initialize();
        expect(f.files.size).toBe(0);
        expect(f.prompt).not.toHaveBeenCalled();
        expect(f.secretStorage.getSecret).not.toHaveBeenCalled();
      });
    });

    describe("setSecret()", () => {
      it("encrypts credentials into the vault and decrypts only the requested provider for a request", async () => {
        const f = fixture();
        const store = f.createStore();
        await store.setSecret("provider-a", "synthetic-secret-a");
        await store.setSecret("provider-b", "synthetic-secret-b");
        expect(f.prompt).toHaveBeenCalledTimes(1);
        expect([...f.files.keys()].every((path) => path.startsWith(".scribe/secrets/"))).toBe(true);
        expect([...f.files.values()].join("\n")).not.toMatch(
          /synthetic-secret|test-only-master-password/
        );
        expect(
          await store.withSecret("provider-a", async (secret) => secret === "synthetic-secret-a")
        ).toBe(true);
        expect(f.secretStorage.setSecret).not.toHaveBeenCalled();
      });

      it("keeps the previously saved credential when replacing its encrypted file fails", async () => {
        const f = fixture();
        const store = f.createStore();
        await store.setSecret("provider-a", "previous-secret");
        const before = new Map(f.files);
        f.adapter.rename.mockRejectedValueOnce(new Error("disk unavailable"));
        await expect(store.setSecret("provider-a", "replacement-secret")).rejects.toThrow(
          "disk unavailable"
        );
        expect(f.files).toEqual(before);
        expect(await store.withSecret("provider-a", async (secret) => secret)).toBe(
          "previous-secret"
        );
      });
    });

    describe("getStatus()", () => {
      it("reports a saved credential as locked after reopening without decrypting or prompting", async () => {
        const f = fixture();
        await f.createStore().setSecret("provider-a", "synthetic-secret");
        f.prompt.mockClear();
        const reopened = f.createStore();
        await reopened.initialize();
        expect(reopened.getStatus("provider-a")).toBe("locked");
        expect(reopened.getStatus("unknown-provider")).toBe("missing");
        expect(f.prompt).not.toHaveBeenCalled();
      });
    });

    describe("withSecret()", () => {
      it("does not send a credential if the plugin stops while decryption is completing", async () => {
        const f = fixture();
        const store = f.createStore();
        await store.setSecret("provider-a", "synthetic-secret");
        let decrypted!: () => void;
        let release!: () => void;
        const started = new Promise<void>((resolve) => {
          decrypted = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const decrypt = cryptoApi.subtle.decrypt.bind(cryptoApi.subtle) as SubtleCrypto["decrypt"];
        const pending = jest
          .spyOn(cryptoApi.subtle, "decrypt")
          .mockImplementationOnce(async (...args: Parameters<SubtleCrypto["decrypt"]>) => {
            const result = await decrypt(...args);
            decrypted();
            await gate;
            return result;
          });
        const send = jest.fn(async () => "sent");
        try {
          const request = store.withSecret("provider-a", send);
          await started;
          store.dispose();
          release();
          await expect(request).rejects.toMatchObject({ name: "AbortError" });
          expect(send).not.toHaveBeenCalled();
        } finally {
          pending.mockRestore();
        }
      });

      it("does not invoke the service callback or prompt for a background request while locked", async () => {
        const f = fixture();
        await f.createStore().setSecret("provider-a", "synthetic-secret");
        const reopened = f.createStore();
        f.prompt.mockClear();
        const send = jest.fn();
        await expect(
          reopened.withSecret("provider-a", send, { interactive: false })
        ).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
        expect(f.prompt).not.toHaveBeenCalled();
      });

      it("rejects a wrong master password and leaves all files untouched", async () => {
        const f = fixture();
        await f.createStore().setSecret("provider-a", "synthetic-secret");
        const before = new Map(f.files);
        const wrong = jest.fn(async (request: SecretUnlockRequest) =>
          request.submit("incorrect-password")
        );
        const reopened = f.createStore(wrong);
        const send = jest.fn();
        await expect(reopened.withSecret("provider-a", send)).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
        expect(f.files).toEqual(before);
      });

      it("rejects modified ciphertext without invoking the provider", async () => {
        const f = fixture();
        const store = f.createStore();
        await store.setSecret("provider-a", "synthetic-secret");
        const path = [...f.files.keys()].find((path) => !path.endsWith("metadata.json"))!;
        const entry = JSON.parse(f.files.get(path)!) as { ciphertext: string };
        entry.ciphertext = entry.ciphertext.slice(0, -4) + "AAAA";
        f.files.set(path, JSON.stringify(entry));
        const reopened = f.createStore();
        const send = jest.fn();
        await expect(reopened.withSecret("provider-a", send)).rejects.toThrow();
        expect(send).not.toHaveBeenCalled();
      });
    });

    describe("ensureUnlocked()", () => {
      it("shares one unlock prompt between concurrent requests", async () => {
        const f = fixture();
        await f.createStore().setSecret("provider-a", "synthetic-secret");
        f.prompt.mockClear();
        const reopened = f.createStore();
        await Promise.all([reopened.ensureUnlocked(), reopened.ensureUnlocked()]);
        expect(f.prompt).toHaveBeenCalledTimes(1);
      });

      it("treats closing the unlock dialog as cancellation without creating storage", async () => {
        const f = fixture();
        const cancelled = f.createStore(jest.fn(async () => {}));
        await expect(cancelled.ensureUnlocked()).rejects.toMatchObject({ name: "AbortError" });
        expect(f.files.size).toBe(0);
      });

      it("restores the unlocked state from the device-wrapped password without prompting (https://github.com/ItsDalk-Lane/Scribe/issues/37)", async () => {
        const f = fixture();
        await f.createStore().setSecret("provider-a", "synthetic-secret");
        f.prompt.mockClear();
        const send = jest.fn(async () => "sent");
        const remembered: string[] = [];
        const restored = f.createStore(undefined, {
          restore: jest.fn(async () => password),
          remember: jest.fn(async (value) => {
            remembered.push(value);
            return true;
          }),
          forget: jest.fn(),
        });
        await restored.withSecret("provider-a", send);
        expect(f.prompt).not.toHaveBeenCalled();
        expect(send).toHaveBeenCalledWith("synthetic-secret");
        expect(remembered).toEqual([]);
      });

      it("clears a stale device-wrapped password and recovers through the normal prompt (https://github.com/ItsDalk-Lane/Scribe/issues/37)", async () => {
        const f = fixture();
        await f.createStore().setSecret("provider-a", "synthetic-secret");
        f.prompt.mockClear();
        const remembered: string[] = [];
        const forget = jest.fn(async () => {});
        const stale = f.createStore(undefined, {
          restore: jest.fn(async () => "wrong-password"),
          remember: jest.fn(async (value) => {
            remembered.push(value);
            return true;
          }),
          forget,
        });
        await expect(stale.ensureUnlocked()).resolves.toBeUndefined();
        expect(forget).toHaveBeenCalledTimes(1);
        expect(f.prompt).toHaveBeenCalledTimes(1);
        expect(remembered).toEqual([password]);
        expect(stale.getStatus("provider-a")).toBe("available");
      });
    });

    describe("tryDeviceUnlock()", () => {
      it("silently restores the unlocked state without prompting or re-wrapping the stored blob (https://github.com/ItsDalk-Lane/Scribe/issues/37)", async () => {
        const f = fixture();
        await f.createStore().setSecret("provider-a", "synthetic-secret");
        f.prompt.mockClear();
        const remember = jest.fn(async () => true);
        const store = f.createStore(undefined, {
          restore: jest.fn(async () => password),
          remember,
          forget: jest.fn(),
        });
        await expect(store.tryDeviceUnlock()).resolves.toBe(true);
        expect(f.prompt).not.toHaveBeenCalled();
        expect(remember).not.toHaveBeenCalled();
        expect(store.getStatus("provider-a")).toBe("available");
      });

      it("returns false and stays locked when no wrapped password is available (https://github.com/ItsDalk-Lane/Scribe/issues/37)", async () => {
        const f = fixture();
        await f.createStore().setSecret("provider-a", "synthetic-secret");
        f.prompt.mockClear();
        const store = f.createStore(undefined, {
          restore: jest.fn(async () => null),
          remember: jest.fn(async () => true),
          forget: jest.fn(),
        });
        await expect(store.tryDeviceUnlock()).resolves.toBe(false);
        expect(f.prompt).not.toHaveBeenCalled();
        expect(store.getStatus("provider-a")).toBe("locked");
      });

      it("drops a stale wrapped password silently instead of prompting (https://github.com/ItsDalk-Lane/Scribe/issues/37)", async () => {
        const f = fixture();
        await f.createStore().setSecret("provider-a", "synthetic-secret");
        f.prompt.mockClear();
        const forget = jest.fn(async () => {});
        const store = f.createStore(undefined, {
          restore: jest.fn(async () => "wrong-password"),
          remember: jest.fn(async () => true),
          forget,
        });
        await expect(store.tryDeviceUnlock()).resolves.toBe(false);
        expect(forget).toHaveBeenCalledTimes(1);
        expect(f.prompt).not.toHaveBeenCalled();
        expect(store.getStatus("provider-a")).toBe("locked");
      });
    });

    describe("deleteSecret()", () => {
      it("removes only the chosen encrypted credential without unlocking other keys", async () => {
        const f = fixture();
        const store = f.createStore();
        await store.setSecret("provider-a", "first-secret");
        await store.setSecret("provider-b", "second-secret");
        const reopened = f.createStore();
        f.prompt.mockClear();
        await reopened.deleteSecret("provider-a");
        expect(reopened.getStatus("provider-a")).toBe("missing");
        expect(reopened.getStatus("provider-b")).toBe("locked");
        expect(f.prompt).not.toHaveBeenCalled();
      });
    });

    describe("reset()", () => {
      it("keeps encrypted files if clearing their configuration references cannot be saved", async () => {
        const f = fixture();
        const store = f.createStore();
        await store.setSecret("provider-a", "synthetic-secret");
        const before = new Map(f.files);
        f.reset.mockRejectedValueOnce(new Error("settings save failed"));
        await expect(store.reset()).rejects.toThrow("settings save failed");
        expect(f.files).toEqual(before);
        expect(store.getStatus("provider-a")).toBe("available");
      });
      it("clears new references before removing only new encrypted files and preserves old storage", async () => {
        const f = fixture();
        const store = f.createStore();
        await store.setSecret("provider-a", "synthetic-secret");
        f.files.set("old-scribe/skills/keep.md", "old content");
        f.reset.mockImplementationOnce(async () => {
          expect(store.getStatus("provider-a")).toBe("available");
        });
        await store.reset();
        expect(f.reset).toHaveBeenCalledTimes(1);
        expect(f.files).toEqual(new Map([["old-scribe/skills/keep.md", "old content"]]));
        expect(f.secretStorage.getSecret).not.toHaveBeenCalled();
      });
      it("deletes the device-wrapped password together with the stored secrets (https://github.com/ItsDalk-Lane/Scribe/issues/37)", async () => {
        const f = fixture();
        const deviceUnlock = {
          restore: jest.fn(async () => null),
          remember: jest.fn(async () => true),
          forget: jest.fn(async () => {}),
        };
        const store = f.createStore(undefined, deviceUnlock);
        await store.setSecret("provider-a", "synthetic-secret");
        expect(deviceUnlock.remember).toHaveBeenCalledWith(password);
        await store.reset();
        expect(deviceUnlock.forget).toHaveBeenCalledTimes(1);
      });
    });

    describe("dispose()", () => {
      it("releases the unlocked key so later use requires unlocking again", async () => {
        const f = fixture();
        const store = f.createStore();
        await store.setSecret("provider-a", "synthetic-secret");
        store.dispose();
        expect(store.getStatus("provider-a")).toBe("locked");
      });
    });
  });
});
