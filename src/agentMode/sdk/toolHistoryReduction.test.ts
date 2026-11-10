import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import { estimateContextTokens } from "@earendil-works/pi-ai/utils/estimate";
import { reduceToolHistory } from "@/agentMode/sdk/toolHistoryReduction";

const model = {
  id: "fixture",
  name: "Fixture",
  api: "openai-completions" as const,
  provider: "fixture",
  baseUrl: "http://localhost",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 8192,
  maxTokens: 1000,
};

function readBatch(id: string, path: string, text: string): AgentMessage[] {
  const assistant = createAssistantMessage(model);
  assistant.content = [{ type: "toolCall", id, name: "read_note", arguments: { path } }];
  assistant.stopReason = "toolUse";
  return [
    assistant,
    {
      role: "toolResult",
      toolCallId: id,
      toolName: "read_note",
      content: [{ type: "text", text }],
      details: { path },
      isError: false,
      timestamp: 1,
    },
  ];
}

const longNote = "中文笔记，需要保留的事实。".repeat(200);
const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/66";

describe("toolHistoryReduction", () => {
  describe("reduceToolHistory()", () => {
    it(`replaces an older duplicate note with a preview and an exact reference to its retained full result (${issue})`, () => {
      const messages: AgentMessage[] = [
        { role: "user", content: "只整理笔记，不改变标题", timestamp: 0 },
        ...readBatch("old-read", "项目/资料.md", longNote),
        ...readBatch("new-read", "项目/资料.md", longNote),
      ];
      const before = JSON.stringify(messages);
      const reduced = reduceToolHistory(messages);
      const older = reduced[2];
      expect(older).toMatchObject({
        role: "toolResult",
        toolCallId: "old-read",
        toolName: "read_note",
        details: { path: "项目/资料.md" },
        isError: false,
        timestamp: 1,
      });
      expect(JSON.stringify(older)).toContain("new-read");
      expect(JSON.stringify(older)).toContain("项目/资料.md");
      expect(JSON.stringify(older)).toContain("中文笔记，需要保留的事实。");
      expect(JSON.stringify(older).length).toBeLessThan(JSON.stringify(messages[2]).length);
      expect(reduced[0]).toBe(messages[0]);
      expect(reduced[1]).toBe(messages[1]);
      expect(reduced[3]).toBe(messages[3]);
      expect(reduced[4]).toBe(messages[4]);
      expect(JSON.stringify(messages)).toBe(before);
    });

    it(`retains every result from the latest complete tool batch even when its reads duplicate each other (${issue})`, () => {
      const first = readBatch("latest-first", "资料.md", longNote);
      const second = readBatch("latest-second", "资料.md", longNote);
      const assistant = first[0];
      if (assistant.role !== "assistant" || second[0].role !== "assistant") throw new Error();
      assistant.content.push(...second[0].content);
      const messages = [assistant, first[1], second[1]];
      expect(reduceToolHistory(messages)).toBe(messages);
    });

    it(`keeps distinct historical versions and notes at different paths in full (${issue})`, () => {
      const messages = [
        ...readBatch("version-a", "资料.md", `${longNote}旧版本独有事实`),
        ...readBatch("other-note", "另一篇.md", longNote),
        ...readBatch("version-b", "资料.md", longNote),
      ];
      expect(reduceToolHistory(messages)).toBe(messages);
    });

    it.each(["error", "image", "write", "unknown", "unpaired", "missing-path"])(
      `preserves %s results instead of treating them as recoverable duplicate reads (${issue})`,
      (condition) => {
        const messages = [
          ...readBatch("old-read", "资料.md", longNote),
          ...readBatch("new-read", "资料.md", longNote),
        ];
        const older = messages[1];
        if (older.role !== "toolResult") throw new Error();
        if (condition === "error") older.isError = true;
        if (condition === "image")
          older.content.push({ type: "image", data: "image", mimeType: "image/png" });
        if (condition === "write") older.toolName = "write_note";
        if (condition === "unknown") older.toolName = "mcp_read_note";
        if (condition === "unpaired") older.toolCallId = "unpaired";
        if (condition === "missing-path") older.details = {};
        expect(reduceToolHistory(messages)).toBe(messages);
      }
    );

    it(`does not grow short results and keeps empty input stable (${issue})`, () => {
      const messages = [
        ...readBatch("old-read", "资料.md", "short"),
        ...readBatch("new-read", "资料.md", "short"),
      ];
      expect(reduceToolHistory(messages)).toBe(messages);
      const empty: AgentMessage[] = [];
      expect(reduceToolHistory(empty)).toBe(empty);
    });

    it(`keeps the newest full duplicate as the common reference and is stable on repeated projection (${issue})`, () => {
      const messages = [
        ...readBatch("first", "资料.md", longNote),
        ...readBatch("second", "资料.md", longNote),
        ...readBatch("third", "资料.md", longNote),
      ];
      const reduced = reduceToolHistory(messages);
      expect(JSON.stringify(reduced[1])).toContain("third");
      expect(JSON.stringify(reduced[3])).toContain("third");
      expect(reduced[5]).toBe(messages[5]);
      expect(reduceToolHistory(reduced)).toBe(reduced);
    });

    it(`re-estimates the shortened view instead of using stale provider usage while preserving the original measurements (${issue})`, () => {
      const messages = [
        ...readBatch("first", "资料.md", longNote),
        ...readBatch("second", "资料.md", longNote),
      ];
      for (const message of messages) {
        if (message.role !== "assistant") continue;
        message.usage = {
          ...message.usage,
          input: 7000,
          output: 300,
          cacheRead: 500,
          cacheWrite: 100,
          totalTokens: 7900,
        };
      }
      const original = JSON.stringify(messages);
      const before = estimateContextTokens(messages).tokens;
      const reduced = reduceToolHistory(messages);
      expect(estimateContextTokens(reduced).tokens).toBeLessThan(before);
      expect(estimateContextTokens(reduced).lastUsageIndex).toBeNull();
      for (const message of reduced) {
        if (message.role !== "assistant") continue;
        expect(message.usage).toMatchObject({
          input: 0,
          output: 0,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 0,
        });
      }
      expect(JSON.stringify(messages)).toBe(original);
      expect(reduceToolHistory(reduced)).toBe(reduced);
    });
  });
});
