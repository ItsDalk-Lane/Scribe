import type { App } from "obsidian";
import type ScribePlugin from "@/main";
import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import {
  createNativeModel,
  getNativeDefaultModelId,
  getNativeEnabledModelEntries,
  getNativeModelEntries,
  getNativeModelReadiness,
} from "@/agentMode/backends/native/nativeModels";
import { appendBackendSection } from "@/agentMode/ui/agentModelPickerHelpers";
import type { ModelSelectorEntry } from "@/components/ui/ModelSelector";
import { createModelManagement } from "@/modelManagement";
import { KeychainService } from "@/services/keychainService";
import { DEFAULT_SETTINGS } from "@/constants";
import { MissingApiKeyError } from "@/error";
import { getSettings, setSettings } from "@/settings/model";
import { setInterfaceLocale } from "@/lib/i18n";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

const POINTER = "synthetic-provider-pointer";
const SYNTHETIC_SECRET = "test-only-provider-value";

function fixture() {
  const values = new Map<string, string>();
  const storage = {
    getSecret: jest.fn((id: string) => values.get(id) ?? null),
    setSecret: jest.fn((id: string, value: string) => {
      values.set(id, value);
    }),
    deleteSecret: jest.fn((id: string) => {
      values.delete(id);
    }),
    listSecrets: jest.fn(() => [...values.keys()]),
  };
  const app = { vault: { adapter: {} }, secretStorage: storage } as unknown as App;
  KeychainService.resetInstance();
  KeychainService.getInstance(app);
  setSettings({
    ...DEFAULT_SETTINGS,
    defaultModelKey: "cloud-model",
    providers: {
      cloud: {
        providerId: "cloud",
        displayName: "Synthetic provider",
        providerType: "openai-compatible",
        origin: { kind: "byok" },
        requiresApiKey: true,
        apiKeyKeychainId: POINTER,
        addedAt: 1,
      },
      optional: {
        providerId: "optional",
        displayName: "No-key provider",
        providerType: "openai-compatible",
        origin: { kind: "byok" },
        requiresApiKey: false,
        addedAt: 1,
      },
    },
    configuredModels: [
      {
        configuredModelId: "cloud-model",
        providerId: "cloud",
        info: { id: "cloud-model", displayName: "Cloud" },
        configuredAt: 1,
      },
      {
        configuredModelId: "optional-model",
        providerId: "optional",
        info: { id: "optional-model", displayName: "Optional" },
        configuredAt: 1,
      },
    ],
    backends: { native: { enabledModels: ["cloud-model", "optional-model"] } },
  });
  const { providerRegistry: providers } = createModelManagement({ app });
  const plugin = {
    app,
    modelManagement: { providerRegistry: providers },
  } as unknown as ScribePlugin;
  return { values, storage, providers, plugin };
}

