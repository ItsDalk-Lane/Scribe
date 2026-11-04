import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessageEventStream, Context, JsonObject } from "@earendil-works/pi-ai";
import { createAssistantMessage } from "@/LLMProviders/piChatModel";
import {
  NativeBackendProcess,
  OBSIDIAN_DEFAULT_CONFIG_DIR,
  type NativeSessionRecord,
  type NativeBackendProcessOptions,
  type NativeToolContext,
} from "@/agentMode/sdk/NativeBackendProcess";
import type { SessionEvent } from "@/agentMode/session/types";
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
        expect(JSON.stringify(f.records.get(id)?.messages)).toContain("Preserved history summary");
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

      it("ends a tool loop at the configured step limit before another model request", async () => {
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
        const id = await f.open();
        await f.send(id);
        expect(request).toHaveBeenCalledTimes(1);
        expect(f.events.map((e) => e.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "max_turn_requests" })
        );
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

    describe("cancel", () => {
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
      it("sends the unread queued message on its own after Send now cancels the running reply", async () => {
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

    describe("stopTask", () => {
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
      it("changes the policy seen by tools and only leaves plan mode after the matching approval", async () => {
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
