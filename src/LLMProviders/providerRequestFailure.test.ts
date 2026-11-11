import { MissingApiKeyError, TimeoutError } from "@/error";
import {
  classifyProviderFailure,
  ProviderRequestError,
  waitForProviderRetry,
} from "@/LLMProviders/providerRequestFailure";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/31";

describe("providerRequestFailure", () => {
  describe("classifyProviderFailure()", () => {
    it.each([
      [{ status: 429, payload: { error: { code: "insufficient_quota" } } }, "quota"],
      [{ status: 429, payload: { error: { type: "rate_limit_error" } } }, "transient"],
      [{ status: 429, payload: { error: { message: "insufficient_quota" } } }, "request"],
      [{ status: 429, payload: { error: { status: "RESOURCE_EXHAUSTED" } } }, "request"],
      [
        {
          status: 429,
          payload: {
            error: { status: "RESOURCE_EXHAUSTED", details: [{ reason: "QUOTA_EXCEEDED" }] },
          },
        },
        "quota",
      ],
      [
        {
          status: 429,
          payload: {
            error: { status: "RESOURCE_EXHAUSTED", details: [{ reason: "RATE_LIMIT_EXCEEDED" }] },
          },
        },
        "transient",
      ],
      [
        { status: 403, payload: { error: { details: [{ reason: "RATE_LIMIT_EXCEEDED" }] } } },
        "transient",
      ],
      [{ status: 200, payload: { error: { type: "billing_error" } } }, "quota"],
      [{ status: 429, payload: { error: { code: "credit_balance_exhausted" } } }, "quota"],
      [{ status: 429, payload: { error: { code: "organization_spend_limit_exceeded" } } }, "quota"],
      [{ status: 401 }, "auth"],
      [{ cause: new MissingApiKeyError() }, "auth"],
      [{ cause: new TimeoutError("Token", 1000) }, "transient"],
      [{ status: 403 }, "auth"],
      [{ status: 400, payload: { error: { code: "context_length_exceeded" } } }, "context"],
      [{ status: 400 }, "request"],
      [{ status: 503 }, "transient"],
      [{ cause: new DOMException("Stopped", "AbortError"), callerAborted: true }, "cancelled"],
      [{ cause: new DOMException("Stopped", "AbortError") }, "transient"],
    ])(
      `classifies structured failures without inspecting natural-language messages (${issue}): %j`,
      (input, kind) => {
        expect(classifyProviderFailure(input)).toMatchObject({ kind });
      }
    );

    it(`stops treating an abort exception as a user cancellation unless the caller aborted (https://github.com/ItsDalk-Lane/Scribe/issues/58)`, () => {
      const abort = new DOMException("Aborted", "AbortError");
      expect(classifyProviderFailure({ cause: abort, callerAborted: true })).toMatchObject({
        kind: "cancelled",
      });
      expect(classifyProviderFailure({ cause: abort, callerAborted: false })).toMatchObject({
        kind: "transient",
      });
    });

    it(`gives deterministic structured failures priority over retry headers and HTTP status (${issue})`, () => {
      expect(
        classifyProviderFailure({
          status: 503,
          payload: { error: { type: "authentication_error" } },
          headers: new Headers({ "retry-after": "3" }),
        })
      ).toMatchObject({ kind: "auth", retryAfterMs: 3000 });
    });
  });

  describe("ProviderRequestError", () => {
    describe("constructor()", () => {
      it(`retains the structured category and original status without interpreting its message (${issue})`, () => {
        const error = new ProviderRequestError("Diagnostic", { kind: "quota", status: 429 });
        expect(error).toMatchObject({
          message: "Diagnostic",
          status: 429,
          failure: { kind: "quota" },
        });
      });
    });
  });

  describe("waitForProviderRetry()", () => {
    it(`completes after its delay and immediately rejects when cancelled (${issue})`, async () => {
      jest.useFakeTimers();
      try {
        const waiting = waitForProviderRetry(100);
        await jest.advanceTimersByTimeAsync(100);
        await expect(waiting).resolves.toBeUndefined();
        const controller = new AbortController();
        const stopped = waitForProviderRetry(10000, controller.signal);
        controller.abort();
        await expect(stopped).rejects.toMatchObject({ name: "AbortError" });
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
