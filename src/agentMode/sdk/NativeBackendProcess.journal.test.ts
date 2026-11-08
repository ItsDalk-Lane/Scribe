import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { Context, JsonObject } from "@earendil-works/pi-ai";
import { obj } from "@earendil-works/pi-schema";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import type { ProviderChatModel } from "@/LLMProviders/piChatModel";
import {
  NativeBackendProcess,
  type NativeSessionStorage,
  type NativeToolContext,
} from "@/agentMode/sdk/NativeBackendProcess";
import { defineNativeTool, NATIVE_PERMISSION_OPTIONS } from "@/agentMode/sdk/nativeToolDefinition";
import type { JournalAppendOptions, JournalRecord } from "@/agentMode/sdk/JournalStorage";
import { NodeJournalStorage } from "@/agentMode/sdk/JournalStorage";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import type { SessionEvent } from "@/agentMode/session/types";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { USER_SENDER } from "@/constants";

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
  calls: Array<{ id: string; name: string; arguments: JsonObject }> = []
) {
  const stream = createAssistantMessageEventStream();
  const message = createAssistantMessage(MODEL);
  message.content = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...calls.map((call) => ({ type: "toolCall" as const, ...call })),
  ];
  message.stopReason = calls.length ? "toolUse" : "stop";
  stream.push({ type: "start", partial: message });
  if (text) stream.push({ type: "text_delta", contentIndex: 0, delta: text, partial: message });
  stream.push({ type: "done", reason: message.stopReason, message });
  return stream;
}

function fixture(
  options: {
    request?: (context: Context) => ReturnType<typeof reply>;
    beforeAppend?: (
      kind: string,
      payload: unknown,
      options?: JournalAppendOptions
    ) => Promise<void>;
    afterAppend?: (record: JournalRecord) => void;
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
    save: async () => {},
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
      pending = operation.then(() => {});
      void pending.catch(() => {});
      return operation;
    },
    flush: async () => pending,
  };
  const provider: ProviderChatModel = {
    model: MODEL,
    stream: () => reply("unused"),
    agentStream: (context) => {
      const captured: Context = JSON.parse(JSON.stringify(context));
      requests.push(captured);
      return options.request?.(captured) ?? reply("Done");
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
            defineNativeTool("write_note", "Write", "Write fixture", obj({}), async (id) => {
              await context.requestPermission({
                sessionId: context.sessionId,
                toolCall: { toolCallId: id, title: "Write fixture", kind: "edit" },
                options: [...NATIVE_PERMISSION_OPTIONS],
              });
              changed = true;
              return { content: [{ type: "text", text: "Saved fixture" }], details: undefined };
            }),
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
            defineNativeTool("fast", "Fast", "Fast fixture", obj({}), async () => ({
              content: [{ type: "text", text: "Fast result" }],
              details: undefined,
            })),
            defineNativeTool("slow", "Slow", "Slow fixture", obj({}), async () => {
              await slow.promise;
              return { content: [{ type: "text", text: "Slow result" }], details: undefined };
            }),
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
            defineNativeTool("read_note", "Read", "Read fixture", obj({}), async () => ({
              content: [{ type: "text", text: "ACTUAL TOOL RESULT" }],
              details: undefined,
            })),
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

      it("recompresses original history instead of the earlier summary", async () => {
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
        expect(summaries[1]).toContain("ORIGINAL USER REQUEST");
        expect(summaries[1]).toContain("ORIGINAL ANSWER TO KEEP");
        expect(summaries[1]).not.toContain("DERIVED SUMMARY 1");
        expect(f.entries.filter((entry) => entry.kind === "compaction")).toHaveLength(2);
      });

      it("stops before a file change when its execution admission cannot be saved", async () => {
        let changed = false;
        const f = fixture({
          request: () => reply("", [{ id: "write", name: "write_note", arguments: {} }]),
          beforeAppend: async (kind) => {
            if (kind === "tool_admitted") throw new Error("Disk unavailable");
          },
          createTools: (context) => [
            defineNativeTool("write_note", "Write", "Write fixture", obj({}), async (id) => {
              await context.requestPermission({
                sessionId: context.sessionId,
                toolCall: { toolCallId: id, title: "Write fixture", kind: "edit" },
                options: [...NATIVE_PERMISSION_OPTIONS],
              });
              changed = true;
              return { content: [{ type: "text", text: "Saved" }], details: undefined };
            }),
          ],
        });
        const id = await f.open();
        await expect(f.send(id, "write", "Write a note")).rejects.toThrow("Disk unavailable");
        expect(changed).toBe(false);
        expect(f.requests).toHaveLength(1);
        expect(f.entries.some((entry) => entry.kind === "tool_result")).toBe(false);
      });
    });

    describe("resumeSession()", () => {
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
              defineNativeTool("write_note", "Write", "Write fixture", obj({}), async () => {
                rerun = true;
                return {
                  content: [{ type: "text", text: "Unexpected write" }],
                  details: undefined,
                };
              }),
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
