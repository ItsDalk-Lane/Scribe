import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import { NodeJournalStorage } from "@/agentMode/sdk/JournalStorage";
import { NodeAttachmentStorage } from "@/agentMode/sdk/AttachmentStorage";
import type { NativeSessionRecord } from "@/agentMode/sdk/NativeBackendProcess";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { NativeSubagentState } from "@/agentMode/sdk/subagentState";

const SESSION_ID = "native-8c4529e7-6551-4f39-81b3-dbf5f8e716dd";
const SECOND_ID = "native-41d51594-f0e0-46b7-b770-a283c9f6405f";

function record(id = SESSION_ID): NativeSessionRecord {
  return {
    version: 1,
    backendId: "native",
    sessionId: id,
    cwd: "/vault/project",
    projectId: "project-a",
    modelId: "model-a",
    effort: "off",
    mode: "default",
    messages: [{ role: "user", content: "Inspect the note", timestamp: 10 }],
    events: [],
    updatedAt: 10,
  };
}

function assistant() {
  const model: Model<Api> = {
    id: "model-a",
    name: "Model A",
    api: "openai-completions",
    provider: "fixture",
    baseUrl: "http://localhost",
    reasoning: false,
    input: ["text"],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 10000,
    maxTokens: 1000,
  };
  return createAssistantMessage(model);
}

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function childState(id = "child-a"): NativeSubagentState {
  return {
    version: 1,
    revision: 1,
    automaticTaskIds: ["generation-a"],
    context: [{ role: "user", content: `子上下文-${id}`, timestamp: 1 }],
    snapshot: {
      id,
      parentSessionId: SESSION_ID,
      projectId: "project-a",
      name: "整理资料",
      modelId: "model-a",
      cwd: "/vault/project",
      retention: "retained",
      createdAt: 1,
      updatedAt: 3,
      runs: [
        {
          id: `run-${id}`,
          toolCallId: `tool-${id}`,
          taskGenerationId: "generation-a",
          status: "completed",
          createdAt: 1,
          resultId: `result-${id}`,
          result: "任务完成",
          usage: { input: 5, output: 2, cacheRead: 0, cacheWrite: 0, totalTokens: 7 },
        },
      ],
      messages: [
        {
          id: `message-${id}`,
          sequence: 1,
          subagentId: id,
          taskGenerationId: "generation-a",
          direction: "to_parent",
          sender: "subagent",
          kind: "result",
          text: "任务完成",
          state: "accepted",
          acceptedAt: 3,
        },
      ],
    },
  };
}

