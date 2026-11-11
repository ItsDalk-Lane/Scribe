import { App, FileSystemAdapter } from "obsidian";
import { obj, int, str } from "@earendil-works/pi-schema";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { AssistantMessageEventStream, Context, JsonObject } from "@earendil-works/pi-ai";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import { getCurrentTools } from "@earendil-works/pi-ai/utils/transcript";
import {
  createAssistantMessage,
  type AgentStreamOptions,
  type ProviderChatModel,
} from "@/LLMProviders/piChatModel";
import {
  NativeBackendProcess,
  type NativeBackendProcessOptions,
  type NativeRuntimeTools,
  type NativeSessionRecord,
  type NativeToolContext,
} from "@/agentMode/sdk/NativeBackendProcess";
import {
  createNativeAdvancedTools,
  type SkillToolEntry,
} from "@/agentMode/sdk/nativeAdvancedTools";
import { defineNativeTool } from "@/agentMode/sdk/nativeToolDefinition";
import type { JournalRecord } from "@/agentMode/sdk/JournalStorage";

const issue = "https://github.com/ItsDalk-Lane/Scribe/issues/70";
const auditIssue = "https://github.com/ItsDalk-Lane/Scribe/issues/71";
const model = {
  id: "builtin-runtime-fixture",
  name: "Built-in runtime fixture",
  api: "openai-completions" as const,
  provider: "fixture",
  baseUrl: "http://localhost/fixture",
  reasoning: false,
  input: ["text" as const],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100000,
  maxTokens: 1000,
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

function response(
  text: string,
  calls: Array<{ id: string; name: string; arguments: JsonObject }> = []
): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  const message = createAssistantMessage(model);
  message.content = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...calls.map((call) => ({ type: "toolCall" as const, ...call })),
  ];
  message.stopReason = calls.length ? "toolUse" : "stop";
  stream.push({ type: "start", partial: message });
  stream.push({ type: "done", reason: message.stopReason, message });
  return stream;
}

function textResult(text: string): AgentToolResult {
  return { content: [{ type: "text", text }], details: undefined };
}

function userText(context: Context): string {
  const message = context.messages.findLast((entry) => entry.role === "user");
  if (message?.role !== "user") return "";
  return typeof message.content === "string"
    ? message.content
    : message.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("");
}

function fixture(
  createTools: (context: NativeToolContext) => NativeRuntimeTools,
  respond: (context: Context, options?: AgentStreamOptions) => AssistantMessageEventStream,
  options: Pick<
    NativeBackendProcessOptions,
    "getModelInvocableSkill" | "getCapabilityRevision"
  > = {}
) {
  const records = new Map<string, NativeSessionRecord>();
  const facts = new Map<string, JournalRecord[]>();
  const requests: Context[] = [];
  const contexts: NativeToolContext[] = [];
  const stream = (context: Context, options?: AgentStreamOptions) => {
    requests.push(JSON.parse(JSON.stringify(context)) as Context);
    return respond(context, options);
  };
  const provider: ProviderChatModel = { model, stream, agentStream: stream };
  const process = new NativeBackendProcess({
    ...options,
    getModels: () => [
      { baseModelId: model.id, name: model.name, provider: model.provider, effortOptions: [] },
    ],
    getDefaultModelId: () => model.id,
    createModel: async () => provider,
    getSystemPrompt: async () => "Built-in tool runtime fixture",
    createTools: (context) => {
      contexts.push(context);
      return createTools(context);
    },
    storage: {
      load: async (id) => records.get(id) ?? null,
      list: async () => [...records.values()],
      save: async (record) => {
        records.set(record.sessionId, JSON.parse(JSON.stringify(record)) as NativeSessionRecord);
      },
      append: async (id, kind, payload, options) => {
        const entries = facts.get(id) ?? [];
        const fact: JournalRecord = {
          version: 2,
          seq: entries.length + 1,
          kind,
          payload: JSON.parse(JSON.stringify(payload)) as unknown,
          origin: options?.origin ?? "observed",
          occurredAt: Date.now(),
        };
        entries.push(fact);
        facts.set(id, entries);
        return fact;
      },
      flush: async () => {},
    },
  });
  process.setPermissionPrompter(async () => ({
    outcome: { outcome: "selected", optionId: "allow_once" },
  }));
  return {
    process,
    requests,
    contexts,
    records,
    facts,
    open: async () => (await process.newSession({ cwd: "/fixture/vault" })).sessionId,
    send: (sessionId: string, text = "Use the tools", promptId = "fixture-prompt") =>
      process.prompt({ sessionId, promptId, prompt: [{ type: "text", text }] }),
  };
}

