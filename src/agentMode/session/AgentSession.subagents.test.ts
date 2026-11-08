import { AgentSession } from "@/agentMode/session/AgentSession";
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
    emit: (update: SessionEvent["update"], occurredAt?: number, seq?: number) =>
      handler!({ sessionId: "parent-1", update, occurredAt, seq }),
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

      it("shows the real child source once across repeated events and saved-directory replay https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
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
      });
    });
  });
});