describe("nativeCredentialStatus", () => {
  beforeEach(() => setInterfaceLocale("en"));
  afterEach(() => KeychainService.resetInstance());

  describe("getNativeModelReadiness()", () => {
    it.each([
      { models: [], hasKey: false, expected: "no_models" },
      { models: ["cloud-model"], hasKey: false, expected: "missing_credentials" },
      { models: ["cloud-model"], hasKey: true, expected: "ready" },
      { models: ["cloud-model", "optional-model"], hasKey: false, expected: "ready" },
    ])(
      "reports $expected from configured models $models and real key $hasKey despite obsolete switches https://github.com/ItsDalk-Lane/Scribe/issues/31",
      ({ models, hasKey, expected }) => {
        const { values, storage } = fixture();
        if (hasKey) values.set(POINTER, SYNTHETIC_SECRET);
        setSettings({
          configuredModels: getSettings().configuredModels.filter((model) =>
            models.includes(model.configuredModelId)
          ),
          backends: { native: { enabledModels: [] } },
        });
        expect(getNativeModelReadiness(getSettings())).toBe(expected);
        expect(storage.setSecret).not.toHaveBeenCalled();
        expect(storage.deleteSecret).not.toHaveBeenCalled();
      }
    );
  });

  describe("getNativeEnabledModelEntries()", () => {
    it.each([null, "", "   "])(
      "skips a saved pointer with actual value %p for the default without changing model order or writing secrets https://github.com/ItsDalk-Lane/Scribe/issues/31",
      (value) => {
        const { values, storage } = fixture();
        if (value !== null) values.set(POINTER, value);
        const settings = getSettings();
        const result = getNativeEnabledModelEntries(settings);
        expect(result.map((entry) => [entry.baseModelId, entry.credentialState])).toEqual([
          ["cloud-model", "missing_key"],
          ["optional-model", "ok"],
        ]);
        expect(getNativeDefaultModelId(settings)).toBe("optional-model");
        expect(getSettings()).toBe(settings);
        expect(storage.setSecret).not.toHaveBeenCalled();
        expect(storage.deleteSecret).not.toHaveBeenCalled();
      }
    );

    it("uses the real nonempty secret and skips keychain access for a no-key connection", () => {
      const { values, storage } = fixture();
      values.set(POINTER, ` ${SYNTHETIC_SECRET} `);
      const result = getNativeEnabledModelEntries(getSettings());
      expect(result.map((entry) => entry.credentialState)).toEqual(["ok", "ok"]);
      expect(storage.getSecret.mock.calls).toEqual([[POINTER]]);
      expect(JSON.stringify(result)).not.toContain(SYNTHETIC_SECRET);
      expect(storage.setSecret).not.toHaveBeenCalled();
      expect(storage.deleteSecret).not.toHaveBeenCalled();
    });

    it("reports a failed keychain read without leaking its raw error or writing a replacement value", () => {
      const { storage } = fixture();
      storage.getSecret.mockImplementation(() => {
        throw new Error(`sensitive diagnostic ${SYNTHETIC_SECRET}`);
      });
      const result = getNativeEnabledModelEntries(getSettings());
      expect(result.map((entry) => entry.credentialState)).toEqual(["unavailable_key", "ok"]);
      expect(JSON.stringify(result)).not.toContain(SYNTHETIC_SECRET);
      expect(storage.setSecret).not.toHaveBeenCalled();
      expect(storage.deleteSecret).not.toHaveBeenCalled();
    });
  });

  describe("createNativeModel()", () => {
    it("matches execution rejection when an otherwise no-key provider still has a pointer whose actual key is missing", async () => {
      const { plugin, storage } = fixture();
      const settings = getSettings();
      setSettings({
        providers: {
          ...settings.providers,
          optional: { ...settings.providers.optional, apiKeyKeychainId: POINTER },
        },
      });
      expect(
        getNativeEnabledModelEntries(getSettings()).find(
          (entry) => entry.baseModelId === "optional-model"
        )?.credentialState
      ).toBe("missing_key");
      await expect(createNativeModel(plugin.app, "optional-model")).rejects.toBeInstanceOf(
        MissingApiKeyError
      );
      expect(storage.getSecret.mock.calls.every(([id]) => id === POINTER)).toBe(true);
      expect(storage.setSecret).not.toHaveBeenCalled();
      expect(storage.deleteSecret).not.toHaveBeenCalled();
    });
  });

  describe("getInstallState()", () => {
    it("keeps a provider with a missing local secret unavailable and becomes ready after that same pointer receives a value", () => {
      const { values, storage } = fixture();
      setSettings({
        configuredModels: getSettings().configuredModels.filter(
          (model) => model.configuredModelId === "cloud-model"
        ),
        backends: { native: { enabledModels: ["cloud-model"] } },
      });
      expect(NativeBackendDescriptor.getInstallState(getSettings())).toMatchObject({
        kind: "error",
        reason: "configuration",
      });
      values.set(POINTER, SYNTHETIC_SECRET);
      expect(NativeBackendDescriptor.getInstallState(getSettings()).kind).toBe("ready");
      expect(getSettings().backends.native?.enabledModels).toEqual(["cloud-model"]);
      expect(storage.setSecret).not.toHaveBeenCalled();
      expect(storage.deleteSecret).not.toHaveBeenCalled();
    });
  });

  describe("subscribeInstallState()", () => {
    it("refreshes after a real same-pointer provider key edit even when settings do not change, and stops after disposal", async () => {
      const { providers, plugin, storage } = fixture();
      setSettings({
        configuredModels: getSettings().configuredModels.filter(
          (model) => model.configuredModelId === "cloud-model"
        ),
        backends: { native: { enabledModels: ["cloud-model"] } },
      });
      const settings = getSettings();
      const observed: string[] = [];
      const dispose = NativeBackendDescriptor.subscribeInstallState(plugin, () => {
        observed.push(NativeBackendDescriptor.getInstallState(getSettings()).kind);
      });
      try {
        await providers.setApiKey("cloud", SYNTHETIC_SECRET);
        expect(getSettings()).toBe(settings);
        expect(observed).toEqual(["ready"]);
        const writes = storage.setSecret.mock.calls.length;
        getNativeEnabledModelEntries(settings);
        NativeBackendDescriptor.getInstallState(settings);
        expect(storage.setSecret).toHaveBeenCalledTimes(writes);
        expect(storage.deleteSecret).not.toHaveBeenCalled();
        dispose();
        await providers.setApiKey("cloud", "different-test-value");
        expect(observed).toEqual(["ready"]);
      } finally {
        dispose();
      }
    });
  });

  describe("appendBackendSection()", () => {
    it.each([false, true])(
      "shows a safe read-failure reason in the picker with reported models %p",
      (reported) => {
        const { storage } = fixture();
        storage.getSecret.mockImplementation(() => {
          throw new Error(SYNTHETIC_SECRET);
        });
        const entries: ModelSelectorEntry[] = [];
        appendBackendSection(entries, NativeBackendDescriptor, {
          settings: getSettings(),
          backendModels: reported ? getNativeModelEntries(getSettings()) : null,
          useEnabledFallback: true,
        });
        expect(entries.find((entry) => entry.name === "cloud-model")?._disabledReason).toBe(
          "Cannot read API key on this device"
        );
        expect(
          entries.find((entry) => entry.name === "optional-model")?._disabledReason
        ).toBeUndefined();
        expect(JSON.stringify(entries)).not.toContain(SYNTHETIC_SECRET);
        expect(storage.setSecret).not.toHaveBeenCalled();
        expect(storage.deleteSecret).not.toHaveBeenCalled();
      }
    );
  });
});
