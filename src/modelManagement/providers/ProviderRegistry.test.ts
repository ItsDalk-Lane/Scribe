import { createTestRegistries } from "@/modelManagement/testRegistries";
import { ProviderAdapterRegistry } from "@/modelManagement/providers/adapters/ProviderAdapterRegistry";
import { ProviderRegistry } from "@/modelManagement/providers/ProviderRegistry";
import { SecretStore } from "@/services/secretStore";
import { getSettings } from "@/settings/model";
import { logError } from "@/logger";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));

function providerInput() {
  return {
    providerType: "anthropic" as const,
    displayName: "Example",
    origin: { kind: "byok" as const },
  };
}

describe("ProviderRegistry", () => {
  describe("ProviderRegistry", () => {
    let registry: ProviderRegistry;
    let store: SecretStore;
    let adapters: ProviderAdapterRegistry;
    beforeEach(() => {
      const { app } = createTestRegistries();
      store = SecretStore.getInstance();
      adapters = new ProviderAdapterRegistry();
      jest
        .spyOn(adapters, "verifyCredentials")
        .mockResolvedValue({ ok: true, checkedAt: 42, message: "Verified" });
      registry = new ProviderRegistry(app, adapters);
    });
    afterEach(() => jest.restoreAllMocks());
    describe("add()", () => {
      it("saves a provider with a stable identity and no credential reference", async () => {
        const id = await registry.add(providerInput());
        expect(registry.get(id)).toMatchObject({
          ...providerInput(),
          providerId: id,
          apiKeyRef: null,
        });
        expect(registry.get(id)?.addedAt).toEqual(expect.any(Number));
      });
    });
    describe("get()", () => {
      it("returns the matching provider and returns undefined for an unknown identity", async () => {
        const id = await registry.add(providerInput());
        expect(registry.get(id)?.displayName).toBe("Example");
        expect(registry.get("missing")).toBeUndefined();
      });
    });
    describe("list()", () => {
      it("returns all saved providers without allocating a new unchanged list", async () => {
        expect(registry.list()).toBe(registry.list());
        await registry.add(providerInput());
        await registry.add({ ...providerInput(), displayName: "Second" });
        expect(registry.list().map((row) => row.displayName)).toEqual(["Example", "Second"]);
        expect(registry.list()).toBe(registry.list());
      });
    });
    describe("listByOrigin()", () => {
      it("returns a stable list containing only providers from the requested source", async () => {
        await registry.add(providerInput());
        await registry.add({ ...providerInput(), origin: { kind: "agent", agentType: "native" } });
        expect(registry.listByOrigin("byok")).toHaveLength(1);
        expect(registry.listByOrigin("byok")).toBe(registry.listByOrigin("byok"));
        expect(registry.listByOrigin("agent")[0].origin.kind).toBe("agent");
      });
    });
    describe("update()", () => {
      it("updates editable connection fields while preserving the identity and credential reference", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "synthetic-secret");
        const reference = registry.get(id)?.apiKeyRef;
        await registry.update(id, {
          displayName: "Changed",
          ...({
            providerId: "other",
            apiKeyRef: "other",
            providerType: "google",
            origin: { kind: "agent" },
          } as object),
        });
        expect(registry.get(id)).toMatchObject({
          providerId: id,
          displayName: "Changed",
          providerType: "anthropic",
          apiKeyRef: reference,
          origin: { kind: "byok" },
        });
      });
      it("rejects an unknown provider and leaves unchanged updates silent", async () => {
        await expect(registry.update("missing", {})).rejects.toThrow("unknown providerId");
        const id = await registry.add(providerInput());
        const listener = jest.fn();
        registry.subscribe(listener);
        await registry.update(id, { displayName: "Example" });
        expect(listener).not.toHaveBeenCalled();
      });
      it("notifies consumers when the provider endpoint changes https://github.com/ItsDalk-Lane/Scribe/issues/51", async () => {
        const id = await registry.add(providerInput());
        const listener = jest.fn();
        registry.subscribe(listener);
        await registry.update(id, { baseUrl: "https://changed.example/v1" });
        expect(registry.get(id)?.baseUrl).toBe("https://changed.example/v1");
        expect(listener).toHaveBeenCalledWith(id);
      });
    });
    describe("setApiKey()", () => {
      it("finishes encrypted saving before publishing a new credential reference", async () => {
        const id = await registry.add(providerInput());
        let finish!: () => void;
        jest.spyOn(store, "setSecret").mockImplementation(
          () =>
            new Promise((resolve) => {
              finish = resolve;
            })
        );
        const saving = registry.setApiKey(id, "synthetic-secret");
        expect(registry.get(id)?.apiKeyRef).toBeNull();
        finish();
        await saving;
        expect(registry.get(id)?.apiKeyRef).toEqual(expect.any(String));
        expect(JSON.stringify(getSettings().providers)).not.toContain("synthetic-secret");
      });
      it("replaces an existing key without decrypting it or changing its reference", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "first");
        const reference = registry.get(id)?.apiKeyRef;
        const read = jest.spyOn(store, "withSecret");
        await registry.setApiKey(id, "replacement");
        expect(registry.get(id)?.apiKeyRef).toBe(reference);
        expect(read).not.toHaveBeenCalled();
        expect(await registry.withApiKey(id, async (key) => key)).toBe("replacement");
      });
      it("keeps the original reference when encrypted saving fails", async () => {
        const id = await registry.add(providerInput());
        jest.spyOn(store, "setSecret").mockRejectedValue(new Error("Disk full"));
        await expect(registry.setApiKey(id, "secret")).rejects.toThrow("Disk full");
        expect(registry.get(id)?.apiKeyRef).toBeNull();
      });
      it("rejects an unknown provider without saving a secret", async () => {
        const write = jest.spyOn(store, "setSecret");
        await expect(registry.setApiKey("missing", "secret")).rejects.toThrow("unknown providerId");
        expect(write).not.toHaveBeenCalled();
      });
    });
    describe("getApiKeyStatus()", () => {
      it("reports credential presence using metadata without reading its plaintext", async () => {
        const id = await registry.add(providerInput());
        expect(registry.getApiKeyStatus(id)).toBe("missing");
        await registry.setApiKey(id, "secret");
        const read = jest.spyOn(store, "withSecret");
        expect(registry.getApiKeyStatus(id)).toBe("available");
        expect(read).not.toHaveBeenCalled();
      });
    });
    describe("withApiKey()", () => {
      it("resolves only the selected provider during its requested operation", async () => {
        const first = await registry.add(providerInput());
        const second = await registry.add(providerInput());
        await registry.setApiKey(first, "first-secret");
        await registry.setApiKey(second, "second-secret");
        const read = jest.spyOn(store, "withSecret");
        expect(
          await registry.withApiKey(first, async (key) => `request:${key}`, { interactive: false })
        ).toBe("request:first-secret");
        expect(read).toHaveBeenCalledWith(registry.get(first)?.apiKeyRef, expect.any(Function), {
          interactive: false,
        });
        expect(read).toHaveBeenCalledTimes(1);
      });
      it("passes null to an operation when no key was configured", async () => {
        const id = await registry.add(providerInput());
        expect(await registry.withApiKey(id, async (key) => key)).toBeNull();
      });
    });
    describe("clearApiKey()", () => {
      it("removes the encrypted key before clearing its reference", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "secret");
        await registry.clearApiKey(id);
        expect(registry.get(id)?.apiKeyRef).toBeNull();
        expect(registry.getApiKeyStatus(id)).toBe("missing");
      });
      it("retains the reference when removal fails and ignores an unknown provider", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "secret");
        const reference = registry.get(id)?.apiKeyRef;
        jest.spyOn(store, "deleteSecret").mockRejectedValue(new Error("Read only"));
        await expect(registry.clearApiKey(id)).rejects.toThrow("Read only");
        expect(registry.get(id)?.apiKeyRef).toBe(reference);
        await registry.clearApiKey("missing");
      });
    });
    describe("remove()", () => {
      it("removes a provider and its encrypted credential", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "secret");
        const reference = registry.get(id)!.apiKeyRef!;
        await registry.remove(id);
        expect(registry.get(id)).toBeUndefined();
        expect(store.getStatus(reference)).toBe("missing");
        await registry.remove(id);
      });
      it("keeps the provider when its encrypted key cannot be removed", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "secret");
        jest.spyOn(store, "deleteSecret").mockRejectedValue(new Error("Read only"));
        await expect(registry.remove(id)).rejects.toThrow("Read only");
        expect(registry.get(id)).toBeDefined();
      });
    });
    describe("verify()", () => {
      it("uses the credential only inside the provider verification request", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "secret");
        expect(await registry.verify(id)).toMatchObject({ ok: true, message: "Verified" });
        expect(adapters.verifyCredentials).toHaveBeenCalledWith(
          "anthropic",
          expect.objectContaining({ apiKey: "secret" })
        );
      });
      it("masks echoed saved credentials in verification results and thrown errors", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "saved-private-credential");
        jest.mocked(adapters.verifyCredentials).mockResolvedValueOnce({
          ok: false,
          checkedAt: 0,
          message: "Rejected saved-private-credential",
        });
        expect(await registry.verify(id)).toMatchObject({ message: "Rejected [redacted]" });
        jest
          .mocked(adapters.verifyCredentials)
          .mockRejectedValueOnce(new Error("Rejected saved-private-credential"));
        await expect(registry.verify(id)).rejects.toThrow("Rejected [redacted]");
      });
      it("does not unlock or send a background probe for a locked saved key", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "secret");
        jest.spyOn(store, "getStatus").mockReturnValue("locked");
        jest.spyOn(store, "tryDeviceUnlock").mockResolvedValue(false);
        const read = jest.spyOn(store, "withSecret");
        expect(await registry.verify(id)).toMatchObject({ ok: false, code: "credentials_locked" });
        expect(read).not.toHaveBeenCalled();
        expect(adapters.verifyCredentials).not.toHaveBeenCalled();
      });
      it("verifies with the saved key after a silent device-unlock restore succeeds (https://github.com/ItsDalk-Lane/Scribe/issues/37)", async () => {
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "secret");
        jest.spyOn(store, "getStatus").mockReturnValue("locked");
        jest.spyOn(store, "tryDeviceUnlock").mockResolvedValue(true);
        expect(await registry.verify(id)).toMatchObject({ ok: true, message: "Verified" });
        expect(adapters.verifyCredentials).toHaveBeenCalledWith(
          "anthropic",
          expect.objectContaining({ apiKey: "secret" })
        );
      });
      it("reports a missing required key and permits a deliberately keyless provider", async () => {
        const id = await registry.add(providerInput());
        expect(await registry.verify(id)).toMatchObject({ ok: false, code: "missing_api_key" });
        await registry.update(id, { requiresApiKey: false });
        expect(await registry.verify(id)).toMatchObject({ ok: true });
      });
      it("rejects an unknown provider before verification", async () => {
        await expect(registry.verify("missing")).rejects.toThrow("unknown providerId");
      });
    });
    describe("subscribe()", () => {
      it("announces successful changes and stops after unsubscribe", async () => {
        const listener = jest.fn();
        const off = registry.subscribe(listener);
        const id = await registry.add(providerInput());
        await registry.setApiKey(id, "secret");
        expect(listener.mock.calls).toEqual([[id], [id]]);
        off();
        await registry.update(id, { displayName: "Changed" });
        expect(listener).toHaveBeenCalledTimes(2);
      });
      it("continues notifying subscribers when another subscriber throws", async () => {
        registry.subscribe(() => {
          throw new Error("Listener failure");
        });
        const listener = jest.fn();
        registry.subscribe(listener);
        const id = await registry.add(providerInput());
        expect(listener).toHaveBeenCalledWith(id);
        expect(logError).toHaveBeenCalled();
      });
    });
  });
});
