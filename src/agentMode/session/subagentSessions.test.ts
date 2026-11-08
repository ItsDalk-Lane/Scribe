import { hasManagedSubagentWork, isSubagentRunActive } from "@/agentMode/session/subagentSessions";
import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";

const child: SubagentSessionSnapshot = {
  id: "child-1",
  parentSessionId: "parent-1",
  name: "资料整理",
  modelId: "model-1",
  cwd: "/vault",
  retention: "retained",
  createdAt: 1,
  updatedAt: 2,
  messages: [],
  runs: [
    {
      id: "run-1",
      toolCallId: "tool-1",
      taskGenerationId: "generation-1",
      status: "running",
      createdAt: 1,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
    },
  ],
};

describe("subagentSessions", () => {
  describe("isSubagentRunActive()", () => {
    it("keeps queued, waiting and stopping runs managed until they actually end https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      for (const status of [
        "queued",
        "running",
        "awaiting_approval",
        "awaiting_input",
        "stopping",
      ] as const)
        expect(isSubagentRunActive(status)).toBe(true);
      for (const status of ["completed", "failed", "stopped", "interrupted"] as const)
        expect(isSubagentRunActive(status)).toBe(false);
    });
  });
  describe("hasManagedSubagentWork()", () => {
    it("keeps a retained saved-result outbox managed until delivery while excluding archived, delivered and summary-only history https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const run = {
        ...child.runs[0],
        status: "completed" as const,
        result: "已保存完整结果",
        resultId: "run-1:result",
        deliveryBlocked: true,
      };
      const waiting = { ...child, runs: [run], messages: [] };
      expect(hasManagedSubagentWork([waiting])).toBe(true);
      expect(
        hasManagedSubagentWork([{ ...waiting, runs: [{ ...run, deliveryBlocked: false }] }])
      ).toBe(true);
      expect(
        hasManagedSubagentWork([
          { ...waiting, runs: [{ ...run, deliveryBlocked: false, resultDelivered: true }] },
        ])
      ).toBe(false);
      expect(hasManagedSubagentWork([{ ...waiting, retention: "archived" }])).toBe(false);
      expect(
        hasManagedSubagentWork([
          { ...waiting, runs: [{ ...run, resultId: undefined, deliveryBlocked: undefined }] },
        ])
      ).toBe(false);
    });

    it("keeps live work and undelivered critical messages out of idle reclamation https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      expect(hasManagedSubagentWork([child])).toBe(true);
      const idle = { ...child, runs: [] };
      expect(hasManagedSubagentWork([idle])).toBe(false);
      const message = {
        id: "msg-1",
        sequence: 1,
        subagentId: child.id,
        taskGenerationId: "generation-1",
        direction: "to_parent" as const,
        sender: "subagent" as const,
        kind: "question" as const,
        text: "需要确认目录",
        state: "accepted" as const,
        acceptedAt: 2,
      };
      expect(hasManagedSubagentWork([{ ...idle, messages: [message] }])).toBe(true);
      expect(
        hasManagedSubagentWork([{ ...idle, messages: [{ ...message, kind: "progress" }] }])
      ).toBe(false);
      expect(
        hasManagedSubagentWork([{ ...idle, messages: [{ ...message, state: "delivered" }] }])
      ).toBe(false);
      expect(
        hasManagedSubagentWork([{ ...idle, retention: "archived", messages: [message] }])
      ).toBe(false);
    });
  });
});
