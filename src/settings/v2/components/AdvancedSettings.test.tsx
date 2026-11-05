import { DEFAULT_SETTINGS } from "@/constants";
import { useApp } from "@/context";
import { setInterfaceLocale } from "@/lib/i18n";
import { createModelManagement } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { resetPersistenceState } from "@/services/settingsPersistence";
import { settingsAtom, settingsStore, setSettings } from "@/settings/model";
import { AdvancedSettings } from "@/settings/v2/components/AdvancedSettings";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Notice, type App } from "obsidian";
import React from "react";

jest.mock("@/context", () => ({
  ...jest.requireActual<object>("@/context"),
  useApp: jest.fn(),
}));
jest.mock("@/contexts/PluginContext", () => ({ usePlugin: jest.fn(() => ({})) }));
jest.mock("@/utils/desktopRuntime", () => ({ isDesktopRuntime: () => false }));
jest.mock("obsidian", () => {
  const actual = jest.requireActual<object>("obsidian");
  class TestModal {
    app: unknown;
    containerEl = document.createElement("div");
    contentEl = this.containerEl.appendChild(document.createElement("div"));
    constructor(app: unknown) {
      this.app = app;
    }
    setTitle() {}
    open() {
      document.body.appendChild(this.containerEl);
      this.onOpen();
    }
    close() {
      this.onClose();
      this.containerEl.remove();
    }
    onOpen() {}
    onClose() {}
  }
  return { ...actual, Modal: TestModal };
});

const STORAGE_DESCRIPTION =
  "Scribe uses this device’s Obsidian Keychain for API keys. Each device has its own Keychain. To check or change a key, open the relevant provider in Models and providers.";

function makeApp(withKeychain = true) {
  const secrets = new Map<string, string>();
  const saveData = jest.fn().mockResolvedValue(undefined);
  const secretStorage = {
    getSecret: jest.fn((id: string) => secrets.get(id) ?? null),
    setSecret: jest.fn((id: string, value: string) => secrets.set(id, value)),
    deleteSecret: jest.fn((id: string) => secrets.delete(id)),
    listSecrets: jest.fn(() => [...secrets.keys()]),
  };
  const app = {
    vault: { adapter: { getBasePath: () => "/isolated-test-vault" } },
    plugins: { getPlugin: () => ({ saveData }) },
    secretStorage: withKeychain ? secretStorage : undefined,
  } as unknown as App;
  return { app, secrets, secretStorage, saveData };
}

