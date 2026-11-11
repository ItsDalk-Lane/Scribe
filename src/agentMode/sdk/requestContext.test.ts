import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import { estimateContextTokens, estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";
import {
  buildRequestContextSnapshot,
  estimateCurrentContextTokens,
} from "@/agentMode/sdk/requestContext";
import { fingerprintRequestContext } from "@/agentMode/session/requestContextFingerprint";

describe("requestContext", () => {
  describe("buildRequestContextSnapshot()", () => {
    it("references unchanged recorded messages and captures the system, temporary instructions and tool declarations", () => {
      const system: AgentMessage = { role: "system", content: "Current rules", timestamp: 0 };
      const original: AgentMessage = { role: "user", content: "Read my notes", timestamp: 1 };
      const injected: AgentMessage = {
        ...original,
        content: "Selected skill instructions\nRead my notes",
      };
      const sequences = new WeakMap<object, number>([
        [original, 12],
        [system, 1],
      ]);
      const sourceDigests = new Map([[12, fingerprintRequestContext(original)]]);
      const tool = {
        name: "read_note",
        description: "Read a note",
        parameters: { type: "object", properties: { path: { type: "string" } } },
        execute: () => "not recorded",
        credential: "not recorded",
      };

      const snapshot = buildRequestContextSnapshot(
        [system, original, injected],
        [tool],
        sequences,
        sourceDigests
      );

      expect(snapshot.version).toBe(1);
      expect(snapshot.messages).toEqual([
        { fingerprint: fingerprintRequestContext(system), message: system },
        { fingerprint: fingerprintRequestContext(original), seq: 12 },
        { fingerprint: fingerprintRequestContext(injected), message: injected },
      ]);
      expect(snapshot.tools).toEqual([
        { name: tool.name, description: tool.description, parameters: tool.parameters },
      ]);
      expect(JSON.stringify(snapshot)).not.toContain("not recorded");
      expect(snapshot.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(
        buildRequestContextSnapshot([system, original, injected], [tool], sequences, sourceDigests)
      ).toEqual(snapshot);
      system.content = "Later rules";
      tool.parameters.properties.path.type = "number";
      expect(snapshot.messages[0].message?.content).toBe("Current rules");
      expect(snapshot.tools[0].parameters).toEqual({
        type: "object",
        properties: { path: { type: "string" } },
      });
    });

    it("captures a replaced message even when its original journal sequence was copied to the request projection", () => {
      const original: AgentMessage = { role: "user", content: "Original text", timestamp: 1 };
      const replaced: AgentMessage = { ...original, content: "Replacement text" };
      const snapshot = buildRequestContextSnapshot(
        [replaced],
        [],
        new WeakMap([[replaced, 12]]),
        new Map([[12, fingerprintRequestContext(original)]])
      );
      expect(snapshot.messages).toEqual([
        { fingerprint: fingerprintRequestContext(replaced), message: replaced },
      ]);
    });

    it("references recorded image attachments without copying their base64 into the request snapshot", () => {
      const message: AgentMessage = {
        role: "user",
        content: [{ type: "image", data: "recorded-image-base64", mimeType: "image/png" }],
        timestamp: 1,
      };
      const snapshot = buildRequestContextSnapshot(
        [message],
        [],
        new WeakMap([[message, 12]]),
        new Map([[12, fingerprintRequestContext(message)]])
      );
      expect(snapshot.messages[0]).toEqual({
        fingerprint: fingerprintRequestContext(message),
        seq: 12,
      });
      expect(JSON.stringify(snapshot)).not.toContain("recorded-image-base64");
    });

    it("keeps a complete inline snapshot when original message digests are unavailable", () => {
      const message: AgentMessage = { role: "user", content: "Current request", timestamp: 1 };
      const snapshot = buildRequestContextSnapshot([message], [], new WeakMap([[message, 12]]));
      expect(snapshot.messages[0]).toEqual({
        fingerprint: fingerprintRequestContext(message),
        message,
      });
      expect(buildRequestContextSnapshot([], [], new WeakMap()).messages).toEqual([]);
    });

    it("captures the displayed tool text without copying private or untrimmed result metadata https://github.com/ItsDalk-Lane/Scribe/issues/71", () => {
      const modelInput = {
        role: "toolResult" as const,
        toolCallId: "read-1",
        toolName: "read_note",
        content: [{ type: "text" as const, text: "Visible excerpt" }],
        isError: false,
        timestamp: 1,
      };
      const original: AgentMessage = {
        ...modelInput,
        durationMs: 123,
        details: { text: "Original uncropped output", _meta: { note: "Private display metadata" } },
      };
      const before = JSON.stringify(original);
      const snapshot = buildRequestContextSnapshot([original], [], new WeakMap());
      expect(snapshot.messages).toEqual([
        { fingerprint: fingerprintRequestContext(modelInput), message: modelInput },
      ]);
      expect(JSON.stringify(original)).toBe(before);
    });

    it("changes the request fingerprint when system instructions or tool declarations change", () => {
      const messages: AgentMessage[] = [{ role: "system", content: "Rules A", timestamp: 0 }];
      const tools = [{ name: "read_note", description: "Read", parameters: { type: "object" } }];
      const previous = buildRequestContextSnapshot(messages, tools, new WeakMap());
      messages[0] = { role: "system", content: "Rules B", timestamp: 0 };
      const changedSystem = buildRequestContextSnapshot(messages, tools, new WeakMap());
      expect(changedSystem.fingerprint).not.toBe(previous.fingerprint);
      tools[0].description = "Read current project notes";
      expect(buildRequestContextSnapshot(messages, tools, new WeakMap()).fingerprint).not.toBe(
        changedSystem.fingerprint
      );
    });
  });

  describe("estimateCurrentContextTokens()", () => {
    function fixture(): { messages: AgentMessage[]; assistant: AssistantMessage } {
      const assistant: AssistantMessage = {
        role: "assistant",
        content: [{ type: "text", text: "Done" }],
        api: "openai-completions",
        provider: "openai",
        model: "test",
        usage: {
          input: 900,
          output: 100,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 1000,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop",
        timestamp: 2,
      };
      return {
        assistant,
        messages: [
          { role: "system", content: "Initial rules", timestamp: 0 },
          { role: "user", content: "Read notes", timestamp: 1 },
          assistant,
          { role: "user", content: "Next", timestamp: 3 },
        ],
      };
    }

    it("uses reported usage when the response belongs to the current context version", () => {
      const { messages, assistant } = fixture();
      const versions = new WeakMap<object, string>([[assistant, "current"]]);
      expect(estimateCurrentContextTokens(messages, "current", versions)).toBe(1002);
    });

    it("recalculates a longer system prompt instead of reusing usage from the previous context version https://github.com/ItsDalk-Lane/Scribe/issues/57", () => {
      const { messages, assistant } = fixture();
      messages[0] = { role: "system", content: "R".repeat(70_000), timestamp: 0 };
      const original = JSON.stringify(messages);
      const versions = new WeakMap<object, string>([[assistant, "previous"]]);
      expect(estimateContextTokens(messages).tokens).toBe(1002);
      expect(estimateCurrentContextTokens(messages, "current", versions)).toBeGreaterThan(20_000);
      expect(JSON.stringify(messages)).toBe(original);
    });

    it("estimates restored responses with unproven versions without altering their recorded usage", () => {
      const { messages, assistant } = fixture();
      const original = JSON.stringify(messages);
      expect(estimateCurrentContextTokens(messages, "current", new WeakMap())).toBe(
        messages.reduce((total, message) => total + estimateMessageTokens(message), 0)
      );
      expect(assistant.usage.totalTokens).toBe(1000);
      expect(JSON.stringify(messages)).toBe(original);
      expect(estimateCurrentContextTokens([], "current", new WeakMap())).toBe(0);
    });
  });
});
