import {
  fingerprintRequestContext,
  serializeRequestContext,
} from "@/agentMode/session/requestContextFingerprint";

describe("requestContextFingerprint", () => {
  describe("serializeRequestContext()", () => {
    it("serializes the actual request deterministically without altering its message content", () => {
      const request = {
        messages: [{ role: "user", content: [{ type: "text", text: "Read notes" }] }],
        tools: [],
      };
      expect(serializeRequestContext(request)).toBe(
        '{"messages":[{"content":[{"text":"Read notes","type":"text"}],"role":"user"}],"tools":[]}'
      );
      expect(JSON.parse(serializeRequestContext(request))).toEqual(request);
    });

    it("removes restored image storage metadata while preserving the actual bytes and other fields", () => {
      const image = {
        type: "image",
        data: "aW1hZ2U=",
        mimeType: "image/png",
        attachmentHash: "internal-reference",
      };
      const before = JSON.stringify(image);
      expect(JSON.parse(serializeRequestContext({ content: [image] }))).toEqual({
        content: [{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" }],
      });
      expect(JSON.stringify(image)).toBe(before);
      expect(serializeRequestContext(undefined)).toBe("undefined");
    });
  });

  describe("fingerprintRequestContext()", () => {
    it("keeps a stable fingerprint when object keys are reordered at any nesting depth", () => {
      const original = {
        role: "user",
        content: [{ type: "text", text: "Read notes" }],
        timestamp: 1,
      };
      const reordered = {
        timestamp: 1,
        content: [{ text: "Read notes", type: "text" }],
        role: "user",
      };
      expect(fingerprintRequestContext(original)).toBe(fingerprintRequestContext(reordered));
      expect(fingerprintRequestContext(original)).toMatch(/^[0-9a-f]{64}$/);
      expect(fingerprintRequestContext([{ a: 1 }, { a: 2 }])).not.toBe(
        fingerprintRequestContext([{ a: 2 }, { a: 1 }])
      );
    });

    it("preserves an image fingerprint after storage restores attachment metadata beside the same data", () => {
      const image = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };
      const restored = {
        mimeType: "image/png",
        attachmentHash: "stored-reference",
        data: "aW1hZ2U=",
        type: "image",
      };
      const original = JSON.stringify(image);
      expect(fingerprintRequestContext({ content: [image] })).toBe(
        fingerprintRequestContext({ content: [restored] })
      );
      expect(JSON.stringify(image)).toBe(original);
      expect(restored.attachmentHash).toBe("stored-reference");
      expect(fingerprintRequestContext(restored)).not.toBe(
        fingerprintRequestContext({ ...restored, data: "Y2hhbmdlZCBpbWFnZQ==" })
      );
      expect(fingerprintRequestContext(restored)).not.toBe(
        fingerprintRequestContext({ ...restored, mimeType: "image/jpeg" })
      );
    });

    it("includes attachment references when image bytes are unavailable and preserves ordinary fields", () => {
      expect(fingerprintRequestContext({ type: "image", attachmentHash: "first" })).not.toBe(
        fingerprintRequestContext({ type: "image", attachmentHash: "second" })
      );
      expect(
        fingerprintRequestContext({ type: "text", data: "same", attachmentHash: "first" })
      ).not.toBe(
        fingerprintRequestContext({ type: "text", data: "same", attachmentHash: "second" })
      );
      expect(fingerprintRequestContext(null)).not.toBe(fingerprintRequestContext(undefined));
    });
  });
});
