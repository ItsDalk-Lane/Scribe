import type { App } from "obsidian";
import { v4 as uuidv4, validate as validateUuid, version as uuidVersion } from "uuid";

const DEVICE_ID_STORAGE_KEY = "obsidian-scribe:device-id:v1";

const FALLBACK_DEVICE_ID = "unknown";

const cachedDeviceIds = new WeakMap<App, string>();

export function getDeviceId(app: App): string {
  const cachedDeviceId = cachedDeviceIds.get(app);
  if (cachedDeviceId) return cachedDeviceId;

  try {
    const existing = app.loadLocalStorage(DEVICE_ID_STORAGE_KEY);
    if (typeof existing === "string" && existing.length > 0) {
      cachedDeviceIds.set(app, existing);
      return existing;
    }

    const id = uuidv4();
    app.saveLocalStorage(DEVICE_ID_STORAGE_KEY, id);
    if (app.loadLocalStorage(DEVICE_ID_STORAGE_KEY) !== id) {
      cachedDeviceIds.set(app, FALLBACK_DEVICE_ID);
      return FALLBACK_DEVICE_ID;
    }
    cachedDeviceIds.set(app, id);
    return id;
  } catch {
    cachedDeviceIds.set(app, FALLBACK_DEVICE_ID);
    return FALLBACK_DEVICE_ID;
  }
}

export function getPersistedDeviceId(app: App): string {
  const id = getDeviceId(app);
  if (
    !validateUuid(id) ||
    uuidVersion(id) !== 4 ||
    app.loadLocalStorage(DEVICE_ID_STORAGE_KEY) !== id
  ) {
    throw new Error("A persisted UUIDv4 device identifier is required.");
  }
  return id;
}
