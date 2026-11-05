import { t } from "@/lib/i18n";
import { DEFAULT_SETTINGS } from "@/constants";
import { logWarn } from "@/logger";
import { KeychainService } from "@/services/keychainService";
import { type LegacyBackupResult } from "@/services/legacyCredentialBackup";
import { cleanupLegacyFields, stripKeychainFields } from "@/services/settingsSecretTransforms";
import type { StartupMigrationItem } from "@/services/startupMigration";
import { CURRENT_SETTINGS_VERSION } from "@/settings/migrations/version";
import { type ScribeSettings, sanitizeSettings } from "@/settings/model";
import { getDeviceId } from "@/utils/deviceId";
import { type App, Notice } from "obsidian";

let writeQueue: Promise<void> = Promise.resolve();
let lastPersistedSettings: ScribeSettings | undefined;
let suppressNextPersist = false;
let transactionEpoch = 0;
let legacyCredentialsUnprotected = false;
const pendingTombstones = new Set<string>();

const KEYCHAIN_VAULT_ID_RE = /^[a-f0-9]{8}$/;

function isValidKeychainVaultId(value: unknown): value is string {
  return typeof value === "string" && KEYCHAIN_VAULT_ID_RE.test(value);
}

function cloneRawSettings(rawData: unknown): ScribeSettings {
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) {
    return {} as ScribeSettings;
  }
  return structuredClone(rawData) as ScribeSettings;
}

function buildDiskSettings(
  settings: ScribeSettings,
  vaultId: string,
  isFreshInstall: boolean
): ScribeSettings {
  // 首次写盘沿用规范化以保持结果一致；当前实现会丢弃未知嵌套代理设置。
  // https://github.com/ItsDalk-Lane/Scribe/issues/18
  const stripped = stripKeychainFields(cleanupLegacyFields(sanitizeSettings(settings)));
  stripped._keychainVaultId = vaultId;
  if (isFreshInstall) {
    stripped.settingsVersion = CURRENT_SETTINGS_VERSION;
  }
  return stripped;
}

export function resetPersistenceState(): void {
  writeQueue = Promise.resolve();
  lastPersistedSettings = undefined;
  suppressNextPersist = false;
  transactionEpoch = 0;
  legacyCredentialsUnprotected = false;
  pendingTombstones.clear();
}

export function releaseLegacyCredentialHold(): void {
  legacyCredentialsUnprotected = false;
}

// 退役迁移删除钥匙串条目前先问这一句：备份失败的那次加载里，密钥唯一副本可能还在钥匙串。
// https://github.com/ItsDalk-Lane/Scribe/issues/23
export function isLegacyCredentialsUnprotected(): boolean {
  return legacyCredentialsUnprotected;
}

export function refreshLastPersistedSettings(data: ScribeSettings): void {
  lastPersistedSettings = structuredClone(data);
}

export function suppressNextPersistOnce(): void {
  suppressNextPersist = true;
}

export async function runPersistenceTransaction(task: () => Promise<void>): Promise<void> {
  const job = writeQueue.then(async () => {
    try {
      await task();
    } finally {
      transactionEpoch++;
    }
  });
  writeQueue = job.catch(() => {});
  return job;
}

export async function flushPersistence(): Promise<void> {
  await writeQueue;
}

function credentialMigrationFromRecovery(
  app: App,
  recovery: ScribeSettings["_pendingCredentialRecovery"]
): StartupMigrationItem | null {
  if (
    !recovery ||
    recovery.deviceId !== getDeviceId(app) ||
    typeof recovery.path !== "string" ||
    typeof recovery.encrypted !== "boolean"
  ) {
    return null;
  }
  return {
    id: "credentials",
    title: t("API keys"),
    status: "action-required",
    summary: t("Scribe uses the Obsidian Keychain for API keys."),
    details: recovery.encrypted
      ? [
          t("Settings backup location: {path}.", { path: recovery.path }),
          t(
            "The backup may contain encrypted keys that Scribe cannot read. After the file-safety issues are fixed, get fresh keys from those providers if needed. Keep the backup private and review it before making changes."
          ),
        ]
      : [
          t("Settings backup location: {path}.", { path: recovery.path }),
          t(
            "After the file-safety issues are fixed, re-enter the keys in Settings. The backup may contain API keys; keep it private and review it before making changes."
          ),
        ],
  };
}

function planProviderNames(
  keychain: KeychainService,
  rawSettings: ScribeSettings
): ReturnType<KeychainService["planProviderNames"]> {
  if (!keychain.isAvailable()) return { settings: rawSettings, moves: [] };
  try {
    return keychain.planProviderNames(rawSettings);
  } catch (error) {
    logWarn("Keychain provider name migration failed; it will retry on the next load.", error);
    return { settings: rawSettings, moves: [] };
  }
}

