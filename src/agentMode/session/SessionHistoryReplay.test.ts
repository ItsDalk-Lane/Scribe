import { AI_SENDER, USER_SENDER } from "@/constants";
import { AgentMessageStore } from "./AgentMessageStore";
import { OUTPUT_LIMIT_CONTINUATION_PROMPT } from "./promptEnvelope";
import { SessionHistoryReplay } from "./SessionHistoryReplay";
import type { SessionEvent } from "./types";

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

function startReplay(): {
  store: AgentMessageStore;
  replay: SessionHistoryReplay;
  scheduleNotifyMessages: jest.Mock;
  applyTodoList: jest.Mock;
} {
  const store = new AgentMessageStore();
  const scheduleNotifyMessages = jest.fn();
  const applyTodoList = jest.fn();
  const replay = new SessionHistoryReplay({ store, scheduleNotifyMessages, applyTodoList });
  replay.start();
  return { store, replay, scheduleNotifyMessages, applyTodoList };
}

const replayText = (
  sessionUpdate: "user_message_chunk" | "agent_message_chunk" | "agent_thought_chunk",
  text: string,
  messageId?: string
): SessionEvent["update"] => ({
  sessionUpdate,
  content: { type: "text", text },
  messageId,
});

function bubbles(store: AgentMessageStore): { sender: string; message: string }[] {
  return store.getDisplayMessages().map((m) => ({ sender: m.sender, message: m.message }));
}

