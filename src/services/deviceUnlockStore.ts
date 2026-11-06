import type { App } from "obsidian";
import { ensureFolderExists } from "@/utils";
import { arrayBufferToBase64, base64ToArrayBuffer } from "@/utils/base64";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";
import { isDesktopRuntime, requireNodeModule } from "@/utils/desktopRuntime";
import type { DeviceUnlockAccess } from "@/services/secretStore";
import { getSettings } from "@/settings/model";

export const DEVICE_UNLOCK_PATH = ".scribe/secrets/device-unlock.json";
const DIRECTORY = ".scribe/secrets";

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Uint8Array;
  decryptString(encrypted: Uint8Array): string;
}

interface DeviceUnlockFile {
  version: 1;
  blob: string;
}

interface MainSafeStorage {
  isEncryptionAvailable(): boolean;
  encryptString(plaintext: string): Uint8Array<ArrayBufferLike>;
  decryptString(encrypted: Buffer): string;
}

interface ElectronBridge {
  safeStorage?: MainSafeStorage;
  remote?: Record<string, (moduleId: "electron") => { safeStorage?: MainSafeStorage }>;
}

export function loadDesktopSafeStorage(): SafeStorageLike | null {
  if (!isDesktopRuntime()) return null;
  try {
    // Obsidian 只向渲染进程暴露一份受限的 electron 模块，不含 safeStorage；必须经 remote
    // 桥取主进程实例，密钥包裹才可用。https://github.com/ItsDalk-Lane/Scribe/issues/37
    const electron = requireNodeModule<ElectronBridge>("electron");
    const remoteBridge = electron.remote?.["require"];
    const safeStorage = electron.safeStorage ?? remoteBridge?.("electron").safeStorage;
    if (!safeStorage || !safeStorage.isEncryptionAvailable()) return null;
    return {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (plain) => new Uint8Array(safeStorage.encryptString(plain)),
      decryptString: (bytes) =>
        safeStorage.decryptString(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)),
    };
  } catch {
    return null;
  }
}

export async function rememberDeviceUnlock(
  app: App,
  safeStorage: SafeStorageLike,
  password: string
): Promise<void> {
  const wrapped = new Uint8Array(safeStorage.encryptString(password));
  const file: DeviceUnlockFile = { version: 1, blob: arrayBufferToBase64(wrapped.buffer) };
  await assertScribePath(app.vault, DEVICE_UNLOCK_PATH);
  await ensureFolderExists(app.vault, DIRECTORY);
  const previous = (await app.vault.adapter.exists(DEVICE_UNLOCK_PATH))
    ? await app.vault.adapter.read(DEVICE_UNLOCK_PATH)
    : null;
  await writeVaultFile(app.vault, DEVICE_UNLOCK_PATH, JSON.stringify(file), previous);
}

export async function readDeviceUnlockPassword(
  app: App,
  safeStorage: SafeStorageLike
): Promise<string | null> {
  if (!(await app.vault.adapter.exists(DEVICE_UNLOCK_PATH))) return null;
  try {
    const parsed = JSON.parse(await app.vault.adapter.read(DEVICE_UNLOCK_PATH)) as DeviceUnlockFile;
    if (parsed?.version !== 1 || typeof parsed.blob !== "string") return null;
    const bytes = new Uint8Array(base64ToArrayBuffer(parsed.blob));
    if (!bytes.byteLength) return null;
    return safeStorage.decryptString(bytes);
  } catch {
    return null;
  }
}

export async function clearDeviceUnlock(app: App): Promise<void> {
  await assertScribePath(app.vault, DEVICE_UNLOCK_PATH);
  if (await app.vault.adapter.exists(DEVICE_UNLOCK_PATH)) {
    await app.vault.adapter.remove(DEVICE_UNLOCK_PATH);
  }
}

export function createDeviceUnlockAccess(
  app: App,
  safeStorage: SafeStorageLike | null
): DeviceUnlockAccess {
  const remembering = () => Boolean(safeStorage) && getSettings().secretsRememberOnDevice;
  return {
    restore: async () => {
      if (!remembering()) return null;
      return readDeviceUnlockPassword(app, safeStorage!);
    },
    remember: async (password) => {
      if (!remembering()) return false;
      await rememberDeviceUnlock(app, safeStorage!, password);
      return true;
    },
    forget: () => clearDeviceUnlock(app),
  };
}
