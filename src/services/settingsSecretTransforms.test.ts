import { DEFAULT_SETTINGS } from "@/constants";
import type { ScribeSettings } from "@/settings/model";
import { cleanupLegacyFields, isSensitiveKey } from "@/services/settingsSecretTransforms";

function makeSettings(overrides: Partial<ScribeSettings> = {}): ScribeSettings {
  return {
    activeModels: [],
    ...overrides,
  } as unknown as ScribeSettings;
}

describe("settingsSecretTransforms", () => {
  describe("isSensitiveKey", () => {
    it.each([
      "openAIApiKey",
      "api_key",
      "accessToken",
      "clientSecret",
      "password",
      "private_key",
      "Authorization",
      "Proxy_Authorization",
    ])("recognizes %s as sensitive", (key) => {
      expect(isSensitiveKey(key)).toBe(true);
    });

    it.each(["defaultModelKey", "temperature", "displayName", "apiVersion"])(
      "does not classify %s as sensitive",
      (key) => {
        expect(isSensitiveKey(key)).toBe(false);
      }
    );
  });

  describe("cleanupLegacyFields", () => {
    it("drops retired runtime configuration from persisted copies while keeping native settings and BYOK references", () => {
      const settings = makeSettings({
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          byok: { anthropic: "retired-secret" },
          claudeCli: { path: "/retired-agent" },
          deviceProfiles: { oldDevice: { claude: { envOverrides: { API_TOKEN: "old-secret" } } } },
          backends: {
            native: { maxSteps: 75 },
            claude: { envOverrides: { API_KEY: "old-secret" } },
          },
        } as unknown as ScribeSettings["agentMode"],
        providers: {
          saved: {
            providerId: "saved",
            providerType: "google",
            displayName: "Saved",
            apiKeyRef: "existing-key",
            origin: { kind: "byok" },
            addedAt: 1,
          },
        },
      });
      const result = cleanupLegacyFields(settings);
      expect(result.agentMode.backends).toEqual({ native: { maxSteps: 75 } });
      expect("claudeCli" in result.agentMode).toBe(false);
      expect("deviceProfiles" in result.agentMode).toBe(false);
      expect("byok" in result.agentMode).toBe(false);
      expect(result.providers.saved.apiKeyRef).toBe("existing-key");
      expect(JSON.stringify(settings)).toContain("retired-secret");
    });

    it("removes retired settings without mutating the input", () => {
      const settings = makeSettings({
        _keychainVaultId: "abc12345",
        _someFutureField: "future-value",
        enableEncryption: true,
        _keychainMigrated: true,
        _keychainMigratedAt: "2026-04-01T00:00:00.000Z",
        _migrationModalDismissed: true,
        _diskSecretsCleared: true,
        _keychainOnly: true,
        githubCopilotAccessToken: "gho_access",
        githubCopilotToken: "tid=fixture",
        githubCopilotTokenExpiresAt: 1893456000,
        agentMode: {
          ...DEFAULT_SETTINGS.agentMode,
          mcpServers: [
            {
              name: "private",
              transport: "http",
              headers: [{ name: "Authorization", value: "Bearer secret" }],
            },
          ],
        },
      } as unknown as Partial<ScribeSettings>);

      const result = cleanupLegacyFields(settings) as unknown as Record<string, unknown>;

      expect(result).toMatchObject({
        _keychainVaultId: "abc12345",
        _someFutureField: "future-value",
      });
      expect(result.enableEncryption).toBeUndefined();
      expect(result._keychainMigrated).toBeUndefined();
      expect(result._keychainMigratedAt).toBeUndefined();
      expect(result._migrationModalDismissed).toBeUndefined();
      expect(result._diskSecretsCleared).toBeUndefined();
      expect(result._keychainOnly).toBeUndefined();
      expect(result.githubCopilotAccessToken).toBeUndefined();
      expect(result.githubCopilotToken).toBeUndefined();
      expect(result.githubCopilotTokenExpiresAt).toBeUndefined();
      expect((result.agentMode as Record<string, unknown>).mcpServers).toBeUndefined();
      expect(settings as unknown as Record<string, unknown>).toHaveProperty("_keychainOnly", true);
      expect((settings.agentMode as unknown as Record<string, unknown>).mcpServers).toHaveLength(1);
    });
  });
});
