import { access, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { App, FileSystemAdapter } from "obsidian";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { normalizeContext } from "@earendil-works/pi-ai/utils/transcript";
import type {
  AssistantMessageEventStream,
  JsonObject,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { createAssistantMessage, type ProviderChatModel } from "@/LLMProviders/piChatModel";
import {
  NativeBackendProcess,
  type NativeBackendProcessOptions,
} from "@/agentMode/sdk/NativeBackendProcess";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  PermissionDecision,
  PermissionPrompt,
  SessionEvent,
} from "@/agentMode/session/types";

const MODEL = {
  id: "fixture-model",
  name: "Fixture model",
  api: "openai-completions" as const,
  provider: "fixture",
  baseUrl: "http://localhost/fixture",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 20000,
  maxTokens: 2000,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function response(
  text: string,
  calls: Array<{ id: string; name: string; arguments: JsonObject }> = []
): AssistantMessageEventStream {
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

function userText(context: TranscriptContext): string {
  const user = context.messages.find((message) => message.role === "user");
  return user?.role === "user"
    ? typeof user.content === "string"
      ? user.content
      : user.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
    : "";
}

function results(context: TranscriptContext) {
  return context.messages.filter((message) => message.role === "toolResult");
}

describe("NativeBackendProcess integration", () => {
  describe("NativeBackendProcess", () => {
    let root: string;
    let data: string;
    let adapter: FileSystemAdapter;
    let beforeRead: (path: string) => Promise<void>;
    let writeCount: number;
    let processes: NativeBackendProcess[];

    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "scribe-native-integration-vault-"));
      data = await mkdtemp(join(tmpdir(), "scribe-native-integration-data-"));
      writeCount = 0;
      beforeRead = async () => {};
      processes = [];
      adapter = new FileSystemAdapter();
      adapter.getBasePath = () => root;
      adapter.read = async (path: string) => {
        await beforeRead(path);
        return readFile(join(root, path), "utf8");
      };
      adapter.write = async (path: string, text: string) => {
        writeCount++;
        await writeFile(join(root, path), text);
      };
      adapter.exists = async (path: string) => {
        try {
          await access(join(root, path));
          return true;
        } catch {
          return false;
        }
      };
      adapter.mkdir = async (path: string) => {
        await mkdir(join(root, path), { recursive: true });
      };
      adapter.list = async (path: string) => {
        const entries = await readdir(join(root, path), { withFileTypes: true });
        return {
          files: entries
            .filter((entry) => entry.isFile())
            .map((entry) => relative(root, join(root, path, entry.name))),
          folders: entries
            .filter((entry) => entry.isDirectory())
            .map((entry) => relative(root, join(root, path, entry.name))),
        };
      };
    });

    afterEach(async () => {
      await Promise.all(processes.map((process) => process.shutdown()));
      await rm(root, { recursive: true, force: true });
      await rm(data, { recursive: true, force: true });
    });

    function fixture(
      responder: (context: TranscriptContext) => AssistantMessageEventStream,
      onEvent?: (event: SessionEvent) => void,
      maxSteps?: number,
      overrides: Partial<NativeBackendProcessOptions> = {}
    ) {
      const contexts: TranscriptContext[] = [];
      const events: SessionEvent[] = [];
      const provider: ProviderChatModel = {
        model: MODEL,
        stream: (context) => responder(normalizeContext(context)),
        agentStream: (context) => {
          const normalized = normalizeContext(context);
          contexts.push(JSON.parse(JSON.stringify(normalized)));
          return responder(normalized);
        },
      };
      const process = new NativeBackendProcess({
        maxSteps,
        getModels: () => [
          { baseModelId: MODEL.id, name: MODEL.name, provider: MODEL.provider, effortOptions: [] },
        ],
        getDefaultModelId: () => MODEL.id,
        createModel: async () => provider,
        getSystemPrompt: async () => "Fixture Obsidian assistant",
        storage: new NodeNativeSessionStorage(join(data, "sessions")),
        createTools: (context) => {
          const commandTasks = new NativeCommandTasks({
            cwd: context.cwd,
            sessionId: context.sessionId,
            outputDirectory: join(data, "commands"),
            emit: context.emit,
          });
          return {
            tools: createNativeTools({
              ...context,
              app: { vault: { adapter } } as unknown as App,
              commandTasks,
            }),
            stopTask: (id) => commandTasks.stop(id),
            shutdown: () => commandTasks.shutdown(),
          };
        },
        ...overrides,
      });
      processes.push(process);
      process.setPermissionPrompter(async () => ({
        outcome: { outcome: "selected", optionId: "allow_once" },
      }));
      return {
        process,
        contexts,
        events,
        async open() {
          const opened = await process.newSession({ cwd: root, projectId: "project-a" });
          process.registerSessionHandler(opened.sessionId, (event) => {
            events.push(event);
            onEvent?.(event);
          });
          return opened.sessionId;
        },
        send: (sessionId: string, text = "Inspect notes") =>
          process.prompt({ sessionId, promptId: "turn-main", prompt: [{ type: "text", text }] }),
      };
    }

    describe("prompt()", () => {
      it("does not let a late failed save for an ended turn settle the next real-session reply", async () => {
        const storage = new NodeNativeSessionStorage(join(data, "late-save"));
        const failOldSave = deferred<void>();
        const nextStarted = deferred<void>();
        const nextStream = createAssistantMessageEventStream();
        let holdSave = true;
        let requests = 0;
        const f = fixture(
          () => {
            if (++requests === 2) {
              nextStarted.resolve();
              return nextStream;
            }
            return response("First answer");
          },
          undefined,
          undefined,
          {
            storage: {
              load: (id) => storage.load(id),
              list: () => storage.list(),
              save: async (record) => {
                if (holdSave && record.events.at(-1)?.update.sessionUpdate === "turn_ended") {
                  holdSave = false;
                  await failOldSave.promise;
                  throw new Error("Late ending save failed");
                }
                await storage.save(record);
              },
            },
          }
        );
        const originalPrompt = f.process.prompt.bind(f.process);
        const admitted: Promise<void>[] = [];
        jest.spyOn(f.process, "prompt").mockImplementation((input) => {
          const result = originalPrompt(input);
          admitted.push(result);
          return result;
        });
        const session = AgentSession.start({
          backend: f.process,
          cwd: root,
          internalId: "native-late-save",
          backendId: "native",
          defaultModelSelection: { baseModelId: MODEL.id, effort: null },
          getDescriptor: () => ({
            ...NativeBackendDescriptor,
            getEnabledModelEntries: () => [
              { baseModelId: MODEL.id, name: MODEL.name, credentialState: "ok" },
            ],
          }),
        });
        await session.ready;
        await session.sendPrompt("First request").turn;
        const next = session.sendPrompt("Next request");
        await nextStarted.promise;
        failOldSave.resolve();
        await expect(admitted[0]).rejects.toThrow("Late ending save failed");
        expect(session.getStatus()).toBe("running");
        const message = createAssistantMessage(MODEL);
        message.stopReason = "stop";
        message.content = [{ type: "text", text: "Next answer" }];
        nextStream.push({
          type: "text_delta",
          contentIndex: 0,
          delta: "Next answer",
          partial: message,
        });
        nextStream.push({ type: "done", reason: "stop", message });
        await expect(next.turn).resolves.toBe("end_turn");
        expect(session.getStatus()).toBe("idle");
        expect(requests).toBe(2);
        expect(JSON.stringify(session.store.getDisplayMessages())).not.toContain(
          "Late ending save failed"
        );
      });

      it("settles a real session after storage fails and allows a new prompt once storage recovers", async () => {
        const storage = new NodeNativeSessionStorage(join(data, "storage-failure"));
        let fail = false;
        const f = fixture(() => response("Actual answer"), undefined, undefined, {
          storage: {
            load: (id) => storage.load(id),
            list: () => storage.list(),
            save: async (record) => {
              if (fail) throw new Error("Native session storage unavailable");
              await storage.save(record);
            },
          },
        });
        const session = AgentSession.start({
          backend: f.process,
          cwd: root,
          internalId: "native-storage-failure",
          backendId: "native",
          defaultModelSelection: { baseModelId: MODEL.id, effort: null },
          getDescriptor: () => ({
            ...NativeBackendDescriptor,
            getEnabledModelEntries: () => [
              { baseModelId: MODEL.id, name: MODEL.name, credentialState: "ok" },
            ],
          }),
        });
        await session.ready;
        fail = true;
        await expect(session.sendPrompt("First request").turn).rejects.toThrow(
          "Native session storage unavailable"
        );
        expect(session.getStatus()).toBe("error");
        fail = false;
        await expect(session.sendPrompt("Recover and continue").turn).resolves.toBe("end_turn");
        expect(session.getStatus()).toBe("idle");
        expect(JSON.stringify(session.store.getDisplayMessages())).toContain("Actual answer");
      });

      it("settles a real session when model preparation fails before a provider request is sent", async () => {
        let prompts = 0;
        const responder = jest.fn(() => response("Not requested"));
        const f = fixture(responder, undefined, undefined, {
          getSystemPrompt: async () => {
            if (++prompts > 1) throw new Error("Instruction loading failed");
            return "Obsidian assistant";
          },
        });
        const session = AgentSession.start({
          backend: f.process,
          cwd: root,
          internalId: "native-failed-preparation",
          backendId: "native",
          defaultModelSelection: { baseModelId: MODEL.id, effort: null },
          getDescriptor: () => ({
            ...NativeBackendDescriptor,
            getEnabledModelEntries: () => [
              { baseModelId: MODEL.id, name: MODEL.name, credentialState: "ok" },
            ],
          }),
        });
        await session.ready;
        await expect(session.sendPrompt("Inspect a note").turn).rejects.toThrow(
          "Instruction loading failed"
        );
        expect(session.getStatus()).toBe("error");
        expect(responder).not.toHaveBeenCalled();
        expect(JSON.stringify(session.store.getDisplayMessages())).toContain(
          "Instruction loading failed"
        );
      });

      it("continues an output-limited reply through the real session without queuing into the ended turn", async () => {
        let requests = 0;
        const f = fixture(() => {
          requests++;
          if (requests !== 1) return response("Continuation completed");
          const stream = createAssistantMessageEventStream();
          const message = createAssistantMessage(MODEL);
          message.content = [{ type: "text", text: "Partial answer" }];
          message.stopReason = "length";
          stream.push({ type: "start", partial: message });
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: "Partial answer",
            partial: message,
          });
          stream.push({ type: "done", reason: "length", message });
          return stream;
        });
        const session = AgentSession.start({
          backend: f.process,
          cwd: root,
          internalId: "native-real-session",
          backendId: "native",
          defaultModelSelection: { baseModelId: MODEL.id, effort: null },
          getDescriptor: () => ({
            ...NativeBackendDescriptor,
            getEnabledModelEntries: () => [
              { baseModelId: MODEL.id, name: MODEL.name, credentialState: "ok" },
            ],
          }),
        });
        await session.ready;
        const ended = await session.sendPrompt("Write an answer").turn;
        expect(ended).toBe("end_turn");
        expect(requests).toBe(2);
        expect(session.getStatus()).toBe("idle");
        expect(JSON.stringify(session.store.getDisplayMessages())).toContain(
          "Continuation completed"
        );
      });

      it("returns two real read results in model call order while the faster tool completes first", async () => {
        await writeFile(join(root, "slow.md"), "slow-marker-81");
        await writeFile(join(root, "fast.md"), "fast-marker-32");
        const fastRead = deferred<void>();
        beforeRead = async (path) => {
          if (path === "slow.md") await fastRead.promise;
        };
        const f = fixture(
          (context) =>
            results(context).length === 0
              ? response("", [
                  { id: "read-slow", name: "read_note", arguments: { path: "slow.md" } },
                  { id: "read-fast", name: "read_note", arguments: { path: "fast.md" } },
                ])
              : response(
                  JSON.stringify(
                    results(context).map((result) => ({
                      id: result.toolCallId,
                      content: result.content,
                    }))
                  )
                ),
          (event) => {
            if (
              event.update.sessionUpdate === "tool_call_update" &&
              event.update.toolCallId === "turn-main:read-fast" &&
              event.update.status === "completed"
            )
              fastRead.resolve();
          }
        );
        const id = await f.open();
        await f.send(id);
        const returned = results(f.contexts[1]);
        expect(returned.map((result) => result.toolCallId)).toEqual(["read-slow", "read-fast"]);
        expect(returned[0].content).toContainEqual({ type: "text", text: "slow-marker-81" });
        expect(returned[1].content).toContainEqual({ type: "text", text: "fast-marker-32" });
        const finished = f.events.flatMap((event) =>
          event.update.sessionUpdate === "tool_call_update" && event.update.status === "completed"
            ? [event.update.toolCallId]
            : []
        );
        expect(finished.indexOf("turn-main:read-fast")).toBeLessThan(
          finished.indexOf("turn-main:read-slow")
        );
      });

      it("writes a real note after approval and persists the exact file diff used by the chat", async () => {
        let round = 0;
        const f = fixture(() =>
          ++round === 1
            ? response("", [
                {
                  id: "write-1",
                  name: "write_note",
                  arguments: { path: "new.md", content: "First paragraph" },
                },
              ])
            : round === 2
              ? response("", [
                  {
                    id: "edit-2",
                    name: "edit_note",
                    arguments: { path: "new.md", old_text: "First", new_text: "Final" },
                  },
                ])
              : response("Saved")
        );
        const id = await f.open();
        await f.send(id);
        expect(await readFile(join(root, "new.md"), "utf8")).toBe("Final paragraph");
        const record = await new NodeNativeSessionStorage(join(data, "sessions")).load(id);
        expect(record?.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "tool_call_update",
              toolCallId: "turn-main:edit-2",
              content: expect.arrayContaining([
                {
                  type: "diff",
                  path: "new.md",
                  oldText: "First paragraph",
                  newText: "Final paragraph",
                },
              ]),
            }),
          })
        );
        expect(record?.decisions).toHaveLength(2);
      });

      it("reports a child that reaches its step limit as failed instead of a completed empty result", async () => {
        await writeFile(join(root, "limit.md"), "Read but not a final child answer");
        const f = fixture(
          (context) =>
            userText(context) === "Limited child"
              ? response("", [
                  { id: "limited-read", name: "read_note", arguments: { path: "limit.md" } },
                ])
              : response("", [
                  {
                    id: "limited-delegate",
                    name: "delegate_task",
                    arguments: { prompt: "Limited child", description: "Limited child" },
                  },
                ]),
          undefined,
          1
        );
        const id = await f.open();
        await f.send(id, "Parent limited task");
        const ended = f.events.flatMap((event) =>
          event.update.sessionUpdate === "task_ended" ? [event.update] : []
        );
        expect(ended).toHaveLength(1);
        expect(ended[0].status).toBe("failed");
        const saved = await new NodeNativeSessionStorage(join(data, "sessions")).load(id);
        expect(saved?.messages).toContainEqual(
          expect.objectContaining({
            role: "toolResult",
            toolCallId: "limited-delegate",
            isError: true,
          })
        );
      });

      it("isolates simultaneous child questions and permissions with repeated model call IDs and returns each child's actual result", async () => {
        const allPending = deferred<void>();
        const childBFinished = deferred<void>();
        const permissions: Array<{
          prompt: PermissionPrompt;
          resolve: (answer: PermissionDecision) => void;
        }> = [];
        const questions: Array<{
          prompt: AskUserQuestionPrompt;
          resolve: (answer: AgentQuestionAnswers) => void;
        }> = [];
        const ready = () => {
          if (permissions.length + questions.length === 4) allPending.resolve();
        };
        const f = fixture(
          (context) => {
            const child = userText(context);
            if (child === "Child A" || child === "Child B") {
              const suffix = child.endsWith("A") ? "A" : "B";
              return results(context).length === 0
                ? response("", [
                    {
                      id: "same-ask",
                      name: "ask_user",
                      arguments: {
                        questions: [
                          {
                            question: `Answer for ${suffix}`,
                            answerKey: "answer",
                            options: [{ label: "Confirm" }],
                          },
                        ],
                      },
                    },
                    {
                      id: "same-write",
                      name: "write_note",
                      arguments: { path: `child-${suffix}.md`, content: `Written by ${suffix}` },
                    },
                  ])
                : response(
                    JSON.stringify(
                      results(context).map((result) => ({
                        id: result.toolCallId,
                        content: result.content,
                        error: result.isError,
                      }))
                    )
                  );
            }
            return results(context).length === 0
              ? response("", [
                  {
                    id: "parent-A",
                    name: "delegate_task",
                    arguments: { prompt: "Child A", description: "Inspect A" },
                  },
                  {
                    id: "parent-B",
                    name: "delegate_task",
                    arguments: { prompt: "Child B", description: "Inspect B" },
                  },
                ])
              : response("Both children returned");
          },
          (event) => {
            if (
              event.update.sessionUpdate === "task_ended" &&
              event.update.summary?.includes("Actual B")
            )
              childBFinished.resolve();
          }
        );
        f.process.setPermissionPrompter(
          (prompt) =>
            new Promise((resolve) => {
              permissions.push({ prompt, resolve });
              prompt.signal?.addEventListener(
                "abort",
                () => resolve({ outcome: { outcome: "cancelled" } }),
                { once: true }
              );
              ready();
            })
        );
        f.process.setAskUserQuestionPrompter(
          (prompt) =>
            new Promise((resolve) => {
              questions.push({ prompt, resolve });
              prompt.signal?.addEventListener("abort", () => resolve({}), { once: true });
              ready();
            })
        );
        const id = await f.open();
        const running = f.send(id, "Parent task");
        await allPending.promise;
        expect(new Set(permissions.map((entry) => entry.prompt.toolCall.toolCallId)).size).toBe(2);
        expect(new Set(questions.map((entry) => entry.prompt.requestId)).size).toBe(2);
        expect(permissions.every((entry) => typeof entry.prompt.requester === "object")).toBe(true);
        const permissionFor = (suffix: string) =>
          permissions.find((entry) =>
            JSON.stringify(entry.prompt.toolCall.rawInput).includes(`child-${suffix}.md`)
          )!;
        const questionFor = (suffix: string) =>
          questions.find((entry) => entry.prompt.questions[0].question === `Answer for ${suffix}`)!;
        permissionFor("B").resolve({ outcome: { outcome: "selected", optionId: "reject_once" } });
        questionFor("B").resolve({ answer: "Actual B" });
        await childBFinished.promise;
        await expect(access(join(root, "child-A.md"))).rejects.toThrow();
        permissionFor("A").resolve({ outcome: { outcome: "selected", optionId: "allow_once" } });
        questionFor("A").resolve({ answer: "Actual A" });
        await running;
        expect(await readFile(join(root, "child-A.md"), "utf8")).toBe("Written by A");
        await expect(access(join(root, "child-B.md"))).rejects.toThrow();
        const parentResults = f.contexts
          .map(results)
          .find((entries) => entries.some((entry) => entry.toolCallId === "parent-A"))!;
        expect(parentResults.map((entry) => entry.toolCallId)).toEqual(["parent-A", "parent-B"]);
        expect(JSON.stringify(parentResults[0])).toContain("Actual A");
        expect(JSON.stringify(parentResults[0])).not.toContain("Actual B");
        expect(JSON.stringify(parentResults[1])).toContain("Actual B");
        expect(JSON.stringify(parentResults[1])).toContain("Permission denied");
      });
    });

    describe("stopTask()", () => {
      it("marks a real child waiting for an answer as stopped when that child is stopped", async () => {
        const questionAsked = deferred<AskUserQuestionPrompt>();
        const f = fixture((context) => {
          if (userText(context) === "Waiting child")
            return response("", [
              {
                id: "waiting-question",
                name: "ask_user",
                arguments: {
                  questions: [{ question: "Keep waiting?", options: [{ label: "Yes" }] }],
                },
              },
            ]);
          return results(context).length === 0
            ? response("", [
                {
                  id: "waiting-delegate",
                  name: "delegate_task",
                  arguments: { prompt: "Waiting child", description: "Waiting child" },
                },
              ])
            : response("Child has stopped");
        });
        f.process.setAskUserQuestionPrompter(
          (prompt) =>
            new Promise((resolve) => {
              prompt.signal?.addEventListener("abort", () => resolve({}), { once: true });
              questionAsked.resolve(prompt);
            })
        );
        const id = await f.open();
        const running = f.send(id, "Parent waiting task");
        await questionAsked.promise;
        const child = f.events.flatMap((event) =>
          event.update.sessionUpdate === "task_started" && event.update.kind === "subagent"
            ? [event.update]
            : []
        )[0];
        await f.process.stopTask({ sessionId: id, taskId: child.taskId! });
        await running;
        expect(f.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "task_ended",
              taskId: child.taskId,
              status: "stopped",
            }),
          })
        );
      });

      it("keeps real background commands alive after the main reply and stops only the requested task", async () => {
        const ready = deferred<void>();
        const f = fixture(
          (context) =>
            results(context).length === 0
              ? response("", [
                  {
                    id: "command-A",
                    name: "run_command",
                    arguments: {
                      command: `"${process.execPath}" -e "process.stdout.write('ready-A');setInterval(() => {},1000)"`,
                      background: true,
                    },
                  },
                  {
                    id: "command-B",
                    name: "run_command",
                    arguments: {
                      command: `"${process.execPath}" -e "process.stdout.write('ready-B');setInterval(() => {},1000)"`,
                      background: true,
                    },
                  },
                ])
              : response("Commands are running"),
          (event) => {
            if (
              event.update.sessionUpdate === "task_progress" &&
              event.update.progress?.description?.includes("ready-A")
            )
              ready.resolve();
          }
        );
        const id = await f.open();
        await f.send(id);
        await ready.promise;
        const started = f.events.flatMap((event) =>
          event.update.sessionUpdate === "task_started" && event.update.kind === "command"
            ? [event.update]
            : []
        );
        expect(started).toHaveLength(2);
        expect(f.events).toContainEqual(
          expect.objectContaining({ update: { sessionUpdate: "busy_changed", busy: false } })
        );
        expect(f.events.some((event) => event.update.sessionUpdate === "task_ended")).toBe(false);
        await f.process.stopTask({ sessionId: id, taskId: started[0].taskId! });
        expect(f.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "task_ended",
              taskId: started[0].taskId,
              status: "stopped",
            }),
          })
        );
        expect(
          f.events.some(
            (event) =>
              event.update.sessionUpdate === "task_ended" &&
              event.update.taskId === started[1].taskId
          )
        ).toBe(false);
        await f.process.stopTask({ sessionId: id, taskId: started[1].taskId! });
      });
    });

    describe("loadSession()", () => {
      it("restores real saved history and task records without another model request or tool side effect", async () => {
        const first = fixture((context) =>
          results(context).length === 0
            ? response("", [
                {
                  id: "saved-write",
                  name: "write_note",
                  arguments: { path: "saved.md", content: "Saved once" },
                },
                {
                  id: "saved-command",
                  name: "run_command",
                  arguments: {
                    command: `"${process.execPath}" -e "setInterval(() => {},1000)"`,
                    background: true,
                  },
                },
              ])
            : response("Recorded reply")
        );
        const id = await first.open();
        await first.send(id);
        await first.process.closeSession({ sessionId: id });
        const before = writeCount;
        const outputFiles = await readdir(join(data, "commands"));
        const restored = fixture(() => {
          throw new Error("History replay must not call a model");
        });
        restored.process.registerSessionHandler(id, (event) => restored.events.push(event));
        await restored.process.loadSession({ sessionId: id, cwd: root, projectId: "project-a" });
        expect(writeCount).toBe(before);
        expect(restored.contexts).toEqual([]);
        expect(await readdir(join(data, "commands"))).toEqual(outputFiles);
        expect(restored.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({ sessionUpdate: "task_started", kind: "command" }),
          })
        );
        expect(restored.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({ sessionUpdate: "task_ended", status: "stopped" }),
          })
        );
        expect(await readFile(join(root, "saved.md"), "utf8")).toBe("Saved once");
        expect(restored.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "Recorded reply" },
            }),
          })
        );
      });
    });
  });
});
