import { AI_SENDER, USER_SENDER } from "@/constants";
import type { AgentTask } from "@/agentMode/session/AgentSession";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import type { AgentChatMessage, PermissionPrompt, QueuedPrompt } from "@/agentMode/session/types";
import type {
  SubagentMessage,
  SubagentMessagePayload,
  SubagentRunSnapshot,
  SubagentSessionSnapshot,
} from "@/agentMode/session/subagentTypes";
import {
  SUBAGENT_RUN_MESSAGE_PREFIX,
  SubagentChatBackend,
  buildSubagentTranscript,
} from "@/agentMode/session/SubagentChatBackend";

const createParent = (overrides: Partial<AgentChatBackend> = {}): AgentChatBackend => ({
  subscribe: jest.fn(() => () => {}),
  sendMessage: jest.fn(),
  acceptsMidTurnMessages: jest.fn(() => true),
  getQueuedPrompts: jest.fn((): readonly QueuedPrompt[] => []),
  canWithdrawMessages: jest.fn(() => false),
  withdrawMessage: jest.fn(async () => {}),
  takeWithdrawnPrompts: jest.fn((): readonly QueuedPrompt[] => []),
  cancel: jest.fn(async () => {}),
  sendWaitingNow: jest.fn(async () => {}),
  deleteMessage: jest.fn(async () => false),
  clearMessages: jest.fn(),
  getMessages: jest.fn((): AgentChatMessage[] => []),
  getTasks: jest.fn((): readonly AgentTask[] => []),
  getTaskMessages: jest.fn((): readonly AgentChatMessage[] => []),
  canStopTasks: jest.fn(() => true),
  stopTask: jest.fn(async () => {}),
  isStarting: jest.fn(() => false),
  isTurnInFlight: jest.fn(() => false),
  isReplyRunning: jest.fn(() => false),
  getBackendState: jest.fn(() => null),
  canSwitchModel: jest.fn(() => false),
  canSwitchEffort: jest.fn(() => false),
  canSwitchMode: jest.fn(() => false),
  resolvePlanProposal: jest.fn(async () => {}),
  getCurrentPlan: jest.fn(() => null),
  getCurrentTodoList: jest.fn(() => null),
  getSessionUsage: jest.fn(() => null),
  getPlanUsage: jest.fn(() => null),
  hasPendingPlanPermission: jest.fn(() => false),
  getPendingToolPermissions: jest.fn((): PermissionPrompt[] => []),
  resolveToolPermission: jest.fn(),
  getPendingAskUserQuestions: jest.fn(() => []),
  resolveAskUserQuestion: jest.fn(),
  ...overrides,
});

const buildRun = (overrides: Partial<SubagentRunSnapshot> = {}): SubagentRunSnapshot => ({
  id: "native-task-1",
  taskGenerationId: "gen-1",
  toolCallId: "call-1",
  status: "completed",
  createdAt: 1000,
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
  ...overrides,
});

const buildSession = (
  overrides: Partial<SubagentSessionSnapshot> = {}
): SubagentSessionSnapshot => ({
  id: "subagent-1",
  parentSessionId: "chat-1",
  name: "Source audit",
  modelId: "model-a",
  cwd: "/vault",
  retention: "retained",
  createdAt: 900,
  updatedAt: 2000,
  runs: [],
  messages: [],
  ...overrides,
});

const buildMessage = (overrides: Partial<SubagentMessage>): SubagentMessage => ({
  id: "m1",
  sequence: 1,
  subagentId: "subagent-1",
  taskGenerationId: "gen-1",
  direction: "to_child",
  sender: "user",
  kind: "instruction",
  text: "hello",
  state: "delivered",
  acceptedAt: 1100,
  ...overrides,
});

const runContent = (id: string, text: string): AgentChatMessage => ({
  id,
  sender: AI_SENDER,
  timestamp: null,
  isVisible: true,
  message: text,
});

