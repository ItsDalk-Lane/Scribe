import type { App } from "obsidian";
import { ensureFolderExists } from "@/utils";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { sha256 } from "@/utils/hash";
import { logWarn } from "@/logger";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";

const DIRECTORY = ".scribe/secrets";
const METADATA_PATH = `${DIRECTORY}/metadata.json`;
const CHECK_VALUE = "scribe-secret-store-v1";
const ITERATIONS = 600_000;

interface Ciphertext {
  iv: string;
  ciphertext: string;
}

interface SecretEntry extends Ciphertext {
  version: 1;
  id: string;
}

interface SecretMetadata {
  version: 1;
  kdf: { algorithm: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  check: Ciphertext;
}

function entryPath(id: string): string {
  return `${DIRECTORY}/${sha256(id)}.json`;
}

function isCiphertext(value: unknown): value is Ciphertext {
  if (!value || typeof value !== "object") return false;
  const record = value as Partial<Ciphertext>;
  try {
    return (
      typeof record.iv === "string" &&
      typeof record.ciphertext === "string" &&
      base64ToArrayBuffer(record.iv).byteLength === 12 &&
      base64ToArrayBuffer(record.ciphertext).byteLength >= 16
    );
  } catch {
    return false;
  }
}

function cancelled(): DOMException {
  return new DOMException("已取消解锁。", "AbortError");
}

export type SecretStatus = "missing" | "locked" | "available" | "unavailable";

export interface SecretUnlockRequest {
  creating: boolean;
  signal: AbortSignal;
  cancel(): void;
  submit(password: string): Promise<void>;
  reset(): Promise<void>;
}

export interface DeviceUnlockAccess {
  restore(): Promise<string | null>;
  remember(password: string): Promise<boolean>;
  forget(): Promise<void>;
}

export interface SecretStoreOptions {
  requestUnlock?: (request: SecretUnlockRequest) => Promise<void>;
  onReset?: () => Promise<void>;
  crypto?: Crypto;
  deviceUnlock?: DeviceUnlockAccess;
}

export class SecretStore {
  private static instance: SecretStore | undefined;
  private metadata: SecretMetadata | undefined;
  private metadataSource: string | null = null;
  private metadataError = false;
  private key: CryptoKey | undefined;
  private readonly entries = new Map<string, SecretEntry>();
  private readonly unreadable = new Set<string>();
  private initialization: Promise<void> | undefined;
  private pendingUnlock: Promise<void> | undefined;
  private unlockController: AbortController | undefined;
  private writes: Promise<void> = Promise.resolve();
  private generation = 0;

  constructor(
    readonly app: App,
    readonly options: SecretStoreOptions = {}
  ) {}

  static getInstance(app?: App, options?: SecretStoreOptions): SecretStore {
    if (!SecretStore.instance) {
      if (!app) throw new Error("SecretStore must be initialized with app.");
      SecretStore.instance = new SecretStore(app, options);
    }
    return SecretStore.instance;
  }

  static resetInstance(): void {
    SecretStore.instance?.dispose();
    SecretStore.instance = undefined;
  }

  initialize(): Promise<void> {
    this.initialization ??= this.load();
    return this.initialization;
  }