describe("AdvancedSettings", () => {
  beforeEach(() => {
    setInterfaceLocale("en");
    settingsStore.set(settingsAtom, { ...DEFAULT_SETTINGS, providers: {}, activeModels: [] });
    KeychainService.resetInstance();
    resetPersistenceState();
  });

  afterEach(() => {
    setInterfaceLocale("en");
    KeychainService.resetInstance();
    resetPersistenceState();
  });

  describe("AdvancedSettings()", () => {
    it("keeps key storage in Others and support controls in Debugging and support", () => {
      const { app } = makeApp(false);
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);
      const view = render(<AdvancedSettings section="others" />);
      expect(screen.getByText("API key storage")).toBeTruthy();
      expect(screen.queryByText("Debug mode")).toBeNull();

      view.rerender(<AdvancedSettings section="debug" />);
      expect(screen.getByText("Debug mode")).toBeTruthy();
      expect(screen.queryByText("API key storage")).toBeNull();
    });

    it("explains key storage without claiming an empty keychain on a fresh installation", () => {
      const { app } = makeApp();
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);

      render(<AdvancedSettings section="others" />);

      expect(screen.getByText(STORAGE_DESCRIPTION)).toBeTruthy();
      expect(screen.getByRole("button", { name: "Delete All Keys" }).hasAttribute("disabled")).toBe(
        false
      );
    });

    it("does not report an empty keychain after a provider has stored a key", async () => {
      const { app, secrets } = makeApp();
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);
      const providers = createModelManagement({ app }).providerRegistry;
      const providerId = await providers.add({
        providerType: "anthropic",
        displayName: "Provider",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
      });
      await providers.setApiKey(providerId, "synthetic-provider-secret");
      expect(await providers.getApiKey(providerId)).toBe("synthetic-provider-secret");

      render(<AdvancedSettings section="others" />);

      expect(screen.getByText(STORAGE_DESCRIPTION)).toBeTruthy();
      expect(screen.queryByText(/No API keys found/)).toBeNull();
      expect(document.body.textContent).not.toContain("synthetic-provider-secret");
      expect([...secrets.values()]).toEqual(["synthetic-provider-secret"]);
    });

    it("does not generalize key status across providers with a present key, missing key and no-key connection", async () => {
      const { app, secrets } = makeApp();
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);
      const providers = createModelManagement({ app }).providerRegistry;
      const stored = await providers.add({
        providerType: "anthropic",
        displayName: "Stored key",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
      });
      const missing = await providers.add({
        providerType: "anthropic",
        displayName: "Missing key",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
      });
      const keyless = await providers.add({
        providerType: "openai-compatible",
        displayName: "Keyless connection",
        origin: { kind: "byok" },
        requiresApiKey: false,
      });
      await providers.setApiKey(stored, "synthetic-stored-key");
      await providers.setApiKey(missing, "synthetic-missing-key");
      secrets.delete(providers.get(missing)!.apiKeyKeychainId!);
      expect(await providers.getApiKey(stored)).toBe("synthetic-stored-key");
      expect(await providers.getApiKey(missing)).toBeNull();
      expect(await providers.getApiKey(keyless)).toBeNull();

      render(<AdvancedSettings section="others" />);

      expect(screen.getByText(STORAGE_DESCRIPTION)).toBeTruthy();
      expect(screen.queryByText(/No API keys found/)).toBeNull();
      expect(document.body.textContent).not.toContain("synthetic-stored-key");
    });

    it("does not claim a key exists when a previously loaded key was removed", () => {
      const { app } = makeApp();
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);
      setSettings({ openAIApiKey: "synthetic-previously-loaded" });

      render(<AdvancedSettings section="others" />);

      expect(screen.getByText(STORAGE_DESCRIPTION)).toBeTruthy();
      expect(screen.queryByText(/API keys are stored in this device/)).toBeNull();
      expect(document.body.textContent).not.toContain("synthetic-previously-loaded");
    });

    it("does not infer that the keychain is empty when it cannot be read", () => {
      const { app, secretStorage } = makeApp();
      secretStorage.getSecret.mockImplementation(() => {
        throw new Error("synthetic locked keychain");
      });
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);

      render(<AdvancedSettings section="others" />);

      expect(screen.getByText(STORAGE_DESCRIPTION)).toBeTruthy();
      expect(screen.queryByText(/No API keys found/)).toBeNull();
      expect(secretStorage.getSecret).not.toHaveBeenCalled();
    });

    it("shows a neutral keychain label rather than implying successful verification", () => {
      const { app } = makeApp();
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);

      const { container } = render(<AdvancedSettings section="others" />);

      expect(container.querySelector(".lucide-shield-check")).toBeNull();
      expect(screen.getByText("Obsidian Keychain").closest("div")?.className).not.toContain(
        "tw-bg-success"
      );
    });

    it("explains the keychain without asserting its contents in Chinese", () => {
      const { app } = makeApp();
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);
      setInterfaceLocale("zh-CN");

      render(<AdvancedSettings section="others" />);

      expect(
        screen.getByText(
          "Scribe 使用此设备的 Obsidian 钥匙串保存 API 密钥。各设备的钥匙串相互独立；如需检查或修改密钥，请打开“模型与供应商”中的对应供应商。"
        )
      ).toBeTruthy();
    });

    it("retains the disabled deletion control when the keychain interface is absent", () => {
      const { app } = makeApp(false);
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);

      render(<AdvancedSettings section="others" />);

      expect(
        screen.getByText(
          "Obsidian Keychain is unavailable in this Obsidian session. Check your Obsidian version or use a device where it is available."
        )
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "Delete All Keys" }).hasAttribute("disabled")).toBe(
        true
      );
    });

    it("explains an unavailable keychain and disables deletion in Chinese", () => {
      const { app } = makeApp(false);
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);
      setInterfaceLocale("zh-CN");

      render(<AdvancedSettings section="others" />);

      expect(
        screen.getByText(
          "当前 Obsidian 无法使用钥匙串。请检查 Obsidian 版本，或在可以使用钥匙串的设备上重试。"
        )
      ).toBeTruthy();
      expect(screen.getByRole("button", { name: "删除所有密钥" }).hasAttribute("disabled")).toBe(
        true
      );
    });

    it("warns in Chinese that existing credential backups may remain", async () => {
      const { app } = makeApp();
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);
      setInterfaceLocale("zh-CN");

      render(<AdvancedSettings section="others" />);
      fireEvent.click(screen.getByRole("button", { name: "删除所有密钥" }));

      expect(await screen.findByText(/已有的凭据备份可能仍然保留/)).toBeTruthy();
      fireEvent.click(screen.getByRole("button", { name: "取消" }));
    });

    it.each([
      [
        "en",
        "Delete All Keys",
        "Remove",
        "Failed to remove API keys. Back up your files, then disable Scribe until file-safety issues are fixed. Check available logs.",
      ],
      [
        "zh-CN",
        "删除所有密钥",
        "移除",
        "无法移除 API 密钥。请先备份现有文件，再停用 Scribe，直到文件安全问题修复。请查看可用日志。",
      ],
    ] as const)(
      "does not suggest an immediate retry in %s after key deletion fails",
      async (locale, open, confirm, expected) => {
        setInterfaceLocale(locale);
        jest.mocked(Notice).mockClear();
        let signal!: () => void;
        const emitted = new Promise<void>((resolve) => {
          signal = resolve;
        });
        const previous = jest.mocked(Notice).getMockImplementation();
        jest.mocked(Notice).mockImplementation((message) => {
          if (
            typeof message === "string" &&
            (message.startsWith("Failed to remove API keys.") ||
              message.startsWith("无法移除 API 密钥"))
          )
            signal();
          return {} as Notice;
        });
        try {
          const { app, secrets, secretStorage } = makeApp();
          jest.mocked(useApp).mockReturnValue(app);
          const service = KeychainService.getInstance(app);
          secrets.set(`scribe-v${service.getVaultId()}-open-a-i-api-key`, "fixture-key");
          secretStorage.deleteSecret.mockImplementation(() => {
            throw new Error("locked");
          });
          render(<AdvancedSettings section="others" />);
          fireEvent.click(screen.getByRole("button", { name: open }));
          const confirmButton = await screen.findByRole("button", { name: confirm });
          await act(async () => {
            fireEvent.click(confirmButton);
            await emitted;
          });
          expect(Notice).toHaveBeenCalledWith(expected);
        } finally {
          jest.mocked(Notice).mockReset();
          if (previous) jest.mocked(Notice).mockImplementation(previous);
        }
      }
    );

    it("still removes a provider key after confirmation while retaining a separate settings backup", async () => {
      const { app, secrets, saveData } = makeApp();
      jest.mocked(useApp).mockReturnValue(app);
      KeychainService.getInstance(app);
      const providers = createModelManagement({ app }).providerRegistry;
      const providerId = await providers.add({
        providerType: "anthropic",
        displayName: "Provider",
        origin: { kind: "byok", catalogProviderId: "anthropic" },
      });
      await providers.setApiKey(providerId, "synthetic-provider-secret");
      secrets.set("scribe-settings-backup-test", "synthetic-backup");

      render(<AdvancedSettings section="others" />);
      fireEvent.click(screen.getByRole("button", { name: "Delete All Keys" }));
      expect(await screen.findByText(/Existing credential backups may remain/)).toBeTruthy();
      fireEvent.click(await screen.findByRole("button", { name: "Remove" }));

      await waitFor(() => expect(saveData).toHaveBeenCalledTimes(1));
      await waitFor(async () => expect(await providers.getApiKey(providerId)).toBeNull());
      expect(secrets.get("scribe-settings-backup-test")).toBe("synthetic-backup");
    });
  });
});
