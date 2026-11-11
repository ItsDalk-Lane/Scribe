import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Context, JsonObject } from "@earendil-works/pi-ai";
import { obj } from "@earendil-works/pi-schema";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import type { AgentStreamOptions, ProviderChatModel } from "@/LLMProviders/piChatModel";
import type { ModelCallMetrics } from "@/LLMProviders/modelUsageMetrics";
import {
  NativeBackendProcess,
  type NativeSessionStorage,
  type NativeToolContext,
} from "@/agentMode/sdk/NativeBackendProcess";
import { defineNativeTool, NATIVE_PERMISSION_OPTIONS } from "@/agentMode/sdk/nativeToolDefinition";
import {
  JournalConfirmationTimeout,
  type JournalAppendOptions,
  type JournalRecord,
} from "@/agentMode/sdk/JournalStorage";
import { t } from "@/lib/i18n";
import { NodeAttachmentStorage } from "@/agentMode/sdk/AttachmentStorage";
import { NodeJournalStorage } from "@/agentMode/sdk/JournalStorage";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import type { CompactionSnapshot, SessionEvent } from "@/agentMode/session/types";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { USER_SENDER } from "@/constants";

const nodeFs = jest.requireActual<typeof import("node:fs/promises")>("node:fs/promises");

const MODEL = {
  id: "journal-fixture",
  name: "Journal fixture",
  api: "openai-completions" as const,
  provider: "fixture",
  baseUrl: "http://localhost/fixture",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 2000,
  maxTokens: 200,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function reply(
  text: string,
  calls: Array<{ id: string; name: string; arguments: JsonObject }> = [],
  usedTokens = 0
) {
  const stream = createAssistantMessageEventStream();
  const message = createAssistantMessage(MODEL);
  message.content = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...calls.map((call) => ({ type: "toolCall" as const, ...call })),
  ];
  message.stopReason = calls.length ? "toolUse" : "stop";
  message.usage.totalTokens = usedTokens;
  stream.push({ type: "start", partial: message });
  if (text) stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
  stream.push({ type: "done", reason: message.stopReason, message });
  return stream;
}

function usageFact(): ModelCallMetrics {
  return {
    id: "usage-call",
    requestIds: ["usage-request"],
    status: "completed",
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  };
}

function isUsageFact(kind: string, payload: unknown): boolean {
  return (
    kind === "event" &&
    (payload as { update: { sessionUpdate: string } }).update.sessionUpdate === "model_call_metrics"
  );
}

function isTurnEnded(entry: JournalRecord): boolean {
  return (
    entry.kind === "event" &&
    (entry.payload as { update: { sessionUpdate: string } }).update.sessionUpdate === "turn_ended"
  );
}

const CONFIRMATION_STOPPED =
  "The chat save was not confirmed in time, so this step was stopped before it ran. Check the disk, then try again.";

function reportUsageWithoutAwaiting(agentOptions: AgentStreamOptions): void {
  void Promise.resolve(agentOptions.onCallMetrics?.(usageFact())).catch(() => {});
}

function fixture(
  options: {
    request?: (context: Context, agentOptions: AgentStreamOptions) => ReturnType<typeof reply>;
    beforeAppend?: (
      kind: string,
      payload: unknown,
      options?: JournalAppendOptions
    ) => Promise<void>;
    afterAppend?: (record: JournalRecord) => void;
    beforeSave?: () => Promise<void> | void;
    beforeFlush?: () => Promise<void> | void;
    createTools?: (context: NativeToolContext) => AgentTool[];
    storage?: NativeSessionStorage;
  } = {}
) {
  const entries: JournalRecord[] = [];
  const requests: Context[] = [];
  let pending = Promise.resolve();
  const storage: NativeSessionStorage = {
    load: async () => null,
    list: async () => [],
    save: async () => {
      await pending;
      await options.beforeSave?.();
    },
    append: (_id, kind, payload, appendOptions) => {
      const operation = pending.then(async () => {
        await options.beforeAppend?.(kind, payload, appendOptions);
        const entry: JournalRecord = {
          version: 2,
          seq: entries.length,
          kind,
          payload: JSON.parse(JSON.stringify(payload)),
          occurredAt: Date.now(),
          origin: appendOptions?.origin ?? "observed",
        };
        entries.push(entry);
        options.afterAppend?.(entry);
        return entry;
      });
      pending = operation.then(
        () => {},
        () => {}
      );
      return operation;
    },
    flush: async () => {
      await options.beforeFlush?.();
      return pending;
    },
  };
  const provider: ProviderChatModel = {
    model: MODEL,
    stream: () => reply("unused"),
    agentStream: (context, agentOptions = {}) => {
      const captured: Context = JSON.parse(JSON.stringify(context));
      requests.push(captured);
      return options.request?.(captured, agentOptions) ?? reply("Done");
    },
  };
  const createModel = jest.fn(async () => provider);
  const process = new NativeBackendProcess({
    getModels: () => [
      { baseModelId: MODEL.id, name: MODEL.name, provider: MODEL.provider, effortOptions: [] },
    ],
    getDefaultModelId: () => MODEL.id,
    createModel,
    getSystemPrompt: async () => "Obsidian fixture assistant",
    createTools: (context) => ({ tools: options.createTools?.(context) ?? [] }),
    storage: options.storage ?? storage,
  });
  process.setPermissionPrompter(async () => ({
    outcome: { outcome: "selected", optionId: "allow_once" },
  }));
  const open = async () => (await process.newSession({ cwd: "/fixture/vault" })).sessionId;
  const send = (sessionId: string, promptId: string, text: string) =>
    process.prompt({ sessionId, promptId, prompt: [{ type: "text", text }] });
  return { process, entries, requests, storage, open, send, createModel };
}

