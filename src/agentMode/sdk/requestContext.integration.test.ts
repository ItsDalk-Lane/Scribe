import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { Context } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { createAssistantMessage, type ProviderChatModel } from "@/LLMProviders/piChatModel";
import { NativeBackendProcess } from "@/agentMode/sdk/NativeBackendProcess";
import { NodeJournalStorage, type JournalRecord } from "@/agentMode/sdk/JournalStorage";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import { NodeAttachmentStorage } from "@/agentMode/sdk/AttachmentStorage";
import type { RequestContextSnapshot } from "@/agentMode/sdk/requestContext";
import { fingerprintRequestContext } from "@/agentMode/session/requestContextFingerprint";
import { isRecord } from "@/utils/obsidianInternals";

const MODEL = {
  id: "request-context-fixture",
  name: "Request context fixture",
  api: "openai-completions" as const,
  provider: "fixture",
  baseUrl: "http://localhost/fixture",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 20000,
  maxTokens: 2000,
};

function fixture(directory: string) {
  const journalDirectory = join(directory, ".scribe", "chats", "v2");
  const attachments = new NodeAttachmentStorage(join(directory, ".scribe", "attachments"));
  const storage = new NodeNativeSessionStorage(
    new NodeJournalStorage(journalDirectory),
    attachments
  );
  const dispatched: Context[] = [];
  const preparations: string[] = [];
  const state = {
    system: "CURRENT SYSTEM RULES",
    runtime: "CURRENT PROJECT SOURCE LIST",
    retries: 1,
    chatRequests: 0,
    rejectChatRequest: 0,
    reportedUsage: 0,
    moved: false,
    beforeReadRules: undefined as (() => Promise<void>) | undefined,
  };
  const provider: ProviderChatModel = {
    model: MODEL,
    stream: () => {
      throw new Error("The fixture uses agentStream only.");
    },
    agentStream: (context, options = {}) => {
      const stream = createAssistantMessageEventStream();
      const message = createAssistantMessage(MODEL);
      void (async () => {
        try {
          const last = context.messages.at(-1);
          const summary =
            typeof last?.content === "string" &&
            last.content.startsWith("Summarize this recorded Obsidian conversation");
          for (let attempt = 0; attempt < state.retries; attempt++) {
            const requestId = `actual-request-${preparations.length + 1}`;
            preparations.push(requestId);
            await options.beforeRequest?.(requestId);
            dispatched.push(JSON.parse(JSON.stringify(context)) as Context);
          }
          if (!summary && ++state.chatRequests === state.rejectChatRequest) {
            options.onFailure?.({ kind: "context" });
            message.stopReason = "error";
            message.errorMessage = "The model rejected the current context window.";
            stream.push({ type: "error", reason: "error", error: message });
            return;
          }
          message.content = [
            { type: "text", text: summary ? "Recorded summary of earlier work" : "Finished" },
          ];
          if (state.reportedUsage) {
            message.usage.input = state.reportedUsage;
            message.usage.totalTokens = state.reportedUsage;
          }
          message.stopReason = "stop";
          stream.push({ type: "start", partial: message });
          stream.push({ type: "done", reason: "stop", message });
        } catch (error) {
          message.stopReason = "error";
          message.errorMessage = error instanceof Error ? error.message : String(error);
          stream.push({ type: "error", reason: "error", error: message });
        }
      })();
      return stream;
    },
  };
  const readNote: AgentTool = {
    name: "read_note",
    label: "Read note",
    description: "Read current project notes",
    parameters: { type: "object", properties: {} },
    execute: async () => ({ content: [{ type: "text", text: "Note" }], details: undefined }),
  };
  const process = new NativeBackendProcess({
    getModels: () => [
      { baseModelId: MODEL.id, name: MODEL.name, provider: MODEL.provider, effortOptions: [] },
    ],
    getDefaultModelId: () => MODEL.id,
    createModel: async () => provider,
    assertScope: () => {
      if (state.moved) throw new Error("The project working folder changed.");
    },
    getSystemPrompt: async () => {
      await state.beforeReadRules?.();
      return state.system;
    },
    getRequestContext: () => state.runtime,
    getManuallyInvokedSkill: (name) =>
      name === "manual-review" ? { name, body: "CURRENT MANUAL SKILL BODY" } : null,
    createTools: () => ({ tools: [readNote] }),
    storage,
    attachments,
  });
  return { process, storage, journalDirectory, dispatched, preparations, state };
}