  private async load(): Promise<void> {
    await assertScribePath(this.app.vault, DIRECTORY);
    const adapter = this.app.vault.adapter;
    if (!(await adapter.exists(DIRECTORY))) return;
    try {
      if (await adapter.exists(METADATA_PATH)) {
        this.metadataSource = await adapter.read(METADATA_PATH);
        const metadata = JSON.parse(this.metadataSource) as SecretMetadata;
        if (
          metadata.version !== 1 ||
          metadata.kdf?.algorithm !== "PBKDF2" ||
          metadata.kdf.hash !== "SHA-256" ||
          metadata.kdf.iterations !== ITERATIONS ||
          typeof metadata.kdf.salt !== "string" ||
          base64ToArrayBuffer(metadata.kdf.salt).byteLength !== 16 ||
          !isCiphertext(metadata.check)
        ) {
          throw new Error("密钥存储格式无效。");
        }
        this.metadata = metadata;
      }
    } catch {
      this.metadataError = true;
    }
    const listing = await adapter.list(DIRECTORY);
    for (const path of listing.files) {
      if (!/^\.scribe\/secrets\/[a-f0-9]{64}\.json$/.test(path)) continue;
      await assertScribePath(this.app.vault, path);
      try {
        const entry = JSON.parse(await adapter.read(path)) as SecretEntry;
        if (
          entry.version !== 1 ||
          typeof entry.id !== "string" ||
          entryPath(entry.id) !== path ||
          !isCiphertext(entry)
        ) {
          throw new Error("密钥文件无效。");
        }
        this.entries.set(entry.id, entry);
      } catch {
        this.unreadable.add(path);
      }
    }
    if (!this.metadata && (this.entries.size || this.unreadable.size)) this.metadataError = true;
  }

  getStatus(id: string): SecretStatus {
    if (this.unreadable.has(entryPath(id))) return "unavailable";
    if (!this.entries.has(id)) return "missing";
    if (this.metadataError) return "unavailable";
    return this.key ? "available" : "locked";
  }

  async ensureUnlocked(): Promise<void> {
    const initialGeneration = this.generation;
    await this.initialize();
    if (initialGeneration !== this.generation) throw cancelled();
    if (this.key) return;
    if (!this.pendingUnlock) {
      const generation = this.generation;
      const controller = new AbortController();
      this.unlockController = controller;
      this.pendingUnlock = (async () => {
        const device = this.options.deviceUnlock;
        if (device) {
          let restored: string | null = null;
          try {
            restored = await device.restore();
          } catch {
            restored = null;
          }
          if (restored !== null) {
            try {
              await this.unlock(restored, generation, true);
              return;
            } catch (error) {
              // 恢复的设备解锁包只有通过既有校验才被接受；失效即删除并回到人工输入。
              // https://github.com/ItsDalk-Lane/Scribe/issues/37
              if (generation !== this.generation) throw error;
              try {
                await device.forget();
              } catch (forgetError) {
                logWarn("[SecretStore] Failed to drop a stale device unlock.", forgetError);
              }
            }
          }
        }
        const request: SecretUnlockRequest = {
          creating: !this.metadata && !this.metadataError,
          signal: controller.signal,
          cancel: () => {
            if (!this.key) this.dispose();
          },
          submit: async (password) => {
            if (generation !== this.generation) throw cancelled();
            await this.unlock(password, generation);
          },
          reset: () => this.reset(),
        };
        if (this.options.requestUnlock) await this.options.requestUnlock(request);
        else {
          const { requestSecretUnlock } = await import("@/services/ui/SecretUnlockModal");
          await requestSecretUnlock(this.app, request);
        }
        if (!this.key || generation !== this.generation) throw cancelled();
      })().finally(() => {
        this.pendingUnlock = undefined;
        this.unlockController = undefined;
      });
    }
    return this.pendingUnlock;
  }

  async tryDeviceUnlock(): Promise<boolean> {
    const generation = this.generation;
    await this.initialize();
    if (generation !== this.generation) return false;
    if (this.key) return true;
    if (this.pendingUnlock) return false;
    const device = this.options.deviceUnlock;
    if (!device) return false;
    let restored: string | null = null;
    try {
      restored = await device.restore();
    } catch {
      restored = null;
    }
    if (restored === null) return false;
    try {
      await this.unlock(restored, generation, true);
      return true;
    } catch {
      // 静默恢复失败不弹窗：失效解锁包删除后保持锁定，等待真正需要密钥时再人工输入。
      // https://github.com/ItsDalk-Lane/Scribe/issues/37
      if (generation !== this.generation) return false;
      try {
        await device.forget();
      } catch (forgetError) {
        logWarn("[SecretStore] Failed to drop a stale device unlock.", forgetError);
      }
      return false;
    }
  }

