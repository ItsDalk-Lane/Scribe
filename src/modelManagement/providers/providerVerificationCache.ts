import type { App } from "obsidian";
import { ensureFolderExists } from "@/utils";
import { sha256 } from "@/utils/hash";
import { assertScribePath, writeVaultFile } from "@/utils/vaultFileStore";
import type { Provider } from "@/modelManagement/types/persisted";
import type { VerificationResult } from "@/modelManagement/types/runtime";

const CACHE_PATH = ".scribe/provider-verification-cache.json";
const DIRECTORY = ".scribe";

export interface CachedProviderVerification {
  fingerprint: string;
  result: VerificationResult;
}

interface ProviderVerificationCacheFile {
  version: 1;
  entries: Record<string, CachedProviderVerification>;
}

export function providerVerificationFingerprint(provider: Provider): string {
  const stable = JSON.stringify([
    provider.providerType,
    provider.baseUrl ?? null,
    provider.enableCors ?? false,
    provider.apiKeyRef ?? null,
    provider.requiresApiKey ?? true,
    provider.extras ?? null,
  ]);
  return sha256(stable);
}

export async function readProviderVerificationCache(
  app: App
): Promise<Record<string, CachedProviderVerification>> {
  try {
    if (!(await app.vault.adapter.exists(CACHE_PATH))) return {};
    const parsed = JSON.parse(
      await app.vault.adapter.read(CACHE_PATH)
    ) as Partial<ProviderVerificationCacheFile>;
    if (parsed?.version !== 1 || !parsed.entries || typeof parsed.entries !== "object") return {};
    return parsed.entries;
  } catch {
    return {};
  }
}

let writes: Promise<void> = Promise.resolve();

export function rememberProviderVerification(
  app: App,
  providerId: string,
  provider: Provider,
  result: VerificationResult
): Promise<void> {
  const job = writes.then(async () => {
    const entries = await readProviderVerificationCache(app);
    entries[providerId] = { fingerprint: providerVerificationFingerprint(provider), result };
    await assertScribePath(app.vault, CACHE_PATH);
    await ensureFolderExists(app.vault, DIRECTORY);
    const previous = (await app.vault.adapter.exists(CACHE_PATH))
      ? await app.vault.adapter.read(CACHE_PATH)
      : null;
    await writeVaultFile(
      app.vault,
      CACHE_PATH,
      JSON.stringify({ version: 1, entries } satisfies ProviderVerificationCacheFile),
      previous
    );
  });
  writes = job.catch(() => {});
  return job;
}