function send(process: NativeBackendProcess, sessionId: string, promptId: string, text: string) {
  return process.prompt({ sessionId, promptId, prompt: [{ type: "text", text }] });
}

function restoreSnapshot(snapshot: RequestContextSnapshot, facts: readonly JournalRecord[]) {
  return snapshot.messages.map((entry) => {
    const source = facts.find((fact) => fact.seq === entry.seq)?.payload;
    const message = entry.message ?? (isRecord(source) ? source.message : undefined);
    expect(message).toBeDefined();
    expect(fingerprintRequestContext(message)).toBe(entry.fingerprint);
    return message as AgentMessage;
  });
}

describe("requestContext.integration", () => {
  describe("NativeBackendProcess", () => {
    let directory: string;
    let f: ReturnType<typeof fixture>;
    let expectedShutdownError: string | undefined;

    beforeEach(async () => {
      directory = await mkdtemp(join(tmpdir(), "scribe-request-context-"));
      f = fixture(directory);
      expectedShutdownError = undefined;
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      try {
        await f.process.shutdown();
      } catch (error) {
        if (!expectedShutdownError) throw error;
        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toBe(expectedShutdownError);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    });

    describe("prompt()", () => {
      it("rejects a project move during rule reading before submitting a mixed request https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const { sessionId } = await f.process.newSession({
          cwd: directory,
          projectId: "move-test",
        });
        f.state.beforeReadRules = async () => {
          f.state.moved = true;
          f.state.runtime = "NEW FOLDER SOURCE LIST";
        };
        await send(f.process, sessionId, "move", "Review this project");
        expect(f.dispatched).toHaveLength(0);
        expect(
          (await f.storage.load(sessionId))?.journalRecords?.some(
            (fact) => fact.kind === "request_context"
          )
        ).toBe(false);
      });

      it("stops dispatch if the project moves while the prepared request is saved https://github.com/ItsDalk-Lane/Scribe/issues/71", async () => {
        const { sessionId } = await f.process.newSession({
          cwd: directory,
          projectId: "move-test",
        });
        const append = f.storage.append.bind(f.storage);
        jest.spyOn(f.storage, "append").mockImplementation(async (...args) => {
          const fact = await append(...args);
          if (fact.kind === "request_context") f.state.moved = true;
          return fact;
        });
        await send(f.process, sessionId, "move-during-save", "Review this project");
        expect(f.preparations).toHaveLength(1);
        expect(f.dispatched).toHaveLength(0);
        expect(
          (await f.storage.load(sessionId))?.journalRecords?.some(
            (fact) => fact.kind === "request_context"
          )
        ).toBe(true);
      });

      it("keeps the previous request as an exact prefix when only a follow-up question is added", async () => {
        const { sessionId } = await f.process.newSession({ cwd: directory });
        await send(f.process, sessionId, "initial", "Review these notes");
        await send(f.process, sessionId, "followup", "Continue the review");
        const initial = f.dispatched[0].messages;
        const followup = f.dispatched[1].messages;
        expect(followup.slice(0, initial.length)).toEqual(initial);
        expect(
          followup.filter(
            (message) =>
              typeof message.content === "string" && message.content.includes("<runtime_context>")
          )
        ).toHaveLength(1);
        expect(followup.at(-1)?.content).toEqual([{ type: "text", text: "Continue the review" }]);
        f.state.runtime = "CURRENT REPLACEMENT PROJECT SOURCES";
        await send(f.process, sessionId, "updated", "Use the updated selection");
        const changed = f.dispatched[2].messages;
        expect(JSON.stringify(changed)).toContain("CURRENT REPLACEMENT PROJECT SOURCES");
        expect(JSON.stringify(changed)).not.toContain("CURRENT PROJECT SOURCE LIST");
        const stored = await f.storage.load(sessionId);
        expect(
          stored?.messages
            .filter((message) => message.role === "user")
            .map((message) => message.content)
        ).toEqual([
          [{ type: "text", text: "Review these notes" }],
          [{ type: "text", text: "Continue the review" }],
          [{ type: "text", text: "Use the updated selection" }],
        ]);
      });

      it("reopens a saved image request preview after attachment hydration without treating restored metadata as changed content", async () => {
        const { sessionId } = await f.process.newSession({ cwd: directory });
        const data = "aW1hZ2UgYnl0ZXM=";
        await f.process.prompt({
          sessionId,
          promptId: "image-request",
          prompt: [
            { type: "text", text: "/manual-review Inspect the attached image" },
            { type: "image", data, mimeType: "image/png" },
          ],
        });
        const initial = await f.process.getRequestContextPreview({ sessionId });
        expect(initial?.content).toContain(data);
        await f.process.closeSession({ sessionId });
        await f.process.loadSession({ sessionId, cwd: directory });

        const reopened = await f.process.getRequestContextPreview({ sessionId });
        expect(reopened?.requestId).toBe(initial?.requestId);
        expect(JSON.parse(reopened!.content).messages).toEqual(f.dispatched[0].messages);
        expect(reopened!.content).not.toContain("attachmentHash");
        expect(JSON.parse(reopened!.content).messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "user",
              content: expect.arrayContaining([
                expect.objectContaining({ type: "image", data, mimeType: "image/png" }),
              ]),
            }),
          ])
        );
        await send(f.process, sessionId, "resumed-request", "Continue using the current state");
        const resumed = f.dispatched.at(-1)!.messages;
        expect(resumed.at(-1)?.content).toContain("<current_context_update>");
        expect(resumed.at(-1)?.content).toContain("CURRENT PROJECT SOURCE LIST");
      });

      it("preserves the user's words and restores the actual system, skill, runtime and tool input from request snapshots after reopening", async () => {
        const { sessionId } = await f.process.newSession({ cwd: directory });
        const original = "/manual-review Check these notes";
        await f.process.prompt({
          sessionId,
          promptId: "manual-request",
          prompt: [{ type: "text", text: original }],
        });
        await f.process.prompt({
          sessionId,
          promptId: "followup",
          prompt: [{ type: "text", text: "Continue" }],
        });
        const preview = await f.process.getRequestContextPreview({ sessionId });
        expect(JSON.parse(preview!.content).messages).toEqual(f.dispatched[1].messages);
        f.state.system = "NEW SYSTEM RULES NOT YET SENT";
        expect(await f.process.getRequestContextPreview({ sessionId })).toEqual(preview);
        await f.process.closeSession({ sessionId });

        const reopened = await new NodeNativeSessionStorage(
          new NodeJournalStorage(f.journalDirectory)
        ).load(sessionId);
        const facts = reopened!.journalRecords!;
        const contexts = facts.filter((fact) => fact.kind === "request_context");
        expect(contexts).toHaveLength(2);
        const first = contexts[0].payload as {
          requestId: string;
          snapshot: RequestContextSnapshot;
        };
        expect(first.requestId).toBe("actual-request-1");
        const actual = restoreSnapshot(first.snapshot, facts);
        expect(JSON.stringify(actual)).toContain("CURRENT SYSTEM RULES");
        expect(JSON.stringify(actual)).toContain("CURRENT MANUAL SKILL BODY");
        expect(JSON.stringify(actual)).toContain("CURRENT PROJECT SOURCE LIST");
        expect(JSON.stringify(actual)).toContain("Current execution mode: default");
        expect(first.snapshot.tools).toEqual([
          {
            name: "read_note",
            description: "Read current project notes",
            parameters: { type: "object", properties: {} },
          },
        ]);
        expect(JSON.stringify(first.snapshot.tools)).not.toContain("execute");
        expect(actual).toEqual(f.dispatched[0].messages);
        const second = contexts[1].payload as { snapshot: RequestContextSnapshot };
        expect(second.snapshot.messages.some((entry) => entry.seq !== undefined)).toBe(true);
        expect(restoreSnapshot(second.snapshot, facts)).toEqual(f.dispatched[1].messages);
        const recordedUsers = reopened!.messages.filter((message) => message.role === "user");
        expect(recordedUsers[0].content).toEqual([{ type: "text", text: original }]);
        expect(JSON.stringify(recordedUsers)).not.toContain("CURRENT MANUAL SKILL BODY");
        await f.process.loadSession({ sessionId, cwd: directory });
        expect(await f.process.getRequestContextPreview({ sessionId })).toEqual(preview);
      });

      it("refreshes and clears project context for subsequent requests and restores current context after compaction and reopening", async () => {
        const { sessionId } = await f.process.newSession({ cwd: directory });
        await send(f.process, sessionId, "first", "Inspect my project");
        expect(JSON.stringify(f.dispatched.at(-1)?.messages)).toContain(
          "CURRENT PROJECT SOURCE LIST"
        );

        f.state.runtime = "REPLACEMENT PROJECT SOURCES";
        await send(f.process, sessionId, "updated", "Use the updated selection");
        expect(JSON.stringify(f.dispatched.at(-1)?.messages)).toContain(
          "REPLACEMENT PROJECT SOURCES"
        );
        expect(JSON.stringify(f.dispatched.at(-1)?.messages)).not.toContain(
          "CURRENT PROJECT SOURCE LIST"
        );

        f.state.runtime = "";
        await send(f.process, sessionId, "cleared", "Continue with the current selection");
        expect(JSON.stringify(f.dispatched.at(-1)?.messages)).not.toContain(
          "REPLACEMENT PROJECT SOURCES"
        );

        f.state.runtime = "PROJECT SOURCES AFTER COMPACTION";
        await send(f.process, sessionId, "compact", "/compact");
        expect(
          (await f.storage.load(sessionId))?.journalRecords?.some(
            (fact) => fact.kind === "compaction"
          )
        ).toBe(true);
        await send(f.process, sessionId, "after-compact", "Continue after summarizing");
        expect(JSON.stringify(f.dispatched.at(-1)?.messages)).toContain(
          "PROJECT SOURCES AFTER COMPACTION"
        );
        expect(JSON.stringify(f.dispatched.at(-1)?.messages)).not.toContain(
          "REPLACEMENT PROJECT SOURCES"
        );

        await f.process.closeSession({ sessionId });
        f.state.runtime = "PROJECT SOURCES AFTER REOPENING";
        await f.process.loadSession({ sessionId, cwd: directory });
        await send(f.process, sessionId, "reopened", "Continue the reopened chat");
        expect(JSON.stringify(f.dispatched.at(-1)?.messages)).toContain(
          "PROJECT SOURCES AFTER REOPENING"
        );
        expect(JSON.stringify(f.dispatched.at(-1)?.messages)).not.toContain(
          "PROJECT SOURCES AFTER COMPACTION"
        );
      });

      it("reuses the same request snapshot across ordinary network retries", async () => {
        f.state.retries = 2;
        const { sessionId } = await f.process.newSession({ cwd: directory });
        await send(f.process, sessionId, "retried", "Inspect these notes");
        const facts = (await f.storage.load(sessionId))!.journalRecords!;
        const snapshots = facts
          .filter((fact) => fact.kind === "request_context")
          .map(
            (fact) =>
              fact.payload as {
                requestId: string;
                promptId: string;
                snapshot: RequestContextSnapshot;
              }
          );
        expect(snapshots.map((fact) => fact.requestId)).toEqual([
          "actual-request-1",
          "actual-request-2",
        ]);
        expect(snapshots.map((fact) => fact.promptId)).toEqual(["retried", "retried"]);
        expect(snapshots[1].snapshot.fingerprint).toBe(snapshots[0].snapshot.fingerprint);
        expect(f.dispatched[0]).toEqual(f.dispatched[1]);
      });

      it("rechecks a larger system prompt before dispatch instead of reusing the previous response's small usage baseline https://github.com/ItsDalk-Lane/Scribe/issues/57", async () => {
        f.state.reportedUsage = 1000;
        const { sessionId } = await f.process.newSession({ cwd: directory });
        await send(f.process, sessionId, "small-system", "Inspect my notes");
        expect(f.dispatched).toHaveLength(1);

        f.state.system = "LARGE CURRENT SYSTEM RULES ".repeat(3000);
        await send(f.process, sessionId, "large-system", "Continue under the current rules");

        expect(f.dispatched).toHaveLength(1);
        const saved = await f.storage.load(sessionId);
        expect(
          saved?.events.findLast((event) => event.update.sessionUpdate === "turn_ended")
        ).toMatchObject({ update: { turnId: "large-system", stopReason: "context_limit" } });
      });

      it("links the failed chat, summary and changed recovery snapshot to the same user request", async () => {
        f.state.rejectChatRequest = 2;
        const { sessionId } = await f.process.newSession({ cwd: directory });
        await send(f.process, sessionId, "earlier", "Original task requirements");
        await send(f.process, sessionId, "recover", "Continue the same task");
        const facts = (await f.storage.load(sessionId))!.journalRecords!;
        const snapshots = facts
          .filter((fact) => fact.kind === "request_context")
          .map(
            (fact) =>
              fact.payload as {
                requestId: string;
                promptId: string;
                purpose: string;
                previousRequestFingerprint?: string;
                snapshot: RequestContextSnapshot;
              }
          );
        const chatSteps = snapshots.filter(
          (fact) => fact.purpose === "chat" && fact.promptId === "recover"
        );
        expect(chatSteps).toHaveLength(2);
        const summaries = snapshots.filter((fact) => fact.purpose === "compaction");
        expect(summaries).toHaveLength(1);
        expect(summaries[0].promptId).toBe("recover");
        expect(chatSteps[1].snapshot.fingerprint).not.toBe(chatSteps[0].snapshot.fingerprint);
        expect(summaries[0].previousRequestFingerprint).toBe(chatSteps[0].snapshot.fingerprint);
        expect(chatSteps[1].previousRequestFingerprint).toBe(summaries[0].snapshot.fingerprint);
        expect(JSON.stringify(restoreSnapshot(chatSteps[1].snapshot, facts))).toContain(
          "Recorded summary of earlier work"
        );
        expect(f.state.chatRequests).toBe(3);
      });

      it("stops before simulated network dispatch when the actual request snapshot cannot be saved", async () => {
        const { sessionId } = await f.process.newSession({ cwd: directory });
        expectedShutdownError = "Snapshot disk failed";
        const append = f.storage.append.bind(f.storage);
        jest.spyOn(f.storage, "append").mockImplementation((id, kind, payload, options) => {
          if (kind === "request_context") return Promise.reject(new Error("Snapshot disk failed"));
          return append(id, kind, payload, options);
        });

        await expect(
          f.process.prompt({
            sessionId,
            promptId: "failed-snapshot",
            prompt: [{ type: "text", text: "Inspect the notes" }],
          })
        ).rejects.toThrow("Snapshot disk failed");

        expect(f.preparations).toEqual(["actual-request-1"]);
        expect(f.dispatched).toEqual([]);
        const stored = await f.storage.load(sessionId);
        expect(stored?.journalRecords?.some((fact) => fact.kind === "request_context")).toBe(false);
        expect(stored?.messages.some((message) => message.role === "assistant")).toBe(false);
      });
    });
  });
});