  private async unlock(password: string, generation: number, viaDevice = false): Promise<void> {
    if (this.metadataError)
      throw new Error("密钥存储已损坏，原文件未被修改。可从备份恢复，或重置后重新填写密钥。");
    if (!password.length) throw new Error("请输入主密码。");
    const cryptoApi = this.options.crypto ?? window.crypto;
    const salt = this.metadata
      ? base64ToArrayBuffer(this.metadata.kdf.salt)
      : cryptoApi.getRandomValues(new Uint8Array(16)).buffer;
    const material = await cryptoApi.subtle.importKey(
      "raw",
      new TextEncoder().encode(password),
      "PBKDF2",
      false,
      ["deriveKey"]
    );
    const key = await cryptoApi.subtle.deriveKey(
      { name: "PBKDF2", hash: "SHA-256", iterations: ITERATIONS, salt },
      material,
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"]
    );
    if (this.metadata) {
      let verified = false;
      try {
        verified = (await this.decrypt(this.metadata.check, key, "metadata")) === CHECK_VALUE;
      } catch {
        verified = false;
      }
      if (!verified) throw new Error("主密码不正确，或密钥存储已损坏。原文件未被修改。");
    } else {
      const metadata: SecretMetadata = {
        version: 1,
        kdf: {
          algorithm: "PBKDF2",
          hash: "SHA-256",
          iterations: ITERATIONS,
          salt: arrayBufferToBase64(salt),
        },
        check: await this.encrypt(CHECK_VALUE, key, "metadata"),
      };
      if (generation !== this.generation) throw cancelled();
      await this.enqueue(async () => {
        if (generation !== this.generation) throw cancelled();
        await assertScribePath(this.app.vault, DIRECTORY);
        await ensureFolderExists(this.app.vault, DIRECTORY);
        if (generation !== this.generation) throw cancelled();
        const text = JSON.stringify(metadata);
        await writeVaultFile(this.app.vault, METADATA_PATH, text, null);
        this.metadata = metadata;
        this.metadataSource = text;
      });
    }
    if (generation !== this.generation) throw cancelled();
    this.key = key;
    if (this.options.deviceUnlock && !viaDevice) {
      try {
        await this.options.deviceUnlock.remember(password);
      } catch (error) {
        logWarn("[SecretStore] Failed to remember the master password on this device.", error);
      }
    }
  }

  private async encrypt(value: string, key: CryptoKey, id: string): Promise<Ciphertext> {
    const cryptoApi = this.options.crypto ?? window.crypto;
    const iv = cryptoApi.getRandomValues(new Uint8Array(12));
    const bytes = new TextEncoder().encode(value);
    try {
      const ciphertext = await cryptoApi.subtle.encrypt(
        { name: "AES-GCM", iv, additionalData: new TextEncoder().encode(`scribe:v1:${id}`) },
        key,
        bytes
      );
      return { iv: arrayBufferToBase64(iv.buffer), ciphertext: arrayBufferToBase64(ciphertext) };
    } finally {
      bytes.fill(0);
    }
  }

  private async decrypt(value: Ciphertext, key: CryptoKey, id: string): Promise<string> {
    const bytes = new Uint8Array(
      await (this.options.crypto ?? window.crypto).subtle.decrypt(
        {
          name: "AES-GCM",
          iv: base64ToArrayBuffer(value.iv),
          additionalData: new TextEncoder().encode(`scribe:v1:${id}`),
        },
        key,
        base64ToArrayBuffer(value.ciphertext)
      )
    );
    try {
      return new TextDecoder().decode(bytes);
    } finally {
      bytes.fill(0);
    }
  }

