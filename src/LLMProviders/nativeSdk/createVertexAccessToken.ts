import { t } from "@/lib/i18n";
const ACCESS_TOKEN_PATTERN = /^[A-Za-z0-9._~+/-]+=*$/;

export function parseVertexCredentials(secret: string): string | Record<string, unknown> {
  const trimmed = secret.trim();
  const token = trimmed.replace(/^Bearer +/i, "");
  if (ACCESS_TOKEN_PATTERN.test(token)) return token;
  if (!trimmed.startsWith("{"))
    throw new Error(t("A Google service account JSON or access token is required."));
  try {
    return JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    throw new Error(t("The provider credentials must be valid JSON."));
  }
}

function base64Url(bytes: Uint8Array): string {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""))
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

export function createVertexAccessToken(
  email: string,
  privateKey: string,
  transport: typeof fetch,
  privateKeyId?: string
): (signal?: AbortSignal) => Promise<string> {
  let cached: { value: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;
  return async () => {
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    pending ??= (async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 15_000);
      try {
        const encoder = new TextEncoder();
        const encode = (value: unknown) => base64Url(encoder.encode(JSON.stringify(value)));
        const now = Math.floor(Date.now() / 1000);
        const claims = `${encode({ alg: "RS256", typ: "JWT", ...(privateKeyId ? { kid: privateKeyId } : {}) })}.${encode({ iss: email, scope: "https://www.googleapis.com/auth/cloud-platform", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 })}`;
        const keyBytes = Uint8Array.from(
          atob(privateKey.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s/g, "")),
          (character) => character.charCodeAt(0)
        );
        const key = await crypto.subtle.importKey(
          "pkcs8",
          keyBytes,
          { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const signature = await crypto.subtle.sign(
          "RSASSA-PKCS1-v1_5",
          key,
          encoder.encode(claims)
        );
        const response = await transport("https://oauth2.googleapis.com/token", {
          method: "POST",
          signal: controller.signal,
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
            assertion: `${claims}.${base64Url(new Uint8Array(signature))}`,
          }).toString(),
        });
        const result = (await response.json()) as { access_token?: string; expires_in?: number };
        if (
          !response.ok ||
          typeof result.access_token !== "string" ||
          !ACCESS_TOKEN_PATTERN.test(result.access_token) ||
          typeof result.expires_in !== "number" ||
          !Number.isFinite(result.expires_in) ||
          result.expires_in <= 0
        )
          throw Object.assign(new Error(t("Google did not return an access token.")), {
            statusCode: response.status,
          });
        cached = {
          value: result.access_token,
          expiresAt: Date.now() + Math.max(0, result.expires_in * 1000 - 30000),
        };
        return result.access_token;
      } finally {
        window.clearTimeout(timer);
      }
    })().finally(() => {
      pending = undefined;
    });
    return pending;
  };
}