describe("SessionHistoryReplay", () => {
  describe("SessionHistoryReplay", () => {
    describe("start", () => {
      it("makes the replay take frames as the chat's past turns", () => {
        const store = new AgentMessageStore();
        const replay = new SessionHistoryReplay({
          store,
          scheduleNotifyMessages: jest.fn(),
          applyTodoList: jest.fn(),
        });

        replay.start();

        expect(replay.append(replayText("agent_message_chunk", "Hello", "a1"), undefined)).toBe(
          true
        );
        expect(bubbles(store)).toEqual([{ sender: AI_SENDER, message: "Hello" }]);
      });
    });

    describe("isOpen", () => {
      it("reports the replay closed before it starts and after it ends, and open in between", () => {
        const replay = new SessionHistoryReplay({
          store: new AgentMessageStore(),
          scheduleNotifyMessages: jest.fn(),
          applyTodoList: jest.fn(),
        });
        expect(replay.isOpen()).toBe(false);

        replay.start();
        expect(replay.isOpen()).toBe(true);

        replay.end();
        expect(replay.isOpen()).toBe(false);
      });
    });

    describe("append", () => {
      it("restores the exact exhausted task generation without authorizing new model calls https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
        const { store, replay } = startReplay();
        replay.append(replayText("user_message_chunk", "Question", "u1"), 100);
        replay.append(
          {
            sessionUpdate: "turn_ended",
            turnId: "t1",
            stopReason: "max_task_requests",
            taskGenerationId: "old-generation",
          },
          150
        );
        replay.end();
        expect(store.getDisplayMessages().at(-1)).toMatchObject({
          turnStopReason: "max_task_requests",
          taskGenerationId: "old-generation",
        });
      });
      it("freezes a normal reply's final thought at its recorded end time after a later replay", () => {
        const clock = jest.spyOn(Date, "now").mockReturnValue(9_000_000);
        try {
          const { store, replay } = startReplay();
          replay.append({ sessionUpdate: "turn_started", turnId: "request" }, 1000, 1);
          replay.append(
            { sessionUpdate: "message_delivered", promptId: "request", messageSeq: 0 },
            2000,
            2
          );
          replay.append(replayText("user_message_chunk", "Question", "request"), 3000, 3);
          replay.append(replayText("agent_thought_chunk", "Thinking"), 4000, 4);
          replay.append(
            { sessionUpdate: "turn_ended", turnId: "request", stopReason: "end_turn" },
            9000,
            5
          );
          replay.end();
          expect(store.getMessage("assistant:request")).toMatchObject({
            seq: 2,
            timestamp: { epoch: 2000 },
            turnStopReason: "end_turn",
            turnDurationMs: 7000,
            parts: [{ kind: "thought", startedAtMs: 4000, durationMs: 5000 }],
          });
        } finally {
          clock.mockRestore();
        }
      });
      it("restores a persisted failure even when no assistant text arrived, without inventing a duration", () => {
        const { store, replay } = startReplay();
        replay.append(replayText("user_message_chunk", "Question", "u1"), undefined);
        replay.append(
          {
            sessionUpdate: "turn_ended",
            turnId: "t1",
            stopReason: "end_turn",
            error: new Error("connection failed"),
          },
          undefined
        );
        expect(store.getDisplayMessages()[1]).toMatchObject({
          isErrorMessage: true,
          errorText: "**Error:** connection failed",
          message: "**Error:** connection failed",
        });
        expect(store.getDisplayMessages()[1].turnDurationMs).toBeUndefined();
      });
      it.each([
        "quota_exhausted",
        "authentication_error",
        "context_limit",
        "request_error",
        "max_turn_requests",
        "cancelled",
      ] as const)(
        "restores %s even without assistant text or a UI snapshot (https://github.com/ItsDalk-Lane/Scribe/issues/31)",
        (stopReason) => {
          const { store, replay } = startReplay();
          replay.append(replayText("user_message_chunk", "Question", "u1"), 100);
          replay.append({ sessionUpdate: "turn_ended", turnId: "t1", stopReason }, 150);
          replay.end();
          expect(store.getDisplayMessages()[1]).toMatchObject({
            sender: AI_SENDER,
            turnStopReason: stopReason,
            turnDurationMs: 50,
          });
          expect(store.getDisplayMessages()[1].isErrorMessage).not.toBe(true);
        }
      );

      it("restores an explicit stop ahead of an accompanying transport error", () => {
        const { store, replay } = startReplay();
        replay.append(replayText("user_message_chunk", "Question", "u1"), 100);
        replay.append(replayText("agent_message_chunk", "Partial", "a1"), 120);
        replay.append(
          {
            sessionUpdate: "turn_ended",
            turnId: "t1",
            stopReason: "cancelled",
            error: new Error("request aborted"),
          },
          150
        );
        expect(store.getDisplayMessages()[1]).toMatchObject({
          message: "Partial",
          turnStopReason: "cancelled",
          turnDurationMs: 50,
        });
        expect(store.getDisplayMessages()[1].isErrorMessage).not.toBe(true);
      });

      it("turns replayed user and agent frames into one user bubble and one agent bubble", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "test", "u1"), undefined);
        replay.append(replayText("agent_message_chunk", "Hello", "a1"), undefined);
        replay.append(replayText("agent_message_chunk", " there", "a1"), undefined);

        expect(bubbles(store)).toEqual([
          { sender: USER_SENDER, message: "test" },
          { sender: AI_SENDER, message: "Hello there" },
        ]);
        expect(store.getDisplayMessages().map((m) => m.timestamp)).toEqual([null, null]);
      });

      it("folds several replayed agent messages between two user messages into one agent bubble", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "first", "u1"), undefined);
        replay.append(replayText("agent_message_chunk", "one ", "a1"), undefined);
        replay.append(replayText("agent_message_chunk", "two", "a2"), undefined);
        replay.append(replayText("user_message_chunk", "second", "u2"), undefined);
        replay.append(replayText("agent_message_chunk", "three", "a3"), undefined);

        expect(bubbles(store)).toEqual([
          { sender: USER_SENDER, message: "first" },
          { sender: AI_SENDER, message: "one two" },
          { sender: USER_SENDER, message: "second" },
          { sender: AI_SENDER, message: "three" },
        ]);
      });

      it("gives a replayed reply the agent started on its own its own bubble when the replay ends the turn before it", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "start a task", "u1"), undefined);
        replay.append(replayText("agent_message_chunk", "Started.", "a1"), undefined);
        replay.append(
          { sessionUpdate: "turn_ended", turnId: "", stopReason: "end_turn" },
          undefined
        );
        replay.append(replayText("agent_message_chunk", "The task finished.", "a2"), undefined);

        expect(bubbles(store)).toEqual([
          { sender: USER_SENDER, message: "start a task" },
          { sender: AI_SENDER, message: "Started." },
          { sender: AI_SENDER, message: "The task finished." },
        ]);
      });

      it("joins user chunks that share a message id and splits chunks that have none", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "one prompt ", "u1"), undefined);
        replay.append(replayText("user_message_chunk", "in two chunks", "u1"), undefined);
        replay.append(replayText("user_message_chunk", "cancelled"), undefined);
        replay.append(replayText("user_message_chunk", "next"), undefined);
        replay.end();

        expect(bubbles(store).map((b) => b.message)).toEqual([
          "one prompt in two chunks",
          "cancelled",
          "next",
        ]);
      });

      it("shows a replayed user message that spans chunks only once it ends, stripped of its prompt envelope, so the raw context is never displayed", () => {
        const { store, replay } = startReplay();

        replay.append(
          replayText(
            "user_message_chunk",
            "<scribe-context>ctx</scribe-context>\n<user-message>\nlist ",
            "u1"
          ),
          undefined
        );
        expect(bubbles(store)).toEqual([]);

        replay.append(
          replayText("user_message_chunk", "the files\n</user-message>", "u1"),
          undefined
        );
        replay.append(replayText("agent_message_chunk", "a.md", "a1"), undefined);

        expect(bubbles(store)).toEqual([
          { sender: USER_SENDER, message: "list the files" },
          { sender: AI_SENDER, message: "a.md" },
        ]);
      });

      it("renders replayed thoughts, tool calls with their updates, and plans as parts of the agent bubble", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "do it", "u1"), undefined);
        replay.append(replayText("agent_thought_chunk", "thinking", "a1"), undefined);
        replay.append(
          {
            sessionUpdate: "tool_call",
            toolCallId: "t1",
            title: "read",
            kind: "read",
            status: "in_progress",
          },
          undefined
        );
        replay.append(
          { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" },
          undefined
        );
        replay.append(
          {
            sessionUpdate: "plan",
            entries: [{ content: "step", status: "pending", priority: "medium" }],
          },
          undefined
        );
        replay.append(replayText("agent_message_chunk", "done", "a2"), undefined);

        const ai = store.getDisplayMessages()[1];
        expect(store.getDisplayMessages()).toHaveLength(2);
        expect(ai.parts?.map((p) => p.kind)).toEqual(["thought", "tool_call", "plan", "text"]);
        const tool = ai.parts?.find((p) => p.kind === "tool_call");
        expect(tool).toMatchObject({ id: "t1", status: "completed" });
      });

      it("hands each replayed task list to the todo list so the last one stays current", () => {
        const { replay, applyTodoList } = startReplay();
        const entries = [
          { content: "step", status: "completed" as const, priority: "medium" as const },
        ];

        replay.append({ sessionUpdate: "plan", entries }, undefined);

        expect(applyTodoList).toHaveBeenCalledWith(entries);
      });

      it("opens a reply bubble for a replayed compaction that no reply precedes", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "hello", "u1"), undefined);
        replay.append(
          { sessionUpdate: "compaction", id: "c1", status: "completed", trigger: "auto" },
          undefined
        );
        replay.end();

        const [user, reply] = store.getDisplayMessages();
        expect(user.sender).toBe(USER_SENDER);
        expect(reply.sender).toBe(AI_SENDER);
        expect(reply.parts?.map((p) => p.kind)).toEqual(["compaction"]);
      });

      it("upserts a replayed compaction's later status over its earlier one", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "hello", "u1"), undefined);
        replay.append(
          { sessionUpdate: "compaction", id: "c1", status: "in_progress", trigger: "auto" },
          undefined
        );
        replay.append(
          { sessionUpdate: "compaction", id: "c1", status: "completed", trigger: "auto" },
          undefined
        );
        replay.end();

        const parts = store.getDisplayMessages()[1].parts;
        expect(parts).toHaveLength(1);
        expect(parts?.[0]).toMatchObject({ kind: "compaction", status: "completed" });
      });

      it("settles a replayed compaction that never reports an end as cancelled so no spinner shows", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "hello", "u1"), undefined);
        replay.append(
          { sessionUpdate: "compaction", id: "c1", status: "in_progress", trigger: "manual" },
          undefined
        );
        replay.end();

        const parts = store.getDisplayMessages()[1].parts;
        expect(parts?.[0]).toMatchObject({ kind: "compaction", status: "cancelled" });
      });

      it("shows no user bubble for the plugin's own output-limit continuation in a replayed chat", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "Write the note", "u1"), undefined);
        replay.append(replayText("agent_message_chunk", "Writing.", "a1"), undefined);
        replay.append(
          replayText("user_message_chunk", OUTPUT_LIMIT_CONTINUATION_PROMPT, "u2"),
          undefined
        );
        replay.append(replayText("agent_message_chunk", "Done.", "a2"), undefined);
        replay.end();

        expect(bubbles(store).filter((b) => b.sender === USER_SENDER)).toEqual([
          { sender: USER_SENDER, message: "Write the note" },
        ]);
      });

      it("dates replayed bubbles from their frames' times and times the agent's turn from its prompt to its last frame", () => {
        const { store, replay } = startReplay();
        const prompt = Date.parse("2026-10-03T19:31:18.000Z");
        const reply = Date.parse("2026-10-03T19:31:22.000Z");
        const turnEnd = Date.parse("2026-10-03T19:31:30.500Z");

        replay.append(replayText("user_message_chunk", "read it", "u1"), prompt);
        replay.append(replayText("agent_thought_chunk", "reading", "a1"), reply);
        replay.append(
          { sessionUpdate: "tool_call", toolCallId: "t1", title: "read", status: "in_progress" },
          reply + 1_000
        );
        replay.append(
          { sessionUpdate: "tool_call_update", toolCallId: "t1", status: "completed" },
          reply + 2_000
        );
        replay.append(replayText("agent_message_chunk", "done", "a2"), turnEnd);
        replay.end();

        const [user, ai] = store.getDisplayMessages();
        expect(user.timestamp?.epoch).toBe(prompt);
        expect(ai.timestamp?.epoch).toBe(reply);
        expect(ai.turnDurationMs).toBe(turnEnd - prompt);
      });

      it("leaves replayed bubbles undated and untimed when their frames carry no time", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "test", "u1"), undefined);
        replay.append(replayText("agent_message_chunk", "Hello", "a1"), undefined);
        replay.end();

        const messages = store.getDisplayMessages();
        expect(messages.map((m) => m.timestamp)).toEqual([null, null]);
        expect(messages[1].turnDurationMs).toBeUndefined();
      });

      it("schedules a messages notification for each frame that changes the transcript", () => {
        const { replay, scheduleNotifyMessages } = startReplay();

        replay.append(replayText("agent_message_chunk", "Hello", "a1"), undefined);

        expect(scheduleNotifyMessages).toHaveBeenCalled();
      });

      it("leaves a frame that is not part of a turn to the caller", () => {
        const { store, replay } = startReplay();

        expect(
          replay.append(
            { sessionUpdate: "usage_update", usage: { usedTokens: 1, updatedAt: 1 } },
            undefined
          )
        ).toBe(false);
        expect(bubbles(store)).toEqual([]);
      });

      it("leaves every frame to the caller before the replay starts", () => {
        const store = new AgentMessageStore();
        const replay = new SessionHistoryReplay({
          store,
          scheduleNotifyMessages: jest.fn(),
          applyTodoList: jest.fn(),
        });

        expect(replay.append(replayText("agent_message_chunk", "live", "a1"), undefined)).toBe(
          false
        );
        expect(bubbles(store)).toEqual([]);
      });
    });

    describe("end", () => {
      it("shows a replayed user message that was still open when the replay ends", () => {
        const { store, replay } = startReplay();
        replay.append(replayText("user_message_chunk", "earlier", "u1"), undefined);

        replay.end();

        expect(bubbles(store)).toEqual([{ sender: USER_SENDER, message: "earlier" }]);
      });

      it("fails a replayed tool call that never finished once its turn closes", () => {
        const { store, replay } = startReplay();

        replay.append(replayText("user_message_chunk", "Write the note", "u1"), undefined);
        replay.append(
          { sessionUpdate: "tool_call", toolCallId: "w1", title: "write", status: "pending" },
          undefined
        );
        replay.append(replayText("user_message_chunk", "Try again", "u2"), undefined);
        replay.append(
          { sessionUpdate: "tool_call", toolCallId: "w2", title: "write", status: "pending" },
          undefined
        );
        replay.end();

        expect(
          store
            .getDisplayMessages()
            .filter((m) => m.sender === AI_SENDER)
            .map((m) => m.parts)
        ).toEqual([
          [expect.objectContaining({ id: "w1", status: "failed" })],
          [expect.objectContaining({ id: "w2", status: "failed" })],
        ]);
      });

      it("stops taking frames once the replay ends", () => {
        const { store, replay } = startReplay();
        replay.end();

        expect(replay.append(replayText("agent_message_chunk", "live", "a1"), undefined)).toBe(
          false
        );
        expect(bubbles(store)).toEqual([]);
      });
    });
  });
});
