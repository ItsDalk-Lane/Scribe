import type { AgentMessage } from "@earendil-works/pi-agent-core";
import {
  isSubagentMessage,
  isSubagentSnapshot,
  projectSubagentState,
  type NativeSubagentState,
} from "@/agentMode/sdk/subagentState";
import type { JournalRecord } from "@/agentMode/sdk/JournalStorage";

function state(): NativeSubagentState {
  return {
    version: 1,
    revision: 1,
    context: [{ role: "user", content: "独立任务", timestamp: 1 }],
    automaticTaskIds: ["generation-a"],
    snapshot: {
      id: "child-a",
      parentSessionId: "parent-a",
      name: "资料整理",
      modelId: "model-a",
      cwd: "/vault",
      retention: "retained",
      createdAt: 1,
      updatedAt: 2,
      runs: [
        {
          id: "run-a",
          toolCallId: "tool-a",
          taskGenerationId: "generation-a",
          status: "running",
          createdAt: 1,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
        },
      ],
      messages: [
        {
          id: "message-a",
          sequence: 1,
          subagentId: "child-a",
          runId: "run-a",
          taskGenerationId: "generation-a",
          direction: "to_parent",
          sender: "subagent",
          kind: "discovery",
          text: "找到资料",
          state: "accepted",
          acceptedAt: 2,
        },
      ],
    },
  };
}

function fact(seq: number, kind: string, payload: unknown): JournalRecord {
  return { version: 2, seq, kind, payload, origin: "observed", occurredAt: seq + 10 };
}

const validateMessage = (value: unknown): value is AgentMessage =>
  !!value && typeof value === "object" && "role" in value;

