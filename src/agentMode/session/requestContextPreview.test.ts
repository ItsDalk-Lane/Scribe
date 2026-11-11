import { readRequestContextPreview } from "@/agentMode/session/requestContextPreview";
import { fingerprintRequestContext } from "@/agentMode/session/requestContextFingerprint";

const original = { role: "user", content: "Explain the original selection", timestamp: 1 };
const system = { role: "system", content: "Original vault rules", timestamp: 0 };
const tools = [{ name: "read_note", description: "Read a note", parameters: { type: "object" } }];
function facts() {
  const body = {
    version: 1,
    messages: [
      { fingerprint: fingerprintRequestContext(system), message: system },
      { fingerprint: fingerprintRequestContext(original), seq: 1 },
    ],
    tools,
  };
  return [
    { seq: 1, kind: "protocol_message", payload: { message: original } },
    {
      seq: 2,
      kind: "request_context",
      payload: {
        version: 1,
        requestId: "request-1",
        modelId: "model-1",
        provider: "provider-1",
        purpose: "chat",
        snapshot: { ...body, fingerprint: fingerprintRequestContext(body) },
      },
    },
  ];
}

describe("requestContextPreview", () => {
  describe("readRequestContextPreview()", () => {
    it("reconstructs the recorded system, original input and tools without reading current files", () => {
      const result = readRequestContextPreview(facts());
      expect(result).toMatchObject({
        requestId: "request-1",
        modelId: "model-1",
        provider: "provider-1",
      });
      expect(JSON.parse(result!.content)).toEqual({ messages: [system, original], tools });
    });
    it("keeps the latest parent chat preview when a child or summary was recorded later", () => {
      const records = facts();
      const payload = records[1].payload;
      records.push({
        seq: 3,
        kind: "request_context",
        payload: { ...payload, requestId: "child-request", subagentId: "child-1" },
      } as never);
      records.push({
        seq: 4,
        kind: "request_context",
        payload: { ...payload, requestId: "summary-request", purpose: "compaction" },
      } as never);
      expect(readRequestContextPreview(records)?.requestId).toBe("request-1");
    });
    it("reports unavailable preview for a chat with no recorded request context", () => {
      expect(readRequestContextPreview(facts().slice(0, 1))).toBeNull();
    });
    it("refuses a missing source message instead of inventing its previous contents", () => {
      expect(() => readRequestContextPreview(facts().slice(1))).toThrow("incomplete or damaged");
    });
    it("refuses a changed original message instead of presenting it as the recorded input", () => {
      const records = facts();
      records[0].payload.message = { ...original, content: "A later edited selection" };
      expect(() => readRequestContextPreview(records)).toThrow("incomplete or damaged");
    });
    it("accepts restored attachment metadata but refuses different image bytes in a referenced source message", () => {
      const image = { type: "image", data: "aW1hZ2U=", mimeType: "image/png" };
      const message = { role: "user", content: [image], timestamp: 1 };
      const body = {
        version: 1,
        messages: [{ fingerprint: fingerprintRequestContext(message), seq: 1 }],
        tools: [],
      };
      const restored = {
        timestamp: 1,
        role: "user",
        content: [
          {
            mimeType: image.mimeType,
            attachmentHash: "stored-reference",
            type: image.type,
            data: image.data,
          },
        ],
      };
      const records = [
        { seq: 1, kind: "protocol_message", payload: { message: restored } },
        {
          seq: 2,
          kind: "request_context",
          payload: {
            version: 1,
            requestId: "image-request",
            modelId: "model-1",
            provider: "provider-1",
            purpose: "chat",
            snapshot: { ...body, fingerprint: fingerprintRequestContext(body) },
          },
        },
      ];
      expect(JSON.parse(readRequestContextPreview(records)!.content).messages).toEqual([message]);
      restored.content[0].data = "Y2hhbmdlZCBpbWFnZQ==";
      expect(() => readRequestContextPreview(records)).toThrow("incomplete or damaged");
    });
    it("refuses a snapshot whose saved content no longer matches its fingerprint", () => {
      const records = facts();
      records[1].payload.snapshot!.tools = [];
      expect(() => readRequestContextPreview(records)).toThrow("incomplete or damaged");
    });

    it("continues to show the exact saved request of an older snapshot with tool details https://github.com/ItsDalk-Lane/Scribe/issues/71", () => {
      const legacy = {
        role: "toolResult",
        toolCallId: "previous-read",
        toolName: "read_note",
        content: [{ type: "text", text: "Saved excerpt" }],
        isError: false,
        timestamp: 1,
        details: { text: "Original body" },
      };
      const body = {
        version: 1,
        messages: [{ fingerprint: fingerprintRequestContext(legacy), message: legacy }],
        tools,
      };
      const records = [
        {
          seq: 1,
          kind: "request_context",
          payload: {
            ...facts()[1].payload,
            snapshot: { ...body, fingerprint: fingerprintRequestContext(body) },
          },
        },
      ];
      expect(JSON.parse(readRequestContextPreview(records)!.content)).toEqual({
        messages: [legacy],
        tools,
      });
    });
  });
});
