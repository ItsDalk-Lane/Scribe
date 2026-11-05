import { Notice, type App } from "obsidian";
import { setInterfaceLocale } from "@/lib/i18n";

import { DEFAULT_SETTINGS } from "@/constants";
import type { Provider } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import {
  loadSettingsWithKeychain,
  persistSettings,
  resetPersistenceState,
} from "@/services/settingsPersistence";
import type { ScribeSettings } from "@/settings/model";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

if (typeof window.structuredClone === "undefined") {
  window.structuredClone = <T>(val: T): T => JSON.parse(JSON.stringify(val)) as T;
}

const noLegacyBackup = async () => ({ status: "not-needed" }) as const;

const VAULT_ID = "1234abcd";
const STABLE_NAME = `scribe-v${VAULT_ID}-provider-anthropic-api-key`;

let secrets: Map<string, string>;

function makeApp(): App {
  return {
    secretStorage: {
      setSecret: (id: string, value: string) => {
        secrets.set(id, value);
      },
      getSecret: (id: string) => (secrets.has(id) ? secrets.get(id)! : null),
      listSecrets: () => Array.from(secrets.keys()),
      deleteSecret: (id: string) => {
        secrets.delete(id);
      },
    },
    vault: { adapter: {} },
  } as unknown as App;
}

function anthropicRow(apiKeyKeychainId: string): Provider {
  return {
    providerId: "row-anthropic",
    providerType: "anthropic",
    displayName: "Anthropic",
    origin: { kind: "byok", catalogProviderId: "anthropic" },
    addedAt: 0,
    requiresApiKey: true,
    apiKeyKeychainId,
  };
}

function diskSettings(pointer: string): ScribeSettings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    _keychainVaultId: VAULT_ID,
    providers: { "row-anthropic": anthropicRow(pointer) },
  };
}

async function load(
  app: App,
  raw: unknown
): Promise<{ settings: ScribeSettings; saved: ScribeSettings | undefined }> {
  let saved: ScribeSettings | undefined;
  const settings = await loadSettingsWithKeychain(
    app,
    raw,
    async (data) => {
      saved = structuredClone(data);
    },
    noLegacyBackup
  );
  return { settings, saved };
}

function apiKeyFor(app: App, settings: ScribeSettings): string | null {
  const pointer = settings.providers["row-anthropic"].apiKeyKeychainId!;
  return KeychainService.getInstance(app).getSecretById(pointer);
}

