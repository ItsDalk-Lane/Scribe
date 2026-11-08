import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessageEventStream, Context, JsonObject } from "@earendil-works/pi-ai";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import {
  NativeBackendProcess,
  OBSIDIAN_DEFAULT_CONFIG_DIR,
  type NativeSessionRecord,
  type NativeBackendProcessOptions,
  type NativeToolContext,
} from "@/agentMode/sdk/NativeBackendProcess";
import type { SessionEvent, PermissionPrompt } from "@/agentMode/session/types";
import type { ProviderChatModel, AgentStreamOptions } from "@/LLMProviders/piChatModel";

const model = {
  id: "configured-model",
  name: "Configured model",
  api: "openai-completions" as const,
  provider: "configured-provider",
  baseUrl: "http://localhost/fixture",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10000,
  maxTokens: 1000,
};

function response(
  text: string,
  calls: Array<{ id: string; name: string; arguments: JsonObject }> = []
) {
  const stream = createAssistantMessageEventStream();
  const message = createAssistantMessage(model);
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
  streamFn: (
    _model: typeof model,
    context: Context,
    options?: AgentStreamOptions
  ) => AssistantMessageEventStream = () => response("Hello"),
  tools: AgentTool[] = [],
  overrides: Partial<NativeBackendProcessOptions> = {}
) {
  const records = new Map<string, NativeSessionRecord>();
  const events: SessionEvent[] = [];
  const toolContexts: NativeToolContext[] = [];
  const provider: ProviderChatModel = {
    model,
    stream: (context, options) => streamFn(model, { messages: context.messages }, options),
    agentStream: (context, options) => streamFn(model, { messages: context.messages }, options),
  };
  const proc = new NativeBackendProcess({
    getModels: () => [
      { baseModelId: model.id, name: model.name, provider: model.provider, effortOptions: [] },
    ],
    createModel: async () => provider,
    getDefaultModelId: () => model.id,
    getSystemPrompt: async () => "Obsidian fixture assistant",
    createTools: (context) => {
      toolContexts.push(context);
      return { tools };
    },
    storage: {
      load: async (id) => records.get(id) ?? null,
      save: async (record) => {
        records.set(record.sessionId, JSON.parse(JSON.stringify(record)));
      },
      list: async () => [...records.values()],
      remove: async (id) => {
        records.delete(id);
      },
      removeSubagent: async (id, subagentId) => {
        const record = records.get(id);
        if (record)
          record.subagents = record.subagents?.filter((state) => state.snapshot.id !== subagentId);
      },
    },
    ...overrides,
  });
  const open = async () => {
    const opened = await proc.newSession({ cwd: "/fixture/vault" });
    proc.registerSessionHandler(opened.sessionId, (event) => events.push(event));
    return opened.sessionId;
  };
  const send = (sessionId: string, promptId = "prompt-1", text = "hi") =>
    proc.prompt({ sessionId, promptId, prompt: [{ type: "text", text }] });
  return { proc, events, records, toolContexts, open, send };
}

