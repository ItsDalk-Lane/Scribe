import { AgentSession } from "@/agentMode/session/AgentSession";
import { SubagentChatBackend } from "@/agentMode/session/SubagentChatBackend";
import { AgentChatUIState } from "@/agentMode/session/AgentChatUIState";
import type { BackendProcess, SessionEvent, SessionUpdateHandler } from "@/agentMode/session/types";
import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";

jest.mock("@/logger", () => ({ logInfo: jest.fn(), logWarn: jest.fn(), logError: jest.fn() }));
jest.mock("@/settings/model", () => ({ getSettings: jest.fn(() => ({ agentMode: {} })) }));

const child: SubagentSessionSnapshot = {
  id: "child-1",
  parentSessionId: "parent-1",
  modelId: "model-1",
  name: "资料整理",
  cwd: "/vault",
  retention: "retained",
  createdAt: 1,
  updatedAt: 2,
  runs: [],
  messages: [],
};

function fixture() {
  let handler: SessionUpdateHandler | undefined;
  let saved: readonly SubagentSessionSnapshot[] = [child];
  const list = jest.fn(async () => saved);
  const send = jest.fn(async () => ({
    subagentId: child.id,
    status: "enqueued" as const,
    messageId: "message-1",
  }));
  const stop = jest.fn(async () => undefined);
  const archive = jest.fn(async ({ archived }: { archived: boolean }) => {
    saved = [{ ...child, retention: archived ? "archived" : "retained" }];
  });
  const remove = jest.fn(async () => {
    saved = [];
  });
  const cancel = jest.fn(async () => undefined);
  const newTask = jest.fn(async () => undefined);
  const recovery = jest.fn(async () => undefined);
  const continueBudget = jest.fn(async () => undefined);
  const backend = {
    registerSessionHandler: (_id: string, next: SessionUpdateHandler) => {
      handler = next;
      return () => undefined;
    },
    listSubagentSessions: list,
    sendSubagentMessage: send,
    stopSubagent: stop,
    setSubagentArchived: archive,
    deleteSubagentSession: remove,
    cancel,
    startIndependentTask: newTask,
    confirmSubagentRecovery: recovery,
    continueTaskBudget: continueBudget,
  } as unknown as BackendProcess;
  const session = new AgentSession({
    backend,
    backendSessionId: "parent-1",
    internalId: "chat-1",
    backendId: "native",
  });
  const chat = new AgentChatUIState(session);
  return {
    session,
    chat,
    backend,
    list,
    send,
    stop,
    archive,
    remove,
    cancel,
    newTask,
    recovery,
    continueBudget,
    emit: (
      update: SessionEvent["update"],
      occurredAt?: number,
      seq?: number,
      taskToolCallId?: string
    ) => handler!({ sessionId: "parent-1", update, occurredAt, seq, taskToolCallId }),
  };
}