describe("builtinToolRuntime", () => {
  describe("NativeBackendProcess", () => {
    const processes: NativeBackendProcess[] = [];
    afterEach(async () => {
      await Promise.all(processes.splice(0).map((process) => process.shutdown()));
    });

    describe("prompt()", () => {
      it(`bounds ten parallel safe reads to eight running bodies and completes the queued reads ${issue}`, async () => {
        const eightStarted = deferred();
        const releaseReads = deferred();
        const started: number[] = [];
        let active = 0;
        let maximum = 0;
        let requests = 0;
        const read = defineNativeTool(
          "fixture_read",
          "Read",
          "Read fixture",
          obj({ index: int() }),
          async (_id, args) => {
            started.push(args.index);
            active++;
            maximum = Math.max(maximum, active);
            if (started.length === 8) eightStarted.resolve();
            try {
              await releaseReads.promise;
              return textResult(`Read ${args.index}`);
            } finally {
              active--;
            }
          },
          { kind: "read" }
        );
        const f = fixture(
          () => ({ tools: [read] }),
          () =>
            ++requests === 1
              ? response(
                  "",
                  Array.from({ length: 10 }, (_, index) => ({
                    id: `read-${index}`,
                    name: "fixture_read",
                    arguments: { index },
                  }))
                )
              : response("All reads complete")
        );
        processes.push(f.process);
        const id = await f.open();
        const running = f.send(id);
        try {
          await eightStarted.promise;
          expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
          expect(active).toBe(8);
        } finally {
          releaseReads.resolve();
        }
        await running;
        expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
        expect(maximum).toBe(8);
        expect(active).toBe(0);
        expect(JSON.stringify(f.requests.at(-1))).toContain("Read 9");
      });

      it(`cancels queued reads before their bodies execute while draining the eight started reads ${issue}`, async () => {
        const eightStarted = deferred();
        const started: number[] = [];
        const stopped: number[] = [];
        const read = defineNativeTool(
          "fixture_read",
          "Read",
          "Read fixture",
          obj({ index: int() }),
          async (_id, args, signal) => {
            started.push(args.index);
            const finished = new Promise<void>((resolve) => {
              signal!.addEventListener(
                "abort",
                () => {
                  stopped.push(args.index);
                  resolve();
                },
                { once: true }
              );
            });
            if (started.length === 8) eightStarted.resolve();
            await finished;
            return textResult(`Read ${args.index} stopped`);
          },
          { kind: "read" }
        );
        const f = fixture(
          () => ({ tools: [read] }),
          () =>
            response(
              "",
              Array.from({ length: 10 }, (_, index) => ({
                id: `read-${index}`,
                name: "fixture_read",
                arguments: { index },
              }))
            )
        );
        processes.push(f.process);
        const id = await f.open();
        const running = f.send(id);
        await eightStarted.promise;
        await f.process.cancel({ sessionId: id });
        await running;
        expect(started).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
        expect(stopped.sort((a, b) => a - b)).toEqual(started);
        expect(f.requests).toHaveLength(1);
      });

      it(`keeps a dynamically discovered tool unavailable to guesses from the same response and publishes it on the next step ${issue}`, async () => {
        let requests = 0;
        const executedAt: number[] = [];
        const late = defineNativeTool(
          "late_read",
          "Late read",
          "A discovered read tool",
          { type: "object", properties: {} },
          async () => {
            executedAt.push(requests);
            return textResult("Discovered source read");
          },
          { kind: "read" }
        );
        const f = fixture(
          (context) => ({
            tools: [
              defineNativeTool(
                "discover",
                "Discover",
                "Discover a read tool",
                { type: "object", properties: {} },
                async () => {
                  context.registerTool(late);
                  return textResult("late_read is available for the next model step");
                },
                { kind: "read", executionMode: "sequential" }
              ),
            ],
          }),
          () => {
            requests++;
            if (requests === 1)
              return response("", [
                { id: "discover", name: "discover", arguments: {} },
                { id: "guess", name: "late_read", arguments: {} },
              ]);
            if (requests === 2)
              return response("", [{ id: "published", name: "late_read", arguments: {} }]);
            return response("Discovered tool used after publication");
          }
        );
        processes.push(f.process);
        const id = await f.open();
        await f.send(id);
        expect(getCurrentTools(f.requests[0].messages).map((tool) => tool.name)).not.toContain(
          "late_read"
        );
        expect(getCurrentTools(f.requests[1].messages).map((tool) => tool.name)).toContain(
          "late_read"
        );
        expect(executedAt).toEqual([2]);
        const guess = f.requests[1].messages.find(
          (message) => message.role === "toolResult" && message.toolCallId === "guess"
        );
        expect(guess).toMatchObject({ isError: true });
      });

      it(`keeps saved result continuation isolated between parent and child even when their tool-call IDs match ${issue}`, async () => {
        let parentRequests = 0;
        let childRequests = 0;
        const f = fixture(
          (context) => {
            const tools: AgentTool[] = [
              defineNativeTool(
                "fixture_read",
                "Read",
                "Read scoped fixture",
                { type: "object", properties: {} },
                async () =>
                  textResult(context.subagentId ? "CHILD_PRIVATE_SOURCE" : "PARENT_PRIVATE_SOURCE"),
                { kind: "read" }
              ),
            ];
            if (context.executeSubagent)
              tools.push(
                defineNativeTool(
                  "delegate_task",
                  "Delegate",
                  "Read in a child",
                  obj({ prompt: str(), description: str() }),
                  (id, args, signal) => context.executeSubagent!(id, args, signal),
                  { kind: "execute" }
                )
              );
            return { tools };
          },
          (context) => {
            if (userText(context).includes("Child reads")) {
              if (++childRequests === 1)
                return response("", [
                  { id: "child-only", name: "fixture_read", arguments: {} },
                  { id: "shared-id", name: "fixture_read", arguments: {} },
                ]);
              return response("Child source checked");
            }
            parentRequests++;
            if (parentRequests === 1)
              return response("", [
                { id: "parent-only", name: "fixture_read", arguments: {} },
                { id: "shared-id", name: "fixture_read", arguments: {} },
              ]);
            if (parentRequests === 2)
              return response("", [
                {
                  id: "delegate",
                  name: "delegate_task",
                  arguments: { prompt: "Child reads", description: "Check child source" },
                },
              ]);
            return response("Parent source checked");
          }
        );
        processes.push(f.process);
        const id = await f.open();
        await f.send(id, "Parent reads");
        const parent = f.contexts.find((context) => !context.subagentId)!;
        const child = f.contexts.find((context) => context.subagentId)!;
        expect(child).toBeDefined();
        expect(JSON.stringify(await parent.readToolResult!({ toolCallId: "shared-id" }))).toContain(
          "PARENT_PRIVATE_SOURCE"
        );
        expect(JSON.stringify(await child.readToolResult!({ toolCallId: "shared-id" }))).toContain(
          "CHILD_PRIVATE_SOURCE"
        );
        await expect(parent.readToolResult!({ toolCallId: "child-only" })).rejects.toThrow("scope");
        await expect(child.readToolResult!({ toolCallId: "parent-only" })).rejects.toThrow("scope");
      });

      it(`delivers a new saved-result page when old tool output fills the history budget ${auditIssue}`, async () => {
        const marker = "Newest recovered page";
        const read = defineNativeTool(
          "fixture_read",
          "Read",
          "Read a long saved result",
          obj({ index: int() }),
          async (_id, { index }) =>
            textResult(`${marker} ${index}\n${String(index).repeat(60000)}`),
          { kind: "read" }
        );
        let step = 0;
        const f = fixture(
          (context) => ({
            tools: [
              read,
              defineNativeTool(
                "read_tool_result",
                "Continue",
                "Read a short page from the saved result",
                obj({}),
                () => context.readToolResult!({ toolCallId: "old-0", maxCharacters: 1000 }),
                { kind: "read" }
              ),
            ],
          }),
          () => {
            if (++step === 1)
              return response(
                "",
                Array.from({ length: 4 }, (_, index) => ({
                  id: `old-${index}`,
                  name: "fixture_read",
                  arguments: { index },
                }))
              );
            if (step === 2)
              return response("", [{ id: "new-page", name: "read_tool_result", arguments: {} }]);
            return response("Read the requested page");
          }
        );
        processes.push(f.process);
        const id = await f.open();
        await f.send(id);
        const page = f.requests[2].messages.find(
          (message) => message.role === "toolResult" && message.toolCallId === "new-page"
        );
        expect(page).toMatchObject({ isError: false });
        expect(JSON.stringify(page?.content)).toContain(`${marker} 0`);
      });

      it.each([
        ["disabled", false],
        ["changed", false],
        ["disabled", true],
        ["changed", true],
      ] as const)(
        `never restores an omitted long skill after it is %s, reopened=%s ${issue}`,
        async (change, reopened) => {
          let changed = false;
          let requestCount = 0;
          const nextRequest = deferred();
          const paused = createAssistantMessageEventStream();
          const oldInstruction = "OLD_OMITTED_SKILL_INSTRUCTION";
          const skills = (): SkillToolEntry[] =>
            Array.from({ length: 5 }, (_, index) => ({
              name: `review-${index}`,
              description: `Review skill ${index}`,
              body: `${index === 4 ? (changed && change === "changed" ? "NEW_SKILL_INSTRUCTION" : oldInstruction) : `ACTIVE_SKILL_${index}`}${"x".repeat(19000)}`,
              status: index === 4 && changed && change === "disabled" ? "disabled" : "available",
            }));
          const adapter = new FileSystemAdapter();
          jest.spyOn(adapter, "getBasePath").mockReturnValue(process.cwd());
          const app = { vault: { adapter } } as unknown as App;
          const f = fixture(
            (context) => ({
              tools: [
                ...createNativeAdvancedTools({ ...context, app, skills }).filter(
                  (tool) => tool.name === "invoke_skill"
                ),
                defineNativeTool(
                  "fixture_read",
                  "Read",
                  "Continue the task",
                  obj({}),
                  async () => textResult("Read complete"),
                  { kind: "read" }
                ),
              ],
            }),
            (_context, options) => {
              requestCount++;
              if (requestCount === 1)
                return response(
                  "",
                  skills().map((skill, index) => ({
                    id: `skill-${index}`,
                    name: "invoke_skill",
                    arguments: { name: skill.name },
                  }))
                );
              if (requestCount === 2) {
                options?.signal?.addEventListener(
                  "abort",
                  () => {
                    const message = createAssistantMessage(model);
                    message.stopReason = "aborted";
                    paused.push({ type: "error", reason: "aborted", error: message });
                  },
                  { once: true }
                );
                nextRequest.resolve();
                return paused;
              }
              return response("Current skill state respected");
            },
            {
              getModelInvocableSkill: (name) =>
                skills().find((skill) => skill.name === name && skill.status === "available") ??
                null,
              getCapabilityRevision: () => String(changed),
            }
          );
          processes.push(f.process);
          const id = await f.open();
          const running = f.send(id);
          await nextRequest.promise;
          changed = true;
          const next = createAssistantMessage(model);
          next.content = [
            { type: "toolCall", id: "continue", name: "fixture_read", arguments: {} },
          ];
          next.stopReason = "toolUse";
          paused.push({ type: "done", reason: "toolUse", message: next });
          await running;
          expect(JSON.stringify(f.requests[1].messages)).not.toContain(oldInstruction);
          expect(JSON.stringify(f.requests.at(-1)!.messages)).not.toContain(oldInstruction);
          const omitted = f.requests[1].messages.find(
            (message) => message.role === "toolResult" && message.toolCallId === "skill-4"
          );
          expect(omitted).toMatchObject({ details: { skillContentOmitted: true } });
          await expect(
            f.contexts.at(-1)!.readToolResult!({ toolCallId: "skill-4" })
          ).rejects.toThrow("invoke_skill");
          if (reopened) {
            await f.process.closeSession({ sessionId: id });
            const beforeResume = requestCount;
            await f.process.resumeSession({ sessionId: id, cwd: "/fixture/vault" });
            expect(requestCount).toBe(beforeResume);
            await f.send(id, "Continue after reopening", "reopened-prompt");
            expect(JSON.stringify(f.requests.at(-1)!.messages)).not.toContain(oldInstruction);
            await expect(
              f.contexts.at(-1)!.readToolResult!({ toolCallId: "skill-4" })
            ).rejects.toThrow("invoke_skill");
          }
        }
      );

      it(`reports an unknown external outcome without automatically repeating the operation ${issue}`, async () => {
        let effects = 0;
        let requests = 0;
        const write = defineNativeTool(
          "external_write",
          "External write",
          "A write whose reply can be lost",
          { type: "object", properties: {} },
          async () => {
            effects++;
            throw new Error("The remote connection closed after writing");
          },
          { kind: "execute" }
        );
        const f = fixture(
          () => ({ tools: [write] }),
          () =>
            ++requests === 1
              ? response("", [{ id: "remote-write", name: "external_write", arguments: {} }])
              : response("Verify the existing effect before retrying")
        );
        processes.push(f.process);
        const id = await f.open();
        await f.send(id);
        expect(effects).toBe(1);
        expect(f.requests).toHaveLength(2);
        const result = f.requests[1].messages.find(
          (message) => message.role === "toolResult" && message.toolCallId === "remote-write"
        );
        expect(result).toMatchObject({
          isError: true,
          details: { execution: { status: "outcome_unknown", retry: "verify_before_retry" } },
        });
        expect(JSON.stringify(result)).toContain("outcome_unknown");
      });
    });
  });
});