describe("SubagentChatBackend", () => {
  describe("buildSubagentTranscript()", () => {
    it("restores note, selection and image display in a delivered message https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const note = { path: "note.md", basename: "note" } as never;
      const message = buildMessage({
        text: "See this",
        payload: {
          context: {
            notes: ["note.md"],
            selectedTextContexts: [
              {
                id: "s",
                sourceType: "note",
                notePath: "note.md",
                noteTitle: "note",
                content: "excerpt",
                startLine: 1,
                endLine: 1,
              },
            ],
          },
          content: [{ type: "image", mimeType: "image/png", data: "YWJj" }],
        },
      });
      const transcript = buildSubagentTranscript(
        buildSession({ messages: [message] }),
        () => [],
        () => note
      );
      expect(transcript[0].context).toMatchObject({
        notes: [note],
        selectedTextContexts: [{ content: "excerpt" }],
      });
      expect(transcript[0].content).toEqual([
        { type: "text", text: "See this" },
        { type: "image_url", image_url: { url: "data:image/png;base64,YWJj" } },
      ]);
    });

    it("renders each run after delivered input and marks parent interjections as notices https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
      const snapshot = buildSession({
        runs: [
          buildRun({ id: "run-1", toolCallId: "call-1", createdAt: 1000 }),
          buildRun({ id: "run-2", toolCallId: "call-2", createdAt: 3000 }),
        ],
        messages: [
          buildMessage({ id: "m0", sequence: 1, text: "Start working", runId: "run-1" }),
          buildMessage({
            id: "m1",
            sequence: 2,
            kind: "question",
            direction: "to_parent",
            sender: "subagent",
            text: "Which folder?",
            runId: "run-1",
          }),
          buildMessage({
            id: "m2",
            sequence: 3,
            text: "Continue with folder B",
            runId: "run-2",
            acceptedAt: 2900,
          }),
        ],
      });
      const readRunMessages = jest.fn((toolCallId: string) =>
        toolCallId === "call-1"
          ? [runContent("a1", "First pass")]
          : [runContent("a2", "Second pass")]
      );
      const transcript = buildSubagentTranscript(snapshot, readRunMessages);
      expect(transcript.map((entry) => entry.message)).toEqual([
        "Start working",
        "First pass",
        expect.stringContaining("Which folder?"),
        "Continue with folder B",
        "Second pass",
      ]);
      expect(transcript[2].message).toMatch(/^Asking the parent agent\n\nWhich folder\?$/);
      expect(transcript[0].sender).toBe(USER_SENDER);
      expect(transcript[1].id).toBe(`${SUBAGENT_RUN_MESSAGE_PREFIX}run-1:a1`);
      expect(transcript[2].sender).toBe(AI_SENDER);
      expect(transcript[2].synthetic).toBe(true);
      expect(transcript[3].id).toBe(`subagent-in:m2`);
      expect(readRunMessages).toHaveBeenCalledWith("call-2");
    });

    it("keeps accepted deliveries and final results out of the transcript", () => {
      const snapshot = buildSession({
        runs: [buildRun({ id: "run-1", toolCallId: "call-1" })],
        messages: [
          buildMessage({ id: "m1", state: "accepted", runId: "run-1" }),
          buildMessage({
            id: "m2",
            kind: "result",
            direction: "to_parent",
            sender: "subagent",
            text: "final",
            runId: "run-1",
          }),
        ],
      });
      const transcript = buildSubagentTranscript(snapshot, () => [runContent("a1", "Work")]);
      expect(transcript.map((entry) => entry.message)).toEqual(["Work"]);
    });

    it("places a progress report at its sending action before the later final reply https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const snapshot = buildSession({
        runs: [buildRun({ id: "run-1", toolCallId: "call-1" })],
        messages: [
          buildMessage({ id: "start", text: "Start", runId: "run-1" }),
          buildMessage({
            id: "progress",
            direction: "to_parent",
            sender: "subagent",
            kind: "progress",
            text: "Working",
            runId: "run-1",
          }),
        ],
      });
      const transcript = buildSubagentTranscript(snapshot, () => [
        {
          ...runContent("a1", "Finished"),
          parts: [
            {
              kind: "tool_call",
              id: "t1",
              title: "Send parent message",
              vendorToolName: "send_parent_message",
              status: "completed",
              input: { text: "Working", kind: "progress" },
            },
            { kind: "tool_call", id: "t2", title: "Run command", status: "completed" },
            { kind: "text", text: "Finished" },
          ],
        },
      ]);
      expect(transcript.map((entry) => entry.message)).toEqual([
        "Start",
        "",
        "Replying to the parent agent\n\nWorking",
        "Finished",
      ]);
      expect(transcript[1].parts?.map((part) => part.kind)).toEqual(["tool_call"]);
      expect(transcript[3].parts?.map((part) => part.kind)).toEqual(["tool_call", "text"]);
    });

    it("places a delivered mid-run instruction after prior progress and before the later reply https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const snapshot = buildSession({
        runs: [buildRun({ id: "run-1", toolCallId: "call-1" })],
        messages: [
          buildMessage({ id: "start", text: "Start", runId: "run-1", deliverySeq: 1 }),
          buildMessage({ id: "steer", text: "Continue", runId: "run-1", deliverySeq: 5 }),
          buildMessage({
            id: "progress",
            direction: "to_parent",
            sender: "subagent",
            kind: "progress",
            text: "Working",
            runId: "run-1",
          }),
        ],
      });
      const transcript = buildSubagentTranscript(snapshot, () => [
        {
          ...runContent("a1", "Finished"),
          parts: [
            {
              kind: "tool_call",
              id: "t1",
              title: "Send parent message",
              vendorToolName: "send_parent_message",
              status: "completed",
              input: { text: "Working", kind: "progress" },
              seq: 3,
            },
            { kind: "text", text: "Finished", segmentSeq: 6, seq: 8 },
          ],
        },
      ]);
      expect(transcript.map((entry) => entry.message)).toEqual([
        "Start",
        "",
        "Replying to the parent agent\n\nWorking",
        "Continue",
        "Finished",
      ]);
    });

    it("retains the old input-first display when saved run content has no comparable sequence https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
      const snapshot = buildSession({
        runs: [buildRun({ id: "run-1", toolCallId: "call-1" })],
        messages: [buildMessage({ text: "Continue", runId: "run-1", deliverySeq: 5 })],
      });
      expect(
        buildSubagentTranscript(snapshot, () => [runContent("a1", "Old content")]).map(
          (entry) => entry.message
        )
      ).toEqual(["Continue", "Old content"]);
    });

    it("flags withdrawn instructions as error-styled user messages", () => {
      const snapshot = buildSession({
        runs: [buildRun({ id: "run-1", toolCallId: "call-1" })],
        messages: [
          buildMessage({ id: "m1", state: "withdrawn", text: "Too late", runId: undefined }),
        ],
      });
      const transcript = buildSubagentTranscript(snapshot, () => []);
      expect(transcript).toHaveLength(1);
      expect(transcript[0].sender).toBe(USER_SENDER);
      expect(transcript[0].isErrorMessage).toBe(true);
      expect(transcript[0].message).toBe("Too late");
    });

    it("anchors messages without a matching run to the first run created after them", () => {
      const snapshot = buildSession({
        runs: [
          buildRun({ id: "run-1", toolCallId: "call-1", createdAt: 1000 }),
          buildRun({ id: "run-2", toolCallId: "call-2", createdAt: 5000 }),
        ],
        messages: [
          buildMessage({ id: "m1", text: "Early note", runId: undefined, acceptedAt: 2000 }),
          buildMessage({ id: "m2", text: "Trailing note", runId: undefined, acceptedAt: 9000 }),
        ],
      });
      const transcript = buildSubagentTranscript(snapshot, () => []);
      expect(transcript.map((entry) => entry.message)).toEqual(["Early note", "Trailing note"]);
    });
  });

  describe("SubagentChatBackend", () => {
    const backendWithSession = (
      session: SubagentSessionSnapshot,
      overrides: Partial<AgentChatBackend> = {}
    ): { backend: SubagentChatBackend; parent: AgentChatBackend } => {
      const parent = createParent({
        getSubagentSessions: jest.fn(() => [session]),
        ...overrides,
      });
      return { backend: new SubagentChatBackend(parent, session.id), parent };
    };

    describe("getMessages()", () => {
      it("reuses the transcript and unchanged reply slices while one reply grows https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
        const snapshot = buildSession({
          runs: [buildRun()],
          messages: [buildMessage({ id: "instruction", runId: "native-task-1", deliverySeq: 5 })],
        });
        const prefix = { kind: "text" as const, text: "Stable", segmentSeq: 1 };
        let source = [
          {
            ...runContent("answer", "StableNew"),
            parts: [prefix, { kind: "text" as const, text: "New", segmentSeq: 6 }],
          },
        ];
        const { backend } = backendWithSession(snapshot, {
          getTaskMessages: () => source,
          getMessageUsageMetrics: () => ({
            partial: false,
            totalTokens: 12,
            sources: [
              {
                sourceId: "child",
                sourceName: "Audit",
                kind: "subagent",
                purpose: "chat",
                modelId: "model-a",
                modelName: "Model A",
                partial: false,
                totalTokens: 12,
              },
            ],
          }),
        });
        const before = backend.getMessages();
        expect(before.map((message) => message.message)).toEqual(["Stable", "hello", "New"]);
        expect(backend.getMessages()).toBe(before);
        source = [
          {
            ...source[0],
            message: "StableNew text",
            parts: [prefix, { kind: "text" as const, text: "New text", segmentSeq: 6 }],
          },
        ];
        const after = backend.getMessages();
        expect(after.map((message) => message.message)).toEqual(["Stable", "hello", "New text"]);
        expect(after[0]).toBe(before[0]);
        expect(after[1]).toBe(before[1]);
        expect(after[2]).not.toBe(before[2]);
      });

      it("preserves native user messages and the transcript when another child task changes https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
        const snapshot = buildSession({ runs: [buildRun()] });
        const source = [
          {
            id: "native-user",
            sender: USER_SENDER,
            message: "Please check these notes",
            timestamp: null,
            isVisible: true,
          },
          runContent("answer", "The notes are consistent"),
        ];
        let tasks: readonly AgentTask[] = [
          {
            taskId: "other-task",
            toolCallId: "other-call",
            kind: "subagent",
            subagentId: "other-child",
            description: "Another child is working",
            status: "running",
          },
        ];
        const { backend } = backendWithSession(snapshot, {
          getTaskMessages: () => source,
          getTasks: () => tasks,
        });
        const before = backend.getMessages();
        expect(before.map((message) => message.message)).toEqual([
          "Please check these notes",
          "The notes are consistent",
        ]);
        expect(backend.getMessages()).toBe(before);
        tasks = [{ ...tasks[0], status: "completed" }];
        const after = backend.getMessages();
        expect(after[0]).toBe(before[0]);
        expect(after[1]).toBe(before[1]);
        expect(after).toBe(before);
      });

      it("refreshes completion and elapsed time when a run ends without changing its text https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
        let snapshot = buildSession({ runs: [buildRun({ status: "running" })] });
        const source = [runContent("answer", "Answer")];
        const parent = createParent({
          getSubagentSessions: () => [snapshot],
          getTaskMessages: () => source,
        });
        const backend = new SubagentChatBackend(parent, snapshot.id);
        const before = backend.getMessages();
        expect(before[0].turnStopReason).toBeUndefined();
        snapshot = {
          ...snapshot,
          runs: [buildRun({ status: "completed", startedAt: 1000, endedAt: 2000 })],
        };
        expect(backend.getMessages()[0]).toMatchObject({
          message: "Answer",
          turnStopReason: "end_turn",
          turnDurationMs: 1000,
        });
      });

      it("refreshes a reply's usage when cumulative metrics change without text or run changes https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
        const snapshot = buildSession({ runs: [buildRun()] });
        const source = [runContent("answer", "Answer")];
        const tasks = Object.freeze([]);
        let usage = {
          usedTokens: 0,
          updatedAt: 1,
          metrics: { partial: false, sources: [], totalTokens: 4 },
        };
        const { backend } = backendWithSession(snapshot, {
          getTaskMessages: () => source,
          getTasks: () => tasks,
          getSubagentUsage: () => usage,
          getMessageUsageMetrics: () => usage.metrics,
        });
        const before = backend.getMessages();
        expect(before[0].turnMetrics?.totalTokens).toBe(4);
        expect(backend.getMessages()).toBe(before);
        usage = { ...usage, updatedAt: 2, metrics: { ...usage.metrics, totalTokens: 8 } };
        const after = backend.getMessages();
        expect(after[0]).toMatchObject({ message: "Answer", turnMetrics: { totalTokens: 8 } });
        expect(after[0]).not.toBe(before[0]);
        expect(backend.getMessages()).toBe(after);
      });

      it("uses each recorded child round's own completion and elapsed time instead of inheriting the whole run https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const snapshot = buildSession({
          runs: [
            buildRun({
              id: "run-1",
              toolCallId: "call-1",
              roundId: "first",
              startedAt: 1000,
              endedAt: 9000,
            }),
          ],
          messages: [
            buildMessage({ id: "follow-up", runId: "run-1", roundId: "second", deliverySeq: 15 }),
          ],
        });
        const { backend } = backendWithSession(snapshot, {
          getTaskMessages: () => [
            {
              ...runContent("reply", "FirstSecond"),
              turnStopReason: "end_turn",
              turnDurationMs: 8000,
              parts: [
                { kind: "text", text: "First", segmentSeq: 10 },
                { kind: "text", text: "Second", segmentSeq: 20 },
              ],
            },
          ],
          getMessageUsageMetrics: (message) => ({
            roundId: message.parts?.[0]?.segmentSeq === 10 ? "first" : "second",
            roundDurationMs: message.parts?.[0]?.segmentSeq === 10 ? 3000 : 4000,
            roundStopReason: message.parts?.[0]?.segmentSeq === 10 ? "end_turn" : "cancelled",
            partial: false,
            sources: [],
          }),
        });
        const replies = backend.getMessages().filter((message) => message.sender === AI_SENDER);
        expect(replies.map((message) => message.turnDurationMs)).toEqual([3000, 4000]);
        expect(replies.map((message) => message.turnStopReason)).toEqual(["end_turn", "cancelled"]);
      });
      it("keeps slice completion unknown when the only available timing belongs to a multi-round run https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const run = buildRun({ id: "run-1", roundId: "first", startedAt: 1000, endedAt: 9000 });
        const { backend } = backendWithSession(
          buildSession({
            runs: [run],
            messages: [buildMessage({ runId: run.id, roundId: "second", deliverySeq: 15 })],
          }),
          {
            getTaskMessages: () => [
              {
                ...runContent("reply", "FirstSecond"),
                turnStopReason: "end_turn",
                turnDurationMs: 8000,
                parts: [
                  { kind: "text", text: "First", segmentSeq: 10 },
                  { kind: "text", text: "Second", segmentSeq: 20 },
                ],
              },
            ],
            getMessageUsageMetrics: () => undefined,
          }
        );
        for (const reply of backend
          .getMessages()
          .filter((message) => message.sender === AI_SENDER)) {
          expect(reply.turnStopReason).toBeUndefined();
          expect(reply.turnDurationMs).toBeUndefined();
        }
      });
      it("keeps an interrupted run's duration unknown because recovery only records its last known activity https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const { backend } = backendWithSession(
          buildSession({
            runs: [
              buildRun({
                status: "interrupted",
                stopReason: "interrupted",
                startedAt: 1000,
                endedAt: 9000,
              }),
            ],
          }),
          { getTaskMessages: () => [runContent("reply", "Interrupted")] }
        );
        expect(backend.getMessages()[0].turnStopReason).toBe("interrupted");
        expect(backend.getMessages()[0].turnDurationMs).toBeUndefined();
      });
      it("recovers an initial completed run's actual elapsed time while keeping an active or unrecorded run unknown https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const complete = buildRun({
          id: "run-1",
          toolCallId: "call-1",
          startedAt: 1000,
          endedAt: 9000,
        });
        const { backend } = backendWithSession(buildSession({ runs: [complete] }), {
          getTaskMessages: () => [runContent("reply", "Answer")],
        });
        expect(backend.getMessages()[0]).toMatchObject({
          turnStopReason: "end_turn",
          turnDurationMs: 8000,
        });
        const active = backendWithSession(
          buildSession({ runs: [{ ...complete, status: "running" }] }),
          { getTaskMessages: () => [runContent("reply", "Still working")] }
        );
        expect(active.backend.getMessages()[0].turnStopReason).toBeUndefined();
        expect(active.backend.getMessages()[0].turnDurationMs).toBeUndefined();
      });
      it("projects usage independently for reply slices separated by delivered child input https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const snapshot = buildSession({
          runs: [buildRun({ id: "run-1", toolCallId: "call-1" })],
          messages: [
            buildMessage({
              id: "second-input",
              runId: "run-1",
              deliverySeq: 15,
              text: "Follow-up",
            }),
          ],
        });
        const { backend } = backendWithSession(snapshot, {
          getTaskMessages: () => [
            {
              ...runContent("reply", "FirstSecond"),
              parts: [
                { kind: "text", text: "First", segmentSeq: 10 },
                { kind: "text", text: "Second", segmentSeq: 20 },
              ],
              turnMetrics: { totalTokens: 999, partial: false, sources: [] },
            },
          ],
          ...{
            getMessageUsageMetrics: (message: AgentChatMessage) => ({
              totalTokens: message.parts?.[0]?.segmentSeq === 10 ? 10 : 20,
              partial: false,
              sources: [],
            }),
          },
        });
        const replies = backend.getMessages().filter((message) => message.sender === AI_SENDER);
        expect(replies.map((message) => message.message)).toEqual(["First", "Second"]);
        expect(replies.map((message) => message.turnMetrics?.totalTokens)).toEqual([10, 20]);
      });

      it("returns an empty transcript when the child session no longer exists", () => {
        const parent = createParent({ getSubagentSessions: jest.fn(() => []) });
        const backend = new SubagentChatBackend(parent, "subagent-missing");
        expect(backend.getMessages()).toEqual([]);
      });

      it("assembles the child transcript from its runs and mailbox", () => {
        const snapshot = buildSession({
          runs: [buildRun({ id: "run-1", toolCallId: "call-1" })],
          messages: [buildMessage({ id: "m1", text: "Go", runId: "run-1" })],
        });
        const { backend } = backendWithSession(snapshot, {
          getTaskMessages: jest.fn(() => [runContent("a1", "Working")]),
        });
        expect(backend.getMessages().map((entry) => entry.message)).toEqual(["Go", "Working"]);
      });
    });

    describe("sendWaitingNow()", () => {
      it("keeps a plain-text user payload and its message identity through the waiting queue and retry https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
        const snapshot = buildSession({ runs: [buildRun({ status: "running" })] });
        const sendSubagentMessage = jest.fn(
          async (
            _subagentId: string,
            text: string,
            _mode: string,
            id?: string,
            payload?: SubagentMessagePayload
          ) => {
            snapshot.messages = [buildMessage({ id, text, payload, state: "accepted" })];
            return { subagentId: snapshot.id, status: "queued" as const };
          }
        );
        const { backend } = backendWithSession(snapshot, { sendSubagentMessage });
        const input = "请调用MCP工具检查资料。";
        const sent = backend.sendMessage(input);
        await sent.turn;
        const payload = sendSubagentMessage.mock.calls[0][4];
        expect(payload?.content).toEqual([{ type: "text", text: input }]);
        expect(backend.getDeliveringPrompts()).toEqual([{ id: sent.id, text: input }]);
        snapshot.runs = [];
        expect(backend.getHeldPrompts()).toEqual([{ id: sent.id, text: input }]);
        await backend.sendWaitingNow();
        expect(sendSubagentMessage).toHaveBeenNthCalledWith(
          2,
          snapshot.id,
          input,
          "wake",
          sent.id,
          payload
        );
        expect(sendSubagentMessage.mock.calls[1][4]).toBe(payload);
      });
      it("retries the first waiting message with its original identity and attachment (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const payload = {
          content: [{ type: "image" as const, mimeType: "image/png", data: "YWJj" }],
        };
        const waiting = buildMessage({ id: "waiting", state: "accepted", text: "", payload });
        const sendSubagentMessage = jest.fn(async () => ({
          subagentId: "subagent-1",
          status: "queued" as const,
        }));
        const { backend } = backendWithSession(buildSession({ messages: [waiting] }), {
          sendSubagentMessage,
        });
        await backend.sendWaitingNow();
        expect(sendSubagentMessage).toHaveBeenCalledWith(
          "subagent-1",
          "",
          "wake",
          "waiting",
          payload
        );
      });
    });

    describe("sendMessage()", () => {
      it("enqueues plain text as user content while the child is executing https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
        const snapshot = buildSession({
          runs: [buildRun({ id: "run-1", toolCallId: "call-1", status: "running" })],
        });
        const sendSubagentMessage = jest.fn(async () => ({
          subagentId: snapshot.id,
          status: "enqueued" as const,
        }));
        const { backend } = backendWithSession(snapshot, { sendSubagentMessage });
        const { turn } = backend.sendMessage("Steer this", undefined, undefined);
        await turn;
        expect(sendSubagentMessage).toHaveBeenCalledWith(
          snapshot.id,
          "Steer this",
          "enqueue",
          expect.any(String),
          { content: [{ type: "text", text: "Steer this" }], context: undefined }
        );
      });

      it("wakes an idle child with plain text as user content instead of quoted collaboration https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
        const snapshot = buildSession({
          runs: [buildRun({ id: "run-1", toolCallId: "call-1", status: "completed" })],
        });
        const sendSubagentMessage = jest.fn(async () => ({
          subagentId: snapshot.id,
          status: "queued" as const,
        }));
        const { backend } = backendWithSession(snapshot, { sendSubagentMessage });
        const { turn } = backend.sendMessage("Start again");
        await turn;
        expect(sendSubagentMessage).toHaveBeenCalledWith(
          snapshot.id,
          "Start again",
          "wake",
          expect.any(String),
          { content: [{ type: "text", text: "Start again" }], context: undefined }
        );
      });

      it("sends attached note, selection and image content to the child https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const sendSubagentMessage = jest.fn(async () => ({
          subagentId: "subagent-1",
          status: "enqueued" as const,
        }));
        const { backend } = backendWithSession(buildSession(), { sendSubagentMessage });
        const context = {
          notes: [{ path: "note.md" } as never],
          selectedTextContexts: [
            {
              id: "s",
              sourceType: "web" as const,
              title: "Page",
              url: "https://example.com",
              content: "excerpt",
            },
          ],
        };
        await backend.sendMessage("Read", context, [
          { type: "image", mimeType: "image/png", data: "YWJj" },
        ]).turn;
        expect(sendSubagentMessage).toHaveBeenCalledWith(
          "subagent-1",
          "Read",
          "wake",
          expect.any(String),
          expect.objectContaining({
            context: expect.objectContaining({ notes: ["note.md"] }),
            content: expect.arrayContaining([
              expect.objectContaining({ type: "text", text: expect.stringContaining("excerpt") }),
              { type: "image", mimeType: "image/png", data: "YWJj" },
            ]),
          })
        );
      });

      it("rejects archived or removed children without contacting the backend (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const sendSubagentMessage = jest.fn();
        const archived = buildSession({ retention: "archived" });
        const { backend: archivedBackend } = backendWithSession(archived, { sendSubagentMessage });
        await expect(archivedBackend.sendMessage("Continue").turn).rejects.toThrow(/Unarchive/i);
        const { backend: missingBackend } = backendWithSession(buildSession(), {
          getSubagentSessions: jest.fn(() => []),
          sendSubagentMessage,
        });
        await expect(missingBackend.sendMessage("Continue").turn).rejects.toThrow(
          /no longer exists/i
        );
        expect(sendSubagentMessage).not.toHaveBeenCalled();
      });
    });

    describe("getQueuedPrompts()", () => {
      it("keeps waiting prompt identities across reads and unrelated child updates https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
        const pending = buildMessage({ state: "accepted", text: "Continue" });
        let snapshot = buildSession({ messages: [pending] });
        const parent = createParent({ getSubagentSessions: () => [snapshot] });
        const backend = new SubagentChatBackend(parent, snapshot.id);
        const before = backend.getQueuedPrompts();
        expect(backend.getQueuedPrompts()).toBe(before);
        snapshot = { ...snapshot, messages: [pending] };
        expect(backend.getQueuedPrompts()).toBe(before);
        snapshot = { ...snapshot, messages: [{ ...pending, state: "delivered" }] };
        expect(backend.getQueuedPrompts()).toEqual([]);
        expect(backend.getQueuedPrompts()).toBe(backend.getQueuedPrompts());
      });

      it("identifies a pending image-only message https://github.com/ItsDalk-Lane/Scribe/issues/50", () => {
        const message = buildMessage({
          text: "",
          state: "accepted",
          payload: { content: [{ type: "image", mimeType: "image/png", data: "YWJj" }] },
        });
        const { backend } = backendWithSession(buildSession({ messages: [message] }));
        expect(backend.getQueuedPrompts()).toEqual([{ id: "m1", text: "[Image attachment]" }]);
      });

      it("lists only accepted instructions that the child has not read yet", () => {
        const snapshot = buildSession({
          messages: [
            buildMessage({ id: "m1", state: "accepted", text: "Pending" }),
            buildMessage({ id: "m2", state: "delivered", text: "Read" }),
            buildMessage({
              id: "m3",
              state: "accepted",
              direction: "to_parent",
              sender: "subagent",
              kind: "progress",
              text: "From child",
            }),
          ],
        });
        const { backend } = backendWithSession(snapshot);
        expect(backend.getQueuedPrompts()).toEqual([{ id: "m1", text: "Pending" }]);
      });

      it("splits the queue into delivering while running and held while idle", () => {
        const running = buildSession({
          runs: [buildRun({ id: "run-1", toolCallId: "call-1", status: "running" })],
          messages: [buildMessage({ id: "m1", state: "accepted", text: "Steer" })],
        });
        const idle = buildSession({
          runs: [buildRun({ id: "run-1", toolCallId: "call-1", status: "completed" })],
          messages: [buildMessage({ id: "m1", state: "accepted", text: "Steer" })],
        });
        const { backend: runningBackend } = backendWithSession(running);
        expect(runningBackend.getDeliveringPrompts().map((prompt) => prompt.text)).toEqual([
          "Steer",
        ]);
        expect(runningBackend.getHeldPrompts()).toEqual([]);
        const { backend: idleBackend } = backendWithSession(idle);
        expect(idleBackend.getDeliveringPrompts()).toEqual([]);
        expect(idleBackend.getHeldPrompts().map((prompt) => prompt.text)).toEqual(["Steer"]);
      });
    });

    describe("getPendingToolPermissions()", () => {
      it("keeps this child's permission list stable across parent reads and resolves through the parent https://github.com/ItsDalk-Lane/Scribe/issues/72", () => {
        const mine: PermissionPrompt = {
          sessionId: "backend-session",
          requester: { taskId: "native-task-1", subagentId: "subagent-1", subagentName: "Audit" },
          toolCall: {
            toolCallId: "tool-1",
            status: "pending",
            title: "write_note",
            arguments: {},
          } as PermissionPrompt["toolCall"],
          options: [],
        };
        const mainPrompt: PermissionPrompt = {
          sessionId: "backend-session",
          toolCall: mine.toolCall,
          options: [],
        };
        const snapshot = buildSession();
        const resolveToolPermission = jest.fn();
        const { backend } = backendWithSession(snapshot, {
          getPendingToolPermissions: jest.fn(() => [mine, mainPrompt]),
          resolveToolPermission,
        });
        const permissions = backend.getPendingToolPermissions();
        expect(permissions).toEqual([mine]);
        expect(backend.getPendingToolPermissions()).toBe(permissions);
        backend.resolveToolPermission("tool-1", "allow_once");
        expect(resolveToolPermission).toHaveBeenCalledWith("tool-1", "allow_once");
      });
    });

    describe("isReplyRunning()", () => {
      it("reports a live run and stops it through cancel()", async () => {
        const running = buildSession({
          runs: [buildRun({ id: "run-1", toolCallId: "call-1", status: "running" })],
        });
        const stopSubagent = jest.fn(async () => {});
        const { backend } = backendWithSession(running, { stopSubagent });
        expect(backend.isReplyRunning()).toBe(true);
        await backend.cancel();
        expect(stopSubagent).toHaveBeenCalledWith(running.id);
        const idle = buildSession();
        const { backend: idleBackend } = backendWithSession(idle, { stopSubagent });
        expect(idleBackend.isReplyRunning()).toBe(false);
      });
    });

    describe("canWithdrawMessages()", () => {
      it("keeps the withdrawn queue contract empty because deliveries cannot be recalled", () => {
        const { backend } = backendWithSession(buildSession());
        expect(backend.canWithdrawMessages()).toBe(false);
        expect(backend.takeWithdrawnPrompts()).toEqual([]);
      });
    });

    describe("subscribe()", () => {
      it("delegates subscriptions to the parent chat backend", () => {
        const unsubscribe = jest.fn();
        const subscribe = jest.fn(() => unsubscribe);
        const { backend } = backendWithSession(buildSession(), { subscribe });
        const listener = () => {};
        expect(backend.subscribe(listener)).toBe(unsubscribe);
        expect(subscribe).toHaveBeenCalledWith(listener);
      });
    });

    describe("getSessionUsage()", () => {
      it("uses all child calls from the parent projection and preserves its reference https://github.com/ItsDalk-Lane/Scribe/issues/52", () => {
        const usage = {
          usedTokens: 0,
          updatedAt: 1,
          metrics: { totalTokens: 16, steps: 2, partial: true, sources: [] },
        };
        const getSubagentUsage = jest.fn(() => usage);
        const { backend } = backendWithSession(buildSession(), { getSubagentUsage });
        expect(backend.getSessionUsage()).toBe(usage);
        expect(backend.getSessionUsage()).toBe(usage);
        expect(getSubagentUsage).toHaveBeenCalledWith(buildSession().id);
      });
    });
    describe("canSwitchModel()", () => {
      it("disables model, effort and mode switching for the child chat", () => {
        const { backend } = backendWithSession(buildSession());
        expect(backend.canSwitchModel()).toBe(false);
        expect(backend.canSwitchEffort()).toBe(false);
        expect(backend.canSwitchMode()).toBe(false);
        expect(backend.getCurrentPlan()).toBeNull();
        expect(backend.getSessionUsage()).toBeNull();
        expect(backend.getTasks()).toEqual([]);
      });
    });
  });
});
