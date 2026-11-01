import { err2String } from "@/lib/errorFormat";

describe("errorFormat", () => {
  describe("err2String()", () => {
    it("returns an Error's message", () => {
      expect(err2String(new Error("boom"))).toBe("boom");
    });

    it("serializes a plain error response as JSON", () => {
      expect(err2String({ message: "Request failed", status: 503 })).toBe(
        '{"message":"Request failed","status":503}'
      );
    });

    it("returns a readable string when a circular object cannot be serialized", () => {
      const error: { cause?: unknown } = {};
      error.cause = error;

      expect(err2String(error)).toBe("[object Object]");
    });
  });
});
