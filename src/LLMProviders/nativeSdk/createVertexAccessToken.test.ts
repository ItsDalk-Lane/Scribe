import { createVertexAccessToken } from "./createVertexAccessToken";
import { generateKeyPairSync, verify, webcrypto } from "node:crypto";

const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const privateKey = pair.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
function response(payload: unknown, status = 200): Response {
  return { ok: status === 200, status, json: async () => payload } as Response;
}

describe("createVertexAccessToken", () => {
  describe("createVertexAccessToken()", () => {
    beforeAll(() => {
      Object.defineProperty(window.crypto, "subtle", {
        configurable: true,
        value: webcrypto.subtle,
      });
    });
    afterAll(() => {
      Object.defineProperty(window.crypto, "subtle", { configurable: true, value: undefined });
    });
    it("signs a verifiable RS256 assertion and sends it through the injected transport with fixed audience", async () => {
      const transport = jest.fn(async () =>
        response({ access_token: "verified-token", expires_in: 3600 })
      );
      const getToken = createVertexAccessToken(
        "fixture@example.invalid",
        privateKey,
        transport,
        "fixture-key-id"
      );
      const controller = new AbortController();
      expect(await getToken(controller.signal)).toBe("verified-token");
      const [url, init] = (transport.mock.calls as unknown as Array<[string, RequestInit]>)[0];
      expect(url).toBe("https://oauth2.googleapis.com/token");
      expect(init.signal).not.toBe(controller.signal);
      expect(init.signal).toBeInstanceOf(AbortSignal);
      expect(init.method).toBe("POST");
      const form = new URLSearchParams(init.body as string);
      expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      const assertion = form.get("assertion") || "";
      const [header, payload, signature] = assertion.split(".");
      expect(JSON.parse(Buffer.from(header, "base64url").toString())).toMatchObject({
        alg: "RS256",
        kid: "fixture-key-id",
      });
      expect(JSON.parse(Buffer.from(payload, "base64url").toString())).toMatchObject({
        iss: "fixture@example.invalid",
        aud: "https://oauth2.googleapis.com/token",
        scope: "https://www.googleapis.com/auth/cloud-platform",
      });
      expect(
        verify(
          "RSA-SHA256",
          new Uint8Array(Buffer.from(`${header}.${payload}`)),
          pair.publicKey,
          new Uint8Array(Buffer.from(signature, "base64url"))
        )
      ).toBe(true);
      expect(init.body as string).not.toContain("PRIVATE KEY");
    });
    it("shares concurrent authorization work and refreshes the token after expiration", async () => {
      let now = 1000000;
      const clock = jest.spyOn(Date, "now").mockImplementation(() => now);
      const transport = jest.fn(async () =>
        response({ access_token: "cached-token", expires_in: 3600 })
      );
      try {
        const getToken = createVertexAccessToken("fixture@example.invalid", privateKey, transport);
        expect(await Promise.all([getToken(), getToken()])).toEqual([
          "cached-token",
          "cached-token",
        ]);
        expect(await getToken()).toBe("cached-token");
        expect(transport).toHaveBeenCalledTimes(1);
        now += 3600000;
        expect(await getToken()).toBe("cached-token");
        expect(transport).toHaveBeenCalledTimes(2);
      } finally {
        clock.mockRestore();
      }
    });
    it("shares one authorization attempt even when a waiting caller aborts", async () => {
      let release: ((value: Response) => void) | undefined;
      let started: (() => void) | undefined;
      const transportStarted = new Promise<void>((resolve) => {
        started = resolve;
      });
      const transport = jest.fn(() => {
        started?.();
        return new Promise<Response>((resolve) => {
          release = resolve;
        });
      });
      const controller = new AbortController();
      const getToken = createVertexAccessToken("fixture@example.invalid", privateKey, transport);

      const first = getToken(controller.signal);
      const second = getToken();
      await transportStarted;
      controller.abort();
      release?.(response({ access_token: "shared-token", expires_in: 3600 }));

      await expect(Promise.all([first, second])).resolves.toEqual(["shared-token", "shared-token"]);
      expect(transport).toHaveBeenCalledTimes(1);
    });
    it("clears failed authorization work so the following request can succeed", async () => {
      const transport = jest
        .fn()
        .mockResolvedValueOnce(response({ error: "temporarily_unavailable" }, 503))
        .mockResolvedValueOnce(response({ access_token: "recovered-token", expires_in: 3600 }));
      const getToken = createVertexAccessToken("fixture@example.invalid", privateKey, transport);
      await expect(getToken()).rejects.toMatchObject({ statusCode: 503 });
      expect(await getToken()).toBe("recovered-token");
      expect(transport).toHaveBeenCalledTimes(2);
    });
    it.each([
      { access_token: 42, expires_in: 3600 },
      { access_token: "invalid", expires_in: -1 },
    ])("rejects malformed OAuth credentials without caching them: %j", async (payload) => {
      const getToken = createVertexAccessToken("fixture@example.invalid", privateKey, async () =>
        response(payload)
      );
      await expect(getToken()).rejects.toThrow("Google did not return an access token.");
    });
  });
});
