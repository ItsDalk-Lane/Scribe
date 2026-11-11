import { RequestRedactor } from "@/LLMProviders/requestRedaction";
import { ProviderRequestError } from "@/LLMProviders/providerRequestFailure";

describe("requestRedaction", () => {
  describe("RequestRedactor", () => {
    describe("redact()", () => {
      it("masks short credentials, bare bearer tokens, service JSON and its private fields", () => {
        const privateKey = "-----BEGIN PRIVATE KEY-----\nprivate\n-----END PRIVATE KEY-----";
        const json = JSON.stringify({
          private_key: privateKey,
          nested: { access_token: "oauth-token" },
          client_email: "public@example.com",
        });
        const redactor = new RequestRedactor(["xy", "Bearer naked-token", json]);
        for (const value of [
          "xy",
          "Bearer naked-token",
          "naked-token",
          json,
          privateKey,
          JSON.stringify(privateKey).slice(1, -1),
          "oauth-token",
        ])
          expect(redactor.redact(value)).toBe("[redacted]");
        expect(redactor.redact("public@example.com")).toBe("public@example.com");
      });
      it("keeps SDK placeholders and ordinary text readable", () => {
        expect(
          new RequestRedactor([
            "",
            "keyless-endpoint",
            "provider-managed-auth",
            "default-key",
          ]).redact("A keyless-endpoint uses provider-managed-auth or default-key")
        ).toBe("A keyless-endpoint uses provider-managed-auth or default-key");
      });
      it("uses newly derived request tokens without retaining a global credential registry", () => {
        const values: string[] = [];
        const redactor = new RequestRedactor(values);
        values.push("derived-token");
        expect(redactor.redact("derived-token")).toBe("[redacted]");
        expect(new RequestRedactor([]).redact("derived-token")).toBe("derived-token");
      });
    });
    describe("push()", () => {
      it("withholds only a possible credential suffix and masks a token split across chunks", () => {
        const redactor = new RequestRedactor(["private-token"]);
        expect(redactor.push(0, "Hello pri")).toBe("Hello ");
        expect(redactor.push(0, "vate-token!")).toBe("[redacted]!");
        expect(redactor.push(1, "Ordinary response")).toBe("Ordinary response");
      });
    });
    describe("flush()", () => {
      it("releases an incomplete nonsecret suffix once and independently for each content block", () => {
        const redactor = new RequestRedactor(["private-token"]);
        redactor.push(0, "pri");
        redactor.push(1, "priv");
        expect(redactor.flush(0)).toBe("pri");
        expect(redactor.flush(0)).toBe("");
        expect(redactor.flush(1)).toBe("priv");
      });
    });
    describe("structured()", () => {
      it("masks nested strings while preserving JSON values and the original object", () => {
        const value = {
          content: ["secret", { value: "secret", count: 2, nullable: null, enabled: true }],
        };
        expect(new RequestRedactor(["secret"]).structured(value)).toEqual({
          content: ["[redacted]", { value: "[redacted]", count: 2, nullable: null, enabled: true }],
        });
        expect(value.content[0]).toBe("secret");
      });
    });
    describe("error()", () => {
      it("masks an authentication error without losing retry classification or status", () => {
        const error = new ProviderRequestError("Bearer secret", { kind: "auth", status: 401 });
        const result = new RequestRedactor(["auth", "secret"]).error(error);
        expect(result).toMatchObject({
          message: "Bearer [redacted]",
          failure: { kind: "auth", status: 401 },
        });
        expect(JSON.stringify(result)).not.toContain("secret");
        expect(
          new RequestRedactor(["a"]).error(
            new ProviderRequestError("Temporary", { kind: "transient", status: 503 })
          )
        ).toMatchObject({ failure: { kind: "transient", status: 503 } });
      });
      it("preserves cancellation without carrying raw error causes outside the request", () => {
        const error = new DOMException("Cancelled", "AbortError");
        expect(new RequestRedactor(["secret"]).error(error)).toMatchObject({
          message: "Cancelled",
          name: "AbortError",
        });
        const nested = Object.assign(new Error("Provider failed"), { cause: new Error("secret") });
        expect(new RequestRedactor(["secret"]).error(nested)).not.toHaveProperty("cause");
        expect(new RequestRedactor([]).error(error)).toBe(error);
      });
    });
  });
});