describe("NativeSessionStorage", () => {
  describe("NodeNativeSessionStorage", () => {
    let directory: string;
    let storage: NodeNativeSessionStorage;
    let journal: NodeJournalStorage;
    let attachmentDirectory: string;
    let attachments: NodeAttachmentStorage;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "scribe-native-journal-"));
      attachmentDirectory = join(directory, "attachments");
      journal = new NodeJournalStorage(join(directory, "sessions"));
      attachments = new NodeAttachmentStorage(attachmentDirectory);
      storage = new NodeNativeSessionStorage(journal, attachments);
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await rm(directory, { recursive: true, force: true });
    });

    describe("constructor()", () => {
      it("shares the journal writer when constructed with the same directory", () => {
        const first = new NodeNativeSessionStorage(directory);
        const second = new NodeNativeSessionStorage(directory);
        expect(first.journal).toBe(second.journal);
      });
    });

    describe("save()", () => {
      it("creates a new journal with the supplied initial messages and event facts", async () => {
        const saved = record();
        saved.events.push({
          sessionId: SESSION_ID,
          update: { sessionUpdate: "turn_ended", turnId: "turn-1", stopReason: "end_turn" },
        });
        await storage.save(saved);
        const loaded = await new NodeNativeSessionStorage(journal).load(SESSION_ID);
        expect(loaded).toMatchObject({
          ...saved,
          updatedAt: expect.any(Number),
          writable: true,
          warnings: [],
        });
        expect((await journal.read(SESSION_ID)).records.map((fact) => fact.kind)).toEqual([
          "session_created",
          "protocol_message",
          "event",
        ]);
        expect(await readdir(journal.directory)).toEqual([`${SESSION_ID}.jsonl`]);
      });

      it("keeps the skill-authoring restriction when the saved chat is reopened from its journal", async () => {
        await storage.save({ ...record(), ...{ purpose: "skill-authoring" as const } });
        const restored = await new NodeNativeSessionStorage(journal).load(SESSION_ID);
        expect(restored).toMatchObject({ purpose: "skill-authoring" });
        expect((await journal.read(SESSION_ID)).records[0].payload).toMatchObject({
          purpose: "skill-authoring",
        });
      });

      it("appends only changed configuration and never rewrites or reimports messages", async () => {
        const saved = record();
        await storage.save(saved);
        const prefix = await readFile(join(journal.directory, `${SESSION_ID}.jsonl`), "utf8");
        saved.messages.push({
          role: "user",
          content: "Not yet accepted by the runtime",
          timestamp: 20,
        });
        saved.mode = "auto";
        await storage.save(saved);
        await storage.save(saved);
        const facts = (await journal.read(SESSION_ID)).records;
        expect(facts.map((fact) => fact.kind)).toEqual([
          "session_created",
          "protocol_message",
          "session_config",
        ]);
        expect((await storage.load(SESSION_ID))?.messages).toHaveLength(1);
        expect(
          (await readFile(join(journal.directory, `${SESSION_ID}.jsonl`), "utf8")).startsWith(
            prefix
          )
        ).toBe(true);
      });

      it.each([null, "off"] as const)("preserves distinct reasoning intent %s", async (effort) => {
        await storage.save({ ...record(), effort });
        expect((await storage.load(SESSION_ID))?.effort).toBe(effort);
      });

      it("round-trips a full-mode chat and the mode held before entering plan (https://github.com/ItsDalk-Lane/Scribe/issues/38)", async () => {
        const saved = record();
        saved.mode = "full";
        saved.modeBeforePlan = "full";
        await storage.save(saved);
        const restored = await new NodeNativeSessionStorage(journal).load(SESSION_ID);
        expect(restored).toMatchObject({ mode: "full", modeBeforePlan: "full" });

        saved.mode = "default";
        await storage.save(saved);
        expect(await storage.load(SESSION_ID)).toMatchObject({
          mode: "default",
          modeBeforePlan: "full",
        });
      });

      it("refuses to create over a journal whose only complete record is malformed", async () => {
        await writeFile(join(directory, `${SESSION_ID}.jsonl`), "original broken bytes\n");
        const broken = new NodeNativeSessionStorage(new NodeJournalStorage(directory));
        await expect(broken.save(record())).rejects.toThrow(/writable|preserv/i);
        expect(await readFile(join(directory, `${SESSION_ID}.jsonl`), "utf8")).toBe(
          "original broken bytes\n"
        );
      });
    });

    describe("append()", () => {
      it("does not accept a child image when attachment storage is unavailable https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        await storage.save(record());
        const state = childState();
        state.snapshot.messages = [
          {
            ...state.snapshot.messages[0],
            payload: { content: [{ type: "image", mimeType: "image/png", data: "YWJj" }] },
          },
        ];
        await expect(
          new NodeNativeSessionStorage(journal).append(
            SESSION_ID,
            "subagent_state",
            { version: 1, state },
            { durable: true }
          )
        ).rejects.toThrow(/Attachment storage/);
        const loaded = await storage.load(SESSION_ID);
        expect(loaded?.subagents ?? []).toEqual([]);
      });

      it("persists a newly accepted protocol message once with its fact sequence", async () => {
        await storage.save(record());
        const message = { role: "user", content: "Follow-up", timestamp: 20 };
        const appended = await storage.append(
          SESSION_ID,
          "protocol_message",
          { message },
          { durable: true }
        );
        expect(appended.seq).toBe(2);
        expect((await storage.load(SESSION_ID))?.messages).toHaveLength(2);
      });

      it("stores protocol and display images as the same binary attachment and rehydrates both views", async () => {
        const data = "AAECA/8=";
        await storage.save(record());
        await storage.append(SESSION_ID, "protocol_message", {
          message: {
            role: "user",
            content: [{ type: "image", data, mimeType: "image/png" }],
            timestamp: 30,
          },
        });
        await storage.append(SESSION_ID, "display_state", {
          image: { type: "image_url", image_url: { url: `data:image/png;base64,${data}` } },
        });
        const raw = await readFile(join(journal.directory, `${SESSION_ID}.jsonl`), "utf8");
        expect(raw).not.toContain(data);
        expect(raw).toContain("attachmentHash");
        expect(await readdir(attachmentDirectory)).toHaveLength(1);
        const loaded = await storage.load(SESSION_ID);
        expect(loaded?.messages[1]).toMatchObject({
          content: [{ type: "image", data, mimeType: "image/png" }],
        });
        expect(
          loaded?.journalRecords?.find((fact) => fact.kind === "display_state")?.payload
        ).toMatchObject({ image: { image_url: { url: `data:image/png;base64,${data}` } } });
      });

      it("keeps append order when an earlier image must finish saving first", async () => {
        await storage.save(record());
        const entered = gate();
        const released = gate();
        const originalPut = attachments.put.bind(attachments);
        jest.spyOn(attachments, "put").mockImplementation(async (bytes) => {
          entered.resolve();
          await released.promise;
          return originalPut(bytes);
        });
        const first = storage.append(SESSION_ID, "display_state", {
          type: "image",
          data: "AAEC",
          mimeType: "image/png",
        });
        await entered.promise;
        const second = storage.append(SESSION_ID, "display_state", { text: "Later" });
        released.resolve();
        const [one, two] = await Promise.all([first, second]);
        expect(two.seq).toBe(one.seq + 1);
      });

      it("shares attachment encoding order across adapters using the same journal", async () => {
        await storage.save(record());
        const entered = gate();
        const released = gate();
        const originalPut = attachments.put.bind(attachments);
        jest.spyOn(attachments, "put").mockImplementation(async (bytes) => {
          entered.resolve();
          await released.promise;
          return originalPut(bytes);
        });
        const first = storage.append(SESSION_ID, "display_state", {
          type: "image",
          data: "AQID",
          mimeType: "image/png",
        });
        await entered.promise;
        const otherAdapter = new NodeNativeSessionStorage(journal, attachments);
        const second = otherAdapter.append(SESSION_ID, "display_state", { text: "Later" });
        released.resolve();
        const [one, two] = await Promise.all([first, second]);
        expect(two.seq).toBe(one.seq + 1);
      });

      it("does not record an attachment reference if binary persistence fails", async () => {
        await storage.save(record());
        jest.spyOn(attachments, "put").mockRejectedValue(new Error("Attachment disk failed"));
        await expect(
          storage.append(SESSION_ID, "display_state", {
            type: "image",
            data: "AAEC",
            mimeType: "image/png",
          })
        ).rejects.toThrow("Attachment disk failed");
        expect((await journal.read(SESSION_ID)).records).toHaveLength(2);
      });
    });

    describe("load()", () => {
      it("restores accepted child reference content and image bytes from the attachment store https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        await storage.save(record());
        const state = childState();
        const message = {
          ...state.snapshot.messages[0],
          direction: "to_child" as const,
          sender: "user" as const,
          kind: "instruction" as const,
          payload: {
            content: [
              { type: "text" as const, text: "note and selected text" },
              { type: "image" as const, mimeType: "image/png", data: "YWJj" },
            ],
            context: { notes: ["note.md"] },
          },
        };
        state.snapshot.messages = [message];
        await storage.append(
          SESSION_ID,
          "subagent_state",
          { version: 1, state },
          { durable: true }
        );
        const raw = await readFile(join(directory, "sessions", `${SESSION_ID}.jsonl`), "utf8");
        expect(raw).not.toContain("YWJj");
        const loaded = await new NodeNativeSessionStorage(journal, attachments).load(SESSION_ID);
        expect(loaded?.subagents?.[0].snapshot.messages[0]).toMatchObject({
          payload: message.payload,
        });
        expect(loaded?.writable).toBe(true);
      });

      it("restores a result-id-only synchronous delivery once and clears its blocked outbox marker (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.save(record());
        const state = childState();
        state.snapshot.messages = [];
        state.snapshot.runs = state.snapshot.runs.map((run) => ({ ...run, deliveryBlocked: true }));
        await storage.append(
          SESSION_ID,
          "subagent_state",
          { version: 1, state },
          { durable: true }
        );
        const payload = {
          version: 1,
          subagentId: "child-a",
          messageIds: [],
          resultId: "result-child-a",
          message: {
            role: "toolResult",
            toolCallId: "delegate",
            toolName: "delegate_task",
            isError: false,
            content: [{ type: "text", text: "唯一规范结果" }],
            timestamp: 4,
          },
        };
        await storage.append(SESSION_ID, "subagent_delivery", payload, { durable: true });
        await storage.append(SESSION_ID, "subagent_delivery", payload, { durable: true });
        const cold = await new NodeNativeSessionStorage(journal).load(SESSION_ID);
        expect(cold?.messages.filter((message) => message.role === "toolResult")).toHaveLength(1);
        expect(cold?.subagents?.[0].snapshot.runs[0]).toMatchObject({
          resultDelivered: true,
          deliveryBlocked: false,
        });
        expect(cold?.subagents?.[0].snapshot.messages).toEqual([]);
        expect(cold?.writable).toBe(true);
      });
      it("restores child directory and collaboration display events while isolating malformed new events (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.save(record());
        const snapshot = childState().snapshot;
        const directory = {
          sessionId: SESSION_ID,
          update: { sessionUpdate: "subagents_updated", subagents: [snapshot] },
        };
        const message = {
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: "subagent_message",
            name: snapshot.name,
            message: snapshot.messages[0],
          },
        };
        await storage.append(SESSION_ID, "event", directory);
        await storage.append(SESSION_ID, "event", message);
        await storage.append(SESSION_ID, "event", {
          sessionId: SESSION_ID,
          update: {
            sessionUpdate: "subagent_message",
            name: "错误",
            message: { text: "缺少来源" },
          },
        });
        const loaded = await storage.load(SESSION_ID);
        expect(loaded?.events).toMatchObject([directory, message]);
        expect(loaded?.events).toHaveLength(2);
        expect(loaded?.warnings?.join(" ")).toContain("unsupported session event");
      });
      it("restores task request budgets and deduplicated usage without restarting a previous generation (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.save(record());
        const usage = {
          requestId: "request-a",
          usage: { input: 3, output: 2, cacheRead: 1, cacheWrite: 0, totalTokens: 6 },
        };
        await storage.append(
          SESSION_ID,
          "subagent_task",
          {
            version: 1,
            task: {
              id: "generation-a",
              active: true,
              limit: 100,
              requestIds: ["request-a"],
              usage: [usage, usage],
            },
          },
          { durable: true }
        );
        const loaded = await new NodeNativeSessionStorage(journal).load(SESSION_ID);
        expect(loaded?.taskGenerations).toEqual([
          {
            id: "generation-a",
            active: false,
            limit: 100,
            requestIds: ["request-a"],
            usage: [usage],
          },
        ]);
        expect(loaded?.writable).toBe(true);
      });

      it.each([
        { version: 2, task: { id: "generation-a" } },
        {
          version: 1,
          task: { id: "generation-a", active: true, limit: -1, requestIds: [], usage: [] },
        },
        {
          version: 1,
          task: {
            id: "generation-a",
            active: true,
            limit: 100,
            requestIds: ["request-a", "request-a"],
            usage: [],
          },
        },
        {
          version: 1,
          task: {
            id: "generation-a",
            active: true,
            limit: 100,
            requestIds: [],
            usage: [{ requestId: "unknown", usage: {} }],
          },
        },
      ])(
        "keeps an unverifiable task budget read-only instead of accepting unbounded requests: %j (https://github.com/ItsDalk-Lane/Scribe/issues/50)",
        async (payload) => {
          await storage.save(record());
          await journal.append(SESSION_ID, "subagent_task", payload, { durable: true });
          expect((await storage.load(SESSION_ID))?.writable).toBe(false);
          await expect(storage.append(SESSION_ID, "protocol_message", {})).rejects.toThrow(
            /format|subagent/i
          );
        }
      );
      it("restores complete child context and one parent delivery with consistent markers (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.save(record());
        const state = childState();
        await storage.append(
          SESSION_ID,
          "subagent_state",
          { version: 1, state },
          { durable: true }
        );
        const delivery = {
          version: 1,
          subagentId: "child-a",
          messageIds: ["message-child-a"],
          resultId: "result-child-a",
          message: { role: "user", content: "子代理来源的结果", timestamp: 4 },
        };
        await storage.append(SESSION_ID, "subagent_delivery", delivery, { durable: true });
        await storage.append(SESSION_ID, "subagent_delivery", delivery, { durable: true });
        await storage.append(SESSION_ID, "protocol_message", {
          message: { role: "user", content: "后续输入", timestamp: 5 },
        });
        const loaded = await new NodeNativeSessionStorage(journal).load(SESSION_ID);
        expect(loaded?.messages.map((message) => message.content)).toEqual([
          "Inspect the note",
          "子代理来源的结果",
          "后续输入",
        ]);
        expect(loaded).toMatchObject({
          subagents: [
            {
              context: state.context,
              snapshot: {
                id: "child-a",
                messages: [{ state: "delivered" }],
                runs: [{ resultDelivered: true }],
              },
            },
          ],
        });
      });

      it("preserves unknown child formats and prevents subsequent writes through another adapter (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.save(record());
        await journal.append(
          SESSION_ID,
          "subagent_state",
          { version: 2, state: childState() },
          { durable: true }
        );
        const original = await readFile(join(journal.directory, `${SESSION_ID}.jsonl`), "utf8");
        const loaded = await storage.load(SESSION_ID);
        expect(loaded?.writable).toBe(false);
        expect(loaded?.warnings?.join(" ")).toContain("unsupported");
        await expect(
          new NodeNativeSessionStorage(journal).append(SESSION_ID, "message", {})
        ).rejects.toThrow(/subagent|format/i);
        await expect(storage.save({ ...record(), mode: "plan" })).rejects.toThrow(
          /subagent|format/i
        );
        expect(await readFile(join(journal.directory, `${SESSION_ID}.jsonl`), "utf8")).toBe(
          original
        );
      });
      it("returns null without opening an old JSON chat", async () => {
        await writeFile(join(directory, `${SESSION_ID}.json`), JSON.stringify(record()));
        expect(await new NodeNativeSessionStorage(directory).load(SESSION_ID)).toBeNull();
        expect(await readFile(join(directory, `${SESSION_ID}.json`), "utf8")).toBe(
          JSON.stringify(record())
        );
      });

      it("returns unresolved tool calls as original facts without synthesizing a result", async () => {
        const saved = record();
        const message = assistant();
        message.stopReason = "toolUse";
        message.content = [
          {
            type: "toolCall",
            id: "write-1",
            name: "write_note",
            arguments: { path: "note.md", content: "Saved?" },
          },
        ];
        saved.messages.push(message);
        await storage.save(saved);
        const restored = await storage.load(SESSION_ID);
        expect(restored?.messages).toEqual(saved.messages);
        expect(restored?.events).toEqual([]);
      });

      it("keeps child protocol messages out of the main request but retains their complete facts", async () => {
        await storage.save(record());
        await storage.append(SESSION_ID, "protocol_message", {
          taskId: "child-1",
          message: { role: "user", content: "Child task", timestamp: 20 },
        });
        const loaded = await storage.load(SESSION_ID);
        expect(loaded?.messages).toHaveLength(1);
        expect(loaded?.journalRecords?.at(-1)?.payload).toMatchObject({
          taskId: "child-1",
          message: { content: "Child task" },
        });
      });

      it("keeps synthetic result provenance after another save and fresh load", async () => {
        await storage.save(record());
        const message = {
          role: "toolResult",
          toolCallId: "write-1",
          toolName: "write_note",
          content: [{ type: "text", text: "Result unknown" }],
          isError: true,
          timestamp: 20,
        };
        await storage.append(
          SESSION_ID,
          "tool_result",
          { message, recovery: "outcome_unknown" },
          { origin: "synthetic", durable: true }
        );
        const loaded = await storage.load(SESSION_ID);
        await storage.save(loaded!);
        const again = await new NodeNativeSessionStorage(journal).load(SESSION_ID);
        expect(again?.messages).toHaveLength(2);
        expect(again?.journalRecords?.at(-1)).toMatchObject({
          kind: "tool_result",
          origin: "synthetic",
          payload: { recovery: "outcome_unknown" },
        });
      });

      it("restores permission and question decisions from their original facts", async () => {
        await storage.save(record());
        const permission = await storage.append(SESSION_ID, "permission", {
          requestId: "edit-1",
          requester: "main",
          response: { outcome: { outcome: "selected", optionId: "allow_once" } },
        });
        const question = await storage.append(SESSION_ID, "question", {
          requestId: "question-1",
          requester: { taskId: "child-1" },
          response: { destination: "Projects" },
        });
        const loaded = await storage.load(SESSION_ID);
        expect(loaded?.decisions).toEqual([
          {
            kind: "permission",
            requestId: "edit-1",
            requester: "main",
            response: { outcome: { outcome: "selected", optionId: "allow_once" } },
            occurredAt: permission.occurredAt,
          },
          {
            kind: "question",
            requestId: "question-1",
            requester: { taskId: "child-1" },
            response: { destination: "Projects" },
            occurredAt: question.occurredAt,
          },
        ]);
      });

      it("preserves unknown messages and facts on disk while opening known messages", async () => {
        await storage.save(record());
        await storage.append(SESSION_ID, "protocol_message", {
          message: { role: "future_role", content: "Keep original", timestamp: 20 },
        });
        await storage.append(SESSION_ID, "future_feature", { future: true });
        const loaded = await storage.load(SESSION_ID);
        expect(loaded?.messages).toHaveLength(1);
        expect(loaded?.warnings).toEqual([expect.stringContaining("unsupported protocol message")]);
        expect(loaded?.journalRecords?.at(-1)?.payload).toEqual({ future: true });
        await storage.save(loaded!);
        expect(await readFile(join(journal.directory, `${SESSION_ID}.jsonl`), "utf8")).toContain(
          "future_role"
        );
      });

      it.each([
        { label: "null assistant block", patch: { content: [null] } },
        {
          label: "unknown assistant block",
          patch: { content: [{ type: "future_block", text: "Keep raw" }] },
        },
        { label: "missing usage fields", patch: { usage: {} } },
      ])(
        "isolates a $label while keeping later valid protocol messages usable",
        async ({ patch }) => {
          await storage.save(record());
          await journal.append(SESSION_ID, "protocol_message", {
            message: { ...assistant(), ...patch },
          });
          const later = {
            role: "user",
            content: "Continue after the damaged record",
            timestamp: 50,
          };
          await storage.append(SESSION_ID, "protocol_message", { message: later });
          const loaded = await storage.load(SESSION_ID);
          expect(loaded?.messages).toEqual([record().messages[0], later]);
          expect(loaded?.warnings).toEqual([
            expect.stringContaining("unsupported protocol message"),
          ]);
          expect(loaded?.journalRecords).toHaveLength(4);
        }
      );

      it.each([
        { sessionUpdate: "agent_message_chunk", content: null },
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: null } },
        { sessionUpdate: "tool_call", toolCallId: 3, title: "Broken" },
        { sessionUpdate: "tool_call_update", toolCallId: "t", content: [null] },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "t",
          content: [{ type: "content", content: null }],
        },
        {
          sessionUpdate: "tool_call_update",
          toolCallId: "t",
          content: [{ type: "diff", path: "note.md", newText: null }],
        },
        { sessionUpdate: "tool_call_update", toolCallId: "t", locations: [null] },
        { sessionUpdate: "plan", entries: [null] },
        { sessionUpdate: "compaction", id: "c", trigger: "manual", status: null },
        { sessionUpdate: "turn_started", turnId: null },
        { sessionUpdate: "turn_ended", turnId: "t", stopReason: "request_error", error: null },
        {
          sessionUpdate: "task_started",
          taskId: "t",
          toolCallId: "call",
          kind: "subagent",
          description: null,
        },
        { sessionUpdate: "task_ended", taskId: "t", status: "future_status" },
        { sessionUpdate: "task_progress", taskId: "t", progress: { description: 3 } },
        { sessionUpdate: "future_event", raw: "Kept" },
        { sessionUpdate: "agent_thought_ended", segmentSeq: -1 },
        { sessionUpdate: "agent_thought_ended", segmentSeq: 2, contentIndex: -1 },
        { sessionUpdate: "agent_thought_ended", segmentSeq: 2, contentIndex: "0" },
        { sessionUpdate: "agent_segment_finalized", segmentSeq: -1, blocks: [] },
        { sessionUpdate: "agent_segment_finalized", segmentSeq: 2, blocks: null },
        { sessionUpdate: "agent_segment_finalized", segmentSeq: 2, blocks: [null] },
        {
          sessionUpdate: "agent_segment_finalized",
          segmentSeq: 2,
          blocks: [{ kind: "future", text: "Unsafe", contentIndex: 0 }],
        },
        {
          sessionUpdate: "agent_segment_finalized",
          segmentSeq: 2,
          blocks: [{ kind: "text", text: null, contentIndex: 0 }],
        },
        {
          sessionUpdate: "agent_segment_finalized",
          segmentSeq: 2,
          blocks: [{ kind: "thought", text: "Unsafe", contentIndex: -1 }],
        },
      ])(
        "isolates a malformed or unsupported $sessionUpdate event and preserves later history",
        async (update) => {
          await storage.save(record());
          await journal.append(SESSION_ID, "event", { sessionId: SESSION_ID, update });
          const valid = {
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Still available" },
            },
          };
          await storage.append(SESSION_ID, "event", valid);
          const loaded = await storage.load(SESSION_ID);
          expect(loaded?.events).toEqual([{ ...valid, seq: 3, origin: "observed" }]);
          expect(loaded?.warnings).toEqual([expect.stringContaining("unsupported session event")]);
          expect(loaded?.journalRecords?.[2].payload).toMatchObject({ update });
        }
      );

      it("preserves segment boundaries, indexed deltas, explicit thought ends and finalized blocks https://github.com/ItsDalk-Lane/Scribe/issues/52", async () => {
        await storage.save(record());
        const updates = [
          { sessionUpdate: "agent_segment_started", futureField: "preserved" },
          {
            sessionUpdate: "agent_thought_chunk",
            segmentSeq: 2,
            contentIndex: 0,
            content: { type: "text", text: "Tentative thought" },
          },
          { sessionUpdate: "agent_thought_ended", segmentSeq: 2, contentIndex: 0 },
          { sessionUpdate: "agent_thought_ended", segmentSeq: 2 },
          {
            sessionUpdate: "agent_message_chunk",
            segmentSeq: 2,
            contentIndex: 1,
            content: { type: "text", text: "Tentative answer" },
          },
          {
            sessionUpdate: "agent_segment_finalized",
            segmentSeq: 2,
            blocks: [
              { kind: "thought", text: "Final thought", contentIndex: 0 },
              { kind: "text", text: "Final answer", contentIndex: 1 },
            ],
          },
        ];
        for (const update of updates)
          await storage.append(SESSION_ID, "event", { sessionId: SESSION_ID, update });
        const loaded = await storage.load(SESSION_ID);
        expect(loaded?.events.map((event) => event.update)).toEqual(updates);
        expect(loaded?.events.map((event) => event.seq)).toEqual([2, 3, 4, 5, 6, 7]);
        expect(loaded?.warnings).toEqual([]);
      });

      it("retains a missing image reference and reports why it cannot be displayed", async () => {
        await storage.save(record());
        const hash = "d".repeat(64);
        await journal.append(SESSION_ID, "protocol_message", {
          message: {
            role: "user",
            content: [{ type: "image", attachmentHash: hash, mimeType: "image/png" }],
            timestamp: 30,
          },
        });
        const loaded = await storage.load(SESSION_ID);
        expect(loaded?.messages[1]).toMatchObject({
          content: [{ type: "image", attachmentHash: hash }],
        });
        expect(loaded?.warnings).toEqual([expect.stringContaining(hash)]);
      });

      it("restores a persisted diagnostic error without altering its message", async () => {
        const saved = record();
        saved.events = [
          {
            sessionId: SESSION_ID,
            update: {
              sessionUpdate: "turn_ended",
              turnId: "turn-1",
              stopReason: "request_error",
              error: new Error("Model request failed"),
            },
          },
        ];
        await storage.save(saved);
        const loaded = await storage.load(SESSION_ID);
        const update = loaded!.events[0].update;
        expect(update.sessionUpdate).toBe("turn_ended");
        if (update.sessionUpdate !== "turn_ended") throw new Error("Missing terminal event");
        expect(update.error).toBeInstanceOf(Error);
        expect(update.error?.message).toBe("Model request failed");
        expect(loaded!.events[0]).toMatchObject({ seq: 2, origin: "observed" });
      });
    });

    describe("flush()", () => {
      it("waits for attachment encoding and the corresponding journal append", async () => {
        await storage.save(record());
        const entered = gate();
        const released = gate();
        const originalPut = attachments.put.bind(attachments);
        jest.spyOn(attachments, "put").mockImplementation(async (bytes) => {
          entered.resolve();
          await released.promise;
          return originalPut(bytes);
        });
        const appended = storage.append(SESSION_ID, "display_state", {
          type: "image",
          data: "AAEC",
          mimeType: "image/png",
        });
        await entered.promise;
        const flushed = storage.flush(SESSION_ID);
        released.resolve();
        await flushed;
        const fact = (await journal.read(SESSION_ID)).records.at(-1);
        expect(fact?.seq).toBe((await appended).seq);
        expect(fact?.payload).toMatchObject({ type: "image", attachmentHash: expect.any(String) });
        expect((await appended).payload).toMatchObject({ type: "image", data: "AAEC" });
      });
    });

    describe("removeSubagent()", () => {
      it("erases only the chosen child recovery data while preserving parent inputs and all sequence identities (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        await storage.save(record());
        const first = childState();
        const second = childState("child-b");
        await storage.append(
          SESSION_ID,
          "subagent_state",
          { version: 1, state: first },
          { durable: true }
        );
        await storage.append(
          SESSION_ID,
          "subagent_state",
          { version: 1, state: second },
          { durable: true }
        );
        await storage.append(SESSION_ID, "protocol_message", {
          taskId: "run-child-a",
          message: { role: "user", content: "需要删除的子指令", timestamp: 2 },
        });
        await storage.append(
          SESSION_ID,
          "subagent_delivery",
          {
            version: 1,
            subagentId: "child-a",
            messageIds: ["message-child-a"],
            resultId: "result-child-a",
            message: { role: "user", content: "主聊天已引用的结论", timestamp: 4 },
          },
          { durable: true }
        );
        await storage.append(
          SESSION_ID,
          "compaction",
          { taskId: "run-child-a", summary: "删除的压缩上下文" },
          { durable: true }
        );
        await storage.append(
          SESSION_ID,
          "tool_result",
          {
            taskId: "run-child-a",
            message: {
              role: "toolResult",
              toolCallId: "old-tool",
              toolName: "read_note",
              isError: false,
              content: [{ type: "text", text: "删除的工具结果" }],
              timestamp: 4,
            },
          },
          { durable: true }
        );
        await storage.append(
          SESSION_ID,
          "subagent_delivery",
          {
            version: 1,
            subagentId: "child-a",
            messageIds: ["message-child-a"],
            resultId: "result-child-a",
            message: { role: "user", content: "主聊天已引用的结论", timestamp: 4 },
          },
          { durable: true }
        );
        const before = (await journal.read(SESSION_ID)).records.map((entry) => entry.seq);
        await storage.removeSubagent(SESSION_ID, "child-a");
        const text = await readFile(join(journal.directory, `${SESSION_ID}.jsonl`), "utf8");
        expect(text).not.toContain("子上下文-child-a");
        expect(text).not.toContain("需要删除的子指令");
        expect(text).not.toContain("删除的压缩上下文");
        expect(text).not.toContain("删除的工具结果");
        expect(text).toContain("主聊天已引用的结论");
        const loaded = await new NodeNativeSessionStorage(journal).load(SESSION_ID);
        expect(loaded?.subagents?.map((entry) => entry.snapshot.id)).toEqual(["child-b"]);
        expect(loaded?.messages.map((message) => message.content)).toEqual([
          "Inspect the note",
          "主聊天已引用的结论",
        ]);
        expect((await journal.read(SESSION_ID)).records.map((entry) => entry.seq)).toEqual(before);
        expect(await readdir(journal.directory)).toEqual([`${SESSION_ID}.jsonl`]);
      });
    });

    describe("remove()", () => {
      it("physically deletes only the explicitly chosen new-format chat", async () => {
        await storage.save(record());
        await storage.save(record(SECOND_ID));
        await storage.remove(SESSION_ID);
        expect(await storage.load(SESSION_ID)).toBeNull();
        expect((await storage.load(SECOND_ID))?.sessionId).toBe(SECOND_ID);
      });
    });

    describe("list()", () => {
      it("lists valid new chats while leaving a malformed neighboring journal and old file intact", async () => {
        const listed = new NodeNativeSessionStorage(directory);
        await listed.save(record());
        await writeFile(join(directory, `${SECOND_ID}.jsonl`), "broken\n");
        await writeFile(join(directory, `${SECOND_ID}.json`), "old history");
        expect((await listed.list()).map((item) => item.sessionId)).toEqual([SESSION_ID]);
        expect(await readFile(join(directory, `${SECOND_ID}.jsonl`), "utf8")).toBe("broken\n");
        expect(await readFile(join(directory, `${SECOND_ID}.json`), "utf8")).toBe("old history");
      });
    });
  });
});