// 备份失败时不更改钥匙串名称，避免丢失可能尚未备份的密钥。
// https://github.com/ItsDalk-Lane/Scribe/issues/23
function executeProviderNamesSafely(
  keychain: KeychainService,
  moves: ReturnType<KeychainService["planProviderNames"]>["moves"]
): void {
  if (moves.length === 0) return;
  try {
    keychain.executeProviderNames(moves);
  } catch (error) {
    logWarn("Keychain provider name migration failed; it will retry on the next load.", error);
  }
}

export async function loadSettingsWithKeychain(
  app: App,
  rawData: unknown,
  saveData: (data: ScribeSettings) => Promise<void>,
  backupLegacyCredentials: (rawData: unknown) => Promise<LegacyBackupResult>,
  onMigration?: (item: StartupMigrationItem) => void
): Promise<ScribeSettings> {
  const isFreshInstall = rawData == null;
  const rawSettings = cloneRawSettings(rawData);
  const keychain = KeychainService.getInstance();
  const persistedVaultId = rawSettings._keychainVaultId;
  const vaultId = isValidKeychainVaultId(persistedVaultId)
    ? persistedVaultId
    : keychain.getVaultId();
  keychain.setVaultId(vaultId);
  const renamePlan = planProviderNames(keychain, rawSettings);
  const diskSettings = buildDiskSettings(renamePlan.settings, vaultId, isFreshInstall);
  let credentialMigration = credentialMigrationFromRecovery(
    app,
    diskSettings._pendingCredentialRecovery
  );

  const reportCredentialMigration = (): void => {
    if (credentialMigration && onMigration) {
      onMigration(credentialMigration);
    }
  };
  const showFallbackNotice = (message: string, duration?: number): void => {
    if (!onMigration || !credentialMigration) new Notice(message, duration);
  };
  const markCredentialError = (detail: string, summary?: string): void => {
    if (!credentialMigration) return;
    credentialMigration = {
      ...credentialMigration,
      status: "error",
      summary: summary ?? credentialMigration.summary,
      details: [...(credentialMigration.details ?? []), detail],
    };
  };

  let runtimeSettings = renamePlan.settings;
  if (JSON.stringify(rawSettings) !== JSON.stringify(diskSettings)) {
    const backup = await backupLegacyCredentials(rawData);
    if (backup.status === "failed") {
      legacyCredentialsUnprotected = true;
      // 备份失败时不改写设置文件或钥匙串，避免丢失尚未备份的密钥。
      // https://github.com/ItsDalk-Lane/Scribe/issues/23
      runtimeSettings = rawSettings;
      credentialMigration = {
        id: "credentials",
        title: t("API keys"),
        status: "error",
        summary: t("API keys could not be backed up, so data.json was left untouched."),
        details: [
          t(
            "Check that the vault is writable. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
          ),
        ],
      };
      showFallbackNotice(
        t(
          "Scribe could not back up the API keys stored in data.json, so it left the file untouched. Check that the vault is writable. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
        )
      );
    } else {
      executeProviderNamesSafely(keychain, renamePlan.moves);
      if (backup.status === "backed-up") {
        diskSettings._pendingCredentialRecovery = {
          deviceId: getDeviceId(app),
          path: backup.path,
          encrypted: backup.encrypted,
        };
        credentialMigration = credentialMigrationFromRecovery(
          app,
          diskSettings._pendingCredentialRecovery
        );
        showFallbackNotice(
          backup.encrypted
            ? t(
                "Scribe uses the Obsidian Keychain for API keys. Settings backup location: {path}. The backup may contain encrypted keys that Scribe cannot read. After the file-safety issues are fixed, get fresh keys from those providers if needed. Keep the backup private and review it before making changes.",
                { path: backup.path }
              )
            : t(
                "Scribe uses the Obsidian Keychain for API keys. Settings backup location: {path}. After the file-safety issues are fixed, re-enter the keys in Settings. The backup may contain API keys; keep it private and review it before making changes.",
                { path: backup.path }
              ),
          15000
        );
      }
      try {
        await saveData(diskSettings);
      } catch {
        markCredentialError(
          t(
            "Check that the vault is writable. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
          ),
          t("API keys were backed up, but could not be removed from data.json.")
        );
        showFallbackNotice(
          t(
            "Scribe could not remove API keys from data.json. Check that the vault is writable. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
          )
        );
      }
    }
  }

  const runtimeSource = isFreshInstall ? structuredClone(DEFAULT_SETTINGS) : runtimeSettings;
  const sanitized = cleanupLegacyFields(sanitizeSettings(runtimeSource));
  const baseline = stripKeychainFields({
    ...sanitized,
    _keychainVaultId: vaultId,
    _pendingCredentialRecovery: diskSettings._pendingCredentialRecovery,
  });

  if (!keychain.isAvailable()) {
    markCredentialError(
      t(
        "Obsidian Keychain is unavailable in this Obsidian build, so keys cannot be loaded or saved."
      )
    );
    showFallbackNotice(
      t(
        "Obsidian Keychain is unavailable. Scribe cannot load or save API keys in this Obsidian build."
      )
    );
    reportCredentialMigration();
    lastPersistedSettings = structuredClone(baseline);
    return baseline;
  }

  const { settings: hydrated, hadFailures } = await keychain.hydrateFromKeychain(baseline);
  if (hadFailures) {
    markCredentialError(
      t(
        "Some API keys could not be loaded from the Obsidian Keychain. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
      )
    );
    showFallbackNotice(
      t(
        "Some API keys could not be loaded from the Obsidian Keychain. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
      )
    );
  }
  reportCredentialMigration();
  lastPersistedSettings = structuredClone(hydrated);
  return hydrated;
}