describe("AgentSession subagent collaboration", () => {
  describe("AgentSession", () => {
    describe("continueTaskBudget()", () => {
      it("adds requests to the explicitly identified old task without starting a new model call https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        await f.chat.continueTaskBudget("old-generation", "budget-request");
        expect(f.continueBudget).toHaveBeenCalledWith({
          sessionId: "parent-1",
          taskGenerationId: "old-generation",
          requestId: "budget-request",
        });
        expect(f.send).not.toHaveBeenCalled();
      });
    });
    describe("confirmSubagentRecovery()", () => {
      it("records the user's recovery check without starting a new child run https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        await f.chat.confirmSubagentRecovery("child-1");
        expect(f.recovery).toHaveBeenCalledWith({ sessionId: "parent-1", subagentId: "child-1" });
        expect(f.send).not.toHaveBeenCalled();
      });
    });
    describe("startIndependentTask()", () => {
      it("starts a separate task only through an explicit action https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        await f.chat.startIndependentTask();
        expect(f.newTask).toHaveBeenCalledWith({ sessionId: "parent-1" });
      });
    });
    describe("cancel()", () => {
      it("cancels a managed root command while the parent is idle and there is no child work https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        f.session.completeResume(null);
        await f.session.ready;
        f.emit({
          sessionUpdate: "task_started",
          taskId: "root-command",
          toolCallId: "root-command-call",
          kind: "command",
          description: "后台校验",
          command: "check-notes",
        });
        expect(f.session.getStatus()).toBe("idle");
        expect(f.session.hasManagedSubagentWork()).toBe(false);
        await f.chat.cancel();
        expect(f.cancel).toHaveBeenCalledWith({ sessionId: "parent-1" });
      });

      it("reports a failed background cancellation to the caller instead of pretending the child stopped https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        f.session.completeResume(null);
        await f.session.ready;
        f.emit({
          sessionUpdate: "subagents_updated",
          subagents: [
            {
              ...child,
              runs: [
                {
                  id: "run-1",
                  taskGenerationId: "g-1",
                  toolCallId: "tool-1",
                  status: "awaiting_input",
                  createdAt: 1,
                  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
                },
              ],
            },
          ],
        });
        f.cancel.mockRejectedValueOnce(new Error("停止状态保存失败"));
        await expect(f.chat.cancel()).rejects.toThrow("停止状态保存失败");
        expect(f.chat.getSubagentSessions()[0].runs[0].status).toBe("awaiting_input");
      });

      it("stops background children even while the parent response is idle https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        f.session.completeResume(null);
        await f.session.ready;
        f.emit({
          sessionUpdate: "subagents_updated",
          subagents: [
            {
              ...child,
              runs: [
                {
                  id: "run-1",
                  taskGenerationId: "g-1",
                  toolCallId: "tool-1",
                  status: "awaiting_input",
                  createdAt: 1,
                  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
                },
              ],
            },
          ],
        });
        expect(f.session.getStatus()).toBe("idle");
        await f.chat.cancel();
        expect(f.cancel).toHaveBeenCalledWith({ sessionId: "parent-1" });
      });
    });
    describe("refreshSubagentSessions()", () => {
      it("loads saved child sessions without asking the model and keeps newer events over a stale query https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        await f.chat.refreshSubagentSessions();
        expect(f.chat.getSubagentSessions()).toEqual([child]);
        let release!: (value: readonly SubagentSessionSnapshot[]) => void;
        f.list.mockImplementationOnce(
          () =>
            new Promise((resolve) => {
              release = resolve;
            })
        );
        const pending = f.chat.refreshSubagentSessions();
        f.emit({ sessionUpdate: "subagents_updated", subagents: [{ ...child, name: "新的名称" }] });
        release([child]);
        await pending;
        expect(f.chat.getSubagentSessions()[0].name).toBe("新的名称");
      });
    });
    describe("getSubagentSessions()", () => {
      it("does not turn legacy summary tasks into recoverable children and refuses continuation from read-only history https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        f.emit({
          sessionUpdate: "task_started",
          taskId: "legacy-task-1",
          toolCallId: "legacy-call-1",
          kind: "subagent",
          description: "旧版资料整理",
        });
        f.emit({
          sessionUpdate: "task_ended",
          taskId: "legacy-task-1",
          status: "completed",
          summary: "已整理三份笔记",
        });
        f.session.setHistoryReadOnly(true);
        expect(f.chat.getTasks()).toEqual([
          expect.objectContaining({ taskId: "legacy-task-1", summary: "已整理三份笔记" }),
        ]);
        expect(f.chat.getSubagentSessions()).toEqual([]);
        await expect(
          f.chat.sendSubagentMessage("legacy-task-1", "继续旧代理", "wake")
        ).rejects.toThrow("cannot be continued");
        expect(f.send).not.toHaveBeenCalled();
        expect(f.list).not.toHaveBeenCalled();
      });

      it("retains the child directory when more than twenty ended task cards are pruned https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        await f.chat.refreshSubagentSessions();
        for (let i = 0; i < 25; i++) {
          f.emit({
            sessionUpdate: "task_started",
            taskId: `task-${i}`,
            toolCallId: `tool-${i}`,
            kind: "subagent",
            description: "整理",
          });
          f.emit({ sessionUpdate: "task_ended", taskId: `task-${i}`, status: "completed" });
        }
        expect(f.chat.getTasks()).toHaveLength(20);
        expect(f.chat.getSubagentSessions()).toEqual([child]);
      });
    });
    describe("hasManagedSubagentWork()", () => {
      it("recognizes queued child work even while the main model is idle https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
        const f = fixture();
        f.emit({
          sessionUpdate: "subagents_updated",
          subagents: [
            {
              ...child,
              runs: [
                {
                  id: "run-1",
                  taskGenerationId: "g-1",
                  toolCallId: "t-1",
                  status: "queued",
                  createdAt: 1,
                  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
                },
              ],
            },
          ],
        });
        expect(f.session.hasManagedSubagentWork()).toBe(true);
      });
    });
    describe("sendSubagentMessage()", () => {
      it("preserves explicit send modes and retry identity while targeting only the owning chat https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        for (const mode of ["enqueue", "wake", "interrupt"] as const)
          await f.chat.sendSubagentMessage("child-1", "只处理指定目录", mode, "retry-1");
        expect(f.send.mock.calls).toEqual(
          ["enqueue", "wake", "interrupt"].map((mode) => [
            {
              sessionId: "parent-1",
              subagentId: "child-1",
              text: "只处理指定目录",
              mode,
              messageId: "retry-1",
            },
          ])
        );
      });
      it("keeps a successful durable acceptance when refreshing the list fails https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        f.list.mockRejectedValueOnce(new Error("list unavailable"));
        await expect(f.chat.sendSubagentMessage("child-1", "继续", "wake")).resolves.toMatchObject({
          status: "enqueued",
        });
      });
      it("refuses unsupported backends without creating another conversation https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        delete f.backend.sendSubagentMessage;
        await expect(f.chat.sendSubagentMessage("child-1", "继续", "wake")).rejects.toThrow(
          "cannot be continued"
        );
      });
    });
    describe("stopSubagent()", () => {
      it("stops only the selected child and reloads its saved state https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        await f.chat.stopSubagent("child-1");
        expect(f.stop).toHaveBeenCalledWith({ sessionId: "parent-1", subagentId: "child-1" });
        expect(f.chat.getSubagentSessions()).toEqual([child]);
      });
    });
    describe("setSubagentArchived()", () => {
      it("archives and restores the same saved child identity https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        await f.chat.setSubagentArchived("child-1", true);
        expect(f.chat.getSubagentSessions()[0]).toMatchObject({
          id: "child-1",
          retention: "archived",
        });
        await f.chat.setSubagentArchived("child-1", false);
        expect(f.chat.getSubagentSessions()[0]).toMatchObject({
          id: "child-1",
          retention: "retained",
        });
      });
    });
    describe("deleteSubagentSession()", () => {
      it("removes the selected child directory only after the backend completes deletion https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture();
        await f.chat.refreshSubagentSessions();
        await f.chat.deleteSubagentSession("child-1");
        expect(f.remove).toHaveBeenCalledWith({ sessionId: "parent-1", subagentId: "child-1" });
        expect(f.chat.getSubagentSessions()).toEqual([]);
      });
    });
    describe("getMessageUsageMetrics()", () => {
      it("restores each child reply's real completion and elapsed time through live and replayed lifecycle facts https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
        const f = fixture();
        f.session.completeResume(null);
        await f.session.ready;
        await f.chat.refreshSubagentSessions();
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
        const run = {
          id: "run",
          roundId: "first",
          promptId: "parent-input",
          taskGenerationId: "g",
          toolCallId: "call",
          status: "running" as const,
          createdAt: 1000,
          startedAt: 1000,
          usage,
        };
        const followup = {
          id: "child-input",
          roundId: "second",
          promptId: "child-input",
          sequence: 1,
          subagentId: child.id,
          runId: "run",
          taskGenerationId: "g",
          direction: "to_child" as const,
          sender: "user" as const,
          kind: "instruction" as const,
          text: "Follow-up",
          state: "delivered" as const,
          acceptedAt: 3500,
          deliveredAt: 4000,
          deliverySeq: 15,
        };
        const saved = {
          ...child,
          runs: [{ ...run, status: "completed" as const, endedAt: 9000 }],
          messages: [followup],
        };
        const base = {
          id: "first-call",
          roundId: "first",
          subagentId: child.id,
          runId: "run",
          sourceId: child.id,
          sourceName: child.name,
          kind: "subagent" as const,
          purpose: "chat" as const,
          modelId: "m",
          modelName: "M",
          requestIds: ["first-request"],
          status: "completed" as const,
          usage: { totalTokens: 7 },
          segmentSeq: 10,
        };
        const events: Array<[SessionEvent["update"], number, number, string?]> = [
          [
            {
              sessionUpdate: "task_started",
              taskId: "run",
              toolCallId: "call",
              kind: "subagent",
              description: "Child",
              subagentId: child.id,
              runId: "run",
              roundId: "first",
            },
            1000,
            1,
          ],
          [{ sessionUpdate: "subagents_updated", subagents: [{ ...child, runs: [run] }] }, 1000, 2],
          [{ sessionUpdate: "agent_segment_started" }, 1000, 10, "call"],
          [{ sessionUpdate: "model_call_metrics", observation: base }, 3000, 11, "call"],
          [
            {
              sessionUpdate: "agent_segment_finalized",
              segmentSeq: 10,
              blocks: [
                { kind: "thought", text: "Thinking", contentIndex: 0 },
                { kind: "text", text: "First", contentIndex: 1 },
              ],
              finalResponse: true,
            },
            3000,
            12,
            "call",
          ],
          [
            {
              sessionUpdate: "turn_started",
              turnId: "child-input",
              roundId: "second",
              startedAt: 4000,
            },
            4000,
            14,
            "call",
          ],
          [{ sessionUpdate: "agent_segment_started" }, 4000, 20, "call"],
          [
            {
              sessionUpdate: "model_call_metrics",
              observation: {
                ...base,
                id: "second-call",
                roundId: "second",
                promptId: "child-input",
                segmentSeq: 20,
                requestIds: ["second-request"],
              },
            },
            8000,
            21,
            "call",
          ],
          [
            {
              sessionUpdate: "agent_segment_finalized",
              segmentSeq: 20,
              blocks: [{ kind: "text", text: "Second", contentIndex: 0 }],
              finalResponse: true,
            },
            8000,
            22,
            "call",
          ],
          [
            {
              sessionUpdate: "turn_ended",
              turnId: "child-input",
              roundId: "second",
              subagentId: child.id,
              stopReason: "end_turn",
            },
            9000,
            23,
            "call",
          ],
          [{ sessionUpdate: "task_ended", taskId: "run", status: "completed" }, 9000, 24],
          [{ sessionUpdate: "subagents_updated", subagents: [saved] }, 9000, 25],
          [
            {
              sessionUpdate: "turn_ended",
              turnId: "parent-input",
              roundId: "first",
              stopReason: "end_turn",
            },
            20000,
            26,
          ],
        ];
        for (const event of events) f.emit(...event);
        const live = new SubagentChatBackend(f.chat, child.id)
          .getMessages()
          .filter((message) => message.sender === "ai");
        expect(
          live.map((message) => ({
            text: message.message,
            stop: message.turnStopReason,
            time: message.turnDurationMs,
            final: message.turnMetrics?.finalResponseSegmentSeq,
          }))
        ).toEqual([
          { text: "First", stop: "end_turn", time: 3000, final: 10 },
          { text: "Second", stop: "end_turn", time: 5000, final: 20 },
        ]);
        const reopened = fixture();
        reopened.list.mockResolvedValue([saved]);
        for (const event of events)
          if (event[0].sessionUpdate !== "subagents_updated") reopened.emit(...event);
        reopened.session.completeResume(null);
        await reopened.session.ready;
        await reopened.chat.refreshSubagentSessions();
        const restored = new SubagentChatBackend(reopened.chat, child.id)
          .getMessages()
          .filter((message) => message.sender === "ai");
        expect(restored.map((message) => [message.turnStopReason, message.turnDurationMs])).toEqual(
          [
            ["end_turn", 3000],
            ["end_turn", 5000],
          ]
        );
        expect(reopened.send).not.toHaveBeenCalled();
      });
      it("does not mutate retained display statistics while deriving live work status https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const f = fixture();
        const metrics = Object.freeze({ partial: true, sources: [], roundId: "legacy" });
        const message = {
          id: "old",
          sender: "ai",
          message: "Old",
          timestamp: null,
          isVisible: true,
          turnMetrics: metrics,
        };
        expect(f.session.getMessageUsageMetrics(message)).toMatchObject({
          partial: true,
          hasActiveWork: false,
        });
        expect(metrics).not.toHaveProperty("hasActiveWork");
      });
      it("finishes a child's process independently while its sibling continues in the same parent round https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const f = fixture();
        const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 };
        const runA = {
          id: "run-a",
          roundId: "round",
          taskGenerationId: "generation",
          toolCallId: "task-a",
          status: "completed" as const,
          createdAt: 1,
          endedAt: 4,
          usage,
        };
        const runB = {
          ...runA,
          id: "run-b",
          toolCallId: "task-b",
          status: "running" as const,
          endedAt: undefined,
        };
        f.emit({
          sessionUpdate: "task_started",
          kind: "subagent",
          taskId: "run-a",
          subagentId: "child-a",
          runId: "run-a",
          roundId: "round",
          toolCallId: "task-a",
          description: "A",
        });
        f.emit({
          sessionUpdate: "task_started",
          kind: "subagent",
          taskId: "run-b",
          subagentId: "child-b",
          runId: "run-b",
          roundId: "round",
          toolCallId: "task-b",
          description: "B",
        });
        f.emit({ sessionUpdate: "agent_segment_started" }, 1000, 10, "task-a");
        f.emit(
          {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "A finished" },
            segmentSeq: 10,
            contentIndex: 0,
          },
          2000,
          11,
          "task-a"
        );
        f.emit(
          {
            sessionUpdate: "agent_segment_finalized",
            segmentSeq: 10,
            blocks: [{ kind: "text", text: "A finished", contentIndex: 0 }],
            finalResponse: true,
          },
          2000,
          12,
          "task-a"
        );
        f.emit({
          sessionUpdate: "model_call_metrics",
          observation: {
            id: "a-call",
            roundId: "round",
            sourceId: "child-a",
            subagentId: "child-a",
            runId: "run-a",
            sourceName: "A",
            kind: "subagent",
            purpose: "chat",
            modelId: "m",
            modelName: "M",
            segmentSeq: 10,
            requestIds: ["request-a"],
            status: "completed",
            usage: { totalTokens: 5 },
          },
        });
        f.emit({
          sessionUpdate: "task_ended",
          taskId: "run-a",
          status: "completed",
        });
        f.emit({
          sessionUpdate: "subagents_updated",
          subagents: [
            { ...child, id: "child-a", runs: [runA] },
            { ...child, id: "child-b", runs: [runB] },
          ],
        });
        expect(
          f.session.getMessageUsageMetrics(f.chat.getTaskMessages("task-a")[0], true)
        ).toMatchObject({ hasActiveWork: false, activeRounds: 0, finalResponseSegmentSeq: 10 });
        expect(f.chat.getTasks().find((task) => task.toolCallId === "task-b")?.status).toBe(
          "running"
        );
      });
    });
    describe("showSubagentMessage()", () => {
      it("restores a child result before the follow-up reply and uses that reply's own start time https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
        const f = fixture();
        const message = {
          id: "result-1",
          sequence: 1,
          subagentId: "child-1",
          taskGenerationId: "g-1",
          direction: "to_parent" as const,
          sender: "subagent" as const,
          kind: "result" as const,
          text: "Child result",
          state: "accepted" as const,
          acceptedAt: 3000,
        };
        f.emit({ sessionUpdate: "turn_started", turnId: "first", startedAt: 1000 }, 1000, 1);
        f.emit({ sessionUpdate: "message_delivered", promptId: "first" }, 1000, 2);
        f.emit(
          { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "First" } },
          1500,
          3
        );
        f.emit({ sessionUpdate: "turn_ended", turnId: "first", stopReason: "end_turn" }, 2000, 4);
        f.emit({ sessionUpdate: "subagent_message", message, name: child.name }, 3000, 5);
        f.emit({ sessionUpdate: "turn_started", turnId: "follow-up", startedAt: 4000 }, 4000, 6);
        f.emit({ sessionUpdate: "message_delivered", promptId: "follow-up" }, 4000, 7);
        f.emit(
          { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "Follow-up" } },
          4500,
          8
        );
        f.emit(
          { sessionUpdate: "turn_ended", turnId: "follow-up", stopReason: "end_turn" },
          5000,
          9
        );
        f.session.completeResume(null);

        expect(f.chat.getMessages().map((item) => item.message)).toEqual([
          "First",
          expect.stringContaining("Child result"),
          "Follow-up",
        ]);
        expect(f.chat.getMessages()[2].turnDurationMs).toBe(1000);
      });

      it("shows the real child source once and identifies collaboration notices during event and directory replay https://github.com/ItsDalk-Lane/Scribe/issues/50 https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const f = fixture();
        const message = {
          id: "message-1",
          sequence: 1,
          subagentId: "child-1",
          taskGenerationId: "g-1",
          direction: "to_parent" as const,
          sender: "subagent" as const,
          kind: "question" as const,
          text: "请确认范围",
          state: "accepted" as const,
          acceptedAt: 2,
        };
        f.emit({ sessionUpdate: "subagent_message", message, name: child.name });
        f.emit({ sessionUpdate: "subagent_message", message, name: child.name });
        f.emit({
          sessionUpdate: "subagents_updated",
          subagents: [{ ...child, messages: [message] }],
        });
        const shown = f.chat.getMessages();
        expect(shown).toHaveLength(1);
        expect(shown[0].message).toContain("资料整理");
        expect(shown[0].message).toContain("请确认范围");
        expect(shown[0].sender).not.toBe("user");
        expect(shown[0].synthetic).toBe(true);
      });
    });
  });
});