describe("settingsPersistence", () => {
  describe("loadSettingsWithKeychain()", () => {
    beforeEach(() => {
      secrets = new Map();
      jest.mocked(Notice).mockClear();
      setInterfaceLocale("en");
      resetPersistenceState();
      KeychainService.resetInstance();
    });

    it.each([
      [
        "en",
        "Scribe could not back up the API keys stored in data.json, so it left the file untouched. Check that the vault is writable. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
      ],
      [
        "zh-CN",
        "Scribe 无法备份 data.json 中的 API 密钥，因此保留了原文件。请确认资料库可以写入。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
      ],
    ] as const)(
      "shows safe %s fallback guidance and rejects later saves when backup fails",
      async (locale, expected) => {
        setInterfaceLocale(locale);
        const app = makeApp();
        KeychainService.getInstance(app);
        const raw = { ...diskSettings(STABLE_NAME), openAIApiKey: "fixture-key" };
        let saved = 0;
        await loadSettingsWithKeychain(
          app,
          raw,
          async () => {
            saved++;
          },
          async () => ({ status: "failed", error: new Error("disk full") })
        );
        expect(Notice).toHaveBeenCalledWith(expected, undefined);
        await expect(
          persistSettings(raw, async () => {
            saved++;
          })
        ).rejects.toThrow(
          locale === "en"
            ? /disable Scribe until file-safety issues are fixed/
            : /停用 Scribe，直到文件安全问题修复/
        );
        expect(saved).toBe(0);
      }
    );

    it.each([
      [
        "en",
        "Scribe could not remove API keys from data.json. Check that the vault is writable. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
      ],
      [
        "zh-CN",
        "Scribe 无法从 data.json 中移除 API 密钥。请确认资料库可以写入。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
      ],
    ] as const)(
      "shows safe %s fallback guidance when saving sanitized credentials fails",
      async (locale, expected) => {
        setInterfaceLocale(locale);
        const app = makeApp();
        KeychainService.getInstance(app);
        const raw = { ...diskSettings(STABLE_NAME), openAIApiKey: "fixture-key" };
        await loadSettingsWithKeychain(
          app,
          raw,
          async () => {
            throw new Error("disk full");
          },
          async () => ({ status: "backed-up", path: "fixture-backup.json", encrypted: false })
        );
        expect(Notice).toHaveBeenCalledWith(expected, undefined);
      }
    );

    it.each([
      [
        "en",
        "Some API keys could not be loaded from the Obsidian Keychain. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
      ],
      [
        "zh-CN",
        "部分 API 密钥无法从 Obsidian 钥匙串加载。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
      ],
    ] as const)(
      "shows safe %s fallback guidance when the keychain cannot be read",
      async (locale, expected) => {
        setInterfaceLocale(locale);
        const app = makeApp();
        app.secretStorage!.getSecret = () => {
          throw new Error("locked");
        };
        KeychainService.getInstance(app);
        await loadSettingsWithKeychain(
          app,
          diskSettings(STABLE_NAME),
          async () => {},
          noLegacyBackup
        );
        expect(Notice).toHaveBeenCalledWith(expected, undefined);
      }
    );

    it.each([
      [
        "en",
        "Scribe uses the Obsidian Keychain for API keys. Settings backup location: fixture-backup.json. After the file-safety issues are fixed, re-enter the keys in Settings. The backup may contain API keys; keep it private and review it before making changes.",
      ],
      [
        "zh-CN",
        "Scribe 使用 Obsidian 钥匙串保存 API 密钥。设置备份位置：fixture-backup.json。文件安全问题修复后，请在设置中重新输入密钥。备份可能包含 API 密钥，请妥善保管，并在作出更改前检查。",
      ],
    ] as const)(
      "advises preserving the backup in the %s fallback notification",
      async (locale, expected) => {
        setInterfaceLocale(locale);
        const app = makeApp();
        KeychainService.getInstance(app);
        const raw = { ...diskSettings(STABLE_NAME), openAIApiKey: "fixture-key" };
        await loadSettingsWithKeychain(
          app,
          raw,
          async () => {},
          async () => ({ status: "backed-up", path: "fixture-backup.json", encrypted: false })
        );
        expect(Notice).toHaveBeenCalledWith(expected, 15000);
      }
    );

    it.each([
      [
        "en",
        "Scribe uses the Obsidian Keychain for API keys. Settings backup location: fixture-backup.json. The backup may contain encrypted keys that Scribe cannot read. After the file-safety issues are fixed, get fresh keys from those providers if needed. Keep the backup private and review it before making changes.",
      ],
      [
        "zh-CN",
        "Scribe 使用 Obsidian 钥匙串保存 API 密钥。设置备份位置：fixture-backup.json。备份可能含有 Scribe 无法读取的加密密钥。文件安全问题修复后，如有需要，请从相应供应商获取新密钥。请妥善保管备份，并在作出更改前检查。",
      ],
    ] as const)(
      "advises preserving the encrypted backup in the %s fallback notification",
      async (locale, expected) => {
        setInterfaceLocale(locale);
        const app = makeApp();
        KeychainService.getInstance(app);
        const raw = { ...diskSettings(STABLE_NAME), openAIApiKey: "enc_desk_fixture" };
        await loadSettingsWithKeychain(
          app,
          raw,
          async () => {},
          async () => ({ status: "backed-up", path: "fixture-backup.json", encrypted: true })
        );
        expect(Notice).toHaveBeenCalledWith(expected, 15000);
      }
    );

    it("keeps an upgrading user's provider key working without re-entry, across repeated loads", async () => {
      const app = makeApp();
      KeychainService.getInstance(app);
      const legacyPointer = `scribe-v${VAULT_ID}-provider-row-anthropic`;
      secrets.set(legacyPointer, "sk-ant-12345");

      const { settings: first, saved } = await load(app, diskSettings(legacyPointer));
      resetPersistenceState();
      const { settings: second } = await load(app, saved);

      expect(first.providers["row-anthropic"].apiKeyKeychainId).toBe(STABLE_NAME);
      expect(apiKeyFor(app, first)).toBe("sk-ant-12345");
      expect(saved?.providers["row-anthropic"].apiKeyKeychainId).toBe(STABLE_NAME);
      expect(saved?._keychainVaultId).toBe(VAULT_ID);
      expect(apiKeyFor(app, second)).toBe("sk-ant-12345");
    });

    it("resolves this device's key after another device's sync already rewrote the provider pointer", async () => {
      const app = makeApp();
      KeychainService.getInstance(app);
      secrets.set(`scribe-v${VAULT_ID}-provider-row-anthropic`, "sk-ant-12345");

      const { settings: loaded } = await load(app, diskSettings(STABLE_NAME));

      expect(apiKeyFor(app, loaded)).toBe("sk-ant-12345");
    });

    it("drops unknown nested agent settings in the first disk write, not only after a reload (https://github.com/ItsDalk-Lane/Scribe/issues/18)", async () => {
      const app = makeApp();
      KeychainService.getInstance(app);
      const raw = {
        ...structuredClone(DEFAULT_SETTINGS),
        _keychainVaultId: VAULT_ID,
        openAIApiKey: "sk-legacy",
        agentMode: {
          ...structuredClone(DEFAULT_SETTINGS.agentMode),
          mcpServers: [{ name: "private", transport: "http" }],
          futureField: "unknown",
        },
      };

      const { saved } = await load(app, raw);

      expect(saved).toBeDefined();
      expect(saved?.openAIApiKey).toBe("");
      expect(saved?.agentMode).not.toHaveProperty("mcpServers");
      expect(saved?.agentMode).not.toHaveProperty("futureField");
    });

    it("leaves the keychain untouched and keeps the legacy pointer when the backup fails (https://github.com/ItsDalk-Lane/Scribe/issues/23)", async () => {
      const app = makeApp();
      KeychainService.getInstance(app);
      const legacyPointer = `scribe-v${VAULT_ID}-provider-row-anthropic`;
      secrets.set(legacyPointer, "sk-ant-12345");
      let savedCount = 0;

      const settings = await loadSettingsWithKeychain(
        app,
        diskSettings(legacyPointer),
        async () => {
          savedCount++;
        },
        async () => ({ status: "failed", error: new Error("disk full") }) as const
      );

      expect(secrets.has(legacyPointer)).toBe(true);
      expect(secrets.has(STABLE_NAME)).toBe(false);
      expect(settings.providers["row-anthropic"].apiKeyKeychainId).toBe(legacyPointer);
      expect(apiKeyFor(app, settings)).toBe("sk-ant-12345");
      expect(savedCount).toBe(0);
    });
  });
});