async function persistKeychainSettings(
  settings: ScribeSettings,
  saveData: (data: ScribeSettings) => Promise<void>,
  prev: ScribeSettings | undefined
): Promise<void> {
  if (legacyCredentialsUnprotected) {
    throw new Error(
      t(
        "Scribe cannot save settings until it can back up the API keys still in data.json. Check that the vault is writable. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs."
      )
    );
  }

  const keychain = KeychainService.getInstance();
  const cleaned = cleanupLegacyFields(settings);
  const keychainDiffBase = lastPersistedSettings ?? prev;
  const rollbackSettings = lastPersistedSettings ?? prev;
  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(cleaned, keychainDiffBase);
  const replayedTombstones: string[] = [];

  try {
    for (const id of pendingTombstones) {
      keychain.setSecretById(id, "");
      replayedTombstones.push(id);
    }

    for (const [id, value] of secretEntries) {
      keychain.setSecretById(id, value);
    }

    for (const id of keychainIdsToDelete) {
      try {
        keychain.setSecretById(id, "");
      } catch (error) {
        pendingTombstones.add(id);
        throw error;
      }
    }

    await saveData(stripKeychainFields(cleaned));
    lastPersistedSettings = structuredClone(cleaned);
    for (const id of replayedTombstones) {
      pendingTombstones.delete(id);
    }
  } catch (error) {
    try {
      await restoreKeychainFromSettings(keychain, rollbackSettings, cleaned);
    } catch (rollbackError) {
      logWarn("Failed to roll back Keychain after settings persistence failed.", rollbackError);
    }
    throw error;
  }
}

export async function persistSettingsWithinTransaction(
  settings: ScribeSettings,
  saveData: (data: ScribeSettings) => Promise<void>,
  prevSettings?: ScribeSettings
): Promise<void> {
  await persistKeychainSettings(settings, saveData, prevSettings);
}

export async function persistSettings(
  settings: ScribeSettings,
  saveData: (data: ScribeSettings) => Promise<void>,
  prevSettings?: ScribeSettings
): Promise<void> {
  if (suppressNextPersist) {
    suppressNextPersist = false;
    return;
  }

  const epochAtEnqueue = transactionEpoch;
  const job = writeQueue.then(() => {
    if (epochAtEnqueue !== transactionEpoch) return;
    return persistKeychainSettings(settings, saveData, prevSettings);
  });
  writeQueue = job.catch(() => {});
  return job;
}

async function restoreKeychainFromSettings(
  keychain: KeychainService,
  restoreFrom: ScribeSettings | undefined,
  failedSettings: ScribeSettings
): Promise<void> {
  if (!restoreFrom) return;

  const { secretEntries, keychainIdsToDelete } = keychain.persistSecrets(
    restoreFrom,
    failedSettings
  );

  for (const [id, value] of secretEntries) {
    try {
      keychain.setSecretById(id, value);
    } catch (error) {
      logWarn(`Failed to restore Keychain entry "${id}" during rollback.`, error);
    }
  }

  for (const id of keychainIdsToDelete) {
    try {
      keychain.setSecretById(id, "");
      pendingTombstones.delete(id);
    } catch (error) {
      logWarn(`Failed to write Keychain tombstone "${id}" during rollback.`, error);
    }
  }
}