describe("subagentState", () => {
  describe("isSubagentMessage()", () => {
    it("accepts complete collaboration messages and rejects invalid source or state fields (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const message = state().snapshot.messages[0];
      expect(isSubagentMessage(message)).toBe(true);
      expect(isSubagentMessage(null)).toBe(false);
      expect(isSubagentMessage({ ...message, sender: "pretend-user" })).toBe(false);
      expect(isSubagentMessage({ ...message, state: "read" })).toBe(false);
      expect(isSubagentMessage({ ...message, acceptedAt: NaN })).toBe(false);
    });
  });

  describe("isSubagentSnapshot()", () => {
    it("accepts complete child snapshots and rejects messages belonging to another child (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const snapshot = state().snapshot;
      expect(isSubagentSnapshot(snapshot)).toBe(true);
      expect(isSubagentSnapshot(null)).toBe(false);
      expect(
        isSubagentSnapshot({
          ...snapshot,
          messages: [{ ...snapshot.messages[0], subagentId: "another-child" }],
        })
      ).toBe(false);
      expect(
        isSubagentSnapshot({
          ...snapshot,
          runs: [{ ...snapshot.runs[0], usage: { totalTokens: -1 } }],
        })
      ).toBe(false);
    });
  });

  describe("projectSubagentState()", () => {
    it("leaves ordinary history unchanged and rejects unknown child record kinds (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      expect(
        projectSubagentState([fact(0, "future_unrelated_record", {})], validateMessage)
      ).toMatchObject({ subagents: [], parentMessages: [], writable: true });
      expect(
        projectSubagentState([fact(0, "subagent_future_record", {})], validateMessage)
      ).toMatchObject({ writable: false, warnings: [expect.stringContaining("unsupported")] });
    });
    it("restores the same child context while marking unfinished execution interrupted without automatic restart (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = state();
      const projected = projectSubagentState(
        [fact(0, "subagent_state", { version: 1, state: saved })],
        validateMessage
      );
      expect(projected).toMatchObject({
        writable: true,
        warnings: [],
        subagents: [
          {
            revision: 1,
            context: saved.context,
            automaticTaskIds: [],
            snapshot: {
              id: "child-a",
              runs: [{ id: "run-a", status: "interrupted", stopReason: "interrupted" }],
            },
          },
        ],
      });
      expect(saved.snapshot.runs[0].status).toBe("running");
    });

    it("restores one parent input and its delivery markers from the same committed fact (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = state();
      saved.snapshot.runs = [
        {
          ...saved.snapshot.runs[0],
          status: "completed",
          resultId: "result-a",
          result: "完成结果",
        },
      ];
      const message: AgentMessage = {
        role: "user",
        content: "来源为子代理：找到资料",
        timestamp: 3,
      };
      const payload = {
        version: 1,
        subagentId: "child-a",
        message,
        messageIds: ["message-a"],
        resultId: "result-a",
      };
      const projected = projectSubagentState(
        [
          fact(0, "subagent_state", { version: 1, state: saved }),
          fact(1, "subagent_delivery", payload),
          fact(2, "subagent_delivery", payload),
        ],
        validateMessage
      );
      expect(projected.parentMessages).toEqual([{ seq: 1, message }]);
      expect(projected.subagents[0].snapshot.messages[0]).toMatchObject({
        state: "delivered",
        deliveredAt: 11,
      });
      expect(projected.subagents[0].snapshot.runs[0]).toMatchObject({ resultDelivered: true });
    });

    it("withdraws unread input from a stopped task even when shutdown interrupted the child's admission save (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = state();
      saved.snapshot.messages = [
        { ...saved.snapshot.messages[0], direction: "to_child", sender: "main" },
      ];
      const records = [
        fact(0, "subagent_state", { version: 1, state: saved }),
        fact(1, "subagent_task", { version: 1, task: { id: "generation-a", active: false } }),
      ];
      expect(
        projectSubagentState(records, validateMessage).subagents[0].snapshot.messages[0].state
      ).toBe("withdrawn");
      expect(
        projectSubagentState(
          [
            ...records,
            fact(2, "subagent_task", { version: 1, task: { id: "generation-a", active: true } }),
          ],
          validateMessage
        ).subagents[0].snapshot.messages[0].state
      ).toBe("accepted");
      const delivered = fact(2, "protocol_message", {
        taskId: "run-a",
        subagentId: "child-a",
        collaborationMessageId: "message-a",
        message: { role: "user", content: "Already committed", timestamp: 3 },
      });
      expect(
        projectSubagentState([...records, delivered], validateMessage).subagents[0].snapshot
          .messages[0].state
      ).toBe("delivered");
    });

    it("keeps the newest revision instead of a late older snapshot (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const old = state();
      const latest = { ...state(), revision: 3, instructions: "新的有效约束" };
      const projected = projectSubagentState(
        [
          fact(0, "subagent_state", { version: 1, state: latest }),
          fact(1, "subagent_state", { version: 1, state: old }),
        ],
        validateMessage
      );
      expect(projected.subagents[0]).toMatchObject({ revision: 3, instructions: "新的有效约束" });
    });

    it("recovers protocol facts saved after the snapshot and marks their collaboration input delivered once (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = state();
      saved.snapshot.messages = [
        { ...saved.snapshot.messages[0], direction: "to_child", sender: "main" },
      ];
      const input: AgentMessage = { role: "user", content: "补充约束", timestamp: 3 };
      const projected = projectSubagentState(
        [
          fact(0, "subagent_state", { version: 1, state: saved }),
          fact(1, "protocol_message", {
            taskId: "run-a",
            subagentId: "child-a",
            collaborationMessageId: "message-a",
            message: input,
          }),
          fact(2, "protocol_message", {
            taskId: "other-run",
            message: { role: "user", content: "另一个子任务", timestamp: 4 },
          }),
        ],
        validateMessage
      );
      expect(projected.subagents[0].context).toEqual([...saved.context, input]);
      expect(projected.subagents[0].contextSeqs).toEqual([-1, 1]);
      expect(projected.subagents[0].snapshot.messages[0]).toMatchObject({
        state: "delivered",
        deliveredAt: 11,
        deliverySeq: 1,
      });
    });

    it("completes unmatched child tool calls with outcome-unknown or not-started results without running a tool (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = state();
      const call = {
        role: "assistant",
        timestamp: 3,
        content: [
          { type: "toolCall", id: "started", name: "edit_note", arguments: {} },
          { type: "toolCall", id: "not-started", name: "run_command", arguments: {} },
        ],
      } as AgentMessage;
      const projected = projectSubagentState(
        [
          fact(0, "subagent_state", { version: 1, state: saved }),
          fact(1, "protocol_message", { taskId: "run-a", message: call }),
          fact(2, "tool_admitted", { taskId: "run-a", id: "started", toolCallId: "view-started" }),
        ],
        validateMessage
      );
      const context = projected.subagents[0].context;
      expect(context).toHaveLength(4);
      expect(context[2]).toMatchObject({
        role: "toolResult",
        toolCallId: "started",
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("结果未知") }],
      });
      expect(context[3]).toMatchObject({
        role: "toolResult",
        toolCallId: "not-started",
        isError: true,
        content: [{ type: "text", text: expect.stringContaining("尚未开始") }],
      });
      const again = projectSubagentState(
        [fact(3, "subagent_state", { version: 1, state: projected.subagents[0] })],
        validateMessage
      );
      expect(again.subagents[0].context).toHaveLength(4);
    });

    it("retains an early saved tool result and blocks recovery while an owned command may still be alive (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = state();
      const result: AgentMessage = {
        role: "toolResult",
        toolCallId: "finished-tool",
        toolName: "read_note",
        isError: false,
        timestamp: 4,
        content: [{ type: "text", text: "已经保存的观察" }],
      };
      const records = [
        fact(0, "subagent_state", { version: 1, state: saved }),
        fact(1, "tool_result", { taskId: "run-a", message: result }),
        fact(2, "task_admitted", {
          taskId: "command-a",
          runId: "run-a",
          subagentId: "child-a",
          command: "long-command",
        }),
        {
          ...fact(3, "event", {
            update: { sessionUpdate: "task_ended", taskId: "command-a", status: "stopped" },
          }),
          origin: "synthetic" as const,
        },
      ];
      const projected = projectSubagentState(records, validateMessage);
      expect(projected.subagents[0].context.at(-1)).toEqual(result);
      expect(projected.subagents[0].snapshot.recoveryBlocked).toContain("command-a");
      const confirmed = projectSubagentState(
        [
          ...records,
          fact(4, "event", {
            update: { sessionUpdate: "task_ended", taskId: "command-a", status: "completed" },
          }),
        ],
        validateMessage
      );
      expect(confirmed.subagents[0].snapshot.recoveryBlocked).toBeUndefined();
    });

    it("does not use an older run admission or late result as authorization or context for a newer run (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = state();
      saved.snapshot.runs = [
        { ...saved.snapshot.runs[0], id: "old-run", status: "completed" },
        ...saved.snapshot.runs,
      ];
      const call = {
        role: "assistant",
        timestamp: 4,
        content: [{ type: "toolCall", id: "reused-id", name: "edit_note", arguments: {} }],
      } as AgentMessage;
      const projected = projectSubagentState(
        [
          fact(0, "subagent_state", { version: 1, state: saved }),
          fact(1, "tool_admitted", { taskId: "old-run", id: "reused-id" }),
          fact(2, "protocol_message", { taskId: "run-a", message: call }),
          fact(3, "tool_result", {
            taskId: "old-run",
            message: {
              role: "toolResult",
              toolCallId: "reused-id",
              toolName: "edit_note",
              isError: false,
              content: [{ type: "text", text: "旧运行迟到结果" }],
              timestamp: 5,
            },
          }),
        ],
        validateMessage
      );
      expect(projected.subagents[0].context).toHaveLength(3);
      expect(projected.subagents[0].context[2]).toMatchObject({
        role: "toolResult",
        toolCallId: "reused-id",
        isError: true,
        content: [{ text: expect.stringContaining("尚未开始") }],
      });
    });

    it("keeps a confirmed old command resolved after another cold restore (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = { ...state(), confirmedCommandIds: ["command-a"], unconfirmedCommandIds: [] };
      const projected = projectSubagentState(
        [
          fact(0, "task_admitted", { subagentId: "child-a", runId: "run-a", taskId: "command-a" }),
          fact(1, "subagent_state", { version: 1, state: saved }),
        ],
        validateMessage
      );
      expect(projected.subagents[0].snapshot.recoveryBlocked).toBeUndefined();
    });

    it("rejects a child state belonging to another chat instead of exposing its context (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const projected = projectSubagentState(
        [
          fact(0, "session_created", { sessionId: "another-parent", cwd: "/vault" }),
          fact(1, "subagent_state", { version: 1, state: state() }),
        ],
        validateMessage
      );
      expect(projected).toMatchObject({ subagents: [], writable: false });
    });

    it("keeps delivered messages delivered after a later state snapshot and rejects overlapping delivery batches (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = state();
      const second = { ...saved.snapshot.messages[0], id: "message-b", sequence: 2 };
      saved.snapshot.messages = [...saved.snapshot.messages, second];
      const message: AgentMessage = { role: "user", content: "来自子代理的发现", timestamp: 4 };
      const projected = projectSubagentState(
        [
          fact(0, "subagent_state", { version: 1, state: saved }),
          fact(1, "subagent_delivery", {
            version: 1,
            subagentId: "child-a",
            message,
            messageIds: ["message-a"],
          }),
          fact(2, "subagent_state", { version: 1, state: { ...saved, revision: 2 } }),
          fact(3, "subagent_delivery", {
            version: 1,
            subagentId: "child-a",
            message,
            messageIds: ["message-a", "message-b"],
          }),
        ],
        validateMessage
      );
      expect(projected.parentMessages).toEqual([{ seq: 1, message }]);
      expect(projected.subagents[0].snapshot.messages.map((entry) => entry.state)).toEqual([
        "delivered",
        "accepted",
      ]);
      expect(projected.writable).toBe(false);
    });

    it.each([
      {
        version: 1,
        subagentId: "unknown",
        messageIds: ["message-a"],
        message: { role: "user", content: "未知来源", timestamp: 1 },
      },
      {
        version: 1,
        subagentId: "child-a",
        messageIds: [],
        message: { role: "user", content: "无身份", timestamp: 1 },
      },
      { version: 1, subagentId: "child-a", messageIds: ["message-a"], message: null },
    ])(
      "preserves an unverifiable delivery without adding it to parent context: %j (https://github.com/ItsDalk-Lane/Scribe/issues/50)",
      (payload) => {
        const projected = projectSubagentState(
          [
            fact(0, "subagent_state", { version: 1, state: state() }),
            fact(1, "subagent_delivery", payload),
          ],
          validateMessage
        );
        expect(projected.parentMessages).toEqual([]);
        expect(projected.writable).toBe(false);
      }
    );

    it("preserves the last valid state and freezes writes for unknown format or invalid context (https://github.com/ItsDalk-Lane/Scribe/issues/50)", () => {
      const saved = state();
      for (const payload of [
        { version: 2, state: saved },
        { version: 1, state: { ...saved, context: [null] } },
      ]) {
        const projected = projectSubagentState(
          [
            fact(0, "subagent_state", { version: 1, state: saved }),
            fact(1, "subagent_state", payload),
          ],
          (value): value is AgentMessage => value !== null
        );
        expect(projected.writable).toBe(false);
        expect(projected.warnings).toHaveLength(1);
        expect(projected.subagents[0].snapshot.id).toBe("child-a");
      }
    });
  });
});