describe("NativeBackendProcess.journal", () => {
  describe("NativeBackendProcess", () => {
    describe("prompt()", () => {
      it("waits for a new turn's durable admission when the previous task is closing https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const closing = deferred();
        const finishClosing = deferred();
        const newAdmission = deferred();
        const finishAdmission = deferred();
        const secondStarted = deferred();
        let closingFirstTask = false;
        let requestNumber = 0;
        const f = fixture({
          beforeAppend: async (kind, payload) => {
            if (kind !== "subagent_task") return;
            const { task } = payload as { task: { active: boolean; requestIds: string[] } };
            if (!task.active && !closingFirstTask) {
              closingFirstTask = true;
              closing.resolve();
              await finishClosing.promise;
            } else if (closingFirstTask && task.active && !task.requestIds.length) {
              newAdmission.resolve();
              await finishAdmission.promise;
            }
          },
          request: (_context, options) => {
            const stream = createAssistantMessageEventStream();
            const requestId = `request-${++requestNumber}`;
            void (async () => {
              try {
                await options.beforeRequest?.(requestId);
                for await (const event of reply(requestId)) stream.push(event);
              } catch (error) {
                const message = createAssistantMessage(MODEL);
                message.stopReason = "error";
                message.errorMessage = error instanceof Error ? error.message : String(error);
                stream.push({ type: "error", reason: "error", error: message });
              }
            })();
            return stream;
          },
        });
        const id = await f.open();
        const first = f.send(id, "first", "First task");
        await closing.promise;
        const createModel = f.createModel.getMockImplementation()!;
        f.createModel.mockImplementation(async () => {
          secondStarted.resolve();
          return createModel();
        });
        const second = f.send(id, "second", "Next task");
        finishClosing.resolve();
        await newAdmission.promise;
        const beforeAdmission = await Promise.race([
          first.then(() => "first closed"),
          secondStarted.promise.then(() => "second started early"),
        ]);
        finishAdmission.resolve();
        await Promise.all([first, second]);
        expect(beforeAdmission).toBe("first closed");
        const requests = f.entries
          .filter((entry) => entry.kind === "request_context")
          .map((entry) => entry.payload as { promptId: string; taskGenerationId: string });
        expect(requests.map((request) => request.promptId)).toEqual(["first", "second"]);
        expect(requests[0].taskGenerationId).not.toBe(requests[1].taskGenerationId);
        expect(
          f.entries
            .filter(isTurnEnded)
            .map((entry) => (entry.payload as { update: { stopReason: string } }).update.stopReason)
        ).toEqual(["end_turn", "end_turn"]);
      });

      it("keeps the active turn in charge of its steering while an older turn finishes saving https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const closing = deferred();
        const finishClosing = deferred();
        const secondStarted = deferred();
        const overlappingRun = deferred();
        const secondStream = createAssistantMessageEventStream();
        let firstEnded = false;
        let heldSave = false;
        let step = 0;
        const f = fixture({
          afterAppend: (entry) => {
            if (isTurnEnded(entry)) firstEnded = true;
          },
          beforeSave: async () => {
            if (!firstEnded || heldSave) return;
            heldSave = true;
            closing.resolve();
            await finishClosing.promise;
          },
          request: () => {
            if (++step === 2) {
              secondStarted.resolve();
              return secondStream;
            }
            return reply("Done");
          },
        });
        const id = await f.open();
        const first = f.send(id, "first", "First request");
        await closing.promise;
        const second = f.send(id, "second", "Second request");
        await secondStarted.promise;
        await f.send(id, "steering", "Steering for the second request");
        const createModel = f.createModel.getMockImplementation()!;
        f.createModel.mockImplementation(async () => {
          overlappingRun.resolve();
          return createModel();
        });
        finishClosing.resolve();
        const whileSecondActive = await Promise.race([
          first.then(() => "first closed"),
          overlappingRun.promise.then(() => "another run started"),
        ]);
        const message = createAssistantMessage(MODEL);
        message.stopReason = "stop";
        secondStream.push({ type: "done", reason: "stop", message });
        await Promise.all([first, second]);
        expect(whileSecondActive).toBe("first closed");
        expect(
          f.entries
            .filter(isTurnEnded)
            .map(
              (entry) =>
                (entry.payload as { update: { turnId: string; stopReason: string } }).update
            )
        ).toEqual([
          expect.objectContaining({ turnId: "first", stopReason: "end_turn" }),
          expect.objectContaining({ turnId: "second", stopReason: "end_turn" }),
          expect.objectContaining({ turnId: "steering", stopReason: "end_turn" }),
        ]);
      });

      it("settles both delivered steering rounds and keeps the newer command on its actual round https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
        const started = deferred();
        const initial = createAssistantMessageEventStream();
        let calls = 0;
        const f = fixture({
          request: () => {
            calls++;
            if (calls === 1) {
              started.resolve();
              return initial;
            }
            if (calls === 2) return reply("", [{ id: "command", name: "inspect", arguments: {} }]);
            return reply("Complete");
          },
          createTools: (context) => [
            defineNativeTool(
              "inspect",
              "Inspect",
              "Inspect fixture",
              obj({}),
              async (toolCallId) => {
                context.emit({
                  sessionUpdate: "task_started",
                  taskId: "background-command",
                  toolCallId,
                  kind: "command",
                  description: "Inspect fixture",
                });
                context.emit({
                  sessionUpdate: "task_ended",
                  taskId: "background-command",
                  status: "completed",
                });
                return { content: [{ type: "text", text: "Complete" }], details: undefined };
              },
              { kind: "read" }
            ),
          ],
        });
        const id = await f.open();
        const first = f.send(id, "p1", "First");
        await started.promise;
        await f.send(id, "p2", "Steering input");
        const message = createAssistantMessage(MODEL);
        message.stopReason = "stop";
        initial.push({ type: "done", reason: "stop", message });
        await first;
        const events = f.entries
          .filter((entry) => entry.kind === "event")
          .map((entry) => (entry.payload as SessionEvent).update);
        const ended = events.filter((update) => update.sessionUpdate === "turn_ended");
        expect(ended.map((update) => update.turnId)).toEqual(["p1", "p2"]);
        expect(new Set(ended.map((update) => update.roundId)).size).toBe(2);
        const newerRound = ended.find((update) => update.turnId === "p2")?.roundId;
        expect(events).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "tool_execution_started",
            roundId: newerRound,
            toolCallId: "p2:command",
          })
        );
        expect(events).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "task_started",
            roundId: newerRound,
            toolCallId: "p2:command",
          })
        );
        await f.process.shutdown();
      });

      it.each([null, "An outdated streamed prefix"])(
        "displays the finalized answer used by later requests when streamed text was %s",
        async (delta) => {
          const finalText = "THE COMPLETE FINAL ANSWER";
          const f = fixture({
            request: () => {
              const stream = createAssistantMessageEventStream();
              const partial = createAssistantMessage(MODEL);
              partial.content = delta ? [{ type: "text", text: delta }] : [];
              stream.push({ type: "start", partial });
              if (delta) stream.push({ type: "text_delta", contentIndex: 0, delta, partial });
              const final = createAssistantMessage(MODEL);
              final.content = [{ type: "text", text: finalText }];
              final.stopReason = "stop";
              stream.push({ type: "done", reason: "stop", message: final });
              return stream;
            },
          });
          const displayed = AgentSession.start({
            backend: f.process,
            cwd: "/fixture/vault",
            internalId: "finalized-answer",
            backendId: "native",
          });
          try {
            await displayed.ready;
            await displayed.sendPrompt("Explain the note").turn;
            const shown = displayed.store
              .getDisplayMessages()
              .filter((message) => message.sender !== USER_SENDER)
              .map((message) => message.message)
              .join("");
            await displayed.sendPrompt("Continue using the answer").turn;

            expect(JSON.stringify(f.requests[1].messages)).toContain(finalText);
            expect(shown).toBe(finalText);
          } finally {
            await displayed.dispose();
          }
        }
      );

      it("waits for durable acceptance before issuing a model request", async () => {
        const accepting = deferred();
        const durable = deferred();
        const f = fixture({
          beforeAppend: async (kind, _payload, options) => {
            if (kind !== "user_accepted") return;
            expect(options?.durable).toBe(true);
            accepting.resolve();
            await durable.promise;
          },
        });
        const id = await f.open();
        const running = f.send(id, "first", "Keep this accepted request");
        await accepting.promise;
        expect(f.requests).toHaveLength(0);
        durable.resolve();
        await running;
        expect(f.entries.find((entry) => entry.kind === "user_accepted")?.payload).toMatchObject({
          promptId: "first",
          message: { content: [{ type: "text", text: "Keep this accepted request" }] },
        });
        expect(f.requests).toHaveLength(1);
      });

      it("waits for durable permission before a tool can change a file", async () => {
        const admitting = deferred();
        const durable = deferred();
        let changed = false;
        let normalRequests = 0;
        const f = fixture({
          request: () =>
            ++normalRequests === 1
              ? reply("", [{ id: "write", name: "write_note", arguments: {} }])
              : reply("Saved"),
          beforeAppend: async (kind, _payload, options) => {
            if (kind !== "tool_admitted") return;
            expect(options?.durable).toBe(true);
            admitting.resolve();
            await durable.promise;
          },
          createTools: (context) => [
            defineNativeTool(
              "write_note",
              "Write",
              "Write fixture",
              obj({}),
              async (id) => {
                await context.requestPermission({
                  sessionId: context.sessionId,
                  toolCall: { toolCallId: id, title: "Write fixture", kind: "edit" },
                  options: [...NATIVE_PERMISSION_OPTIONS],
                });
                changed = true;
                return { content: [{ type: "text", text: "Saved fixture" }], details: undefined };
              },
              { kind: "edit" }
            ),
          ],
        });
        const id = await f.open();
        const running = f.send(id, "first", "Save a note");
        await admitting.promise;
        expect(changed).toBe(false);
        durable.resolve();
        await running;
        expect(changed).toBe(true);
        expect(f.entries.find((entry) => entry.kind === "tool_result")?.payload).toMatchObject({
          message: { toolCallId: "write", content: [{ type: "text", text: "Saved fixture" }] },
        });
        expect(normalRequests).toBe(2);
      });

      it("accepts one copy when the same prompt is submitted again before its first save completes", async () => {
        const accepting = deferred();
        const durable = deferred();
        const f = fixture({
          beforeAppend: async (kind) => {
            if (kind !== "user_accepted") return;
            accepting.resolve();
            await durable.promise;
          },
        });
        const id = await f.open();
        const first = f.send(id, "same", "A single accepted request");
        await accepting.promise;
        const duplicate = f.send(id, "same", "A single accepted request");
        durable.resolve();
        await Promise.all([first, duplicate]);
        expect(f.entries.filter((entry) => entry.kind === "user_accepted")).toHaveLength(1);
        expect(f.requests).toHaveLength(1);
      });

      it("saves a finished parallel tool result while another tool is still running", async () => {
        const fastSaved = deferred();
        const slow = deferred();
        let normalRequests = 0;
        const f = fixture({
          request: () =>
            ++normalRequests === 1
              ? reply("", [
                  { id: "fast-call", name: "fast", arguments: {} },
                  { id: "slow-call", name: "slow", arguments: {} },
                ])
              : reply("Both finished"),
          afterAppend: ({ kind, payload }) => {
            if (
              kind === "tool_result" &&
              (payload as { message: { toolCallId: string } }).message.toolCallId === "fast-call"
            )
              fastSaved.resolve();
          },
          createTools: () => [
            defineNativeTool(
              "fast",
              "Fast",
              "Fast fixture",
              obj({}),
              async () => ({
                content: [{ type: "text", text: "Fast result" }],
                details: undefined,
              }),
              { kind: "read" }
            ),
            defineNativeTool(
              "slow",
              "Slow",
              "Slow fixture",
              obj({}),
              async () => {
                await slow.promise;
                return { content: [{ type: "text", text: "Slow result" }], details: undefined };
              },
              { kind: "read" }
            ),
          ],
        });
        const id = await f.open();
        const running = f.send(id, "parallel", "Run both");
        await fastSaved.promise;
        expect(normalRequests).toBe(1);
        expect(
          f.entries.find(
            (entry) =>
              entry.kind === "tool_result" &&
              (entry.payload as { message: { toolCallId: string } }).message.toolCallId ===
                "fast-call"
          )?.payload
        ).toMatchObject({
          message: { content: [{ type: "text", text: "Fast result" }] },
        });
        expect(
          f.entries.some(
            (entry) =>
              entry.kind === "tool_result" &&
              (entry.payload as { message: { toolCallId: string } }).message.toolCallId ===
                "slow-call"
          )
        ).toBe(false);
        slow.resolve();
        await running;
        expect(f.entries.filter((entry) => entry.kind === "tool_result")).toHaveLength(2);
        expect(normalRequests).toBe(2);
      });

      it("retains the current request and completed tools on every request after automatic compaction", async () => {
        let normalRequests = 0;
        const normalContexts: Context[] = [];
        const f = fixture({
          request: (context) => {
            if (JSON.stringify(context.messages).includes("Summarize this recorded Obsidian"))
              return reply("Earlier original history was reviewed.");
            normalContexts.push(context);
            normalRequests++;
            if (normalRequests === 1) return reply("Earlier original answer. ".repeat(1400));
            if (normalRequests === 2)
              return reply("", [{ id: "read", name: "read_note", arguments: {} }]);
            return reply("The current request is complete.");
          },
          createTools: () => [
            defineNativeTool(
              "read_note",
              "Read",
              "Read fixture",
              obj({}),
              async () => ({
                content: [{ type: "text", text: "ACTUAL TOOL RESULT" }],
                details: undefined,
              }),
              { kind: "read" }
            ),
          ],
        });
        const id = await f.open();
        await f.send(id, "first", "Earlier request");
        await f.send(id, "second", "CURRENT REQUEST: inspect the note");
        expect(normalContexts).toHaveLength(3);
        expect(JSON.stringify(normalContexts[1].messages)).toContain(
          "CURRENT REQUEST: inspect the note"
        );
        expect(JSON.stringify(normalContexts[2].messages)).toContain(
          "CURRENT REQUEST: inspect the note"
        );
        expect(JSON.stringify(normalContexts[2].messages)).toContain("ACTUAL TOOL RESULT");
        expect(f.entries.filter((entry) => entry.kind === "compaction").length).toBeGreaterThan(0);
        expect(
          f.entries.some(
            (entry) =>
              entry.kind === "protocol_message" &&
              JSON.stringify(entry.payload).includes("Earlier original answer.")
          )
        ).toBe(true);
      });

      it("recompresses from the verified summary plus the new history suffix instead of the full original record (https://github.com/ItsDalk-Lane/Scribe/issues/63)", async () => {
        const summaries: string[] = [];
        const f = fixture({
          request: (context) => {
            const content = JSON.stringify(context.messages);
            if (!content.includes("Summarize this recorded Obsidian"))
              return reply("ORIGINAL ANSWER TO KEEP");
            summaries.push(content);
            return reply(`DERIVED SUMMARY ${summaries.length}`);
          },
        });
        const id = await f.open();
        await f.send(id, "first", "ORIGINAL USER REQUEST");
        await f.send(id, "compact-one", "/compact");
        await f.send(id, "compact-two", "/compact");
        expect(summaries).toHaveLength(2);
        // 第二次压缩以「已验证摘要 + 新增区间」取料；记录仍覆盖原始全量坐标供投影命中。https://github.com/ItsDalk-Lane/Scribe/issues/63
        expect(summaries[1]).toContain("DERIVED SUMMARY 1");
        expect(summaries[1]).not.toContain("ORIGINAL USER REQUEST");
        expect(summaries[1]).not.toContain("ORIGINAL ANSWER TO KEEP");
        expect(f.entries.filter((entry) => entry.kind === "compaction")).toHaveLength(2);
      });

      it.each([2, 3])(
        "includes retained requirements after %i tool rounds and reopening the chat (https://github.com/ItsDalk-Lane/Scribe/issues/63)",
        async (toolRounds) => {
          const root = await mkdtemp(join(tmpdir(), "scribe-compaction-"));
          const storage = new NodeNativeSessionStorage(root);
          const summaries: string[] = [];
          const requirement = "Keep original names; do not rename notes";
          let normal = 0;
          const f = fixture({
            storage,
            request: (context) => {
              const content = JSON.stringify(context.messages);
              if (content.includes("Summarize this recorded Obsidian")) {
                summaries.push(content);
                return reply(
                  content.includes(requirement)
                    ? `Merged summary: ${requirement}`
                    : "Earlier tool work summary"
                );
              }
              normal++;
              if (normal <= toolRounds) {
                return reply(
                  "",
                  [{ id: `read-${normal}`, name: "read_note", arguments: {} }],
                  normal === 1 ? 100 : 1500
                );
              }
              return reply("Finished");
            },
            createTools: () => [
              defineNativeTool(
                "read_note",
                "Read",
                "Read fixture",
                obj({}),
                async (id) => ({
                  content: [
                    { type: "text", text: `${id}: ` + "earlier note contents ".repeat(70) },
                  ],
                  details: undefined,
                }),
                { kind: "read" }
              ),
            ],
          });
          try {
            const id = await f.open();
            await f.send(id, "original-requirement", requirement);
            expect(normal).toBe(toolRounds + 1);
            expect(summaries).toHaveLength(1);
            for (const summary of summaries) expect(summary).not.toContain(requirement);
            const saved = await storage.load(id);
            expect(
              saved?.journalRecords?.findLast((entry) => entry.kind === "compaction")?.payload
            ).toMatchObject({ preservedIndices: [0] });
            await f.process.closeSession({ sessionId: id });
            await f.process.loadSession({ sessionId: id, cwd: "/fixture/vault" });
            await f.send(id, "manual-compact", "/compact");
            expect(summaries).toHaveLength(2);
            expect(summaries.at(-1)).toContain("Earlier tool work summary");
            expect(summaries.at(-1)).toContain(requirement);
            expect(summaries.at(-1)).not.toContain("read-1:");
            await f.send(id, "continue", "Continue following my requirements");
            expect(JSON.stringify(f.requests.at(-1)?.messages)).toContain(requirement);
          } finally {
            await f.process.shutdown();
            await rm(root, { recursive: true, force: true });
          }
        }
      );

      it("stops before a file change when its execution admission cannot be saved", async () => {
        let changed = false;
        const f = fixture({
          request: () => reply("", [{ id: "write", name: "write_note", arguments: {} }]),
          beforeAppend: async (kind) => {
            if (kind === "tool_admitted") throw new Error("Disk unavailable");
          },
          createTools: (context) => [
            defineNativeTool(
              "write_note",
              "Write",
              "Write fixture",
              obj({}),
              async (id) => {
                await context.requestPermission({
                  sessionId: context.sessionId,
                  toolCall: { toolCallId: id, title: "Write fixture", kind: "edit" },
                  options: [...NATIVE_PERMISSION_OPTIONS],
                });
                changed = true;
                return { content: [{ type: "text", text: "Saved" }], details: undefined };
              },
              { kind: "edit" }
            ),
          ],
        });
        const id = await f.open();
        await expect(f.send(id, "write", "Write a note")).rejects.toThrow("Disk unavailable");
        expect(changed).toBe(false);
        expect(f.requests).toHaveLength(1);
        expect(f.entries.some((entry) => entry.kind === "tool_result")).toBe(false);
      });

      it("keeps the reply and later prompts running when a usage fact cannot be saved https://github.com/ItsDalk-Lane/Scribe/issues/55", async () => {
        let usageAttempts = 0;
        const f = fixture({
          request: (_context, agentOptions) => {
            reportUsageWithoutAwaiting(agentOptions);
            return reply("Answer");
          },
          beforeAppend: async (kind, payload) => {
            if (!isUsageFact(kind, payload)) return;
            usageAttempts++;
            throw new Error("Disk unavailable");
          },
        });
        const id = await f.open();
        await f.send(id, "first", "Hello");
        await expect(f.send(id, "second", "Again")).resolves.toBeUndefined();
        expect(usageAttempts).toBe(2);
        expect(f.requests).toHaveLength(2);
      });

      it("shows sixty streamed chunks and settles Stop within a fixed deadline while usage storage remains stalled, then recovers ordered storage (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        const directory = await mkdtemp(join(tmpdir(), "scribe-stalled-usage-"));
        // 恢复阶段走真实磁盘，1s 上限给 CI 慢盘留出余量；停滞侧由 held 无限期挂起触发同一超时路径。
        // https://github.com/ItsDalk-Lane/Scribe/issues/55
        const journal = new NodeJournalStorage(directory, 1_000);
        const storage = new NodeNativeSessionStorage(journal);
        const f = fixture({
          storage,
          request: (_context, options) => {
            for (let index = 0; index < 60; index++) reportUsageWithoutAwaiting(options);
            const stream = createAssistantMessageEventStream();
            const message = createAssistantMessage(MODEL);
            message.content = [{ type: "text", text: "部分正文".repeat(60) }];
            message.stopReason = "stop";
            stream.push({ type: "start", partial: message });
            for (let index = 0; index < 60; index++)
              stream.push({
                type: "text_delta",
                contentIndex: 0,
                delta: "部分正文",
                partial: message,
              });
            stream.push({ type: "done", reason: "stop", message });
            return stream;
          },
        });
        const held = deferred();
        const started = deferred();
        const displayed = deferred();
        const events: SessionEvent[] = [];
        let running: Promise<unknown> | undefined;
        try {
          const id = await f.open();
          const originalOpen = nodeFs.open;
          let stalled = false;
          jest
            .spyOn(nodeFs, "open")
            .mockImplementation(async (...args: Parameters<typeof nodeFs.open>) => {
              const handle = await originalOpen(...args);
              if (args[0] === join(directory, `${id}.jsonl`)) {
                const write = handle.write.bind(handle);
                jest
                  .spyOn(handle, "write")
                  .mockImplementation(async (...values: Parameters<typeof handle.write>) => {
                    if (
                      !stalled &&
                      new TextDecoder()
                        .decode(values[0] as unknown as Uint8Array)
                        .includes('"sessionUpdate":"model_call_metrics"')
                    ) {
                      stalled = true;
                      started.resolve();
                      await held.promise;
                    }
                    return write(...values);
                  });
              }
              return handle;
            });
          jest.useFakeTimers();
          f.process.registerSessionHandler(id, (event) => {
            events.push(event);
            if (event.update.sessionUpdate === "agent_message_chunk") displayed.resolve();
          });
          running = f.send(id, "first", "Hello").catch((error: unknown) => error);
          await started.promise;
          await jest.advanceTimersByTimeAsync(1_001);
          await displayed.promise;
          const stopStartedAt = Date.now();
          const stopping = f.process.cancel({ sessionId: id });
          let stopSettledAt = Infinity;
          const settled = Promise.allSettled([running, stopping]).then((results) => {
            stopSettledAt = Date.now();
            return results;
          });
          await jest.advanceTimersByTimeAsync(4_000);
          const results = await settled;
          expect(stopSettledAt - stopStartedAt).toBeLessThanOrEqual(4_000);
          expect(results[1]).toMatchObject({
            status: "rejected",
            reason: expect.objectContaining({ name: "JournalConfirmationTimeout" }),
          });
          expect(
            events.filter((event) => event.update.sessionUpdate === "agent_message_chunk")
          ).toHaveLength(60);
          expect(
            events
              .filter((event) => event.update.sessionUpdate === "agent_message_chunk")
              .every((event) => event.seq === undefined)
          ).toBe(true);
          held.resolve();
          jest.useRealTimers();
          jest.restoreAllMocks();
          await journal.flush(id);
          await expect(f.send(id, "retry", "Continue")).resolves.toBeUndefined();
          const restored = await new NodeJournalStorage(directory).read(id);
          expect(restored.writable).toBe(true);
          expect(restored.records.map((entry) => entry.seq)).toEqual(
            restored.records.map((_entry, index) => index)
          );
          expect(f.requests).toHaveLength(2);
        } finally {
          held.resolve();
          jest.useRealTimers();
          jest.restoreAllMocks();
          await running;
          await f.process.shutdown();
          await rm(directory, { recursive: true, force: true });
        }
      });

      it("stops a request whose disk confirmation runs out of time and sends it after a retry (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        let stalled = false;
        const f = fixture({
          beforeFlush: () => {
            if (!stalled) return;
            stalled = false;
            throw new JournalConfirmationTimeout(30_000);
          },
        });
        const id = await f.open();
        stalled = true;
        await f.send(id, "first", "Hello");
        expect(f.requests).toHaveLength(0);
        expect(
          f.entries.some((entry) => JSON.stringify(entry.payload).includes(t(CONFIRMATION_STOPPED)))
        ).toBe(true);
        await expect(f.send(id, "second", "Again")).resolves.toBeUndefined();
        expect(f.requests).toHaveLength(1);
      });

      it("stops a file change whose admission confirmation runs out of time and keeps the chat usable (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        let changed = false;
        let stalled = false;
        let calls = 0;
        const f = fixture({
          request: () =>
            calls++ === 0
              ? reply("", [{ id: "write", name: "write_note", arguments: {} }])
              : reply("Done"),
          beforeAppend: async (kind) => {
            if (!stalled || kind !== "tool_admitted") return;
            stalled = false;
            throw new JournalConfirmationTimeout(30_000);
          },
          createTools: (context) => [
            defineNativeTool(
              "write_note",
              "Write",
              "Write fixture",
              obj({}),
              async (id) => {
                await context.requestPermission({
                  sessionId: context.sessionId,
                  toolCall: { toolCallId: id, title: "Write fixture", kind: "edit" },
                  options: [...NATIVE_PERMISSION_OPTIONS],
                });
                changed = true;
                return { content: [{ type: "text", text: "Saved" }], details: undefined };
              },
              { kind: "edit" }
            ),
          ],
        });
        const id = await f.open();
        stalled = true;
        await f.send(id, "write", "Write a note");
        expect(changed).toBe(false);
        expect(
          f.requests.some((context) =>
            JSON.stringify(context.messages).includes(t(CONFIRMATION_STOPPED))
          )
        ).toBe(true);
        await expect(f.send(id, "again", "Again")).resolves.toBeUndefined();
        expect(f.requests).toHaveLength(3);
      });

      it("starts a disk confirmation after a finished turn without holding the turn open (https://github.com/ItsDalk-Lane/Scribe/issues/55)", async () => {
        let turnEnded = false;
        let backgroundConfirmations = 0;
        const f = fixture({
          afterAppend: (entry) => {
            if (isTurnEnded(entry)) turnEnded = true;
          },
          beforeFlush: () => {
            if (!turnEnded) return;
            backgroundConfirmations++;
            return new Promise<void>(() => {});
          },
        });
        const id = await f.open();
        await f.send(id, "first", "Hello");
        expect(backgroundConfirmations).toBeGreaterThan(0);
      });

      it("saves usage facts without forcing a disk sync https://github.com/ItsDalk-Lane/Scribe/issues/55", async () => {
        const usageSaves: Array<JournalAppendOptions | undefined> = [];
        const f = fixture({
          request: (_context, agentOptions) => {
            reportUsageWithoutAwaiting(agentOptions);
            return reply("Answer");
          },
          beforeAppend: async (kind, payload, appendOptions) => {
            if (isUsageFact(kind, payload)) usageSaves.push(appendOptions);
          },
        });
        const id = await f.open();
        await f.send(id, "first", "Hello");
        expect(usageSaves).toHaveLength(1);
        expect(usageSaves[0]?.durable).not.toBe(true);
      });
    });

    describe("resumeSession()", () => {
      it("replays real usage and admitted tools into a reopened AgentSession without repeating requests https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
        const journal = new NodeJournalStorage(directory);
        const storage = new NodeNativeSessionStorage(journal);
        const original = fixture({ storage });
        const id = await original.open();
        await original.send(id, "prompt", "Explain the note");
        const facts = (await journal.read(id)).records;
        const accepted = facts.find((entry) => entry.kind === "user_accepted")!;
        const roundId = (accepted.payload as { roundId: string }).roundId;
        const segment = facts.find(
          (entry) =>
            entry.kind === "event" &&
            (entry.payload as SessionEvent).update.sessionUpdate === "agent_segment_started"
        )!.seq;
        const base = {
          id: "reported-call",
          roundId,
          promptId: "prompt",
          sourceId: "main",
          sourceName: "Main",
          kind: "main" as const,
          purpose: "chat" as const,
          modelId: MODEL.id,
          modelName: MODEL.name,
          requestIds: ["retry", "continuation"],
          status: "completed" as const,
          startedAt: 100,
          firstTokenAt: 200,
          generationMs: 500,
          generationOutputTokens: 2,
          segmentSeq: segment,
          usage: { inputTokens: 5, outputTokens: 2, totalTokens: 7, cacheReadTokens: 0 },
        };
        for (const update of [
          { sessionUpdate: "model_call_metrics" as const, observation: base },
          { sessionUpdate: "model_call_metrics" as const, observation: base },
          {
            sessionUpdate: "tool_execution_started" as const,
            roundId,
            sourceId: "main",
            toolCallId: "admitted-tool",
          },
        ])
          await storage.append(id, "event", { sessionId: id, update }, { durable: true });
        await original.process.shutdown();
        const restored = fixture({
          storage: new NodeNativeSessionStorage(new NodeJournalStorage(directory)),
        });
        const displayed = new AgentSession({
          backend: restored.process,
          backendSessionId: id,
          internalId: "metrics-reopen",
          backendId: "native",
        });
        try {
          const loaded = await restored.process.loadSession({
            sessionId: id,
            cwd: "/fixture/vault",
          });
          displayed.completeResume(loaded.state);
          await displayed.ready;
          expect(displayed.getSessionUsage()?.metrics).toMatchObject({
            totalTokens: 7,
            steps: 2,
            rounds: 1,
            activeRounds: 0,
            toolCallCount: 1,
            hasActiveWork: false,
            tokensPerSecond: 4,
          });
          const assistant = displayed.store
            .getDisplayMessages()
            .find((message) => message.id === "assistant:prompt");
          expect(assistant?.turnMetrics).toMatchObject({
            totalTokens: 7,
            steps: 2,
            finalResponseSegmentSeq: segment,
            toolCallCount: 1,
            hasActiveWork: false,
          });
          expect(restored.requests).toHaveLength(0);
        } finally {
          await displayed.dispose();
          await restored.process.shutdown();
        }
      });

      it("restores the saved child completion when its task-ended notification was never committed (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const storage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        const original = fixture({ storage });
        const id = await original.open();
        await original.process.shutdown();
        const result = createAssistantMessage(MODEL);
        result.content = [{ type: "text", text: "Actual saved child result" }];
        result.stopReason = "stop";
        await storage.append(
          id,
          "event",
          {
            sessionId: id,
            update: {
              sessionUpdate: "task_started",
              taskId: "saved-run",
              toolCallId: "delegate",
              kind: "subagent",
              description: "Saved child",
              subagentId: "saved-child",
              runId: "saved-run",
            },
          },
          { durable: true }
        );
        await storage.append(
          id,
          "subagent_state",
          {
            version: 1,
            state: {
              version: 1,
              revision: 1,
              context: [{ role: "user", timestamp: 1, content: "Original child task" }, result],
              automaticTaskIds: [],
              snapshot: {
                id: "saved-child",
                parentSessionId: id,
                name: "Saved child",
                modelId: MODEL.id,
                cwd: "/fixture/vault",
                retention: "retained",
                createdAt: 1,
                updatedAt: 2,
                runs: [
                  {
                    id: "saved-run",
                    taskGenerationId: "saved-task",
                    toolCallId: "delegate",
                    status: "completed",
                    createdAt: 1,
                    startedAt: 1,
                    endedAt: 2,
                    resultId: "saved-result",
                    result: "Actual saved child result",
                    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0 },
                  },
                ],
                messages: [
                  {
                    id: "saved-result",
                    sequence: 1,
                    subagentId: "saved-child",
                    runId: "saved-run",
                    taskGenerationId: "saved-task",
                    direction: "to_parent",
                    sender: "subagent",
                    kind: "result",
                    text: "Actual saved child result",
                    state: "accepted",
                    acceptedAt: 2,
                  },
                ],
              },
            },
          },
          { durable: true }
        );
        const restoredStorage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        const restored = fixture({ storage: restoredStorage });
        await restored.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" });
        const loaded = await restoredStorage.load(id);
        expect(loaded?.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "task_ended",
            taskId: "saved-run",
            status: "completed",
            summary: "Actual saved child result",
          })
        );
        expect(restored.requests).toHaveLength(0);
        await restored.process.shutdown();
      });

      let directory: string;
      beforeEach(async () => {
        directory = await mkdtemp(join(tmpdir(), "scribe-journal-runtime-"));
      });
      afterEach(async () => {
        await rm(directory, { recursive: true, force: true });
      });

      it("restores complete mixed MCP blocks, structured output and unknown metadata without rerunning tools https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
        const text = '{"id":900719925474099312345,"body":"' + "x".repeat(270_000) + '"}';
        const original = {
          content: [
            { type: "text", text },
            { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
            {
              type: "resource",
              resource: {
                uri: "mcp://report",
                text: "# Complete resource",
                mimeType: "text/markdown",
              },
            },
            { type: "future-block", opaque: { version: 99, value: "retained" } },
          ],
          structuredContent: { answer: 42 },
          _meta: { futureVersion: 99 },
        };
        const storage = new NodeNativeSessionStorage(
          new NodeJournalStorage(directory),
          new NodeAttachmentStorage(join(directory, "attachments"))
        );
        const initial = fixture({ storage });
        const id = await initial.open();
        const assistant = createAssistantMessage(MODEL);
        assistant.content = [
          { type: "toolCall", id: "mcp-result", name: "mcp__library__search", arguments: {} },
        ];
        assistant.stopReason = "toolUse";
        await storage.append(id, "protocol_message", { message: assistant }, { durable: true });
        await storage.append(
          id,
          "tool_admitted",
          { id: "mcp-result", name: "mcp__library__search", toolCallId: "run:mcp-result" },
          { durable: true }
        );
        await storage.append(
          id,
          "event",
          {
            sessionId: id,
            update: {
              sessionUpdate: "tool_call",
              toolCallId: "run:mcp-result",
              title: "Search",
              status: "in_progress",
            },
          },
          { durable: true }
        );
        await storage.append(
          id,
          "tool_result",
          {
            message: {
              role: "toolResult",
              toolCallId: "mcp-result",
              toolName: "mcp__library__search",
              content: [{ type: "text", text }],
              details: { mcpResult: original },
              timestamp: 2,
              isError: false,
            },
          },
          { durable: true }
        );
        const restoredStorage = new NodeNativeSessionStorage(
          new NodeJournalStorage(directory),
          new NodeAttachmentStorage(join(directory, "attachments"))
        );
        const restored = fixture({ storage: restoredStorage });
        const events: SessionEvent[] = [];
        restored.process.registerSessionHandler(id, (event) => events.push(event));
        await restored.process.loadSession({ sessionId: id, cwd: "/fixture/vault" });
        const toolUpdate = events.find(
          (event) =>
            event.update.sessionUpdate === "tool_call_update" && event.update.status === "completed"
        );
        const output =
          toolUpdate?.update.sessionUpdate === "tool_call_update" ? toolUpdate.update.content : [];
        expect(output).toHaveLength(6);
        const first = output?.[0];
        expect(first?.type === "content" && first.content.text === text).toBe(true);
        expect(output?.slice(1)).toEqual([
          ...original.content.slice(1).map((content) => ({
            type: "content",
            content:
              content.type === "image"
                ? { ...content, attachmentHash: expect.any(String) }
                : content,
          })),
          {
            type: "content",
            content: { type: "json", name: "structuredContent", text: '{"answer":42}' },
          },
          {
            type: "content",
            content: { type: "json", name: "metadata", text: '{"_meta":{"futureVersion":99}}' },
          },
        ]);
        expect(restored.requests).toHaveLength(0);
        await restored.process.shutdown();
      });

      it.each(["compaction", "user_accepted", "tool_admitted", "display"])(
        "skips a malformed %s fact while preserving and using later valid history",
        async (kind) => {
          const storage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
          const initial = fixture({ storage });
          const id = await initial.open();
          await storage.append(id, kind, null, { durable: true });
          const displayMessage = {
            id: "valid-display",
            sender: "user",
            message: "Valid later history",
            timestamp: null,
            isVisible: true,
          };
          await storage.append(
            id,
            "display",
            { kind: "user_message", message: displayMessage },
            { durable: true }
          );
          const restoredStorage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
          const restored = fixture({ storage: restoredStorage });

          await expect(
            restored.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" })
          ).resolves.toMatchObject({ sessionId: id });
          const facts = await restored.process.readDisplayFacts({ sessionId: id });
          expect(facts).toHaveLength(1);
          expect(facts[0].payload).toEqual({ kind: "user_message", message: displayMessage });
          await expect(restored.send(id, "next", "Continue safely")).resolves.toBeUndefined();
          expect(restored.requests).toHaveLength(1);
          expect(
            (await restoredStorage.load(id))?.journalRecords?.find((entry) => entry.kind === kind)
              ?.payload
          ).toBeNull();
        }
      );

      it("restores accepted user wording before any model request without automatically resending it", async () => {
        const storage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        const initial = fixture({ storage });
        const id = await initial.open();
        const displayMessage = {
          id: "accepted-display",
          sender: "user",
          message: "My original question",
          timestamp: null,
          isVisible: true,
          context: { notes: ["source.md"] },
        };
        await storage.append(
          id,
          "user_accepted",
          {
            promptId: "accepted-prompt",
            message: {
              role: "user",
              content: "Wrapped actual request with source material",
              timestamp: 1,
            },
            displayMessage,
          },
          { durable: true }
        );

        const restored = fixture({
          storage: new NodeNativeSessionStorage(new NodeJournalStorage(directory)),
        });
        await restored.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" });
        expect(await restored.process.readDisplayFacts({ sessionId: id })).toContainEqual({
          seq: expect.any(Number),
          origin: "observed",
          payload: { kind: "user_message", message: displayMessage },
        });
        expect(restored.requests).toHaveLength(0);
      });

      it("retains a saved partial assistant reply for continued conversation without synthesizing it twice", async () => {
        const storage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        const initial = fixture({ storage });
        const id = await initial.open();
        await storage.append(
          id,
          "protocol_message",
          { message: { role: "user", content: "Explain the note", timestamp: 1 } },
          { durable: true }
        );
        await storage.append(
          id,
          "event",
          {
            sessionId: id,
            update: { sessionUpdate: "turn_started", turnId: "interrupted", startedAt: 1 },
          },
          { durable: true }
        );
        for (const text of ["PARTIAL ", "ANSWER BEFORE THE INTERRUPTION"])
          await storage.append(
            id,
            "event",
            {
              sessionId: id,
              update: { sessionUpdate: "agent_message_chunk", content: { type: "text", text } },
            },
            { durable: true }
          );

        const restoredStorage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        const restored = fixture({ storage: restoredStorage });
        await restored.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" });
        const afterRecovery = await restoredStorage.load(id);
        expect(JSON.stringify(afterRecovery?.messages)).toContain(
          "PARTIAL ANSWER BEFORE THE INTERRUPTION"
        );
        expect(
          afterRecovery?.journalRecords?.filter(
            (entry) => entry.kind === "protocol_message" && entry.origin === "synthetic"
          )
        ).toHaveLength(1);
        await restored.process.shutdown();

        const reopenedStorage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        const reopened = fixture({ storage: reopenedStorage });
        await reopened.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" });
        await reopened.send(id, "next", "Continue the unfinished answer");
        expect(JSON.stringify(reopened.requests[0].messages)).toContain(
          "PARTIAL ANSWER BEFORE THE INTERRUPTION"
        );
        expect(JSON.stringify(reopened.requests[0].messages)).toContain(
          "Continue the unfinished answer"
        );
        expect(
          (await reopenedStorage.load(id))?.journalRecords?.filter(
            (entry) => entry.kind === "protocol_message" && entry.origin === "synthetic"
          )
        ).toHaveLength(1);
      });

      it("restores a compressed chat from disk while retaining the complete original history", async () => {
        const firstStorage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        const first = fixture({
          storage: firstStorage,
          request: (context) =>
            JSON.stringify(context).includes("Summarize this recorded Obsidian")
              ? reply("SAVED SUMMARY")
              : reply("ORIGINAL ANSWER"),
        });
        const id = await first.open();
        await first.send(id, "first", "ORIGINAL QUESTION");
        await first.send(id, "compact", "/compact");
        await first.process.shutdown();
        const before = await readFile(join(directory, `${id}.jsonl`), "utf8");

        const restoredStorage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        const restored = fixture({ storage: restoredStorage });
        await restored.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" });
        await restored.send(id, "followup", "Continue after restart");
        const loaded = await restoredStorage.load(id);

        expect(JSON.stringify(loaded?.messages)).toContain("ORIGINAL QUESTION");
        expect(JSON.stringify(loaded?.messages)).toContain("ORIGINAL ANSWER");
        expect(JSON.stringify(restored.requests[0].messages)).toContain("SAVED SUMMARY");
        expect(JSON.stringify(restored.requests[0].messages)).toContain("Continue after restart");
        expect(restored.requests[0].messages).toContainEqual(
          expect.objectContaining({ role: "system", content: "Obsidian fixture assistant" })
        );
        expect(JSON.stringify(restored.requests[0].messages)).not.toContain("ORIGINAL ANSWER");
        expect((await readFile(join(directory, `${id}.jsonl`), "utf8")).startsWith(before)).toBe(
          true
        );
      });

      it("recovers one completed compression and its reduced occupancy when the display fact was lost after durable commit https://github.com/ItsDalk-Lane/Scribe/issues/66", async () => {
        const original = fixture({
          storage: new NodeNativeSessionStorage(new NodeJournalStorage(directory)),
          request: (context) =>
            JSON.stringify(context).includes("Summarize this recorded Obsidian")
              ? reply("COMMITTED CONTINUATION SUMMARY")
              : reply("Original answer before compression"),
        });
        const id = await original.open();
        await original.send(id, "first", "Keep note paths and unfinished tasks");
        await original.send(id, "manual-compress", "/compact");
        await original.process.shutdown();
        const file = join(directory, `${id}.jsonl`);
        const records = (await readFile(file, "utf8"))
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line) as JournalRecord);
        const committedIndex = records.findLastIndex((record) => record.kind === "compaction");
        const committed = records[committedIndex];
        const expected = (committed.payload as { completion: CompactionSnapshot }).completion;
        expect(expected).toMatchObject({
          id: expect.any(String),
          status: "completed",
          postTokens: expect.any(Number),
          summary: "COMMITTED CONTINUATION SUMMARY",
        });
        await writeFile(
          file,
          `${records
            .slice(0, committedIndex + 1)
            .map((record) => JSON.stringify(record))
            .join("\n")}\n`
        );

        for (let restart = 0; restart < 2; restart++) {
          const storage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
          const restored = fixture({ storage });
          const events: SessionEvent[] = [];
          restored.process.registerSessionHandler(id, (event) => events.push(event));
          await restored.process.loadSession({ sessionId: id, cwd: "/fixture/vault" });
          const states = events.filter(
            (event) =>
              event.update.sessionUpdate === "compaction" && event.update.id === expected.id
          );
          expect(
            states.filter(
              (event) =>
                event.update.sessionUpdate === "compaction" && event.update.status === "completed"
            )
          ).toHaveLength(1);
          expect(states).not.toContainEqual(
            expect.objectContaining({ update: expect.objectContaining({ status: "cancelled" }) })
          );
          expect(states.at(-1)?.update).toMatchObject({
            status: "completed",
            summary: expected.summary,
            commitSeq: committed.seq,
          });
          expect(
            events.findLast((event) => event.update.sessionUpdate === "usage_update")?.update
          ).toMatchObject({
            usage: { usedTokens: expected.postTokens, contextWindow: MODEL.contextWindow },
          });
          expect(restored.requests).toHaveLength(0);
          const saved = await storage.load(id);
          expect(
            saved?.journalRecords?.filter((record) => {
              if (record.kind !== "event") return false;
              const update = (record.payload as SessionEvent).update;
              return update.sessionUpdate === "compaction" && update.status === "completed";
            })
          ).toHaveLength(1);
          await restored.process.shutdown();
        }
      });

      it("does not apply an old summary to new input when an unsupported original message was skipped", async () => {
        const firstStorage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        const first = fixture({
          storage: firstStorage,
          request: (context) =>
            JSON.stringify(context).includes("Summarize this recorded Obsidian")
              ? reply("SUMMARY OF THE ORIGINAL MESSAGES")
              : reply("Original assistant answer"),
        });
        const id = await first.open();
        await first.send(id, "first", "Original user request");
        await first.send(id, "compact", "/compact");
        await first.process.shutdown();
        const file = join(directory, `${id}.jsonl`);
        const records = (await readFile(file, "utf8"))
          .trimEnd()
          .split("\n")
          .map((line) => JSON.parse(line) as JournalRecord);
        const original = records.find(
          (entry) =>
            entry.kind === "protocol_message" &&
            (entry.payload as { message: { role: string } }).message.role === "assistant"
        );
        expect(original).toBeDefined();
        (original!.payload as { message: { role: string } }).message.role = "future_message";
        await writeFile(file, `${records.map((entry) => JSON.stringify(entry)).join("\n")}\n`);

        const restored = fixture({
          storage: new NodeNativeSessionStorage(new NodeJournalStorage(directory)),
        });
        await restored.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" });
        await restored.send(id, "next", "NEW USER INPUT MUST REMAIN");

        expect(restored.requests).toHaveLength(1);
        expect(JSON.stringify(restored.requests[0].messages)).toContain(
          "NEW USER INPUT MUST REMAIN"
        );
        expect(JSON.stringify(restored.requests[0].messages)).toContain("Original user request");
      });

      it.each([false, true])(
        "restores the real saved result when its final display event is missing and isError=%s",
        async (isError) => {
          const storage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
          const initial = fixture({ storage });
          const id = await initial.open();
          const assistant = createAssistantMessage(MODEL);
          assistant.content = [
            {
              type: "toolCall",
              id: "finished",
              name: "write_note",
              arguments: { path: "note.md" },
            },
          ];
          assistant.stopReason = "toolUse";
          await storage.append(id, "protocol_message", { message: assistant }, { durable: true });
          await storage.append(
            id,
            "tool_admitted",
            { id: "finished", name: "write_note", toolCallId: "run:finished" },
            { durable: true }
          );
          await storage.append(
            id,
            "event",
            {
              sessionId: id,
              update: {
                sessionUpdate: "tool_call",
                toolCallId: "run:finished",
                title: "Write note",
                kind: "edit",
                status: "in_progress",
              },
            },
            { durable: true }
          );
          const outcome = isError ? "Actual write failed: permission refused" : "Actual note saved";
          await storage.append(
            id,
            "tool_result",
            {
              message: {
                role: "toolResult",
                toolCallId: "finished",
                toolName: "write_note",
                content: [{ type: "text", text: outcome }],
                timestamp: 2,
                isError,
              },
            },
            { durable: true }
          );
          const before = await readFile(join(directory, `${id}.jsonl`), "utf8");
          const restoredStorage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
          const restored = fixture({ storage: restoredStorage });
          const events: SessionEvent[] = [];
          restored.process.registerSessionHandler(id, (event) => events.push(event));
          await restored.process.loadSession({ sessionId: id, cwd: "/fixture/vault" });

          const completion = events
            .filter(
              (event) =>
                event.update.sessionUpdate === "tool_call_update" &&
                event.update.toolCallId === "run:finished"
            )
            .at(-1);
          expect(completion).toMatchObject({
            origin: "synthetic",
            update: { status: isError ? "failed" : "completed" },
          });
          expect(JSON.stringify(completion)).toContain(outcome);
          expect(JSON.stringify(completion)).not.toContain("outcome is unknown");
          expect(restored.requests).toHaveLength(0);
          expect(
            (await restoredStorage.load(id))?.journalRecords?.filter(
              (entry) => entry.kind === "tool_result" && entry.origin === "synthetic"
            )
          ).toHaveLength(0);
          expect((await readFile(join(directory, `${id}.jsonl`), "utf8")).startsWith(before)).toBe(
            true
          );
        }
      );

      it.each([false, true])(
        "restores a missing tool result with its durable admission state admitted=%s and never reruns it",
        async (admitted) => {
          const storage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
          const initial = fixture({ storage });
          const id = await initial.open();
          const assistant = createAssistantMessage(MODEL);
          assistant.content = [
            {
              type: "toolCall",
              id: "unfinished",
              name: "write_note",
              arguments: { path: "note.md" },
            },
          ];
          assistant.stopReason = "toolUse";
          await storage.append(id, "protocol_message", { message: assistant }, { durable: true });
          if (admitted)
            await storage.append(
              id,
              "tool_admitted",
              { id: "unfinished", name: "write_note", toolCallId: "run:unfinished" },
              { durable: true }
            );

          let rerun = false;
          const restoredStorage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
          const restored = fixture({
            storage: restoredStorage,
            createTools: () => [
              defineNativeTool(
                "write_note",
                "Write",
                "Write fixture",
                obj({}),
                async () => {
                  rerun = true;
                  return {
                    content: [{ type: "text", text: "Unexpected write" }],
                    details: undefined,
                  };
                },
                { kind: "edit" }
              ),
            ],
          });
          await restored.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" });
          const loaded = await restoredStorage.load(id);
          const repairs = loaded?.journalRecords?.filter(
            (entry) => entry.kind === "tool_result" && entry.origin === "synthetic"
          );
          expect(repairs).toHaveLength(1);
          expect(repairs?.[0].payload).toMatchObject({
            recovery: admitted ? "outcome_unknown" : "not_started",
            message: { toolCallId: "unfinished", isError: true },
          });
          expect(JSON.stringify(repairs?.[0].payload)).toContain(
            admitted ? "outcome is unknown" : "never started"
          );
          expect(rerun).toBe(false);
          expect(restored.requests).toHaveLength(0);

          const again = fixture({
            storage: new NodeNativeSessionStorage(new NodeJournalStorage(directory)),
          });
          await again.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" });
          expect(
            (await restoredStorage.load(id))?.journalRecords?.filter(
              (entry) => entry.kind === "tool_result" && entry.origin === "synthetic"
            )
          ).toHaveLength(1);
        }
      );
    });

    describe("readDisplayFacts()", () => {
      it("reads and updates a saved chat pin without opening a model session", async () => {
        const directory = await mkdtemp(join(tmpdir(), "scribe-offline-facts-"));
        try {
          const storage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
          const initial = fixture({ storage });
          const id = await initial.open();
          await initial.process.shutdown();
          const offline = fixture({
            storage: new NodeNativeSessionStorage(new NodeJournalStorage(directory)),
          });
          await offline.process.appendDisplayFacts({
            sessionId: id,
            facts: [{ kind: "pin", pinnedAt: 1234 }],
          });
          expect(await offline.process.readDisplayFacts({ sessionId: id })).toContainEqual({
            seq: expect.any(Number),
            origin: "observed",
            payload: { kind: "pin", pinnedAt: 1234 },
          });
          expect(offline.createModel).not.toHaveBeenCalled();
          expect(offline.requests).toHaveLength(0);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    });

    describe("appendDisplayFacts()", () => {
      it("assigns new local sequence identities to inherited branch messages", async () => {
        const directory = await mkdtemp(join(tmpdir(), "scribe-branch-facts-"));
        try {
          const storage = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
          const f = fixture({ storage });
          const id = await f.open();
          const source = {
            id: "source-message",
            seq: 700,
            sender: "user",
            message: "Inherited original wording",
            timestamp: null,
            isVisible: true,
          };
          await f.process.appendDisplayFacts({
            sessionId: id,
            facts: [
              {
                kind: "branch",
                branch: {
                  sourceChatId: "source-chat",
                  sourceMessageId: source.id,
                  historyPending: true,
                  inheritedMessageCount: 1,
                },
                messages: [source],
              },
            ],
          });
          const facts = await f.process.readDisplayFacts({ sessionId: id });
          const inherited = facts.find((fact) => fact.payload.kind === "inherited_message");
          expect(inherited).toMatchObject({
            seq: 1,
            origin: "derived",
            payload: {
              kind: "inherited_message",
              message: { id: source.id, message: source.message },
            },
          });
          expect(inherited?.payload).toHaveProperty("message");
          expect((inherited?.payload as { message: unknown }).message).not.toHaveProperty("seq");
          expect(facts.find((fact) => fact.payload.kind === "branch")?.seq).toBe(2);
          expect(source.seq).toBe(700);
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      });
    });
  });
});