describe("NativeBackendProcess", () => {
  describe("NativeBackendProcess", () => {
    describe("newSession", () => {
      it("uses the explicitly selected model before resolving an unusable saved default", async () => {
        const createModel = jest.fn(async (id: string) => {
          if (id !== model.id) throw new Error("Saved default has no credentials");
          return { model, stream: () => response("Hello"), agentStream: () => response("Hello") };
        });
        const f = fixture(undefined, [], {
          createModel,
          getDefaultModelId: () => "unusable-default",
        });
        const opened = await f.proc.newSession({ cwd: "/fixture/vault", modelId: model.id });
        expect(createModel).toHaveBeenCalledWith(model.id);
        expect(f.records.get(opened.sessionId)?.modelId).toBe(model.id);
      });

      it("refuses an unknown purpose instead of silently granting ordinary-chat tools", async () => {
        const f = fixture();
        await expect(
          f.proc.newSession({ cwd: "/fixture/vault", purpose: "unsupported" as never })
        ).rejects.toThrow("purpose is not supported");
        expect(f.records.size).toBe(0);
      });

      it("persists a skill-authoring purpose and registers only read and explicit-review tools even in auto mode", async () => {
        const seen: string[][] = [];
        const names = [
          "read_note",
          "list_directory",
          "find_paths",
          "search_content",
          "ask_user",
          "invoke_skill",
          "propose_skill",
          "write_note",
          "edit_note",
          "run_command",
          "delegate_task",
          "excalidraw_write",
        ];
        const tools = names.map((name) => ({
          name,
          label: name,
          description: name,
          parameters: { type: "object", properties: {} },
          execute: jest.fn(async () => ({ content: [], details: undefined })),
        })) as AgentTool[];
        const f = fixture((_model, context) => {
          seen.push(getCurrentTools(context.messages).map((tool) => tool.name));
          return response("Draft ready");
        }, tools);
        const opened = await f.proc.newSession({
          cwd: "/fixture/vault",
          ...{ purpose: "skill-authoring" as const },
        });
        await f.proc.setSessionMode({ sessionId: opened.sessionId, modeId: "auto" });
        await f.send(opened.sessionId);
        expect(f.records.get(opened.sessionId)).toMatchObject({ purpose: "skill-authoring" });
        expect(seen[0]).toEqual(names.slice(0, 7));
        expect(tools.slice(7).every((tool) => !jest.mocked(tool.execute).mock.calls.length)).toBe(
          true
        );
      });

      it("creates a separate native identity and persists the configured model and working folder", async () => {
        const f = fixture();
        const id = await f.open();
        expect(id).toMatch(/^native-/);
        expect(f.records.get(id)).toMatchObject({
          backendId: "native",
          cwd: "/fixture/vault",
          modelId: model.id,
        });
        expect(f.proc.isRunning()).toBe(true);
      });
    });

    describe("getExtensionRuntime", () => {
      it("reads registered extensions for the originating working folder without sending a model request", async () => {
        const getRuntime = jest.fn(async () => null);
        const request = jest.fn(() => response("unused"));
        const f = fixture(request, [], { getExtensionRuntime: getRuntime });
        const id = await f.open();
        await expect(f.proc.getExtensionRuntime({ sessionId: id })).resolves.toBeNull();
        expect(getRuntime).toHaveBeenCalledWith("/fixture/vault");
        expect(request).not.toHaveBeenCalled();
      });
    });

    describe("refreshSessionConfiguration", () => {
      it("refreshes the tool registration on the next prompt while keeping conversation history", async () => {
        const contexts: Context[] = [];
        const createTools = jest.fn(() => ({ tools: [] }));
        const f = fixture(
          (_model, context) => {
            contexts.push(context);
            return response("Earlier reply");
          },
          [],
          { createTools }
        );
        const id = await f.open();
        await f.send(id);
        f.proc.refreshSessionConfiguration(id);
        await f.send(id, "next", "Continue");
        expect(createTools).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(contexts[1].messages)).toContain("Earlier reply");
      });
    });

    describe("prompt", () => {
      it.each([
        ["not selected", "ordinary request", true, "只能转交"],
        ["disabled after selection", "/manual-review check", false, "已停用或不可用"],
        ["selected and enabled", "/manual-review check", true, "找不到当前聊天所属的子会话"],
      ])(
        "checks the current user authorization before a resumed child receives skills when %s (https://github.com/ItsDalk-Lane/Scribe/issues/50)",
        async (_label, prompt, enabledAtSend, expected) => {
          let enabled = true;
          let failure = "";
          const f = fixture(
            (_model, context) => {
              if (context.messages.at(-1)?.role === "toolResult") return response("done");
              return response("", [{ id: "send", name: "send_subagent_message", arguments: {} }]);
            },
            [],
            {
              getManuallyInvokedSkill: (name) =>
                enabled && name === "manual-review" ? { name, body: "Instructions" } : null,
              createTools: (context) => ({
                tools: [
                  {
                    name: "send_subagent_message",
                    label: "send",
                    description: "send",
                    parameters: { type: "object", properties: {} },
                    execute: async () => {
                      enabled = enabledAtSend;
                      try {
                        await context.sendSubagentMessage!({
                          subagentId: "unknown",
                          text: "continue",
                          mode: "wake",
                          skills: ["manual-review"],
                        });
                      } catch (error) {
                        failure = String(error);
                      }
                      return { content: [{ type: "text", text: "done" }], details: undefined };
                    },
                  },
                ] as AgentTool[],
              }),
            }
          );
          const id = await f.open();
          await f.send(id, "authorization-test", prompt);
          expect(failure).toContain(expected);
        }
      );
      function transferredSkillFixture(overrides: Partial<NativeBackendProcessOptions>) {
        const contexts: Context[] = [];
        const f = fixture(
          (_model, context) => {
            contexts.push(context);
            const last = context.messages.at(-1);
            if (JSON.stringify(last).includes("Child task")) return response("Child done");
            if (last?.role === "toolResult") return response("Parent done");
            return response("", [
              {
                id: "delegate",
                name: "delegate_task",
                arguments: {
                  prompt: "Child task",
                  description: "Review",
                  skills: ["manual-review"],
                },
              },
            ]);
          },
          [],
          {
            getManuallyInvokedSkill: (name) => ({ name, body: "Instructions" }),
            createTools: (context) => ({
              tools: context.executeSubagent
                ? [
                    {
                      name: "delegate_task",
                      label: "Delegate",
                      description: "Delegate",
                      parameters: { type: "object", properties: {} },
                      execute: (id, args, signal) =>
                        context.executeSubagent!(
                          id,
                          args as { prompt: string; description: string; skills: string[] },
                          signal
                        ),
                    },
                  ]
                : [],
            }),
            ...overrides,
          }
        );
        return { ...f, contexts };
      }

      it("does not send a child request when dependency resolution fails (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let calls = 0;
        const f = transferredSkillFixture({
          resolveSkillDependencies: async () => {
            if (++calls === 2) throw new Error("Dependency check failed");
            return [];
          },
        });
        const id = await f.open();
        await f.send(id, "manual", "/manual-review Check");
        expect(
          f.contexts.some((context) =>
            JSON.stringify(context.messages.at(-1)).includes("Child task")
          )
        ).toBe(false);
      });

      it("does not send a child request when the skill is disabled during dependency resolution (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let enabled = true;
        let calls = 0;
        const f = transferredSkillFixture({
          getManuallyInvokedSkill: (name) => (enabled ? { name, body: "Instructions" } : null),
          resolveSkillDependencies: async () => {
            if (++calls === 2) enabled = false;
            return [];
          },
        });
        const id = await f.open();
        await f.send(id, "manual", "/manual-review Check");
        expect(
          f.contexts.some((context) =>
            JSON.stringify(context.messages.at(-1)).includes("Child task")
          )
        ).toBe(false);
      });

      it("does not send a child request after cancellation during dependency resolution (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let calls = 0;
        let started!: () => void;
        let finish!: (readings: []) => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const pending = new Promise<[]>((resolve) => {
          finish = resolve;
        });
        const f = transferredSkillFixture({
          resolveSkillDependencies: async () => {
            if (++calls === 2) {
              started();
              return pending;
            }
            return [];
          },
        });
        const id = await f.open();
        const turn = f.send(id, "manual", "/manual-review Check");
        await ready;
        const cancellation = f.proc.cancel({ sessionId: id });
        finish([]);
        await Promise.all([turn, cancellation]);
        expect(
          f.contexts.some((context) =>
            JSON.stringify(context.messages.at(-1)).includes("Child task")
          )
        ).toBe(false);
      });

      it("bounds the combined transferred instruction and indicates truncation (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = transferredSkillFixture({
          getManuallyInvokedSkill: (name) => ({ name, body: "X".repeat(30000) }),
        });
        const id = await f.open();
        await f.send(id, "manual", "/manual-review Check");
        const child = f.contexts.find((context) =>
          JSON.stringify(context.messages.at(-1)).includes("Child task")
        );
        const text = child?.messages[0].content;
        expect(typeof text).toBe("string");
        expect((text as string).length).toBeLessThanOrEqual(
          20000 + "\n\n[Output truncated]".length
        );
        expect(text).toContain("[Output truncated]");
      });

      it("delivers transferred skills with dependency readiness and their support directory to the child (https://github.com/ItsDalk-Lane/Scribe/issues/46)", async () => {
        const contexts: Context[] = [];
        const f = fixture(
          (_model, context) => {
            contexts.push(context);
            const last = context.messages.at(-1);
            if (JSON.stringify(last).includes("Child task")) return response("Child done");
            if (last?.role === "toolResult") return response("Parent done");
            return response("", [
              {
                id: "delegate",
                name: "delegate_task",
                arguments: {
                  prompt: "Child task",
                  description: "Review",
                  skills: ["manual-review"],
                },
              },
            ]);
          },
          [],
          {
            getManuallyInvokedSkill: (name) => ({
              name,
              body: "Review instructions",
              dirPath: "/fixture/skills/manual-review",
            }),
            resolveSkillDependencies: async () => [
              { type: "command", name: "example", ready: true, detail: "/usr/bin/example" },
              { type: "python-package", name: "missing", ready: false, detail: "not installed" },
            ],
            createTools: (context) => ({
              tools: context.executeSubagent
                ? [
                    {
                      name: "delegate_task",
                      label: "Delegate",
                      description: "Delegate",
                      parameters: { type: "object", properties: {} },
                      execute: (id, args, signal) =>
                        context.executeSubagent!(
                          id,
                          args as { prompt: string; description: string; skills: string[] },
                          signal
                        ),
                    },
                  ]
                : [],
            }),
          }
        );
        const id = await f.open();
        await f.send(id, "manual", "/manual-review Check");
        const child = contexts.find((context) =>
          JSON.stringify(context.messages.at(-1)).includes("Child task")
        );
        expect(child).toBeDefined();
        const text = JSON.stringify(child!.messages);
        expect(text).toContain("Review instructions");
        expect(text).toContain("/fixture/skills/manual-review");
        expect(text).toContain("/usr/bin/example");
        expect(text).toContain("not available on this computer");
      });

      it("loads an explicitly named manual skill for this request without rewriting the original user message", async () => {
        const contexts: Context[] = [];
        const findSkill = jest.fn((name: string) =>
          name === "manual-review"
            ? {
                name,
                body: "Verify each quoted claim.",
                dirPath: "/fixture/vault/.scribe/skills/manual-review",
              }
            : null
        );
        const f = fixture(
          (_model, context) => {
            contexts.push(context);
            return response("Reviewed");
          },
          [],
          { getManuallyInvokedSkill: findSkill }
        );
        const id = await f.open();
        const original =
          "<scribe-context>Attached note</scribe-context>\n<user-message>\n/manual-review Check this note\n</user-message>";
        await f.send(id, "manual", original);
        expect(JSON.stringify(contexts[0].messages)).toContain("Verify each quoted claim.");
        expect(JSON.stringify(contexts[0].messages)).toContain(
          "/fixture/vault/.scribe/skills/manual-review"
        );
        expect(
          f.records.get(id)?.messages.find((message) => message.role === "user")?.content
        ).toEqual([{ type: "text", text: original }]);
        await f.send(id, "ordinary", "Continue without a skill");
        expect(JSON.stringify(contexts[1].messages)).not.toContain("Verify each quoted claim.");
      });

      it("counts one manual skill selection once across tool continuations and counts a new selection separately https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
        const onManualSkillInvoked = jest.fn();
        let requests = 0;
        const tool = {
          name: "check",
          label: "Check",
          description: "Check",
          parameters: { type: "object", properties: {} },
          execute: jest.fn(async () => ({
            content: [{ type: "text", text: "done" }],
            details: undefined,
          })),
        } as AgentTool;
        const f = fixture(
          () =>
            ++requests === 1
              ? response("", [{ id: "call-1", name: "check", arguments: {} }])
              : response("Done"),
          [tool],
          {
            getManuallyInvokedSkill: (name) => ({ name, body: "Instructions" }),
            onManualSkillInvoked,
          }
        );
        const id = await f.open();
        await f.send(id, "first", "/manual-review Check");
        expect(requests).toBe(2);
        expect(onManualSkillInvoked).toHaveBeenCalledTimes(1);
        await f.send(id, "second", "/manual-review Again");
        expect(onManualSkillInvoked).toHaveBeenCalledTimes(2);
      });

      it("does not count a manual selection when preparing its dependencies fails https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
        const onManualSkillInvoked = jest.fn();
        const request = jest.fn(() => response("unused"));
        const f = fixture(request, [], {
          getManuallyInvokedSkill: (name) => ({ name, body: "Instructions" }),
          resolveSkillDependencies: async () => {
            throw new Error("Dependency check failed");
          },
          onManualSkillInvoked,
        });
        const id = await f.open();
        await f.send(id, "failed", "/manual-review Check");
        expect(request).not.toHaveBeenCalled();
        expect(onManualSkillInvoked).not.toHaveBeenCalled();
      });

      it("does not count a manual selection cancelled before the model request https://github.com/ItsDalk-Lane/Scribe/issues/48", async () => {
        const onManualSkillInvoked = jest.fn();
        const request = jest.fn(() => response("unused"));
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        let finish!: (readings: []) => void;
        const dependency = new Promise<[]>((resolve) => {
          finish = resolve;
        });
        const f = fixture(request, [], {
          getManuallyInvokedSkill: (name) => ({ name, body: "Instructions" }),
          resolveSkillDependencies: () => {
            started();
            return dependency;
          },
          onManualSkillInvoked,
        });
        const id = await f.open();
        const pending = f.send(id, "cancelled", "/manual-review Check");
        await ready;
        const cancelled = f.proc.cancel({ sessionId: id });
        finish([]);
        await Promise.all([pending, cancelled]);
        expect(request).not.toHaveBeenCalled();
        expect(onManualSkillInvoked).not.toHaveBeenCalled();
      });

      it("does not send a model request when the explicitly named skill disallows manual invocation", async () => {
        const request = jest.fn(() => response("must not run"));
        const f = fixture(request, [], {
          getManuallyInvokedSkill: () => {
            throw new Error("Manual use is disabled");
          },
        });
        const id = await f.open();
        await f.send(id, "manual", "/private-skill Check this");
        expect(request).not.toHaveBeenCalled();
        expect(f.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "turn_ended",
              stopReason: "request_error",
            }),
          })
        );
      });

      it("rejects a model attempt to run a command in an authoring chat without executing it", async () => {
        const execute = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "must not run" }],
          details: undefined,
        }));
        const tool: AgentTool = {
          name: "run_command",
          label: "Run",
          description: "Run",
          parameters: { type: "object", properties: {} },
          execute,
        };
        let requests = 0;
        const f = fixture(
          () =>
            ++requests === 1
              ? response("", [{ id: "forbidden-command", name: "run_command", arguments: {} }])
              : response("Draft only"),
          [tool]
        );
        const opened = await f.proc.newSession({
          cwd: "/fixture/vault",
          purpose: "skill-authoring",
        });
        await f.proc.setSessionMode({ sessionId: opened.sessionId, modeId: "auto" });
        await f.send(opened.sessionId);
        expect(execute).not.toHaveBeenCalled();
        expect(f.records.get(opened.sessionId)?.messages).toContainEqual(
          expect.objectContaining({ role: "toolResult", toolName: "run_command", isError: true })
        );
      });

      it.each([false, true])(
        "keeps a saving-phase message isolated from the ended agent when cancel=%s",
        async (cancel) => {
          let ready!: () => void;
          let release!: () => void;
          const saving = new Promise<void>((resolve) => {
            ready = resolve;
          });
          const persisted = new Promise<void>((resolve) => {
            release = resolve;
          });
          let assistantSaves = 0;
          let requests = 0;
          const f = fixture(
            () => {
              requests++;
              return response("Answer");
            },
            [],
            {
              storage: {
                load: async () => null,
                list: async () => [],
                save: async (record) => {
                  if (record.messages.at(-1)?.role === "assistant" && ++assistantSaves === 2) {
                    ready();
                    await persisted;
                  }
                },
              },
            }
          );
          const id = await f.open();
          const first = f.send(id, "first", "First request");
          await saving;
          const second = f.send(id, "second", "Second request");
          const cancellation = cancel ? f.proc.cancel({ sessionId: id }) : Promise.resolve();
          release();
          await Promise.all([first, second, cancellation]);
          expect(requests).toBe(cancel ? 1 : 2);
          expect(
            f.events
              .filter((event) => event.update.sessionUpdate === "turn_ended")
              .map((event) => event.update)
          ).toEqual([
            expect.objectContaining({
              turnId: "first",
              stopReason: cancel ? "cancelled" : "end_turn",
            }),
            ...(cancel
              ? []
              : [expect.objectContaining({ turnId: "second", stopReason: "end_turn" })]),
          ]);
          const delivery = { sessionUpdate: "message_delivered", promptId: "second" };
          if (cancel) {
            expect(f.events.map((event) => event.update)).not.toContainEqual(delivery);
            expect(f.events.map((event) => event.update)).toContainEqual({
              sessionUpdate: "messages_withdrawn",
              promptIds: ["second"],
            });
            await f.send(id, "after-cancel", "Recover");
            expect(requests).toBe(2);
          } else expect(f.events.map((event) => event.update)).toContainEqual(delivery);
        }
      );

      it("gives each consecutive prompt its own step budget when the agent is reused", async () => {
        let requests = 0;
        const execute = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "Read result" }],
          details: undefined,
        }));
        const f = fixture(
          () =>
            ++requests % 2 === 1
              ? response("", [{ id: "read", name: "read_note", arguments: {} }])
              : response("Final answer"),
          [
            {
              name: "read_note",
              label: "Read",
              description: "Read a note",
              parameters: { type: "object", properties: {} },
              execute,
            },
          ],
          { maxSteps: 2 }
        );
        const id = await f.open();
        await f.send(id, "first", "Read the first note");
        await f.send(id, "second", "Read the next note");
        expect(requests).toBe(4);
        expect(execute).toHaveBeenCalledTimes(2);
        expect(
          f.events
            .filter((event) => event.update.sessionUpdate === "turn_ended")
            .map((event) => event.update)
        ).toEqual([
          expect.objectContaining({ turnId: "first", stopReason: "end_turn" }),
          expect.objectContaining({ turnId: "second", stopReason: "end_turn" }),
        ]);
      });

      it("delivers a message queued while manual compaction is waiting instead of leaving it unread", async () => {
        let startSummary!: () => void;
        const summaryStarted = new Promise<void>((resolve) => {
          startSummary = resolve;
        });
        const summary = createAssistantMessageEventStream();
        let requests = 0;
        const f = fixture(() => {
          if (++requests === 2) {
            startSummary();
            return summary;
          }
          return response("Answer");
        });
        const id = await f.open();
        await f.send(id, "first", "Earlier context");
        const compacting = f.send(id, "compact", "/compact");
        await summaryStarted;
        await f.send(id, "during-compact", "Keep this new instruction");
        const message = createAssistantMessage(model);
        message.content = [{ type: "text", text: "History summary" }];
        message.stopReason = "stop";
        summary.push({ type: "done", reason: "stop", message });
        await compacting;
        expect(f.events.map((event) => event.update)).toContainEqual({
          sessionUpdate: "message_delivered",
          promptId: "during-compact",
        });
        expect(requests).toBe(3);
        expect(JSON.stringify(f.records.get(id)?.messages)).toContain("Keep this new instruction");
      });

      it("keeps queued messages when refreshed tools replace the agent after instruction loading", async () => {
        let startLoading!: () => void;
        let finishLoading!: (value: string) => void;
        const loadingStarted = new Promise<void>((resolve) => {
          startLoading = resolve;
        });
        const loading = new Promise<string>((resolve) => {
          finishLoading = resolve;
        });
        let reads = 0;
        const f = fixture(undefined, [], {
          getSystemPrompt: async () => {
            if (++reads === 3) {
              startLoading();
              return loading;
            }
            return "Instructions";
          },
        });
        const id = await f.open();
        await f.send(id, "first", "Previous turn");
        f.proc.refreshSessionConfiguration(id);
        const running = f.send(id, "second", "Main instruction");
        await loadingStarted;
        await f.send(id, "during-refresh", "Queued instruction");
        finishLoading("Refreshed instructions");
        await running;
        expect(f.events.map((event) => event.update)).toContainEqual({
          sessionUpdate: "message_delivered",
          promptId: "during-refresh",
        });
        const saved = JSON.stringify(f.records.get(id)?.messages);
        expect(saved.match(/Queued instruction/g)).toHaveLength(1);
      });

      it("persists automatic compaction and keeps the new user request outside the historical summary", async () => {
        const contexts: Context[] = [];
        let requests = 0;
        const f = fixture((_model, context) => {
          contexts.push(JSON.parse(JSON.stringify(context)));
          requests++;
          if (requests === 1) {
            const stream = createAssistantMessageEventStream();
            const message = createAssistantMessage(model);
            message.content = [{ type: "text", text: "Large previous answer" }];
            message.stopReason = "stop";
            message.usage.totalTokens = 9000;
            stream.push({ type: "done", reason: "stop", message });
            return stream;
          }
          return response(requests === 2 ? "Preserved history summary" : "Next answer");
        });
        const id = await f.open();
        await f.send(id, "first", "Old user request");
        await f.send(id, "second", "Exact new authorization");
        const summaryInput = JSON.stringify(contexts[1].messages);
        expect(summaryInput).toContain("Large previous answer");
        expect(summaryInput).not.toContain("Exact new authorization");
        expect(JSON.stringify(f.records.get(id)?.messages)).toContain("Large previous answer");
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "compaction",
            summary: "Preserved history summary",
          })
        );
        await f.send(id, "third", "Follow-up");
        expect(JSON.stringify(contexts[3].messages)).not.toContain("Large previous answer");
        expect(JSON.stringify(contexts[2].messages)).toContain("Exact new authorization");
      });

      it.each(["refusal", "content_filter"])(
        "reports structured %s termination as refusal without a transport error",
        async (rawStopReason) => {
          const f = fixture(() => {
            const stream = createAssistantMessageEventStream();
            const message = createAssistantMessage(model);
            message.stopReason = "error";
            message.rawStopReason = rawStopReason;
            message.errorMessage = "Provider declined the request";
            stream.push({ type: "error", reason: "error", error: message });
            return stream;
          });
          const id = await f.open();
          await f.send(id);
          const ended = f.events
            .map((event) => event.update)
            .find((update) => update.sessionUpdate === "turn_ended");
          expect(ended).toMatchObject({ sessionUpdate: "turn_ended", stopReason: "refusal" });
          expect(ended).not.toHaveProperty("error");
        }
      );

      it("enters plan mode before a mixed proposal and edit batch can change files", async () => {
        const edit = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "wrote" }],
          details: undefined,
        }));
        let requests = 0;
        const f = fixture(
          () =>
            ++requests === 1
              ? response("", [
                  { id: "edit-before-plan", name: "write_note", arguments: {} },
                  {
                    id: "review-plan",
                    name: "propose_plan",
                    arguments: { plan: "# Review before editing" },
                  },
                ])
              : response("Waiting for approval"),
          [
            {
              name: "write_note",
              label: "Write",
              description: "Write",
              parameters: { type: "object", properties: {} },
              execute: edit,
            },
            {
              name: "propose_plan",
              label: "Plan",
              description: "Plan",
              parameters: {
                type: "object",
                properties: { plan: { type: "string" } },
                required: ["plan"],
              },
              execute: async () => ({
                content: [{ type: "text", text: "Plan pending" }],
                details: undefined,
              }),
            },
          ]
        );
        const id = await f.open();
        await f.send(id);
        expect(edit).not.toHaveBeenCalled();
        expect(f.toolContexts[0].getMode()).toBe("plan");
      });
      it("reports model failures as errors without accepting the partial reply as success", async () => {
        const f = fixture(() => {
          const stream = createAssistantMessageEventStream();
          const message = createAssistantMessage(model);
          message.stopReason = "error";
          message.errorMessage = "fixture endpoint refused tools";
          stream.push({ type: "error", reason: "error", error: message });
          return stream;
        });
        const id = await f.open();
        await f.send(id);
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "turn_ended",
            error: expect.objectContaining({ message: "fixture endpoint refused tools" }),
          })
        );
      });

      it("summarizes the final tool result without tools when its explicit budget is spent (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const contexts: Context[] = [];
        const execute = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "changed actual note" }],
          details: undefined,
        }));
        const f = fixture(
          (_model, context) => {
            contexts.push(JSON.parse(JSON.stringify(context)));
            return contexts.length === 1
              ? response("", [{ id: "edit", name: "write_note", arguments: {} }])
              : response("Completed the note edit; more work remains.");
          },
          [
            {
              name: "write_note",
              label: "Edit",
              description: "Edit",
              parameters: { type: "object", properties: {} },
              execute,
            },
          ],
          { maxSteps: 1 }
        );
        const id = await f.open();
        await f.send(id);
        expect(contexts).toHaveLength(2);
        expect(JSON.stringify(contexts[1])).toContain("changed actual note");
        expect(getCurrentTools(contexts[1].messages)).toEqual([]);
        expect(execute).toHaveBeenCalledTimes(1);
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "max_turn_requests" })
        );
        expect(JSON.stringify(f.records.get(id)?.messages)).toContain("Completed the note edit");
      });

      it("continues past fifty tool rounds when no limit was saved (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        let requests = 0;
        const execute = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "read" }],
          details: undefined,
        }));
        const f = fixture(
          () =>
            ++requests <= 51
              ? response("", [{ id: `read-${requests}`, name: "read_note", arguments: {} }])
              : response("All notes checked"),
          [
            {
              name: "read_note",
              label: "Read",
              description: "Read",
              parameters: { type: "object", properties: {} },
              execute,
            },
          ]
        );
        const id = await f.open();
        await f.send(id);
        expect(requests).toBe(52);
        expect(execute).toHaveBeenCalledTimes(51);
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "end_turn" })
        );
      });

      it("ends after the closing request even if it returns another tool call (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const request = jest.fn(() =>
          response("", [{ id: "step-1", name: "inspect", arguments: {} }])
        );
        const f = fixture(
          request,
          [
            {
              name: "inspect",
              label: "Inspect",
              description: "Inspect",
              parameters: { type: "object", properties: {} },
              execute: async () => ({
                content: [{ type: "text", text: "checked" }],
                details: undefined,
              }),
            },
          ],
          { maxSteps: 1 }
        );
        f.proc.setPermissionPrompter(async () => ({
          outcome: { outcome: "selected", optionId: "allow_once" },
        }));
        const id = await f.open();
        await f.send(id);
        expect(request).toHaveBeenCalledTimes(2);
        expect(
          f.records.get(id)?.messages.filter((m) => m.role === "toolResult" && !m.isError)
        ).toHaveLength(1);
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "max_turn_requests" })
        );
      });

      it("gives a user message read mid-run its own step budget (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        let ready!: () => void;
        const started = new Promise<void>((resolve) => {
          ready = resolve;
        });
        let release!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        let requests = 0;
        let executions = 0;
        const f = fixture(
          () =>
            ++requests <= 3
              ? response("", [{ id: `read-${requests}`, name: "read_note", arguments: {} }])
              : response("Closing summary"),
          [
            {
              name: "read_note",
              label: "Read",
              description: "Read",
              parameters: { type: "object", properties: {} },
              execute: async () => {
                if (++executions === 1) {
                  ready();
                  await gate;
                }
                return { content: [{ type: "text", text: "result" }], details: undefined };
              },
            },
          ],
          { maxSteps: 2 }
        );
        const id = await f.open();
        const run = f.send(id, "first", "First request");
        await started;
        await f.send(id, "new-request", "A new request during the task");
        release();
        await run;
        expect(requests).toBe(4);
        expect(executions).toBe(3);
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "message_delivered", promptId: "new-request" })
        );
      });

      it("returns queued text unread after instruction preparation fails (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        let reject!: (failure: Error) => void;
        const loading = new Promise<string>((_resolve, fail) => {
          reject = fail;
        });
        let loads = 0;
        const request = jest.fn(() => response("Unexpected next request"));
        const f = fixture(request, [], {
          getSystemPrompt: async () => {
            if (++loads === 2) {
              started();
              return loading;
            }
            return "Initial instructions";
          },
        });
        const id = await f.open();
        const run = f.send(id, "first");
        await ready;
        await f.send(id, "next", "Keep this unsent");
        reject(new Error("Cannot load instructions"));
        await run;
        expect(request).not.toHaveBeenCalled();
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "request_error" })
        );
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "messages_withdrawn", promptIds: ["next"] })
        );
      });

      it("returns new messages unread when they arrive during the closing request (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        let ready!: () => void;
        const started = new Promise<void>((resolve) => {
          ready = resolve;
        });
        let complete!: () => void;
        let requests = 0;
        const f = fixture(
          () => {
            if (++requests === 1)
              return response("", [{ id: "read", name: "read_note", arguments: {} }]);
            const stream = createAssistantMessageEventStream();
            complete = () => {
              const message = {
                ...createAssistantMessage(model),
                content: [{ type: "text" as const, text: "Closing summary" }],
                stopReason: "stop" as const,
              };
              stream.push({ type: "done", reason: "stop", message });
            };
            ready();
            return stream;
          },
          [
            {
              name: "read_note",
              label: "Read",
              description: "Read",
              parameters: { type: "object", properties: {} },
              execute: async () => ({
                content: [{ type: "text", text: "result" }],
                details: undefined,
              }),
            },
          ],
          { maxSteps: 1 }
        );
        const id = await f.open();
        const run = f.send(id, "first");
        await started;
        await f.send(id, "new-request", "Do this next");
        complete();
        await run;
        expect(requests).toBe(2);
        expect(f.events.map((event) => event.update)).not.toContainEqual(
          expect.objectContaining({ sessionUpdate: "message_delivered", promptId: "new-request" })
        );
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "messages_withdrawn",
            promptIds: ["new-request"],
          })
        );
      });

      it("restores tools and a fresh budget after a closing turn (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const contexts: Context[] = [];
        const f = fixture(
          (_model, context) => {
            contexts.push(JSON.parse(JSON.stringify(context)));
            return contexts.length % 2 === 1
              ? response("", [{ id: "read", name: "read_note", arguments: {} }])
              : response("Read completed");
          },
          [
            {
              name: "read_note",
              label: "Read",
              description: "Read",
              parameters: { type: "object", properties: {} },
              execute: async () => ({
                content: [{ type: "text", text: "note" }],
                details: undefined,
              }),
            },
          ],
          { maxSteps: 1 }
        );
        const id = await f.open();
        await f.send(id, "first");
        await f.send(id, "next");
        expect(contexts).toHaveLength(4);
        expect(getCurrentTools(contexts[2].messages).map((tool) => tool.name)).toEqual([
          "read_note",
        ]);
        expect(JSON.stringify(contexts[2])).not.toContain(
          "The configured step limit has been reached."
        );
      });

      it.each([
        ["quota", "quota_exhausted"],
        ["auth", "authentication_error"],
        ["context", "context_limit"],
        ["request", "request_error"],
      ] as const)(
        "reports structured %s failures as %s without a raw provider error (https://github.com/ItsDalk-Lane/Scribe/issues/31)",
        async (kind, stopReason) => {
          const f = fixture((_model, _context, options) => {
            options?.onFailure?.({ kind });
            const stream = createAssistantMessageEventStream();
            const error = {
              ...createAssistantMessage(model),
              stopReason: "error" as const,
              errorMessage: "opaque provider detail",
            };
            stream.push({ type: "error", reason: "error", error });
            return stream;
          });
          const id = await f.open();
          await f.send(id);
          const end = f.events
            .map((event) => event.update)
            .find((event) => event.sessionUpdate === "turn_ended");
          expect(end).toEqual(expect.objectContaining({ stopReason }));
          expect(end).not.toHaveProperty("error");
        }
      );

      it("does not start a child request when a selected custom agent is disabled or missing", async () => {
        const request = jest.fn(() => response("Unused"));
        const f = fixture(request, [], {
          getSubagents: () => [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Review",
              instructions: "Review carefully",
              enabled: false,
            },
          ],
        });
        await f.open();
        for (const agent of ["reviewer", "missing"]) {
          await expect(
            f.toolContexts[0].executeSubagent!("child", {
              prompt: "Review",
              description: "Review",
              agent,
            })
          ).rejects.toThrow("disabled or unavailable");
        }
        expect(request).not.toHaveBeenCalled();
        expect(
          f.events
            .map((event) => event.update)
            .filter((update) => update.sessionUpdate === "task_started")
        ).toEqual([]);
      });
      it("names the child from the explicit name before the custom agent and description fallbacks", async () => {
        const request = jest.fn(() => response("Child work"));
        const f = fixture(request, [], {
          getSubagents: () => [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Review",
              instructions: "Review carefully",
              enabled: true,
            },
          ],
        });
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("named", {
          prompt: "Inspect",
          description: "Inspect notes",
          name: "  Source audit  ",
          agent: "reviewer",
          background: true,
        });
        await f.toolContexts[0].executeSubagent!("custom-fallback", {
          prompt: "Inspect",
          description: "Inspect notes",
          agent: "reviewer",
          background: true,
        });
        await f.toolContexts[0].executeSubagent!("generic-fallback", {
          prompt: "Inspect",
          description: "Generic child",
          background: true,
        });
        const children = await f.proc.listSubagentSessions({ sessionId: id });
        expect(children.map((child) => child.name)).toEqual([
          "Source audit",
          "Reviewer: Inspect notes",
          "Generic child",
        ]);
        await f.proc.shutdown();
      });

      it("refuses background delegation cancelled while the task setup is being saved (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let entered!: () => void;
        let finish!: () => void;
        const saving = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const released = new Promise<void>((resolve) => {
          finish = resolve;
        });
        let held = false;
        const request = jest.fn(() => response("Must not run"));
        const f = fixture(request, [], {
          storage: {
            load: async () => null,
            list: async () => [],
            save: async (record) => {
              if (!held && record.taskGenerations?.length) {
                held = true;
                entered();
                await released;
              }
            },
          },
        });
        const id = await f.open();
        const signal = new AbortController();
        const delegation = f.toolContexts[0].executeSubagent!(
          "cancelled-create",
          { prompt: "Do work", description: "Cancelled", background: true },
          signal.signal
        );
        await saving;
        signal.abort();
        finish();
        await expect(delegation).rejects.toMatchObject({ name: "AbortError" });
        expect(await f.proc.listSubagentSessions({ sessionId: id })).toEqual([]);
        expect(request).not.toHaveBeenCalled();
        await f.proc.shutdown();
      });

      it("counts failed and retried actual request usage once in the child run (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const failedUsage = { input: 7, output: 3, cacheRead: 0, cacheWrite: 0, totalTokens: 10 };
        const successUsage = { input: 13, output: 5, cacheRead: 1, cacheWrite: 1, totalTokens: 20 };
        const cost = { ...model.cost, total: 0 };
        const f = fixture((_model, _context, options) => {
          const stream = createAssistantMessageEventStream();
          void (async () => {
            await options?.beforeRequest?.("child-failed-request");
            await options?.onRequestUsage?.("child-failed-request", {
              ...failedUsage,
              cost,
            });
            await options?.beforeRequest?.("child-retried-request");
            await options?.onRequestUsage?.("child-failed-request", {
              ...failedUsage,
              cost,
            });
            await options?.onRequestUsage?.("child-retried-request", {
              ...successUsage,
              cost,
            });
            const message = createAssistantMessage(model);
            message.content = [{ type: "text", text: "Retried child completed" }];
            message.stopReason = "stop";
            message.usage = { ...successUsage, cost };
            stream.push({ type: "done", reason: "stop", message });
          })();
          return stream;
        });
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("delegate-retry", {
          prompt: "Retry the child request",
          description: "Retry usage",
        });
        const [child] = await f.proc.listSubagentSessions({ sessionId: id });
        expect(child.runs[0].usage).toEqual({
          input: 20,
          output: 8,
          cacheRead: 1,
          cacheWrite: 1,
          totalTokens: 30,
        });
        expect(f.records.get(id)?.taskGenerations?.[0].usage).toHaveLength(2);
      });

      it.each([
        { allowedTools: ["invoke_skill"], expected: ["invoke_skill"] },
        { allowedTools: [], expected: [] },
      ])(
        "only exposes the child's allowed tools and blocks a forbidden tool call for $allowedTools (https://github.com/ItsDalk-Lane/Scribe/issues/50)",
        async ({ allowedTools, expected }) => {
          const childTools: string[][] = [];
          const readNote = jest.fn(async () => ({ content: [], details: undefined }));
          let assertChildTool: NativeToolContext["assertCanExecute"];
          const f = fixture(
            (_model, context) => {
              const last = context.messages.at(-1);
              if (last?.role === "toolResult") return response("Finished");
              if (JSON.stringify(last).includes("Child task")) {
                childTools.push(getCurrentTools(context.messages).map((tool) => tool.name));
                return response("", [{ id: "forbidden", name: "read_note", arguments: {} }]);
              }
              return response("", [
                {
                  id: "delegate",
                  name: "delegate_task",
                  arguments: { prompt: "Child task", description: "Review", allowedTools },
                },
              ]);
            },
            [],
            {
              createTools: (context) => {
                if (context.subagentId) assertChildTool = context.assertCanExecute;
                const tools: AgentTool[] = ["invoke_skill", "read_note"].map((name) => ({
                  name,
                  label: name,
                  description: name,
                  parameters: { type: "object", properties: {} },
                  execute:
                    name === "read_note"
                      ? readNote
                      : async () => ({ content: [], details: undefined }),
                })) as AgentTool[];
                if (context.executeSubagent)
                  tools.push({
                    name: "delegate_task",
                    label: "Delegate",
                    description: "Delegate",
                    parameters: { type: "object", properties: {} },
                    execute: (id, args, signal) =>
                      context.executeSubagent!(
                        id,
                        args as { prompt: string; description: string; allowedTools: string[] },
                        signal
                      ),
                  } as AgentTool);
                return { tools };
              },
            }
          );
          const id = await f.open();
          await f.send(id);
          expect(childTools).toEqual([expected]);
          expect(readNote).not.toHaveBeenCalled();
          expect(assertChildTool).toBeDefined();
          expect(() => assertChildTool!("read_note")).toThrow("此子会话的角色限制不允许调用该工具");
          if (allowedTools.length) expect(() => assertChildTool!("invoke_skill")).not.toThrow();
          else
            expect(() => assertChildTool!("invoke_skill")).toThrow(
              "此子会话的角色限制不允许调用该工具"
            );
        }
      );

      it("delegates to a saved custom agent with its own instructions and the current model", async () => {
        const contexts: Context[] = [];
        const request = jest.fn((_model, context: Context) => {
          contexts.push(context);
          const last = context.messages.at(-1);
          if (JSON.stringify(last).includes("Analyze selected"))
            return response("Custom review done");
          if (last?.role === "toolResult") return response("Parent complete");
          return response("", [
            {
              id: "delegate",
              name: "delegate_task",
              arguments: { prompt: "Analyze selected", description: "Review", agent: "reviewer" },
            },
          ]);
        });
        const f = fixture(request, [], {
          getSubagents: () => [
            {
              id: "reviewer",
              name: "Reviewer",
              description: "Review sources",
              instructions: "Custom reviewer: cite every source.",
              enabled: true,
            },
          ],
          createTools: (context) => ({
            tools: context.executeSubagent
              ? [
                  {
                    name: "delegate_task",
                    label: "Delegate",
                    description: "Delegate",
                    parameters: { type: "object", properties: {} },
                    execute: (id, args, signal) =>
                      context.executeSubagent!(
                        id,
                        args as { prompt: string; description: string; agent?: string },
                        signal
                      ),
                  },
                ]
              : [],
          }),
        });
        const id = await f.open();
        await f.send(id);
        expect(
          contexts.some((context) =>
            JSON.stringify(context.messages).includes("Custom reviewer: cite every source.")
          )
        ).toBe(true);
        expect(request.mock.calls.every((call) => call[0].id === model.id)).toBe(true);
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "task_started",
            description: "Reviewer: Review",
          })
        );
      });

      it("rejects an unknown remote write after plan mode starts while its approval is pending (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let ready!: () => void;
        let approve!: () => void;
        const pending = new Promise<void>((resolve) => {
          ready = resolve;
        });
        const execute = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "changed" }],
          details: undefined,
        }));
        let requests = 0;
        const f = fixture(
          () =>
            ++requests === 1
              ? response("", [{ id: "remote", name: "remote_write", arguments: {} }])
              : response("No remote write"),
          [
            {
              name: "remote_write",
              label: "Remote",
              description: "Remote",
              parameters: { type: "object", properties: {} },
              execute,
            },
          ]
        );
        f.proc.setPermissionPrompter(
          () =>
            new Promise((resolve) => {
              approve = () => resolve({ outcome: { outcome: "selected", optionId: "allow_once" } });
              ready();
            })
        );
        const id = await f.open();
        const turn = f.send(id);
        await pending;
        await f.proc.setSessionMode({ sessionId: id, modeId: "plan" });
        approve();
        await turn;
        expect(execute).not.toHaveBeenCalled();
        expect(JSON.stringify(f.records.get(id)?.messages)).toContain("Plan approval is required");
      });

      it("keeps permanent approvals separate for distinct remote tools with identical arguments (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let requests = 0;
        const execute = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "changed" }],
          details: undefined,
        }));
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow_always" },
        }));
        const f = fixture(
          () =>
            ++requests < 3
              ? response("", [
                  {
                    id: `remote-${requests}`,
                    name: requests === 1 ? "service_a_write" : "service_b_write",
                    arguments: { target: "same" },
                  },
                ])
              : response("Done"),
          ["service_a_write", "service_b_write"].map((name) => ({
            name,
            label: name,
            description: name,
            parameters: { type: "object", properties: { target: { type: "string" } } },
            execute,
          }))
        );
        f.proc.setPermissionPrompter(permission);
        const id = await f.open();
        await f.send(id);
        expect(permission).toHaveBeenCalledTimes(2);
        expect(execute).toHaveBeenCalledTimes(2);
      });

      it("refreshes changed capability descriptions before the next actual model request (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let revision = "first";
        const contexts: Context[] = [];
        const f = fixture(
          (_model, context) => {
            contexts.push(context);
            return contexts.length === 1
              ? response("", [{ id: "read", name: "read_note", arguments: {} }])
              : response("Updated tools");
          },
          [],
          {
            getCapabilityRevision: () => revision,
            createTools: () => ({
              tools: [
                {
                  name: revision === "first" ? "read_note" : "find_paths",
                  label: "Current",
                  description: revision,
                  parameters: { type: "object", properties: {} },
                  execute: async () => {
                    revision = "second";
                    return { content: [{ type: "text", text: "read" }], details: undefined };
                  },
                },
              ],
            }),
          }
        );
        const id = await f.open();
        await f.send(id);
        expect(getCurrentTools(contexts[1].messages).map((tool) => tool.name)).toEqual([
          "find_paths",
        ]);
      });

      it("delivers interleaved child messages in accepted order after parent preparation finishes (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let blocked = false;
        let ready!: () => void;
        let release!: () => void;
        const preparing = new Promise<void>((resolve) => {
          ready = resolve;
        });
        const resumed = new Promise<void>((resolve) => {
          release = resolve;
        });
        const contexts: Context[] = [];
        const f = fixture(
          (_model, context) => {
            contexts.push(context);
            return response("Done");
          },
          [],
          {
            getSystemPrompt: async () => {
              if (blocked) {
                ready();
                await resumed;
              }
              return "Instructions";
            },
          }
        );
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("a", { prompt: "A", description: "A" });
        await f.toolContexts[0].executeSubagent!("b", { prompt: "B", description: "B" });
        blocked = true;
        const turn = f.send(id, "parent", "Read discoveries");
        await preparing;
        await f.toolContexts[2].sendParentMessage!({ kind: "discovery", text: "First from B" });
        await f.toolContexts[1].sendParentMessage!({ kind: "discovery", text: "Second from A" });
        release();
        await turn;
        const actual = JSON.stringify(contexts.at(-1)!.messages);
        expect(actual).toContain("First from B");
        expect(actual).toContain("Second from A");
        expect(actual.indexOf("First from B")).toBeLessThan(actual.indexOf("Second from A"));
        await f.proc.shutdown();
      });

      it("keeps a child's local plan and its approval from changing the parent or a sibling mode (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const contexts: NativeToolContext[] = [];
        let waiting!: () => void;
        let approve!: () => void;
        const pending = new Promise<void>((resolve) => {
          waiting = resolve;
        });
        const f = fixture(
          (_model, context) => {
            const task = context.messages.find((message) => message.role === "user");
            return task?.role === "user" &&
              task.content === "Child A" &&
              !context.messages.some((message) => message.role === "toolResult")
              ? response("", [{ id: "plan", name: "propose_plan", arguments: { plan: "Review" } }])
              : response("Done");
          },
          [],
          {
            createTools: (context) => {
              contexts.push(context);
              return {
                tools: [
                  {
                    name: "propose_plan",
                    label: "Plan",
                    description: "Plan",
                    parameters: { type: "object", properties: { plan: { type: "string" } } },
                    execute: async (id) => {
                      const decision = await context.requestPermission({
                        sessionId: context.sessionId,
                        toolCall: {
                          toolCallId: id,
                          kind: "switch_mode",
                          title: "Plan",
                          rawInput: { plan: "Review" },
                          isPlanProposal: true,
                        },
                        options: [{ optionId: "allow_once", name: "Approve", kind: "allow_once" }],
                      });
                      if (decision.outcome.outcome === "selected") context.onPlanApproved();
                      return {
                        content: [{ type: "text", text: "Plan approved" }],
                        details: undefined,
                      };
                    },
                  },
                ],
              };
            },
          }
        );
        f.proc.setPermissionPrompter(
          () =>
            new Promise((resolve) => {
              approve = () => resolve({ outcome: { outcome: "selected", optionId: "allow_once" } });
              waiting();
            })
        );
        const id = await f.open();
        await f.proc.setSessionMode({ sessionId: id, modeId: "full" });
        const first = contexts[0].executeSubagent!("child-a", {
          prompt: "Child A",
          description: "A",
        });
        await pending;
        expect(contexts[1].getMode()).toBe("plan");
        expect(contexts[0].getMode()).toBe("full");
        await contexts[0].executeSubagent!("child-b", { prompt: "Child B", description: "B" });
        expect(contexts[2].getMode()).toBe("full");
        approve();
        await first;
        expect(contexts[1].getMode()).toBe("full");
        expect(contexts[0].getMode()).toBe("full");
        expect(contexts[2].getMode()).toBe("full");
      });

      it("keeps an independent new parent task running when an old child reports delayed quota exhaustion (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let childReady!: () => void;
        let parentReady!: () => void;
        let failChild!: () => void;
        let finishParent!: () => void;
        let parentAborted = false;
        const childStarted = new Promise<void>((resolve) => {
          childReady = resolve;
        });
        const parentStarted = new Promise<void>((resolve) => {
          parentReady = resolve;
        });
        let requests = 0;
        const f = fixture((_model, _context, options) => {
          const stream = createAssistantMessageEventStream();
          if (++requests === 1) {
            let ended = false;
            const end = () => {
              if (ended) return;
              ended = true;
              const message = createAssistantMessage(model);
              message.stopReason = "error";
              message.errorMessage = "Old account quota exhausted";
              stream.push({ type: "error", reason: "error", error: message });
            };
            options?.signal?.addEventListener("abort", end, { once: true });
            failChild = () => {
              options?.onFailure?.({ kind: "quota" });
              end();
            };
            childReady();
          } else {
            const abort = () => {
              parentAborted = true;
              const message = createAssistantMessage(model);
              message.stopReason = "aborted";
              stream.push({ type: "error", reason: "aborted", error: message });
            };
            options?.signal?.addEventListener("abort", abort, { once: true });
            finishParent = () => {
              options?.signal?.removeEventListener("abort", abort);
              const message = createAssistantMessage(model);
              message.content = [{ type: "text", text: "Independent task done" }];
              message.stopReason = "stop";
              stream.push({ type: "done", reason: "stop", message });
            };
            parentReady();
          }
          return stream;
        });
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("old-delegate", {
          prompt: "Old child",
          description: "Old",
          background: true,
        });
        await childStarted;
        const [child] = await f.proc.listSubagentSessions({ sessionId: id });
        const sequence = Math.max(...child.messages.map((message) => message.sequence));
        await f.proc.startIndependentTask({ sessionId: id });
        const parent = f.send(id, "new-task", "Independent task");
        await parentStarted;
        const childEnded = f.proc.waitSubagents({
          sessionId: id,
          subagentIds: [child.id],
          after: sequence,
        });
        failChild();
        await childEnded;
        expect(parentAborted).toBe(false);
        finishParent();
        await parent;
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "turn_ended",
            turnId: "new-task",
            stopReason: "end_turn",
          })
        );
        await f.proc.shutdown();
      });

      it("stops the parent without another request when a child exhausts quota (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const request = jest.fn((_model, context: Context, options?: AgentStreamOptions) => {
          if (
            JSON.stringify(
              context.messages.findLast((message) => message.role === "user")?.content
            ).includes("Child quota")
          ) {
            options?.onFailure?.({ kind: "quota", code: "insufficient_quota" });
            const stream = createAssistantMessageEventStream();
            stream.push({
              type: "error",
              reason: "error",
              error: {
                ...createAssistantMessage(model),
                stopReason: "error",
                errorMessage: "account exhausted",
              },
            });
            return stream;
          }
          return response("", [
            {
              id: "delegate",
              name: "delegate_task",
              arguments: { prompt: "Child quota", description: "Check notes" },
            },
          ]);
        });
        const f = fixture(request, [], {
          createTools: (context) => ({
            tools: [
              {
                name: "delegate_task",
                label: "Delegate",
                description: "Delegate",
                parameters: { type: "object", properties: {} },
                execute: (id, input, signal) =>
                  context.executeSubagent!(
                    id,
                    input as { prompt: string; description: string },
                    signal
                  ),
              },
            ],
          }),
        });
        const id = await f.open();
        await f.send(id);
        expect(request).toHaveBeenCalledTimes(2);
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "quota_exhausted" })
        );
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "task_ended", stopReason: "quota_exhausted" })
        );
      });

      it("compacts within one prompt while preserving the latest complete tool batch and user request (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const contexts: Context[] = [];
        let normal = 0;
        const f = fixture(
          (_model, context) => {
            contexts.push(JSON.parse(JSON.stringify(context)));
            if (JSON.stringify(context).includes("Summarize this recorded Obsidian conversation"))
              return response("Earlier work summary");
            normal++;
            if (normal > 3) return response("Finished");
            const stream = createAssistantMessageEventStream();
            const message = createAssistantMessage(model);
            message.content = [
              { type: "toolCall", id: `read-${normal}`, name: "read_note", arguments: {} },
            ];
            message.stopReason = "toolUse";
            message.usage.totalTokens = normal === 2 ? 7900 : 100;
            stream.push({ type: "done", reason: "toolUse", message });
            return stream;
          },
          [
            {
              name: "read_note",
              label: "Read",
              description: "Read",
              parameters: { type: "object", properties: {} },
              execute: async (id) => ({
                content: [{ type: "text", text: `${id}:` + "a".repeat(1000) }],
                details: undefined,
              }),
            },
          ]
        );
        const id = await f.open();
        await f.send(id, "long", "Exact current task");
        expect(contexts).toHaveLength(5);
        expect(JSON.stringify(contexts[2])).toContain("read-1");
        expect(JSON.stringify(contexts[2])).not.toContain("Exact current task");
        expect(JSON.stringify(contexts[3])).toContain("Exact current task");
        expect(JSON.stringify(contexts[3])).toContain("Earlier work summary");
        expect(contexts[3].messages).toContainEqual(
          expect.objectContaining({ role: "toolResult", toolCallId: "read-2" })
        );
        expect(
          contexts[4].messages.filter(
            (message) => message.role === "toolResult" && message.toolCallId === "read-3"
          )
        ).toHaveLength(1);
        expect(
          f.records
            .get(id)
            ?.messages.filter(
              (message) =>
                message.role === "assistant" &&
                message.content.some((part) => part.type === "text" && part.text === "Finished")
            )
        ).toHaveLength(1);
        expect(JSON.stringify(f.records.get(id)?.messages)).toContain('"toolCallId":"read-1"');
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "compaction",
            status: "completed",
            trigger: "auto",
          })
        );
      });

      it("stops with a context reason when the newest tool result alone cannot fit (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        const request = jest.fn(() =>
          response("", [{ id: "huge", name: "read_note", arguments: {} }])
        );
        const f = fixture(request, [
          {
            name: "read_note",
            label: "Read",
            description: "Read",
            parameters: { type: "object", properties: {} },
            execute: async () => ({
              content: [{ type: "text", text: "a".repeat(40000) }],
              details: undefined,
            }),
          },
        ]);
        const id = await f.open();
        await f.send(id);
        expect(request).toHaveBeenCalledTimes(1);
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "context_limit" })
        );
        expect(JSON.stringify(f.records.get(id)?.messages)).toContain("a".repeat(40000));
      });

      it("keeps a normal final reply successful when it finishes on the step limit", async () => {
        const f = fixture(undefined, [], { maxSteps: 1 });
        const id = await f.open();
        await f.send(id);
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "end_turn" })
        );
      });

      it("compacts actual conversation text with the selected model and then continues from its summary", async () => {
        const contexts: Context[] = [];
        const f = fixture((_model, context) => {
          contexts.push(context);
          return response(contexts.length === 2 ? "Saved summary of the actual notes" : "Hello");
        });
        const id = await f.open();
        await f.send(id);
        await f.send(id, "compact-1", "/compact");
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "compaction",
            trigger: "manual",
            status: "completed",
          })
        );
        expect(contexts[1].messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ role: "user", content: expect.stringContaining("Hello") }),
          ])
        );
        await f.send(id, "after-compact", "Continue");
        expect(JSON.stringify(contexts[2].messages)).toContain("Saved summary of the actual notes");
      });
      it("keeps the original context when the manual compaction summary ends truncated", async () => {
        const contexts: Context[] = [];
        let round = 0;
        const f = fixture((_model, context) => {
          contexts.push(JSON.parse(JSON.stringify(context)));
          round++;
          if (round === 1) return response("a secret hidden near end of source");
          if (round === 2) {
            const stream = createAssistantMessageEventStream();
            const message = createAssistantMessage(model);
            message.stopReason = "length";
            message.content = [{ type: "text", text: "first two words before cutoff" }];
            stream.push({ type: "done", reason: "length", message });
            return stream;
          }
          return response("done");
        });
        const id = await f.open();
        await f.send(id, "r1", "Keep the important source");
        await f.send(id, "compact", "/compact");
        expect(
          f.events
            .filter((event) => event.update.sessionUpdate === "compaction")
            .map((event) => (event.update as { status?: string }).status)
        ).toEqual(["in_progress", "failed"]);
        await f.send(id, "r2", "continue");
        expect(JSON.stringify(contexts.at(-1))).toContain("secret hidden near end");
        expect(JSON.stringify(contexts.at(-1))).not.toContain("first two words before cutoff");
      });
      it("keeps the original context when the automatic compaction summary ends truncated", async () => {
        const contexts: Context[] = [];
        let round = 0;
        const f = fixture(undefined, [], {
          createModel: async () => ({
            model: { ...model, contextWindow: 8192 },
            stream: () => response("unused"),
            agentStream: (context: Context) => {
              contexts.push(JSON.parse(JSON.stringify(context)));
              round++;
              if (round === 1) {
                const stream = createAssistantMessageEventStream();
                const message = createAssistantMessage(model);
                message.content = [{ type: "text", text: "large earlier answer" }];
                message.stopReason = "stop";
                message.usage.totalTokens = 7000;
                stream.push({ type: "done", reason: "stop", message });
                return stream;
              }
              if (round === 2) {
                const stream = createAssistantMessageEventStream();
                const message = createAssistantMessage(model);
                message.stopReason = "length";
                message.content = [{ type: "text", text: "cut short" }];
                stream.push({ type: "done", reason: "length", message });
                return stream;
              }
              return response("final answer");
            },
          }),
        });
        const id = await f.open();
        await f.send(id, "r1", "unique marker 762");
        await f.send(id, "r2", "next authorization");
        const statuses = f.events
          .filter((event) => event.update.sessionUpdate === "compaction")
          .map((event) => (event.update as { status?: string }).status);
        expect(statuses).toEqual(["in_progress", "failed"]);
        expect(JSON.stringify(contexts.at(-1))).toContain("unique marker 762");
      });
      it("builds the compaction request from continuation-relevant text without assistant error details", async () => {
        const contexts: Context[] = [];
        const secret = "audit-secret-ONE-not-real";
        let round = 0;
        const f = fixture((_model, context) => {
          contexts.push(JSON.parse(JSON.stringify(context)));
          if (++round === 1) {
            const stream = createAssistantMessageEventStream();
            const message = createAssistantMessage(model);
            message.stopReason = "error";
            message.errorMessage = `configured-model (openai-completions), model stream: HTTP 401: Invalid credential ${secret}`;
            stream.push({ type: "error", reason: "error", error: message });
            return stream;
          }
          if (round === 2) return response("Saved summary");
          return response("done");
        });
        const id = await f.open();
        await f.send(id, "p1", "Hello");
        expect(JSON.stringify(f.records.get(id))).toContain(secret);
        await f.send(id, "p2", "/compact");
        const summaryRequest = JSON.stringify(contexts[1].messages);
        expect(summaryRequest).toContain("Hello");
        expect(summaryRequest).not.toContain(secret);
        expect(summaryRequest).not.toContain("errorMessage");
      });
      it("reports an unknown context window instead of a fabricated one", async () => {
        const f = fixture(undefined, [], {
          createModel: async () => ({
            model: { ...model, contextWindow: 0 },
            stream: () => response("unused"),
            agentStream: () => response("Hello"),
          }),
        });
        const id = await f.open();
        await f.send(id);
        const usage = f.events.find((event) => event.update.sessionUpdate === "usage_update")
          ?.update as { usage?: { usedTokens: number; contextWindow: number } } | undefined;
        expect(usage?.usage).toMatchObject({ usedTokens: expect.any(Number) });
        expect(usage?.usage?.contextWindow).toBeUndefined();
      });
      it("delivers a prompt id once even when the caller submits it again after completion", async () => {
        const request = jest.fn(() => response("once"));
        const f = fixture(request);
        const id = await f.open();
        await f.send(id);
        await f.send(id);
        expect(request).toHaveBeenCalledTimes(1);
      });
      it("streams the reply once and ends the matching turn with actual usage", async () => {
        const f = fixture();
        const id = await f.open();
        await f.send(id);
        expect(
          f.events
            .filter((e) => e.update.sessionUpdate === "agent_message_chunk")
            .map((e) => e.update)
        ).toEqual([expect.objectContaining({ content: { type: "text", text: "Hello" } })]);
        expect(f.events.map((e) => e.update)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({ sessionUpdate: "message_delivered", promptId: "prompt-1" }),
            expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "end_turn" }),
            expect.objectContaining({
              sessionUpdate: "usage_update",
              usage: expect.objectContaining({ contextWindow: 10000 }),
            }),
          ])
        );
      });

      it("runs a validated real tool and sends its result back under the original call id", async () => {
        const contexts: Context[] = [];
        const read = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "random-marker-7f3" }],
          details: undefined,
        }));
        const f = fixture(
          (_model, context) => {
            contexts.push(JSON.parse(JSON.stringify(context)));
            return contexts.length === 1
              ? response("", [{ id: "read-1", name: "read_note", arguments: { path: "note.md" } }])
              : response("random-marker-7f3");
          },
          [
            {
              name: "read_note",
              label: "Read",
              description: "Read a fixture note",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
                additionalProperties: false,
              },
              execute: read,
            },
          ]
        );
        const id = await f.open();
        await f.send(id);
        expect(read).toHaveBeenCalledTimes(1);
        expect(contexts[1].messages).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              role: "toolResult",
              toolCallId: "read-1",
              content: [{ type: "text", text: "random-marker-7f3" }],
            }),
          ])
        );
        expect(f.events.map((e) => e.update)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              sessionUpdate: "tool_call",
              toolCallId: "prompt-1:read-1",
              kind: "read",
            }),
            expect.objectContaining({
              sessionUpdate: "tool_call_update",
              toolCallId: "prompt-1:read-1",
              status: "completed",
            }),
          ])
        );
      });

      it("returns invalid parameters as an error result without executing the tool", async () => {
        const execute = jest.fn();
        let requests = 0;
        const f = fixture(
          () =>
            ++requests === 1
              ? response("", [{ id: "bad-1", name: "read_note", arguments: { path: {} } }])
              : response("Invalid path"),
          [
            {
              name: "read_note",
              label: "Read",
              description: "Read note",
              parameters: {
                type: "object",
                properties: { path: { type: "string" } },
                required: ["path"],
              },
              execute,
            },
          ]
        );
        const id = await f.open();
        await f.send(id);
        expect(execute).not.toHaveBeenCalled();
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "tool_call_update",
            toolCallId: "prompt-1:bad-1",
            status: "failed",
          })
        );
      });
    });

    describe("mcp tool permission gating", () => {
      function mcpToolFixture() {
        const execute = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "ok" }],
          details: undefined,
        }));
        const tool: AgentTool = {
          name: "mcp__files__search",
          label: "search",
          description: "Search notes.",
          parameters: { type: "object", properties: {} },
          execute,
        };
        return { execute, tool };
      }

      it("runs mcp tools listed for auto-approval without a permission prompt", async () => {
        const { execute, tool } = mcpToolFixture();
        let requests = 0;
        const f = fixture(
          () =>
            ++requests === 1
              ? response("", [{ id: "mcp-1", name: "mcp__files__search", arguments: {} }])
              : response("Done"),
          [tool],
          {
            createTools: () => ({
              tools: [tool],
              autoApproveTools: new Set(["mcp__files__search"]),
            }),
          }
        );
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow_once" },
        }));
        f.proc.setPermissionPrompter(permission);
        const id = await f.open();
        await f.send(id);
        expect(permission).not.toHaveBeenCalled();
        expect(execute).toHaveBeenCalledTimes(1);
        expect(JSON.stringify(f.records.get(id)?.messages)).toContain("mcp__files__search");
      });

      it("still prompts for mcp tools that are not auto-approved", async () => {
        const { execute, tool } = mcpToolFixture();
        let requests = 0;
        const f = fixture(
          () =>
            ++requests === 1
              ? response("", [{ id: "mcp-1", name: "mcp__files__search", arguments: {} }])
              : response("Done"),
          [tool],
          { createTools: () => ({ tools: [tool] }) }
        );
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow_once" },
        }));
        f.proc.setPermissionPrompter(permission);
        const id = await f.open();
        await f.send(id);
        expect(permission).toHaveBeenCalledTimes(1);
        expect(execute).toHaveBeenCalledTimes(1);
      });
    });

    describe("continueTaskBudget()", () => {
      it("adds the configured allowance to the exact task once per grant without starting a model (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const request = jest.fn(() => response("Done"));
        const f = fixture(request);
        const id = await f.open();
        await f.send(id);
        const task = f.records.get(id)!.taskGenerations![0];
        await f.proc.continueTaskBudget({
          sessionId: id,
          taskGenerationId: task.id,
          requestId: "grant",
        });
        await f.proc.continueTaskBudget({
          sessionId: id,
          taskGenerationId: task.id,
          requestId: "grant",
        });
        expect(
          f.records.get(id)!.taskGenerations!.find((entry) => entry.id === task.id)?.limit
        ).toBe(200);
        expect(request).toHaveBeenCalledTimes(1);
      });
    });

    describe("startIndependentTask()", () => {
      it("starts a distinct budget generation without rewriting the completed task (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const id = await f.open();
        await f.send(id);
        const originalId = f.records.get(id)!.taskGenerations![0].id;
        await f.proc.startIndependentTask({ sessionId: id });
        await f.send(id, "independent", "New task");
        const tasks = f.records.get(id)!.taskGenerations!;
        expect(tasks).toHaveLength(2);
        expect(tasks[0].id).toBe(originalId);
        expect(tasks[0].autoContinue).toBe(false);
        expect(tasks[1].id).not.toBe(originalId);
      });
    });

    describe("setSubagentArchived()", () => {
      it("does not append archived results or start an extra parent request after its current response ends (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let signalChild!: () => void;
        let signalParent!: () => void;
        const childStarted = {
          promise: new Promise<void>((resolve) => {
            signalChild = resolve;
          }),
        };
        const parentStarted = {
          promise: new Promise<void>((resolve) => {
            signalParent = resolve;
          }),
        };
        let endParent!: () => void;
        const contexts: Context[] = [];
        const f = fixture((_model, context, options) => {
          contexts.push(context);
          const stream = createAssistantMessageEventStream();
          const first = context.messages.find((message) => message.role === "user");
          if (first?.role === "user" && first.content === "Archive child") {
            options?.signal?.addEventListener(
              "abort",
              () => {
                const message = createAssistantMessage(model);
                message.stopReason = "aborted";
                stream.push({ type: "error", reason: "aborted", error: message });
              },
              { once: true }
            );
            signalChild();
          } else if (contexts.length === 2) {
            endParent = () => {
              const message = createAssistantMessage(model);
              message.content = [{ type: "text", text: "Parent complete" }];
              message.stopReason = "stop";
              stream.push({ type: "done", reason: "stop", message });
            };
            signalParent();
          } else return response("Unexpected extra request");
          return stream;
        });
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("child", {
          prompt: "Archive child",
          description: "Archived",
          background: true,
        });
        await childStarted.promise;
        const [child] = await f.proc.listSubagentSessions({ sessionId: id });
        const turn = f.send(id, "parent-current", "Current work");
        await parentStarted.promise;
        await f.proc.setSubagentArchived({ sessionId: id, subagentId: child.id, archived: true });
        endParent();
        await turn;
        expect(contexts).toHaveLength(2);
        expect(
          (await f.proc.listSubagentSessions({ sessionId: id }))[0].runs[0].resultDelivered
        ).not.toBe(true);
        await f.proc.shutdown();
      });

      it("archives and unarchives the retained child without exposing another chat's state (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("delegate", {
          prompt: "Child",
          description: "Retained",
        });
        const [child] = await f.proc.listSubagentSessions({ sessionId: id });
        await f.proc.setSubagentArchived({ sessionId: id, subagentId: child.id, archived: true });
        expect((await f.proc.listSubagentSessions({ sessionId: id }))[0].retention).toBe(
          "archived"
        );
        await expect(
          f.proc.sendSubagentMessage({
            sessionId: id,
            subagentId: child.id,
            text: "Continue",
            mode: "wake",
          })
        ).rejects.toThrow("取消归档");
        await f.proc.setSubagentArchived({ sessionId: id, subagentId: child.id, archived: false });
        expect((await f.proc.listSubagentSessions({ sessionId: id }))[0].retention).toBe(
          "retained"
        );
      });
    });

    describe("deleteSubagentSession()", () => {
      it("removes the saved child while retaining the original parent chat (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const f = fixture();
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("delegate", {
          prompt: "Child",
          description: "Retained",
        });
        const [child] = await f.proc.listSubagentSessions({ sessionId: id });
        await f.proc.deleteSubagentSession({ sessionId: id, subagentId: child.id });
        expect(await f.proc.listSubagentSessions({ sessionId: id })).toEqual([]);
        expect(f.records.has(id)).toBe(true);
        await expect(
          f.proc.sendSubagentMessage({
            sessionId: id,
            subagentId: child.id,
            text: "Continue",
            mode: "wake",
          })
        ).rejects.toThrow("找不到");
      });
    });

    describe("confirmSubagentRecovery()", () => {
      it("records an explicit recovery confirmation without running a model or tool (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const request = jest.fn(() => response("Done"));
        const f = fixture(request);
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("delegate", {
          prompt: "Child",
          description: "Retained",
        });
        const [child] = await f.proc.listSubagentSessions({ sessionId: id });
        const count = request.mock.calls.length;
        await f.proc.confirmSubagentRecovery({ sessionId: id, subagentId: child.id });
        expect(request).toHaveBeenCalledTimes(count);
        expect((await f.proc.listSubagentSessions({ sessionId: id }))[0].id).toBe(child.id);
      });
    });

    describe("cancel", () => {
      it("still aborts child work and releases owned resources when saving the stop fails (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const contexts: NativeToolContext[] = [];
        let fail = false;
        let started!: () => void;
        let aborted = false;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const shutdown = jest.fn(async () => {});
        const f = fixture(
          (_model, _context, options) => {
            const stream = createAssistantMessageEventStream();
            options?.signal?.addEventListener(
              "abort",
              () => {
                aborted = true;
                const message = createAssistantMessage(model);
                message.stopReason = "aborted";
                stream.push({ type: "error", reason: "aborted", error: message });
              },
              { once: true }
            );
            started();
            return stream;
          },
          [],
          {
            storage: {
              load: async () => null,
              list: async () => [],
              save: async () => {
                if (fail) throw new Error("Stop save failed");
              },
            },
            createTools: (context) => {
              contexts.push(context);
              return { tools: [], shutdown };
            },
          }
        );
        const id = await f.open();
        await contexts[0].executeSubagent!("child", {
          prompt: "Run",
          description: "Running",
          background: true,
        });
        await ready;
        fail = true;
        await expect(f.proc.cancel({ sessionId: id })).rejects.toThrow("Stop save failed");
        expect(aborted).toBe(true);
        expect(shutdown).toHaveBeenCalledTimes(2);
        fail = false;
        await f.proc.shutdown();
      });

      it("stops during instruction loading and does not start a model request when that loading finishes later", async () => {
        let started!: () => void;
        let finish!: (text: string) => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const loading = new Promise<string>((resolve) => {
          finish = resolve;
        });
        let reads = 0;
        const request = jest.fn(() => response("must not send"));
        const f = fixture(request, [], {
          getSystemPrompt: async () => {
            if (++reads === 1) return "Initial instructions";
            started();
            return loading;
          },
        });
        const id = await f.open();
        const run = f.send(id);
        await ready;
        await f.proc.cancel({ sessionId: id });
        finish("Late instructions");
        await loading;
        await run;
        expect(request).not.toHaveBeenCalled();
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "cancelled" })
        );
      });
      it("aborts the selected model request and settles the turn without emitting late text", async () => {
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const f = fixture((_model, _context, options) => {
          const stream = createAssistantMessageEventStream();
          started();
          options?.signal?.addEventListener(
            "abort",
            () => {
              const message = createAssistantMessage(model);
              message.stopReason = "aborted";
              stream.push({ type: "error", reason: "aborted", error: message });
            },
            { once: true }
          );
          return stream;
        });
        const id = await f.open();
        const pending = f.send(id);
        await ready;
        await f.proc.cancel({ sessionId: id });
        await pending;
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "cancelled" })
        );
        expect(
          f.events.filter((e) => e.update.sessionUpdate === "agent_message_chunk")
        ).toHaveLength(0);
      });
      it("sends unread text after Send now even when the provider reports structured cancellation (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const contexts: string[] = [];
        const f = fixture((_model, context, options) => {
          contexts.push(JSON.stringify(context.messages));
          if (contexts.length === 1) {
            const stream = createAssistantMessageEventStream();
            started();
            options?.signal?.addEventListener(
              "abort",
              () => {
                options?.onFailure?.({ kind: "cancelled" });
                const message = createAssistantMessage(model);
                message.stopReason = "aborted";
                stream.push({ type: "error", reason: "aborted", error: message });
              },
              { once: true }
            );
            return stream;
          }
          return response("next reply");
        });
        const id = await f.open();
        const running = f.send(id, "first", "first user turn");
        await ready;
        const queued = f.send(id, "queued", "Please read immediately");
        await f.proc.cancel({ sessionId: id, keepUnread: true });
        await Promise.all([running, queued]);
        expect(contexts.at(-1)).toContain("Please read immediately");
        expect(
          f.events.filter(
            (event) =>
              event.update.sessionUpdate === "message_delivered" &&
              event.update.promptId === "queued"
          )
        ).toHaveLength(1);
        expect(
          f.events
            .filter((event) => event.update.sessionUpdate === "turn_ended")
            .map((event) => event.update)
        ).toEqual([
          expect.objectContaining({ turnId: "first", stopReason: "cancelled" }),
          expect.objectContaining({ turnId: "queued", stopReason: "end_turn" }),
        ]);
      });
      it("does not resend a queued message that was withdrawn after Send now", async () => {
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        const request = jest.fn(
          (_model: unknown, _context: Context, options?: AgentStreamOptions) => {
            const stream = createAssistantMessageEventStream();
            started();
            options?.signal?.addEventListener(
              "abort",
              () => {
                const message = createAssistantMessage(model);
                message.stopReason = "aborted";
                stream.push({ type: "error", reason: "aborted", error: message });
              },
              { once: true }
            );
            return stream;
          }
        );
        const f = fixture(request);
        const id = await f.open();
        const running = f.send(id, "first", "first user turn");
        await ready;
        const queued = f.send(id, "queued", "Please read immediately");
        await f.proc.cancel({ sessionId: id, keepUnread: true });
        await f.proc.withdraw({ sessionId: id, promptId: "queued" });
        await Promise.all([running, queued]);
        expect(request).toHaveBeenCalledTimes(1);
        expect(
          f.events.filter((event) => event.update.sessionUpdate === "message_delivered")
        ).toHaveLength(1);
      });
    });

    describe("withdraw", () => {
      it("withdraws an unread queued prompt and never sends it to the model", async () => {
        let ready!: () => void;
        const started = new Promise<void>((resolve) => {
          ready = resolve;
        });
        let release!: () => void;
        const completed = new Promise<void>((resolve) => {
          release = resolve;
        });
        const request = jest.fn(() => {
          const stream = createAssistantMessageEventStream();
          ready();
          void completed.then(() => {
            const message = createAssistantMessage(model);
            message.stopReason = "stop";
            stream.push({ type: "done", reason: "stop", message });
          });
          return stream;
        });
        const f = fixture(request);
        const id = await f.open();
        const running = f.send(id);
        await started;
        await f.send(id, "queued-7", "Do not deliver");
        expect(await f.proc.withdraw({ sessionId: id, promptId: "queued-7" })).toBe(true);
        expect(await f.proc.withdraw({ sessionId: id, promptId: "prompt-1" })).toBe(false);
        release();
        await running;
        expect(request).toHaveBeenCalledTimes(1);
        expect(f.events.map((e) => e.update)).toContainEqual({
          sessionUpdate: "messages_withdrawn",
          promptIds: ["queued-7"],
        });
      });
    });

    describe("stopSubagent()", () => {
      it("stops the selected retained child's active run and preserves its directory (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        let requests = 0;
        const f = fixture((_model, _context, options) => {
          if (++requests > 1) return response("Stopped child acknowledged");
          const stream = createAssistantMessageEventStream();
          options?.signal?.addEventListener(
            "abort",
            () => {
              const message = createAssistantMessage(model);
              message.stopReason = "aborted";
              stream.push({ type: "error", reason: "aborted", error: message });
            },
            { once: true }
          );
          started();
          return stream;
        });
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("child", {
          prompt: "Running",
          description: "Retained",
          background: true,
        });
        await ready;
        const [child] = await f.proc.listSubagentSessions({ sessionId: id });
        await f.proc.stopSubagent({ sessionId: id, subagentId: child.id });
        expect((await f.proc.listSubagentSessions({ sessionId: id }))[0].runs[0]).toMatchObject({
          status: "stopped",
          result: "Subagent stopped.",
        });
        await f.proc.shutdown();
      });
    });

    describe("stopTask", () => {
      it("ignores an ended run's late stop while the same child's new run continues (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        let started!: () => void;
        let finish!: () => void;
        let aborted = false;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        let requests = 0;
        const f = fixture((_model, _context, options) => {
          if (++requests !== 2) return response("Done");
          const stream = createAssistantMessageEventStream();
          const abort = () => {
            aborted = true;
            const message = createAssistantMessage(model);
            message.stopReason = "aborted";
            stream.push({ type: "error", reason: "aborted", error: message });
          };
          options?.signal?.addEventListener("abort", abort, { once: true });
          finish = () => {
            options?.signal?.removeEventListener("abort", abort);
            const message = createAssistantMessage(model);
            message.content = [{ type: "text", text: "Second run done" }];
            message.stopReason = "stop";
            stream.push({ type: "done", reason: "stop", message });
          };
          started();
          return stream;
        });
        const id = await f.open();
        await f.toolContexts[0].executeSubagent!("delegate", {
          prompt: "Child",
          description: "Retained",
        });
        const [child] = await f.proc.listSubagentSessions({ sessionId: id });
        const sequence = Math.max(...child.messages.map((message) => message.sequence));
        await f.proc.sendSubagentMessage({
          sessionId: id,
          subagentId: child.id,
          text: "Continue",
          mode: "wake",
        });
        await ready;
        await f.proc.stopTask({ sessionId: id, taskId: child.runs[0].id });
        expect(aborted).toBe(false);
        const completed = f.proc.waitSubagents({
          sessionId: id,
          subagentIds: [child.id],
          after: sequence,
        });
        finish();
        expect((await completed).reason).toBe("completed");
        expect((await f.proc.listSubagentSessions({ sessionId: id }))[0].runs).toHaveLength(2);
        await f.proc.shutdown();
      });

      it("passes the requested task identity to its runner without cancelling the chat", async () => {
        const stopTask = jest.fn(async () => {});
        const f = fixture(undefined, [], { createTools: () => ({ tools: [], stopTask }) });
        const id = await f.open();
        await f.proc.stopTask({ sessionId: id, taskId: "command-9" });
        expect(stopTask).toHaveBeenCalledWith("command-9");
        await f.send(id);
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "end_turn" })
        );
      });
    });

    describe("loadSession", () => {
      it("restores child messages and turn start times in their original order without rerunning them https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture(() => response("Done"));
        const id = await f.open();
        await f.send(id);
        await f.toolContexts[0].executeSubagent!("child", {
          prompt: "Child",
          description: "Child",
        });
        await f.send(id, "follow-up", "Continue");
        const relevant = (events: SessionEvent[]) =>
          events.filter((event) =>
            ["turn_started", "subagent_message", "message_delivered", "turn_ended"].includes(
              event.update.sessionUpdate
            )
          );
        const original = relevant(f.events);
        expect(original.some((event) => event.update.sessionUpdate === "subagent_message")).toBe(
          true
        );
        await f.proc.closeSession({ sessionId: id });
        f.events.length = 0;

        await f.proc.loadSession({ sessionId: id, cwd: "/fixture/vault" });

        expect(relevant(f.events)).toEqual(original);
        await f.proc.shutdown();
      });

      it("replays stored history without executing its recorded tools", async () => {
        const execute = jest.fn(async () => ({
          content: [{ type: "text" as const, text: "read result" }],
          details: undefined,
        }));
        let requests = 0;
        const f = fixture(
          () =>
            ++requests === 1
              ? response("", [{ id: "call-1", name: "read_note", arguments: {} }])
              : response("done"),
          [
            {
              name: "read_note",
              label: "Read",
              description: "Read",
              parameters: { type: "object", properties: {} },
              execute,
            },
          ]
        );
        const id = await f.open();
        await f.send(id);
        await f.proc.closeSession({ sessionId: id });
        const count = execute.mock.calls.length;
        f.events.length = 0;
        await f.proc.loadSession({ sessionId: id, cwd: "/fixture/vault" });
        expect(execute).toHaveBeenCalledTimes(count);
        expect(f.events.some((e) => e.update.sessionUpdate === "agent_message_chunk")).toBe(true);
        expect(
          f.events.some((e) => e.update.sessionUpdate === "busy_changed" && e.update.busy)
        ).toBe(false);
      });
    });

    describe("isRunning", () => {
      it("reports unavailable after shutdown", async () => {
        const f = fixture();
        await f.proc.shutdown();
        expect(f.proc.isRunning()).toBe(false);
      });
    });

    describe("onExit", () => {
      it("notifies subscribed listeners once and lets removed listeners stay silent", async () => {
        const f = fixture();
        const listener = jest.fn();
        const removed = jest.fn();
        f.proc.onExit(listener);
        f.proc.onExit(removed)();
        await f.proc.shutdown();
        await f.proc.shutdown();
        expect(listener).toHaveBeenCalledTimes(1);
        expect(removed).not.toHaveBeenCalled();
      });
    });

    describe("setPermissionPrompter", () => {
      it("keeps one-shot command approval separate for the parent, two children and a later run of the same child (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const permission = jest.fn(async (_prompt: PermissionPrompt) => ({
          outcome: { outcome: "selected" as const, optionId: "allow_once" },
        }));
        const f = fixture();
        f.proc.setPermissionPrompter(permission);
        const id = await f.open();
        const prompt = (call: string) => ({
          sessionId: id,
          toolCall: {
            toolCallId: call,
            kind: "execute" as const,
            vendorToolName: "run_command",
            title: "Same command",
            rawInput: { command: "printf same", cwd: "/fixture/vault" },
          },
          options: [],
        });
        await f.toolContexts[0].requestPermission(prompt("parent-command"));
        await f.toolContexts[0].executeSubagent!("child-a", { prompt: "A", description: "A" });
        await f.toolContexts[1].requestPermission(prompt("a-command"));
        await f.toolContexts[0].executeSubagent!("child-b", { prompt: "B", description: "B" });
        await f.toolContexts[2].requestPermission(prompt("b-command"));
        const [child] = await f.proc.listSubagentSessions({ sessionId: id });
        const sequence = Math.max(...child.messages.map((message) => message.sequence));
        const completed = f.proc.waitSubagents({
          sessionId: id,
          subagentIds: [child.id],
          after: sequence,
        });
        await f.proc.sendSubagentMessage({
          sessionId: id,
          subagentId: child.id,
          text: "Continue A",
          mode: "wake",
        });
        await completed;
        await f.toolContexts[3].requestPermission(prompt("a-next-command"));
        expect(permission).toHaveBeenCalledTimes(4);
        expect(permission.mock.calls.map((call) => call[0].requester)).toEqual([
          "main",
          expect.objectContaining({ subagentId: child.id }),
          expect.any(Object),
          expect.objectContaining({ subagentId: child.id }),
        ]);
        await f.proc.shutdown();
      });

      it("remembers only an explicit persistent decision for the same action in the same chat and requester", async () => {
        const f = fixture();
        const id = await f.open();
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow_always" },
        }));
        f.proc.setPermissionPrompter(permission);
        const prompt = {
          sessionId: id,
          toolCall: {
            toolCallId: "write-1",
            title: "Edit",
            kind: "edit" as const,
            rawInput: { path: "same.md" },
          },
          options: [],
        };
        expect((await f.toolContexts[0].requestPermission(prompt)).outcome).toEqual({
          outcome: "selected",
          optionId: "allow_once",
        });
        await f.toolContexts[0].requestPermission({
          ...prompt,
          toolCall: { ...prompt.toolCall, toolCallId: "write-2" },
        });
        expect(permission).toHaveBeenCalledTimes(1);
        await f.toolContexts[0].requestPermission({
          ...prompt,
          toolCall: { ...prompt.toolCall, rawInput: { path: "different.md" } },
        });
        expect(permission).toHaveBeenCalledTimes(2);
        await f.toolContexts[0].executeSubagent!("delegate-1", {
          prompt: "Independent task",
          description: "Child",
        });
        await f.toolContexts[1].requestPermission(prompt);
        expect(permission).toHaveBeenCalledTimes(3);
      });
      it("routes a tool approval to the configured callback without manufacturing an approval", async () => {
        const f = fixture();
        const id = await f.open();
        const prompt = {
          sessionId: id,
          toolCall: { toolCallId: "write-7", title: "Edit" },
          options: [],
        };
        expect(await f.toolContexts[0].requestPermission(prompt)).toEqual({
          outcome: { outcome: "cancelled" },
        });
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow_once" },
        }));
        f.proc.setPermissionPrompter(permission);
        expect(await f.toolContexts[0].requestPermission(prompt)).toEqual({
          outcome: { outcome: "selected", optionId: "allow_once" },
        });
        expect(permission).toHaveBeenCalledWith(
          expect.objectContaining({ ...prompt, requester: "main" })
        );
      });
      it("auto-approves an ordinary note edit in Auto mode without prompting", async () => {
        const f = fixture();
        const id = await f.open();
        await f.proc.setSessionMode({ sessionId: id, modeId: "auto" });
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow_once" },
        }));
        f.proc.setPermissionPrompter(permission);
        const decision = await f.toolContexts[0].requestPermission({
          sessionId: id,
          toolCall: {
            toolCallId: "auto-note",
            title: "Edit",
            kind: "edit",
            rawInput: { path: "notes/ordinary.md" },
            locations: [{ path: "notes/ordinary.md" }],
          },
          options: [],
        });
        expect(decision.outcome).toEqual({ outcome: "selected", optionId: "allow_once" });
        expect(permission).not.toHaveBeenCalled();
      });
      it.each([
        [
          "the default config directory",
          [OBSIDIAN_DEFAULT_CONFIG_DIR, "plugins", "fixture", "main.js"].join("/"),
          undefined,
        ],
        ["a custom config directory", ".myconfig/workspace.json", ".myconfig"],
      ])("still prompts in Auto mode for writes inside %s", async (_label, path, configDir) => {
        const f = fixture(undefined, [], {
          ...(configDir ? { getVaultConfigDir: () => configDir } : {}),
        });
        const id = await f.open();
        await f.proc.setSessionMode({ sessionId: id, modeId: "auto" });
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "reject_once" },
        }));
        f.proc.setPermissionPrompter(permission);
        const decision = await f.toolContexts[0].requestPermission({
          sessionId: id,
          toolCall: {
            toolCallId: "config-write",
            title: "Edit",
            kind: "edit",
            rawInput: { path },
            locations: [{ path }],
          },
          options: [],
        });
        expect(decision.outcome).toEqual({ outcome: "selected", optionId: "reject_once" });
        expect(permission).toHaveBeenCalledTimes(1);
      });
      it("honors a saved reject_always decision before Auto mode can auto-approve the same target", async () => {
        const f = fixture();
        const id = await f.open();
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "reject_always" },
        }));
        f.proc.setPermissionPrompter(permission);
        const prompt = (toolCallId: string) => ({
          sessionId: id,
          toolCall: {
            toolCallId,
            title: "Edit",
            kind: "edit" as const,
            rawInput: { path: "protected.md" },
            locations: [{ path: "protected.md" }],
          },
          options: [],
        });
        await f.toolContexts[0].requestPermission(prompt("deny-1"));
        await f.proc.setSessionMode({ sessionId: id, modeId: "auto" });
        const afterSwitch = await f.toolContexts[0].requestPermission(prompt("deny-2"));
        expect(afterSwitch.outcome).toEqual({ outcome: "selected", optionId: "reject_once" });
        expect(permission).toHaveBeenCalledTimes(1);
      });
    });

    describe("setAskUserQuestionPrompter", () => {
      it("returns the actual answer for the originating request", async () => {
        const f = fixture();
        const id = await f.open();
        const prompt = {
          sessionId: id,
          requestId: "ask-2",
          questions: [{ question: "Which?", options: [{ label: "One" }] }],
        };
        expect(await f.toolContexts[0].askUser(prompt)).toEqual({});
        f.proc.setAskUserQuestionPrompter(async () => ({ "Which?": "One" }));
        expect(await f.toolContexts[0].askUser(prompt)).toEqual({ "Which?": "One" });
      });
    });

    describe("registerSessionHandler", () => {
      it("keeps a replacement handler subscribed when the previous handler unsubscribes", async () => {
        const f = fixture();
        const id = await f.open();
        const original = jest.fn();
        const replacement = jest.fn();
        const unsubscribe = f.proc.registerSessionHandler(id, original);
        f.proc.registerSessionHandler(id, replacement);
        unsubscribe();
        await f.send(id);
        expect(original).not.toHaveBeenCalled();
        expect(replacement).toHaveBeenCalled();
      });
    });

    describe("setSessionModel", () => {
      it("selects the configured model for subsequent requests and persists its id", async () => {
        const f = fixture();
        const id = await f.open();
        expect(
          (await f.proc.setSessionModel({ sessionId: id, modelId: model.id })).model?.current
            .baseModelId
        ).toBe(model.id);
        expect(f.records.get(id)?.modelId).toBe(model.id);
        await expect(
          f.proc.setSessionModel({ sessionId: id, modelId: "unregistered" })
        ).rejects.toThrow("unavailable");
      });
    });

    describe("setSessionMode", () => {
      it("changes the policy seen by tools and returns to Default when the plan is approved", async () => {
        const f = fixture();
        const id = await f.open();
        await f.proc.setSessionMode({ sessionId: id, modeId: "plan" });
        expect(f.toolContexts[0].getMode()).toBe("plan");
        f.toolContexts[0].onPlanApproved();
        expect(f.toolContexts[0].getMode()).toBe("default");
        await expect(f.proc.setSessionMode({ sessionId: id, modeId: "bypass" })).rejects.toThrow(
          "Unknown"
        );
      });
    });

    describe("setSessionConfigOption", () => {
      it.each(["high", "default"])(
        "keeps an already started child's %s thinking intent when the parent changes off and default",
        async (initial) => {
          const gates = [0, 1].map(() => {
            let started!: () => void;
            let release!: () => void;
            const ready = new Promise<void>((resolve) => {
              started = resolve;
            });
            const done = new Promise<void>((resolve) => {
              release = resolve;
            });
            return { started, release, ready, done };
          });
          const requested: unknown[] = [];
          let requests = 0;
          let executions = 0;
          const f = fixture(
            (_model, _context, options) => {
              requested.push({
                reasoning: options?.reasoning,
                disableReasoning: options?.disableReasoning,
              });
              requests++;
              return response(
                requests < 3 ? "" : "Child completed",
                requests < 3 ? [{ id: `read-${requests}`, name: "read_note", arguments: {} }] : []
              );
            },
            [
              {
                name: "read_note",
                label: "Read",
                description: "Read a note",
                parameters: { type: "object", properties: {} },
                execute: async () => {
                  const gate = gates[executions++];
                  gate.started();
                  await gate.done;
                  return { content: [{ type: "text", text: "Read result" }], details: undefined };
                },
              },
            ],
            {
              getModels: () => [
                {
                  baseModelId: model.id,
                  name: model.name,
                  provider: model.provider,
                  effortOptions: [
                    { value: "off", label: "Off" },
                    { value: "high", label: "High" },
                  ],
                },
              ],
            }
          );
          const id = await f.open();
          await f.proc.setSessionConfigOption({
            sessionId: id,
            configId: "effort",
            value: initial,
          });
          const child = f.toolContexts[0].executeSubagent!("launch", {
            prompt: "Read twice",
            description: "Read child",
          });
          await gates[0].ready;
          await f.proc.setSessionConfigOption({ sessionId: id, configId: "effort", value: "off" });
          gates[0].release();
          await gates[1].ready;
          await f.proc.setSessionConfigOption({
            sessionId: id,
            configId: "effort",
            value: "default",
          });
          gates[1].release();
          await child;
          expect(requested).toEqual(
            Array.from({ length: 3 }, () => ({
              reasoning: initial === "high" ? "high" : undefined,
              disableReasoning: false,
            }))
          );
        }
      );

      it("applies explicit thinking off on the next request and preserves a separate provider-default choice", async () => {
        const requested: unknown[] = [];
        const f = fixture(
          (_model, _context, options) => {
            requested.push({
              reasoning: options?.reasoning,
              disableReasoning: options?.disableReasoning,
            });
            return response("Answer");
          },
          [],
          {
            getModels: () => [
              {
                baseModelId: model.id,
                name: model.name,
                provider: model.provider,
                effortOptions: [
                  { value: "off", label: "Off" },
                  { value: "high", label: "High" },
                ],
              },
            ],
          }
        );
        const id = await f.open();
        await f.send(id, "default-initial");
        await f.proc.setSessionConfigOption({ sessionId: id, configId: "effort", value: "off" });
        await f.send(id, "explicit-off");
        await f.send(id, "compact-off", "/compact");
        await f.proc.setSessionConfigOption({ sessionId: id, configId: "effort", value: "high" });
        await f.send(id, "explicit-high");
        await f.proc.setSessionConfigOption({
          sessionId: id,
          configId: "effort",
          value: "default",
        });
        await f.send(id, "provider-default");
        expect(requested).toEqual([
          expect.objectContaining({ disableReasoning: false }),
          expect.objectContaining({ disableReasoning: true }),
          expect.objectContaining({ disableReasoning: true }),
          expect.objectContaining({ disableReasoning: false, reasoning: "high" }),
          expect.objectContaining({ disableReasoning: false }),
        ]);
        expect(f.records.get(id)?.effort).toBeNull();
      });

      it("rejects unsupported reasoning choices and accepts the model's advertised effort", async () => {
        const f = fixture(undefined, [], {
          getModels: () => [
            {
              baseModelId: model.id,
              name: model.name,
              provider: model.provider,
              effortOptions: [{ value: "low", label: "Low" }],
            },
          ],
        });
        const id = await f.open();
        expect(
          (await f.proc.setSessionConfigOption({ sessionId: id, configId: "effort", value: "low" }))
            .model?.current.effort
        ).toBe("low");
        await expect(
          f.proc.setSessionConfigOption({ sessionId: id, configId: "effort", value: "max" })
        ).rejects.toThrow("does not offer");
        await expect(
          f.proc.setSessionConfigOption({ sessionId: id, configId: "other", value: "low" })
        ).rejects.toThrow();
      });
    });

    describe("listSessions", () => {
      it("returns only sessions belonging to the requested working folder", async () => {
        const f = fixture();
        await f.open();
        await f.proc.newSession({ cwd: "/other/vault" });
        expect((await f.proc.listSessions({ cwd: "/fixture/vault" })).sessions).toHaveLength(1);
        expect((await f.proc.listSessions({})).sessions).toHaveLength(2);
      });
    });

    describe("resumeSession", () => {
      it("restores the authoring purpose and never exposes file or command tools after reopening", async () => {
        const seen: string[][] = [];
        const tools = ["read_note", "run_command", "write_note", "delegate_task"].map((name) => ({
          name,
          label: name,
          description: name,
          parameters: { type: "object", properties: {} },
          execute: jest.fn(async () => ({ content: [], details: undefined })),
        })) as AgentTool[];
        const f = fixture((_model, context) => {
          seen.push(getCurrentTools(context.messages).map((tool) => tool.name));
          return response("Still drafting");
        }, tools);
        const opened = await f.proc.newSession({
          cwd: "/fixture/vault",
          purpose: "skill-authoring",
        });
        await f.proc.closeSession({ sessionId: opened.sessionId });
        const restored = await f.proc.resumeSession({
          sessionId: opened.sessionId,
          cwd: "/fixture/vault",
        });
        expect(restored.purpose).toBe("skill-authoring");
        await f.send(opened.sessionId);
        expect(seen[0]).toEqual(["read_note"]);
      });

      it("resumes the original project and refuses an attempt from another project", async () => {
        const f = fixture();
        const id = await f.open();
        expect(
          (await f.proc.resumeSession({ sessionId: id, cwd: "/fixture/vault" })).sessionId
        ).toBe(id);
        await expect(f.proc.resumeSession({ sessionId: id, cwd: "/other/vault" })).rejects.toThrow(
          "different project"
        );
        await f.proc.closeSession({ sessionId: id });
        await expect(
          f.proc.resumeSession({ sessionId: id, cwd: "/fixture/vault", projectId: "other" })
        ).rejects.toThrow("not found");
      });
    });

    describe("sessionExistsLocally", () => {
      it("checks the native identity against its original vault", async () => {
        const f = fixture();
        const id = await f.open();
        expect(await f.proc.sessionExistsLocally({ sessionId: id, cwd: "/fixture/vault" })).toBe(
          true
        );
        expect(await f.proc.sessionExistsLocally({ sessionId: id, cwd: "/other/vault" })).toBe(
          false
        );
        expect(
          await f.proc.sessionExistsLocally({ sessionId: "claude-old", cwd: "/fixture/vault" })
        ).toBe(false);
      });
    });

    describe("closeSession", () => {
      it("saves the transcript, frees its runtime, and refuses another prompt until resumed", async () => {
        const f = fixture();
        const id = await f.open();
        await f.send(id);
        await f.proc.closeSession({ sessionId: id });
        expect(f.records.get(id)?.messages.some((message) => message.role === "assistant")).toBe(
          true
        );
        await expect(f.send(id, "later")).rejects.toThrow("not open");
      });
    });

    describe("deleteSession", () => {
      it("closes the selected runtime and removes only that native transcript from storage", async () => {
        const f = fixture();
        const id = await f.open();
        const other = await f.open();
        await f.proc.deleteSession({ sessionId: id });
        expect(f.records.has(id)).toBe(false);
        expect(f.records.has(other)).toBe(true);
        expect((await f.proc.listSessions({})).sessions.map((record) => record.sessionId)).toEqual([
          other,
        ]);
      });
    });

    describe("shutdown", () => {
      it("disposes every session's task resources before announcing exit", async () => {
        const dispose = jest.fn(async () => {});
        const f = fixture(undefined, [], { createTools: () => ({ tools: [], shutdown: dispose }) });
        await f.open();
        await f.proc.shutdown();
        expect(dispose).toHaveBeenCalledTimes(1);
        await expect(f.proc.newSession({ cwd: "/fixture/vault" })).rejects.toThrow("shut down");
      });
    });

    describe("isSetSessionModelSupported", () => {
      it("advertises model switching to the existing selector", () =>
        expect(fixture().proc.isSetSessionModelSupported()).toBe(true));
    });

    describe("isSetSessionModeSupported", () => {
      it("advertises permission switching to the existing selector", () =>
        expect(fixture().proc.isSetSessionModeSupported()).toBe(true));
    });

    describe("isSetSessionConfigOptionSupported", () => {
      it("advertises effort switching to the existing selector", () =>
        expect(fixture().proc.isSetSessionConfigOptionSupported()).toBe(true));
    });
  });
});
