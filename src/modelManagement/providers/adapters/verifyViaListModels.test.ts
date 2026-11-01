import { setInterfaceLocale, type InterfaceLocale } from "@/lib/i18n";
import { verifyViaListModels } from "./verifyViaListModels";

jest.mock("@/utils", () => ({
  safeFetchNoThrow: jest.fn(),
}));

import { safeFetchNoThrow } from "@/utils";

const mockSafeFetch = safeFetchNoThrow as jest.MockedFunction<typeof safeFetchNoThrow>;

const MODELS_RESPONSE = { responseShape: "models" as const, timeoutMs: 1000 };
const GOOGLE_RESPONSE = { responseShape: "google-models" as const, timeoutMs: 1000 };
const KEY_RESPONSE = { responseShape: "openrouter-key" as const, timeoutMs: 1000 };

function fakeResponse(status: number, body = '{"data":[]}'): Response {
  return {
    status,
    text: async () => body,
    json: async (): Promise<unknown> => JSON.parse(body) as unknown,
  } as unknown as Response;
}

describe("verifyViaListModels", () => {
  describe("verifyViaListModels()", () => {
    afterEach(() => setInterfaceLocale("en"));

    beforeEach(() => {
      mockSafeFetch.mockReset();
    });

    it("returns ok and sends a GET with the given headers for 200", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(200));
      const result = await verifyViaListModels(
        "https://example.test/models",
        { h: "v" },
        MODELS_RESPONSE
      );
      expect(result.ok).toBe(true);
      expect(result.checkedAt).toEqual(expect.any(Number));
      expect(mockSafeFetch).toHaveBeenCalledWith("https://example.test/models", {
        method: "GET",
        headers: { h: "v" },
      });
    });

    it("does not verify an empty 204 response as provider access (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(204, ""));
      expect(await verifyViaListModels("u", {}, MODELS_RESPONSE)).toMatchObject({
        ok: false,
        code: "invalid_response",
      });
    });

    it.each([401])("maps %i to invalid_api_key with a check-your-key message", async (status) => {
      mockSafeFetch.mockResolvedValue(fakeResponse(status));
      const result = await verifyViaListModels("u", {}, MODELS_RESPONSE);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("invalid_api_key");
      expect(result.message).toMatch(/check your API key/i);
    });

    it("keeps a 403 permission denial distinct from an invalid key and retains the provider reason (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      mockSafeFetch.mockResolvedValue(
        fakeResponse(403, '{"error":{"message":"Model listing permission is required"}}')
      );
      const result = await verifyViaListModels("u", {}, MODELS_RESPONSE);
      expect(result).toMatchObject({ ok: false, code: "permission_denied" });
      expect(result.message).toContain("Model listing permission is required");
    });

    it.each([
      "<html>Sign in</html>",
      '{"error":{"message":"Not authorized"}}',
      '{"data":{}}',
      '{"data":[],"error":{"message":"Failed"}}',
      "null",
    ])(
      "does not verify a successful HTTP response with an invalid model payload %p (https://github.com/logancyang/obsidian-copilot/issues/3147)",
      async (body) => {
        mockSafeFetch.mockResolvedValue(fakeResponse(200, body));
        expect(await verifyViaListModels("u", {}, MODELS_RESPONSE)).toMatchObject({
          ok: false,
          code: "invalid_response",
        });
      }
    );

    it("accepts Google's models array as the selected response shape", async () => {
      mockSafeFetch.mockResolvedValue(
        fakeResponse(200, '{"models":[{"name":"models/gemini-test"}]}')
      );
      expect(await verifyViaListModels("u", {}, GOOGLE_RESPONSE)).toMatchObject({ ok: true });
    });

    it("does not accept another protocol's model list for Google (https://github.com/logancyang/obsidian-copilot/issues/3147)", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(200, '{"data":[]}'));
      expect(await verifyViaListModels("u", {}, GOOGLE_RESPONSE)).toMatchObject({
        ok: false,
        code: "invalid_response",
      });
    });

    it("accepts OpenRouter's key metadata object without expecting a model list", async () => {
      mockSafeFetch.mockResolvedValue(
        fakeResponse(200, '{"data":{"label":"key-label","usage":0}}')
      );
      expect(await verifyViaListModels("u", {}, KEY_RESPONSE)).toMatchObject({ ok: true });
    });

    it.each([
      '{"data":[]}',
      '{"data":null}',
      '{"data":"login"}',
      '{"data":{},"error":{"message":"Denied"}}',
    ])(
      "does not accept invalid OpenRouter key metadata %p (https://github.com/logancyang/obsidian-copilot/issues/3147)",
      async (body) => {
        mockSafeFetch.mockResolvedValue(fakeResponse(200, body));
        expect(await verifyViaListModels("u", {}, KEY_RESPONSE)).toMatchObject({
          ok: false,
          code: "invalid_response",
        });
      }
    );

    it("maps 429 to rate_limited", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(429));
      const result = await verifyViaListModels("u", {}, MODELS_RESPONSE);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("rate_limited");
    });

    it.each<[InterfaceLocale, RegExp]>([
      ["en", /not (?:been )?verified/i],
      ["zh-CN", /尚未验证/],
    ])(
      "reports an unavailable 404 verification endpoint in %s while retaining the response detail (https://github.com/logancyang/obsidian-copilot/issues/3147)",
      async (locale, expectedMessage) => {
        setInterfaceLocale(locale);
        mockSafeFetch.mockResolvedValue(fakeResponse(404, '{"error":"route_not_found"}'));
        const result = await verifyViaListModels(
          "https://example.test/models",
          {},
          MODELS_RESPONSE
        );
        expect(result.ok).toBe(false);
        expect(result.code).toBe("verification_unavailable");
        expect(result.checkedAt).toEqual(expect.any(Number));
        expect(result.message).toMatch(expectedMessage);
        expect(result.message).toContain("HTTP 404");
        expect(result.message).toContain('{"error":"route_not_found"}');
      }
    );

    it("maps other non-2xx statuses to http_error including the response body", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(500, '{"error":"internal server explosion"}'));
      const result = await verifyViaListModels("u", {}, MODELS_RESPONSE);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("http_error");
      expect(result.message).toContain("500");
      expect(result.message).toContain("internal server explosion");
    });

    it("reports only the HTTP status when the error body is empty", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(502, ""));
      const result = await verifyViaListModels("u", {}, MODELS_RESPONSE);
      expect(result.message).toBe("HTTP 502");
    });

    it("truncates a very long error body", async () => {
      const longBody = "x".repeat(500);
      mockSafeFetch.mockResolvedValue(fakeResponse(500, longBody));
      const result = await verifyViaListModels("u", {}, MODELS_RESPONSE);
      expect(result.message).toContain("…");
      expect(result.message?.length).toBeLessThan(longBody.length);
    });

    it("includes the body of a 400 response so a Gemini-style bad-key message is readable", async () => {
      mockSafeFetch.mockResolvedValue(fakeResponse(400, "API key not valid"));
      const result = await verifyViaListModels("u", {}, MODELS_RESPONSE);
      expect(result.code).toBe("http_error");
      expect(result.message).toContain("API key not valid");
    });

    it("maps a thrown fetch error to network with its message", async () => {
      mockSafeFetch.mockRejectedValue(new Error("ECONNREFUSED"));
      const result = await verifyViaListModels("u", {}, MODELS_RESPONSE);
      expect(result.ok).toBe(false);
      expect(result.code).toBe("network");
      expect(result.message).toBe("ECONNREFUSED");
    });

    it("reports timeout, distinct from network, when the fetch hangs past timeoutMs", async () => {
      mockSafeFetch.mockImplementation(() => new Promise(() => {}));
      const result = await verifyViaListModels("u", {}, { ...MODELS_RESPONSE, timeoutMs: 5 });
      expect(result.ok).toBe(false);
      expect(result.code).toBe("timeout");
      expect(result.message).toMatch(/timed out/i);
    });
  });
});
