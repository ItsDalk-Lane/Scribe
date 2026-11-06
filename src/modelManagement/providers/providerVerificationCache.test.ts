import type { App } from "obsidian";
import type { Provider } from "@/modelManagement/types/persisted";
import type { VerificationResult } from "@/modelManagement/types/runtime";
import {
  providerVerificationFingerprint,
  readProviderVerificationCache,
  rememberProviderVerification,
} from "@/modelManagement/providers/providerVerificationCache";

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
  };
  const app = { vault: { adapter } } as unknown as App;
  return { files, adapter, app };
}
const provider = (overrides: Partial<Provider> = {}): Provider => ({
  providerId: "p1",
  providerType: "anthropic",
  displayName: "Example",
  baseUrl: "https://api.example.com",
  apiKeyRef: "ref-1",
  requiresApiKey: true,
  origin: { kind: "byok" },
  addedAt: 0,
  ...overrides,
});
const ok: VerificationResult = { ok: true, checkedAt: 42 };

describe("providerVerificationCache", () => {
  describe("providerVerificationFingerprint()", () => {
    it("stays stable across renders and renames but changes with verification-relevant config (https://github.com/ItsDalk-Lane/Scribe/issues/39)", () => {
      const base = provider();
      expect(providerVerificationFingerprint(provider())).toBe(
        providerVerificationFingerprint(provider())
      );
      expect(
        providerVerificationFingerprint(provider({ displayName: "Renamed", addedAt: 99 }))
      ).toBe(providerVerificationFingerprint(base));
      expect(providerVerificationFingerprint(provider({ baseUrl: "https://other" }))).not.toBe(
        providerVerificationFingerprint(base)
      );
      expect(providerVerificationFingerprint(provider({ apiKeyRef: "ref-2" }))).not.toBe(
        providerVerificationFingerprint(base)
      );
      expect(providerVerificationFingerprint(provider({ extras: { region: "eu" } }))).not.toBe(
        providerVerificationFingerprint(base)
      );
    });
  });
  describe("readProviderVerificationCache()", () => {
    it("returns an empty record for a missing or corrupted cache file", async () => {
      const f = fixture();
      expect(await readProviderVerificationCache(f.app)).toEqual({});
      f.files.set(".scribe/provider-verification-cache.json", "{broken");
      expect(await readProviderVerificationCache(f.app)).toEqual({});
      f.files.set(".scribe/provider-verification-cache.json", JSON.stringify({ version: 2 }));
      expect(await readProviderVerificationCache(f.app)).toEqual({});
    });
  });
  describe("rememberProviderVerification()", () => {
    it("round-trips the latest result per provider (https://github.com/ItsDalk-Lane/Scribe/issues/39)", async () => {
      const f = fixture();
      await rememberProviderVerification(f.app, "p1", provider(), ok);
      await rememberProviderVerification(f.app, "p2", provider({ providerId: "p2" }), {
        ok: false,
        code: "invalid_api_key",
        checkedAt: 43,
      });
      const entries = await readProviderVerificationCache(f.app);
      expect(entries.p1).toMatchObject({
        fingerprint: providerVerificationFingerprint(provider()),
      });
      expect(entries.p1.result).toEqual(ok);
      expect(entries.p2.result).toMatchObject({ code: "invalid_api_key" });

      await rememberProviderVerification(f.app, "p1", provider(), {
        ok: false,
        code: "http_error",
        checkedAt: 44,
      });
      const updated = await readProviderVerificationCache(f.app);
      expect(updated.p1.result).toMatchObject({ code: "http_error" });
      expect(updated.p2).toBeDefined();
    });
  });
});