  async setSecret(id: string, value: string): Promise<void> {
    if (!id || !value) throw new Error("密钥标识和密钥不能为空。");
    const generation = this.generation;
    await this.ensureUnlocked();
    if (generation !== this.generation) throw cancelled();
    const key = this.key!;
    await this.enqueue(async () => {
      if (generation !== this.generation) throw cancelled();
      const path = entryPath(id);
      await assertScribePath(this.app.vault, path);
      if ((await this.app.vault.adapter.read(METADATA_PATH)) !== this.metadataSource)
        throw new Error("密钥存储已被其他窗口修改，请重新打开库后重试。");
      const previous = (await this.app.vault.adapter.exists(path))
        ? await this.app.vault.adapter.read(path)
        : null;
      const entry: SecretEntry = { version: 1, id, ...(await this.encrypt(value, key, id)) };
      if (generation !== this.generation) throw cancelled();
      await writeVaultFile(this.app.vault, path, JSON.stringify(entry), previous);
      this.entries.set(id, entry);
      this.unreadable.delete(path);
    });
  }

  async deleteSecret(id: string): Promise<void> {
    await this.initialize();
    await this.enqueue(async () => {
      const path = entryPath(id);
      await assertScribePath(this.app.vault, path);
      if (await this.app.vault.adapter.exists(path)) await this.app.vault.adapter.remove(path);
      this.entries.delete(id);
      this.unreadable.delete(path);
    });
  }

  async withSecret<T>(
    id: string,
    execute: (plaintext: string) => Promise<T>,
    options?: { interactive?: boolean }
  ): Promise<T> {
    const generation = this.generation;
    await this.initialize();
    if (generation !== this.generation) throw cancelled();
    const status = this.getStatus(id);
    if (status === "missing" || status === "unavailable")
      throw new Error("服务商密钥缺失或无法读取，请重新填写。");
    if (!this.key && options?.interactive === false) throw new Error("密钥存储尚未解锁。");
    await this.ensureUnlocked();
    await assertScribePath(this.app.vault, entryPath(id));
    if (generation !== this.generation) throw cancelled();
    let plaintext: string;
    try {
      const current = JSON.parse(await this.app.vault.adapter.read(entryPath(id))) as SecretEntry;
      if (current.version !== 1 || current.id !== id || !isCiphertext(current))
        throw new Error("invalid ciphertext");
      plaintext = await this.decrypt(current, this.key!, id);
    } catch {
      if (generation !== this.generation) throw cancelled();
      this.unreadable.add(entryPath(id));
      throw new Error("密钥文件已损坏或被修改，未发送请求。请重新填写此服务商密钥。");
    }
    try {
      if (generation !== this.generation) throw cancelled();
      return await execute(plaintext);
    } finally {
      plaintext = "";
    }
  }

  async reset(): Promise<void> {
    await this.initialize();
    await this.enqueue(async () => {
      await this.options.onReset?.();
      if (this.options.deviceUnlock) {
        try {
          await this.options.deviceUnlock.forget();
        } catch (error) {
          logWarn("[SecretStore] Failed to drop the device unlock during reset.", error);
        }
      }
      this.dispose();
      if (await this.app.vault.adapter.exists(DIRECTORY)) {
        const listing = await this.app.vault.adapter.list(DIRECTORY);
        for (const path of listing.files) {
          if (path !== METADATA_PATH && !/^\.scribe\/secrets\/[a-f0-9]{64}\.json$/.test(path))
            continue;
          await assertScribePath(this.app.vault, path);
          await this.app.vault.adapter.remove(path);
        }
      }
      this.entries.clear();
      this.unreadable.clear();
      this.metadata = undefined;
      this.metadataSource = null;
      this.metadataError = false;
    });
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    const job = this.writes.then(task);
    this.writes = job.catch(() => {});
    return job;
  }

  dispose(): void {
    this.generation++;
    this.key = undefined;
    this.unlockController?.abort();
  }
}
