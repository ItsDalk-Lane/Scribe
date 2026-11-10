import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
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
  OBSIDIAN_DEFAULT_CONFIG_DIR,
  type NativeBackendProcessOptions,
} from "@/agentMode/sdk/NativeBackendProcess";
import { AgentSession } from "@/agentMode/session/AgentSession";
import AgentChatMessages from "@/agentMode/ui/AgentChatMessages";
import type { AgentChatBackend } from "@/agentMode/session/AgentChatBackend";
import { AppContext } from "@/context";
import { TooltipProvider } from "@/components/ui/tooltip";
import { act, fireEvent, render, waitFor } from "@testing-library/react";
import * as React from "react";

import { NativeBackendDescriptor } from "@/agentMode/backends/native/descriptor";
import { createNativeAdvancedTools } from "@/agentMode/sdk/nativeAdvancedTools";
import { sha256 } from "@/utils/hash";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import { AgentSessionSnapshots } from "@/agentMode/session/AgentSessionSnapshots";
import { createNodeSnapshotStorage } from "@/agentMode/session/nodeFileStorage";
import type {
  AgentQuestionAnswers,
  AskUserQuestionPrompt,
  PermissionDecision,
  PermissionPrompt,
  SessionEvent,
} from "@/agentMode/session/types";

jest.mock("@/utils/desktopStreamingFetch", () => ({
  loadDesktopStreamingFetch: () =>
    jest.requireActual<typeof import("@/utils")>("@/utils").safeFetchNoThrow,
}));

jest.mock("@/agentMode/ui/AgentMarkdownText", () => ({
  AgentMarkdownText: ({ text }: { text: string }) => React.createElement("div", null, text),
}));
jest.mock("@/hooks/useChatScrolling", () => ({
  useChatScrolling: () => ({
    scrollContainerCallbackRef: () => {},
    contentCallbackRef: () => {},
    onScroll: () => {},
    isScrollPaused: false,
    scrollToEnd: () => {},
    getMessageKey: (message: { id: string }) => message.id,
  }),
}));

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
  const user = context.messages.find(
    (message) =>
      message.role === "user" &&
      !(typeof message.content === "string" && message.content.startsWith("<runtime_context>"))
  );
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
            .map((entry) =>
              relative(root, join(root, path, entry.name))
                .split(sep)
                .join("/")
            ),
          folders: entries
            .filter((entry) => entry.isDirectory())
            .map((entry) =>
              relative(root, join(root, path, entry.name))
                .split(sep)
                .join("/")
            ),
        };
      };
    });

    afterEach(async () => {
      await Promise.all(processes.map((process) => process.shutdown()));
      await rm(root, { recursive: true, force: true });
      await rm(data, { recursive: true, force: true });
    });

    function fixture(
      responder: (
        context: TranscriptContext,
        options?: { signal?: AbortSignal }
      ) => AssistantMessageEventStream,
      onEvent?: (event: SessionEvent) => void,
      maxSteps?: number,
      overrides: Partial<NativeBackendProcessOptions> = {}
    ) {
      const contexts: TranscriptContext[] = [];
      const events: SessionEvent[] = [];
      const provider: ProviderChatModel = {
        model: MODEL,
        stream: (context, options) => responder(normalizeContext(context), options),
        agentStream: (context, options) => {
          const normalized = normalizeContext(context);
          contexts.push(JSON.parse(JSON.stringify(normalized)));
          return responder(normalized, options);
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
            flush: context.flush,
            beforeStart: context.beforeTaskStart,
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

    describe("prompt", () => {
      it("restores a model-invoked skill body after compaction and reopening https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = { name: "model-only", body: "Important skill body for this task." };
        const settings = {
          getManuallyInvokedSkill: () => null,
          getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
          createTools: (
            context: import("@/agentMode/sdk/NativeBackendProcess").NativeToolContext
          ) => ({
            tools: createNativeAdvancedTools({
              ...context,
              app: { vault: { adapter } } as unknown as App,
              skills: () => [{ ...skill, description: "Review notes", status: "available" }],
            }),
          }),
        };
        const responder = (context: TranscriptContext) => {
          const last = context.messages.at(-1);
          const text = JSON.stringify(last?.content ?? "");
          if (text.includes("Summarize this recorded Obsidian conversation"))
            return response("Earlier work summarized.");
          if (last?.role === "toolResult") return response("Read the skill.");
          if (text.includes("Select the skill"))
            return response("", [
              { id: "skill-read", name: "invoke_skill", arguments: { name: skill.name } },
            ]);
          return response("Continued.");
        };
        const first = fixture(responder, undefined, undefined, settings);
        const id = await first.open();
        const send = (process: NativeBackendProcess, promptId: string, text: string) =>
          process.prompt({ sessionId: id, promptId, prompt: [{ type: "text", text }] });
        await send(first.process, "initial", "Select the skill");
        expect(
          first.contexts.some((context) =>
            results(context).some((result) => JSON.stringify(result.content).includes(skill.body))
          )
        ).toBe(true);
        await send(first.process, "compact", "/compact");
        await first.process.closeSession({ sessionId: id });
        const restored = fixture(responder, undefined, undefined, settings);
        await restored.process.loadSession({ sessionId: id, cwd: root, projectId: "project-a" });
        await send(restored.process, "continue", "Continue the task");
        const context = restored.contexts.at(-1)!;
        expect(
          results(context).some((result) => JSON.stringify(result.content).includes(skill.body))
        ).toBe(false);
        expect(JSON.stringify(context.messages)).toContain(skill.body);
      });

      it("does not reactivate an old skill from visible history after starting an independent task https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = { name: "model-only", body: "OLD-TASK-SKILL-INSTRUCTIONS" };
        const summaries: TranscriptContext[] = [];
        const settings = {
          getManuallyInvokedSkill: () => null,
          getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
          createTools: (
            context: import("@/agentMode/sdk/NativeBackendProcess").NativeToolContext
          ) => ({
            tools: createNativeAdvancedTools({
              ...context,
              app: { vault: { adapter } } as unknown as App,
              skills: () => [{ ...skill, description: "Review", status: "available" }],
            }),
          }),
        };
        const responder = (context: TranscriptContext) => {
          const last = context.messages.at(-1);
          const text = JSON.stringify(last?.content ?? "");
          if (text.includes("Summarize this recorded Obsidian conversation")) {
            summaries.push(context);
            return response("Summary of prior work.");
          }
          if (last?.role === "toolResult") return response("Read the skill.");
          if (text.includes("Select the skill"))
            return response("", [
              { id: "old-skill", name: "invoke_skill", arguments: { name: skill.name } },
            ]);
          return response("New work.");
        };
        const first = fixture(responder, undefined, undefined, settings);
        const id = await first.open();
        const send = (process: NativeBackendProcess, promptId: string, text: string) =>
          process.prompt({ sessionId: id, promptId, prompt: [{ type: "text", text }] });
        await send(first.process, "initial", "Select the skill");
        await first.process.startIndependentTask({ sessionId: id });
        await send(first.process, "new-work", "Start unrelated work");
        await send(first.process, "compact", "/compact");
        expect(
          summaries.every((context) => !JSON.stringify(context.messages).includes(skill.body))
        ).toBe(true);
        if (!summaries.length)
          expect(first.events).toContainEqual(
            expect.objectContaining({
              update: expect.objectContaining({
                sessionUpdate: "compaction",
                status: "failed",
                error: expect.stringContaining("unavailable skill"),
              }),
            })
          );
        await first.process.closeSession({ sessionId: id });
        const restored = fixture(responder, undefined, undefined, settings);
        await restored.process.loadSession({ sessionId: id, cwd: root, projectId: "project-a" });
        restored.process.registerSessionHandler(id, (event) => restored.events.push(event));
        await send(restored.process, "continue", "Continue unrelated work");
        if (restored.contexts.length) {
          expect(JSON.stringify(restored.contexts.at(-1)?.messages)).not.toContain(skill.body);
        } else {
          expect(restored.events).toContainEqual(
            expect.objectContaining({
              update: expect.objectContaining({
                sessionUpdate: "turn_ended",
                stopReason: "request_error",
              }),
            })
          );
        }
      });

      it("starts an independent task without checking dependencies of skills from the previous task https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = { name: "model-only", body: "OLD-TASK-SKILL-INSTRUCTIONS" };
        let independent = false;
        const dependencyChecks = jest.fn(async () => {
          if (independent) throw new Error("Old dependency is unavailable");
          return [];
        });
        const f = fixture(
          (context) => {
            const last = context.messages.at(-1);
            if (last?.role === "toolResult") return response("Read the skill.");
            if (JSON.stringify(last?.content).includes("Select the skill"))
              return response("", [
                { id: "old-skill", name: "invoke_skill", arguments: { name: skill.name } },
              ]);
            return response("New work.");
          },
          undefined,
          undefined,
          {
            getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
            resolveSkillDependencies: dependencyChecks,
            createTools: (context) => ({
              tools: createNativeAdvancedTools({
                ...context,
                app: { vault: { adapter } } as unknown as App,
                skills: () => [{ ...skill, description: "Review", status: "available" }],
              }),
            }),
          }
        );
        const id = await f.open();
        await f.process.prompt({
          sessionId: id,
          promptId: "initial",
          prompt: [{ type: "text", text: "Select the skill" }],
        });
        await f.process.startIndependentTask({ sessionId: id });
        independent = true;
        dependencyChecks.mockClear();
        await f.process.prompt({
          sessionId: id,
          promptId: "new",
          prompt: [{ type: "text", text: "New work" }],
        });
        expect(dependencyChecks).not.toHaveBeenCalled();
        expect(JSON.stringify(f.contexts.at(-1)?.messages)).not.toContain(skill.body);
        expect(f.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "turn_ended",
              stopReason: "end_turn",
            }),
          })
        );
        dependencyChecks.mockClear();
        await f.process.prompt({
          sessionId: id,
          promptId: "compact",
          prompt: [{ type: "text", text: "/compact" }],
        });
        expect(dependencyChecks).not.toHaveBeenCalled();
      });

      it("never sends disabled skill instructions to the manual compaction model https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        let enabled = true;
        const skill = { name: "model-only", body: "DISABLED-SKILL-SECRET" };
        const summaries: TranscriptContext[] = [];
        const f = fixture(
          (context) => {
            const last = context.messages.at(-1);
            if (
              JSON.stringify(last?.content).includes(
                "Summarize this recorded Obsidian conversation"
              )
            ) {
              summaries.push(context);
              return response("Summary.");
            }
            if (last?.role === "toolResult") return response("Read the skill.");
            return response("", [
              { id: "read", name: "invoke_skill", arguments: { name: skill.name } },
            ]);
          },
          undefined,
          undefined,
          {
            getManuallyInvokedSkill: () => null,
            getModelInvocableSkill: (name: string) =>
              enabled && name === skill.name ? skill : null,
            createTools: (context) => ({
              tools: createNativeAdvancedTools({
                ...context,
                app: { vault: { adapter } } as unknown as App,
                skills: () => [
                  { ...skill, description: "Review", status: enabled ? "available" : "disabled" },
                ],
              }),
            }),
          }
        );
        const id = await f.open();
        await f.process.prompt({
          sessionId: id,
          promptId: "initial",
          prompt: [{ type: "text", text: "Read the skill" }],
        });
        enabled = false;
        await f.process.prompt({
          sessionId: id,
          promptId: "compact",
          prompt: [{ type: "text", text: "/compact" }],
        });
        expect(
          summaries.every((context) => !JSON.stringify(context.messages).includes(skill.body))
        ).toBe(true);
        if (!summaries.length)
          expect(f.events).toContainEqual(
            expect.objectContaining({
              update: expect.objectContaining({
                sessionUpdate: "compaction",
                status: "failed",
                error: expect.stringContaining("unavailable skill"),
              }),
            })
          );
      });

      it("does not restore a skill result when its model request failed before receiving a response https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = { name: "model-only", body: "Unconfirmed skill instructions." };
        const settings = {
          getManuallyInvokedSkill: () => null,
          getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
          createTools: (
            context: import("@/agentMode/sdk/NativeBackendProcess").NativeToolContext
          ) => ({
            tools: createNativeAdvancedTools({
              ...context,
              app: { vault: { adapter } } as unknown as App,
              skills: () => [{ ...skill, description: "Review", status: "available" }],
            }),
          }),
        };
        const f = fixture(
          (context) => {
            const last = context.messages.at(-1);
            if (last?.role === "toolResult") {
              const stream = createAssistantMessageEventStream();
              const message = createAssistantMessage(MODEL);
              message.stopReason = "error";
              message.errorMessage = "No model response";
              stream.push({ type: "start", partial: message });
              stream.push({ type: "error", reason: "error", error: message });
              return stream;
            }
            return response("", [
              { id: "skill-read", name: "invoke_skill", arguments: { name: skill.name } },
            ]);
          },
          undefined,
          undefined,
          settings
        );
        const id = await f.open();
        await f.send(id, "Read a skill");
        expect(
          f.contexts.some((context) =>
            results(context).some((result) => JSON.stringify(result.content).includes(skill.body))
          )
        ).toBe(true);
        const journal = await readFile(join(data, "sessions", `${id}.jsonl`), "utf8");
        const facts = journal
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        expect(
          facts.some(
            (fact) => fact.kind === "tool_result" && JSON.stringify(fact).includes(skill.body)
          )
        ).toBe(true);
        expect(facts.some((fact) => fact.kind === "skill_model_delivery")).toBe(false);
      });

      it("keeps a child agent's delivered skill body out of the parent request https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = { name: "model-only", body: "Child-only skill instructions." };
        const f = fixture(
          (context) => {
            const last = context.messages.at(-1);
            if (
              JSON.stringify(last?.content).includes(
                "Summarize this recorded Obsidian conversation"
              )
            )
              return response("Parent task summary.");
            if (last?.role === "toolResult") return response("Finished.");
            if (JSON.stringify(last?.content).includes("Child task"))
              return response("", [
                { id: "child-skill", name: "invoke_skill", arguments: { name: skill.name } },
              ]);
            return response("", [
              {
                id: "delegate",
                name: "delegate_task",
                arguments: { prompt: "Child task", description: "Review" },
              },
            ]);
          },
          undefined,
          undefined,
          {
            getManuallyInvokedSkill: () => null,
            getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
            createTools: (context) => ({
              tools: [
                ...createNativeAdvancedTools({
                  ...context,
                  app: { vault: { adapter } } as unknown as App,
                  skills: () => [{ ...skill, description: "Review", status: "available" }],
                }),
                ...(context.executeSubagent
                  ? [
                      {
                        name: "delegate_task",
                        label: "Delegate",
                        description: "Delegate",
                        parameters: { type: "object", properties: {} },
                        execute: (id: string, args: unknown, signal?: AbortSignal) =>
                          context.executeSubagent!(
                            id,
                            args as { prompt: string; description: string },
                            signal
                          ),
                      },
                    ]
                  : []),
              ],
            }),
          }
        );
        const id = await f.open();
        await f.send(id, "Delegate a review");
        const child = f.contexts.find((context) =>
          results(context).some((result) => result.toolCallId === "child-skill")
        );
        const parent = f.contexts.find((context) =>
          results(context).some((result) => result.toolCallId === "delegate")
        );
        expect(child).toBeDefined();
        expect(JSON.stringify(child?.messages)).toContain(skill.body);
        expect(parent).toBeDefined();
        expect(JSON.stringify(parent?.messages)).not.toContain(skill.body);
        const journal = await readFile(join(data, "sessions", `${id}.jsonl`), "utf8");
        const facts = journal
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const deliveries = facts.filter((fact) => fact.kind === "skill_model_delivery");
        expect(deliveries).toHaveLength(1);
        expect(JSON.stringify(deliveries[0])).not.toContain(skill.body);
        expect(deliveries[0].payload).toMatchObject({
          formatVersion: 2,
          callSeq: expect.any(Number),
          resultSeq: expect.any(Number),
        });
        expect(JSON.stringify(deliveries[0])).toContain("subagentId");
        const [retainedChild] = await f.process.listSubagentSessions({ sessionId: id });
        const after = Math.max(...retainedChild.messages.map((message) => message.sequence));
        await f.process.prompt({
          sessionId: id,
          promptId: "compact-parent",
          prompt: [{ type: "text", text: "/compact" }],
        });
        await f.process.closeSession({ sessionId: id });
        const reopened = fixture(() => response("Continued."), undefined, undefined, {
          getModelInvocableSkill: (name) => (name === skill.name ? skill : null),
        });
        await reopened.process.loadSession({ sessionId: id, cwd: root, projectId: "project-a" });
        await reopened.process.prompt({
          sessionId: id,
          promptId: "continued-parent",
          prompt: [{ type: "text", text: "Continue parent work" }],
        });
        expect(JSON.stringify(reopened.contexts.at(-1)?.messages)).not.toContain(skill.body);
        await reopened.process.sendSubagentMessage({
          sessionId: id,
          subagentId: retainedChild.id,
          text: "Start a new child run",
          mode: "wake",
        });
        await reopened.process.waitSubagents({
          sessionId: id,
          subagentIds: [retainedChild.id],
          after,
        });
        const resumed = reopened.contexts.find((context) =>
          JSON.stringify(context.messages).includes("Start a new child run")
        );
        expect(resumed).toBeDefined();
        expect(
          JSON.stringify(resumed?.messages.filter((message) => message.role === "user"))
        ).not.toContain(skill.body);
      });

      it("restores a delivered skill through automatic compaction within one child run https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = {
          name: "model-only",
          body: "CHILD-SKILL-BEGIN" + "S".repeat(4000) + "CHILD-SKILL-END",
        };
        const f = fixture(
          (context) => {
            const last = context.messages.at(-1);
            const content = JSON.stringify(last?.content ?? "");
            if (content.includes("Summarize this recorded Obsidian conversation"))
              return response("Child summary.");
            if (last?.role === "toolResult" && last.toolCallId === "child-skill")
              return response("", [{ id: "filler-1", name: "filler", arguments: {} }]);
            if (last?.role === "toolResult" && last.toolCallId === "filler-1")
              return response("", [{ id: "filler-2", name: "filler", arguments: {} }]);
            if (last?.role === "toolResult") return response("Finished.");
            if (content.includes("Child task"))
              return response("", [
                { id: "child-skill", name: "invoke_skill", arguments: { name: skill.name } },
              ]);
            return response("", [
              {
                id: "delegate",
                name: "delegate_task",
                arguments: { prompt: "Child task " + "X".repeat(3000), description: "Review" },
              },
            ]);
          },
          undefined,
          undefined,
          {
            getManuallyInvokedSkill: () => null,
            getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
            createTools: (context) => ({
              tools: [
                ...createNativeAdvancedTools({
                  ...context,
                  app: { vault: { adapter } } as unknown as App,
                  skills: () => [{ ...skill, description: "Review", status: "available" }],
                }),
                {
                  name: "filler",
                  label: "Filler",
                  description: "Filler",
                  parameters: { type: "object", properties: {} },
                  execute: async () => ({
                    content: [{ type: "text", text: "F".repeat(20000) }],
                    details: undefined,
                  }),
                },
                ...(context.executeSubagent
                  ? [
                      {
                        name: "delegate_task",
                        label: "Delegate",
                        description: "Delegate",
                        parameters: { type: "object", properties: {} },
                        execute: (id: string, args: unknown, signal?: AbortSignal) =>
                          context.executeSubagent!(
                            id,
                            args as { prompt: string; description: string },
                            signal
                          ),
                      },
                    ]
                  : []),
              ],
            }),
          }
        );
        const id = await f.open();
        await f.send(id, "Delegate a review");
        const compacted = f.contexts.find((context) =>
          JSON.stringify(context.messages).includes("Child summary.")
        );
        expect(compacted).toBeDefined();
        expect(results(compacted!).some((result) => result.toolCallId === "child-skill")).toBe(
          false
        );
        expect(JSON.stringify(compacted?.messages)).toContain("CHILD-SKILL-BEGIN");
        expect(JSON.stringify(compacted?.messages)).toContain("CHILD-SKILL-END");
      });

      it("does not present an unread final page as delivered after compaction and reopening https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = { name: "model-only", body: "A".repeat(21000) + "UNREAD-TAIL" };
        const settings = {
          getManuallyInvokedSkill: () => null,
          getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
          createTools: (
            context: import("@/agentMode/sdk/NativeBackendProcess").NativeToolContext
          ) => ({
            tools: createNativeAdvancedTools({
              ...context,
              app: { vault: { adapter } } as unknown as App,
              skills: () => [{ ...skill, description: "Review", status: "available" }],
            }),
          }),
        };
        const responder = (context: TranscriptContext) => {
          const last = context.messages.at(-1);
          const text = JSON.stringify(last?.content ?? "");
          if (text.includes("Summarize this recorded Obsidian conversation"))
            return response("Summary.");
          if (last?.role === "toolResult") return response("Read the first page.");
          if (text.includes("Select the skill"))
            return response("", [
              { id: "skill-read", name: "invoke_skill", arguments: { name: skill.name } },
            ]);
          return response("Continued.");
        };
        const first = fixture(responder, undefined, undefined, settings);
        const id = await first.open();
        const send = (process: NativeBackendProcess, promptId: string, text: string) =>
          process.prompt({ sessionId: id, promptId, prompt: [{ type: "text", text }] });
        await send(first.process, "initial", "Select the skill");
        await send(first.process, "compact", "/compact");
        await first.process.closeSession({ sessionId: id });
        const restored = fixture(responder, undefined, undefined, settings);
        await restored.process.loadSession({ sessionId: id, cwd: root, projectId: "project-a" });
        await send(restored.process, "continue", "Continue the task");
        const text = JSON.stringify(restored.contexts.at(-1)?.messages);
        expect(text).toContain("[Output truncated]");
        expect(text).toContain("Continue with cursor:");
        expect(text).not.toContain("UNREAD-TAIL");
      });

      it("restores both delivered pages of a skill after compaction and reopening https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = {
          name: "model-only",
          body: "FIRST-PAGE-START" + "A".repeat(21000) + "LAST-PAGE-END",
        };
        const settings = {
          getManuallyInvokedSkill: () => null,
          getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
          createTools: (
            context: import("@/agentMode/sdk/NativeBackendProcess").NativeToolContext
          ) => ({
            tools: createNativeAdvancedTools({
              ...context,
              app: { vault: { adapter } } as unknown as App,
              skills: () => [{ ...skill, description: "Review", status: "available" }],
            }),
          }),
        };
        const responder = (context: TranscriptContext) => {
          const last = context.messages.at(-1);
          const text = JSON.stringify(last?.content ?? "");
          if (text.includes("Summarize this recorded Obsidian conversation"))
            return response("Summary.");
          if (last?.role === "toolResult" && last.toolCallId === "first-page") {
            const cursor = /Continue with cursor: (\d+:[a-f0-9]{64})/.exec(text)?.[1];
            if (!cursor) throw new Error("Missing continuation cursor");
            return response("", [
              { id: "second-page", name: "invoke_skill", arguments: { name: skill.name, cursor } },
            ]);
          }
          if (last?.role === "toolResult") return response("Read both pages.");
          if (text.includes("Select the skill"))
            return response("", [
              { id: "first-page", name: "invoke_skill", arguments: { name: skill.name } },
            ]);
          return response("Continued.");
        };
        const first = fixture(responder, undefined, undefined, settings);
        const id = await first.open();
        const send = (process: NativeBackendProcess, promptId: string, text: string) =>
          process.prompt({ sessionId: id, promptId, prompt: [{ type: "text", text }] });
        await send(first.process, "initial", "Select the skill");
        await send(first.process, "compact", "/compact");
        await first.process.closeSession({ sessionId: id });
        const restored = fixture(responder, undefined, undefined, settings);
        await restored.process.loadSession({ sessionId: id, cwd: root, projectId: "project-a" });
        await send(restored.process, "continue", "Continue the task");
        const text = JSON.stringify(restored.contexts.at(-1)?.messages);
        expect(text).toContain("FIRST-PAGE-START");
        expect(text).toContain("LAST-PAGE-END");
      });

      it("refuses a later page when the skill changes between model reads https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        let body = "OLD-BEGIN" + "A".repeat(21000) + "OLD-END";
        const f = fixture(
          (context) => {
            const last = context.messages.at(-1);
            if (last?.role === "toolResult" && last.toolCallId === "first-page") {
              const cursor = /Continue with cursor: (\d+:[a-f0-9]{64})/.exec(
                JSON.stringify(last.content)
              )?.[1];
              if (!cursor) throw new Error("Missing continuation cursor");
              body = "NEW-BEGIN" + "B".repeat(21000) + "NEW-END";
              return response("", [
                {
                  id: "second-page",
                  name: "invoke_skill",
                  arguments: { name: "model-only", cursor },
                },
              ]);
            }
            if (last?.role === "toolResult") return response("Stopped after changed content.");
            return response("", [
              { id: "first-page", name: "invoke_skill", arguments: { name: "model-only" } },
            ]);
          },
          undefined,
          undefined,
          {
            getManuallyInvokedSkill: () => null,
            getModelInvocableSkill: (name: string) => ({ name, body }),
            createTools: (context) => ({
              tools: createNativeAdvancedTools({
                ...context,
                app: { vault: { adapter } } as unknown as App,
                skills: () => [
                  { name: "model-only", body, description: "Review", status: "available" },
                ],
              }),
            }),
          }
        );
        const id = await f.open();
        await f.send(id, "Read the skill");
        const attempted = f.contexts
          .flatMap(results)
          .find((result) => result.toolCallId === "second-page");
        expect(attempted?.isError).toBe(true);
        expect(JSON.stringify(attempted?.content)).not.toContain("NEW-END");
      });

      it("rejects restoring noncontiguous delivered pages rather than merging them https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = { name: "model-only", body: "A".repeat(45000) + "LAST-PAGE-END" };
        const version = sha256(JSON.stringify([JSON.stringify([skill.name, null]), skill.body]));
        const f = fixture(
          (context) => {
            const last = context.messages.at(-1);
            if (last?.role === "toolResult") return response("Read noncontiguous pages.");
            return response("", [
              { id: "first-page", name: "invoke_skill", arguments: { name: skill.name } },
              {
                id: "third-page",
                name: "invoke_skill",
                arguments: { name: skill.name, cursor: `40000:${version}` },
              },
            ]);
          },
          undefined,
          undefined,
          {
            getManuallyInvokedSkill: () => null,
            getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
            createTools: (context) => ({
              tools: createNativeAdvancedTools({
                ...context,
                app: { vault: { adapter } } as unknown as App,
                skills: () => [{ ...skill, description: "Review", status: "available" }],
              }),
            }),
          }
        );
        const id = await f.open();
        await f.process.prompt({
          sessionId: id,
          promptId: "initial",
          prompt: [{ type: "text", text: "Read pages" }],
        });
        const count = f.contexts.length;
        await f.process.prompt({
          sessionId: id,
          promptId: "continue",
          prompt: [{ type: "text", text: "Continue" }],
        });
        expect(f.contexts).toHaveLength(count);
        expect(f.events).toContainEqual(
          expect.objectContaining({
            update: expect.objectContaining({
              sessionUpdate: "turn_ended",
              stopReason: "request_error",
            }),
          })
        );
      });

      it.each(["disabled", "changed"])(
        "does not restore model-invoked skill instructions after the skill is %s https://github.com/ItsDalk-Lane/Scribe/issues/68",
        async (change) => {
          let skill = { name: "model-only", body: "Original private skill instructions." };
          let enabled = true;
          const settings = {
            getManuallyInvokedSkill: () => null,
            getModelInvocableSkill: (name: string) =>
              enabled && name === skill.name ? skill : null,
            createTools: (
              context: import("@/agentMode/sdk/NativeBackendProcess").NativeToolContext
            ) => ({
              tools: createNativeAdvancedTools({
                ...context,
                app: { vault: { adapter } } as unknown as App,
                skills: () => [
                  { ...skill, description: "Review", status: enabled ? "available" : "disabled" },
                ],
              }),
            }),
          };
          const responder = (context: TranscriptContext) => {
            const last = context.messages.at(-1);
            const text = JSON.stringify(last?.content ?? "");
            if (text.includes("Summarize this recorded Obsidian conversation"))
              return response("Summary.");
            if (last?.role === "toolResult") return response("Read the skill.");
            if (text.includes("Select the skill"))
              return response("", [
                { id: "skill-read", name: "invoke_skill", arguments: { name: skill.name } },
              ]);
            return response("Continued.");
          };
          const first = fixture(responder, undefined, undefined, settings);
          const id = await first.open();
          const send = (process: NativeBackendProcess, promptId: string, text: string) =>
            process.prompt({ sessionId: id, promptId, prompt: [{ type: "text", text }] });
          await send(first.process, "initial", "Select the skill");
          await send(first.process, "compact", "/compact");
          await first.process.closeSession({ sessionId: id });
          if (change === "disabled") enabled = false;
          else skill = { ...skill, body: "Updated instructions." };
          const restored = fixture(responder, undefined, undefined, settings);
          await restored.process.loadSession({ sessionId: id, cwd: root, projectId: "project-a" });
          restored.process.registerSessionHandler(id, (event) => restored.events.push(event));
          await send(restored.process, "continue", "Continue the task");
          expect(restored.contexts).toHaveLength(0);
          expect(restored.events).toContainEqual(
            expect.objectContaining({
              update: expect.objectContaining({
                sessionUpdate: "turn_ended",
                stopReason: "request_error",
              }),
            })
          );
        }
      );

      it("keeps the newly read version after revoking a previously delivered version https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        let body = "OLD-VERSION-INSTRUCTIONS";
        const f = fixture(
          (context) => {
            const last = context.messages.at(-1);
            if (last?.role === "toolResult") return response("Skill read.");
            if (JSON.stringify(last?.content).includes("Read version"))
              return response("", [
                {
                  id: body === "OLD-VERSION-INSTRUCTIONS" ? "old-read" : "new-read",
                  name: "invoke_skill",
                  arguments: { name: "model-only" },
                },
              ]);
            return response("Continued.");
          },
          undefined,
          undefined,
          {
            getManuallyInvokedSkill: () => null,
            getModelInvocableSkill: (name: string) => ({ name, body }),
            createTools: (context) => ({
              tools: createNativeAdvancedTools({
                ...context,
                app: { vault: { adapter } } as unknown as App,
                skills: () => [
                  { name: "model-only", body, description: "Review", status: "available" },
                ],
              }),
            }),
          }
        );
        const id = await f.open();
        await f.process.prompt({
          sessionId: id,
          promptId: "old",
          prompt: [{ type: "text", text: "Read version" }],
        });
        body = "NEW-VERSION-INSTRUCTIONS";
        await f.process.prompt({
          sessionId: id,
          promptId: "new",
          prompt: [{ type: "text", text: "Read version" }],
        });
        await f.process.prompt({
          sessionId: id,
          promptId: "followup",
          prompt: [{ type: "text", text: "Continue" }],
        });
        const text = JSON.stringify(f.contexts.at(-1)?.messages);
        expect(text).toContain("NEW-VERSION-INSTRUCTIONS");
        expect(text).not.toContain("OLD-VERSION-INSTRUCTIONS");
      });

      it("recognizes a newly delivered result when a later task reuses a tool call id https://github.com/ItsDalk-Lane/Scribe/issues/68", async () => {
        const skill = { name: "model-only", body: "CURRENT-TASK-INSTRUCTIONS" };
        const settings = {
          getManuallyInvokedSkill: () => null,
          getModelInvocableSkill: (name: string) => (name === skill.name ? skill : null),
          createTools: (
            context: import("@/agentMode/sdk/NativeBackendProcess").NativeToolContext
          ) => ({
            tools: createNativeAdvancedTools({
              ...context,
              app: { vault: { adapter } } as unknown as App,
              skills: () => [{ ...skill, description: "Review", status: "available" }],
            }),
          }),
        };
        const responder = (context: TranscriptContext) => {
          const last = context.messages.at(-1);
          const text = JSON.stringify(last?.content ?? "");
          if (text.includes("Summarize this recorded Obsidian conversation"))
            return response("Summary.");
          if (last?.role === "toolResult") return response("Skill read.");
          if (text.includes("Read skill"))
            return response("", [
              { id: "reused-call", name: "invoke_skill", arguments: { name: skill.name } },
            ]);
          return response("Continued.");
        };
        const f = fixture(responder, undefined, undefined, settings);
        const id = await f.open();
        const send = (process: NativeBackendProcess, promptId: string, text: string) =>
          process.prompt({ sessionId: id, promptId, prompt: [{ type: "text", text }] });
        await send(f.process, "old", "Read skill");
        await f.process.startIndependentTask({ sessionId: id });
        await send(f.process, "new", "Read skill");
        const journal = await readFile(join(data, "sessions", `${id}.jsonl`), "utf8");
        const facts = journal
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line));
        const deliveries = facts.filter((fact) => fact.kind === "skill_model_delivery");
        expect(deliveries).toHaveLength(2);
        expect(deliveries[0].payload.resultSeq).not.toBe(deliveries[1].payload.resultSeq);
      });

      it("rebuilds tools with the model context window and the catalog lifecycle each turn https://github.com/ItsDalk-Lane/Scribe/issues/42", async () => {
        const seen: Array<{ contextWindow?: number; everPublished: boolean }> = [];
        const { open, send } = fixture(() => response("ok"), undefined, undefined, {
          getSubagents: () => [],
          createTools: (context) => {
            seen.push({
              contextWindow: context.contextWindow,
              everPublished: context.skillCatalog?.everPublished() ?? false,
            });
            context.skillCatalog?.markPublished();
            return { tools: [] };
          },
        });
        const sessionId = await open();
        await send(sessionId, "first turn");
        await send(sessionId, "second turn");
        expect(seen.length).toBeGreaterThanOrEqual(2);
        expect(seen.map((entry) => entry.contextWindow)).toEqual(
          seen.map(() => MODEL.contextWindow)
        );
        expect(seen[0].everPublished).toBe(false);
        expect(seen.slice(1).every((entry) => entry.everPublished)).toBe(true);
      });

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

      it("keeps a task live when immediate child wake admission overlaps the ended parent's final disk save (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const storage = new NodeNativeSessionStorage(join(data, "wake-admission"));
        const endingSave = deferred<void>();
        const releaseEnding = deferred<void>();
        const admitting = deferred<void>();
        const releaseAdmission = deferred<void>();
        let holdEnding = true;
        let holdAdmission = true;
        let created = false;
        const f = fixture(
          (context) => {
            if (userText(context) === "Child seed")
              return response(
                JSON.stringify(context.messages).includes("Wake immediately")
                  ? "Continued child"
                  : "Child result"
              );
            if (!created) {
              created = true;
              return response("", [
                {
                  id: "delegate",
                  name: "delegate_task",
                  arguments: { prompt: "Child seed", description: "Retained" },
                },
              ]);
            }
            return response("Parent result");
          },
          undefined,
          undefined,
          {
            storage: {
              load: (id) => storage.load(id),
              list: () => storage.list(),
              flush: (id) => storage.flush(id),
              save: async (record) => {
                const last = record.events.at(-1)?.update;
                if (
                  holdEnding &&
                  last?.sessionUpdate === "turn_ended" &&
                  last.turnId === "interleave"
                ) {
                  holdEnding = false;
                  endingSave.resolve();
                  await releaseEnding.promise;
                }
                await storage.save(record);
              },
              append: async (id, kind, payload, options) => {
                if (
                  holdAdmission &&
                  kind === "subagent_state" &&
                  JSON.stringify(payload).includes("Wake immediately")
                ) {
                  holdAdmission = false;
                  admitting.resolve();
                  await releaseAdmission.promise;
                }
                return storage.append(id, kind, payload, options);
              },
            },
          }
        );
        const id = await f.open();
        await f.process.prompt({
          sessionId: id,
          promptId: "create",
          prompt: [{ type: "text", text: "Create child" }],
        });
        const [child] = await f.process.listSubagentSessions({ sessionId: id });
        const after = Math.max(...child.messages.map((message) => message.sequence));
        const interleave = f.process.prompt({
          sessionId: id,
          promptId: "interleave",
          prompt: [{ type: "text", text: "Interleave" }],
        });
        await endingSave.promise;
        const completed = f.process.waitSubagents({
          sessionId: id,
          subagentIds: [child.id],
          after,
        });
        const waking = f.process.sendSubagentMessage({
          sessionId: id,
          subagentId: child.id,
          text: "Wake immediately",
          mode: "wake",
        });
        await admitting.promise;
        releaseEnding.resolve();
        await interleave;
        const taskFact = (await storage.journal.read(id)).records.findLast(
          (record) => record.kind === "subagent_task"
        )!;
        expect((taskFact.payload as { task: { active: boolean } }).task.active).toBe(true);
        releaseAdmission.resolve();
        await waking;
        expect((await completed).reason).toBe("completed");
        const current = (await f.process.listSubagentSessions({ sessionId: id }))[0];
        expect(current.id).toBe(child.id);
        expect(current.runs.at(-1)?.status).toBe("completed");
        expect(current.runs.at(-1)?.result).toBe("Continued child");
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

      it.each([false, true])(
        "shows the real failed partial reply once and copies only its body with reopened=%s",
        async (reopened) => {
          const f = fixture(() => {
            const stream = createAssistantMessageEventStream();
            const message = createAssistantMessage(MODEL);
            message.content = [{ type: "text", text: "Partial reply" }];
            message.stopReason = "error";
            message.errorMessage = "Synthetic stream failure";
            stream.push({ type: "start", partial: message });
            stream.push({
              type: "text_delta",
              contentIndex: 0,
              delta: "Partial reply",
              partial: message,
            });
            stream.push({ type: "error", reason: "error", error: message });
            return stream;
          });
          const descriptor = {
            ...NativeBackendDescriptor,
            getEnabledModelEntries: () => [
              { baseModelId: MODEL.id, name: MODEL.name, credentialState: "ok" as const },
            ],
          };
          let displayed = AgentSession.start({
            backend: f.process,
            cwd: root,
            internalId: "partial-failure",
            backendId: "native",
            projectId: "project-a",
            defaultModelSelection: { baseModelId: MODEL.id, effort: null },
            getDescriptor: () => descriptor,
          });
          await displayed.ready;
          await expect(displayed.sendPrompt("Test partial reply").turn).rejects.toThrow(
            "Synthetic stream failure"
          );
          expect(displayed.getStatus()).toBe("error");
          const expectedBody = "Partial reply";
          if (reopened) {
            const sessionId = displayed.getBackendSessionId();
            if (!sessionId) throw new Error("Missing native session");
            const snapshots = new AgentSessionSnapshots(
              createNodeSnapshotStorage(),
              join(data, "ui-snapshots"),
              () => null
            );
            const savedMessages = displayed.store.getDisplayMessages().map((message) =>
              message.sender === "user"
                ? message
                : {
                    ...message,
                    message: "Saved user edit",
                    parts: [{ kind: "text" as const, text: "Saved user edit" }],
                    isErrorMessage: false,
                    errorText: undefined,
                    customSavedField: { retain: "edit" },
                  }
            );
            await snapshots.save({
              version: 1,
              chatId: "partial-edit",
              backendId: "native",
              sessionId,
              projectId: "project-a",
              savedAtMs: 1,
              label: null,
              messages: savedMessages,
              tasks: [],
              branch: null,
            });
            const snapshotFile = join(
              data,
              "ui-snapshots",
              (await readdir(join(data, "ui-snapshots")))[0]
            );
            const originalSnapshot = await readFile(snapshotFile, "utf8");
            await f.process.closeSession({ sessionId });
            const path = join(data, "sessions", `${sessionId}.jsonl`);
            const storage = new NodeNativeSessionStorage(join(data, "sessions"));
            await storage.append(
              sessionId,
              "future_record",
              { nested: ["retain", { untouched: true }] },
              { durable: true }
            );
            const original = await readFile(path, "utf8");
            const restored = fixture(() => response("Recovery reply"));
            displayed = new AgentSession({
              backend: restored.process,
              backendSessionId: sessionId,
              cwd: root,
              internalId: "partial-failure-reopened",
              backendId: "native",
              projectId: "project-a",
              defaultModelSelection: { baseModelId: MODEL.id, effort: null },
              getDescriptor: () => descriptor,
            });
            const opened = await restored.process.loadSession({
              sessionId,
              cwd: root,
              projectId: "project-a",
            });
            expect((await readFile(path, "utf8")).startsWith(original)).toBe(true);
            displayed.completeResume(opened.state);
            await displayed.ready;
            expect(restored.contexts).toEqual([]);
            await displayed.restorePersistedDisplayFacts();
            expect(
              displayed.store.getDisplayMessages().find((message) => message.sender !== "user")
            ).toMatchObject({
              message: "Partial reply\n\n**Error:** Synthetic stream failure",
              isErrorMessage: true,
              errorText: "**Error:** Synthetic stream failure",
            });
            expect((await readFile(path, "utf8")).startsWith(original)).toBe(true);
            expect(await readFile(snapshotFile, "utf8")).toBe(originalSnapshot);
          }
          expect(displayed.getStatus()).toBe("error");
          const reply = displayed.store
            .getDisplayMessages()
            .find((message) => message.sender !== "user");
          expect(reply?.isErrorMessage).toBe(true);
          if (!reply) throw new Error("Missing displayed reply");
          const app = {
            vault: { adapter },
            workspace: { getActiveFile: () => null },
          } as unknown as App;
          const clipboard = jest.fn().mockResolvedValue(undefined);
          Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: clipboard },
          });
          const view = render(
            React.createElement(
              AppContext.Provider,
              { value: app },
              React.createElement(
                TooltipProvider,
                null,
                React.createElement(AgentChatMessages, {
                  messages: [reply],
                  plugin: { app, manifest: { id: "scribe" } } as never,
                  currentPlan: null,
                  pendingToolPermissions: [],
                  pendingAskUserQuestions: [],
                  chatBackend: {} as AgentChatBackend,
                  isLoading: false,
                })
              )
            )
          );
          await waitFor(() =>
            expect(view.container.textContent).toContain("Synthetic stream failure")
          );
          expect(view.container.textContent?.split(expectedBody).length).toBe(2);
          if (reopened) expect(view.container.textContent).not.toContain("Saved user edit");
          expect(view.container.textContent?.match(/Synthetic stream failure/g)).toHaveLength(1);
          await act(async () => {
            fireEvent.click(view.getByTitle("Copy"));
            await clipboard.mock.results[0].value;
          });
          expect(clipboard.mock.calls).toEqual([[expectedBody]]);
          view.unmount();
          if (reopened) {
            await expect(displayed.sendPrompt("Continue after the error").turn).resolves.toBe(
              "end_turn"
            );
            expect(displayed.getStatus()).toBe("idle");
          }
        }
      );

      it("keeps an actively stopped partial reply cancelled after real disk reopening without inventing an error", async () => {
        const started = deferred<void>();
        const f = fixture((_context, options) => {
          const stream = createAssistantMessageEventStream();
          const message = createAssistantMessage(MODEL);
          message.content = [{ type: "text", text: "Stopped partial reply" }];
          stream.push({ type: "start", partial: message });
          stream.push({
            type: "text_delta",
            contentIndex: 0,
            delta: "Stopped partial reply",
            partial: message,
          });
          options?.signal?.addEventListener(
            "abort",
            () => {
              message.stopReason = "aborted";
              stream.push({ type: "error", reason: "aborted", error: message });
            },
            { once: true }
          );
          started.resolve();
          return stream;
        });
        const descriptor = {
          ...NativeBackendDescriptor,
          getEnabledModelEntries: () => [
            { baseModelId: MODEL.id, name: MODEL.name, credentialState: "ok" as const },
          ],
        };
        const active = AgentSession.start({
          backend: f.process,
          cwd: root,
          internalId: "stopped-partial",
          backendId: "native",
          projectId: "project-a",
          defaultModelSelection: { baseModelId: MODEL.id, effort: null },
          getDescriptor: () => descriptor,
        });
        await active.ready;
        const sent = active.sendPrompt("Stop this reply");
        await started.promise;
        await waitFor(() =>
          expect(
            active.store
              .getDisplayMessages()
              .some((message) => message.message.includes("Stopped partial reply"))
          ).toBe(true)
        );
        await active.cancel();
        await expect(sent.turn).resolves.toBe("cancelled");
        const sessionId = active.getBackendSessionId();
        if (!sessionId) throw new Error("Missing stopped session");
        await f.process.closeSession({ sessionId });
        const restored = fixture(() => response("Must not request another reply"));
        const displayed = new AgentSession({
          backend: restored.process,
          backendSessionId: sessionId,
          cwd: root,
          internalId: "stopped-partial-reopened",
          backendId: "native",
          projectId: "project-a",
          defaultModelSelection: { baseModelId: MODEL.id, effort: null },
          getDescriptor: () => descriptor,
        });
        const opened = await restored.process.loadSession({
          sessionId,
          cwd: root,
          projectId: "project-a",
        });
        displayed.completeResume(opened.state);
        await displayed.ready;
        const reply = displayed.store
          .getDisplayMessages()
          .find((message) => message.sender !== "user");
        expect(reply).toMatchObject({
          message: "Stopped partial reply",
          turnStopReason: "cancelled",
        });
        expect(reply?.isErrorMessage).not.toBe(true);
        expect(displayed.getStatus()).toBe("idle");
        expect(restored.contexts).toEqual([]);
        if (!reply) throw new Error("Missing stopped reply");
        const app = {
          vault: { adapter },
          workspace: { getActiveFile: () => null },
        } as unknown as App;
        const view = render(
          React.createElement(
            AppContext.Provider,
            { value: app },
            React.createElement(
              TooltipProvider,
              null,
              React.createElement(AgentChatMessages, {
                messages: [reply],
                plugin: { app, manifest: { id: "scribe" } } as never,
                currentPlan: null,
                pendingToolPermissions: [],
                pendingAskUserQuestions: [],
                chatBackend: {} as AgentChatBackend,
                isLoading: false,
              })
            )
          )
        );
        expect(view.container.textContent?.match(/Stopped partial reply/g)).toHaveLength(1);
        expect(view.queryByTitle("Copy")).toBeNull();
        view.unmount();
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

      it.each([
        {
          label: "a final answer",
          finalText: "  Actual child result\n",
          stopReason: "stop" as const,
          status: "completed",
          isError: false,
          summary: "  Actual child result\n",
        },
        {
          label: "an empty final answer",
          finalText: "",
          stopReason: "stop" as const,
          status: "failed",
          isError: true,
          summary: "The child agent did not return a final result.",
        },
        {
          label: "a whitespace-only final answer",
          finalText: " \n\t ",
          stopReason: "stop" as const,
          status: "failed",
          isError: true,
          summary: "The child agent did not return a final result.",
        },
        {
          label: "a failed partial answer",
          finalText: "Partial child result",
          stopReason: "error" as const,
          status: "failed",
          isError: true,
          summary: "Partial child result",
        },
        {
          label: "a cancelled partial answer",
          finalText: "Partial child result",
          stopReason: "aborted" as const,
          status: "stopped",
          isError: true,
          summary: "Partial child result",
        },
        {
          label: "a truncated partial answer",
          finalText: "Partial child result",
          stopReason: "length" as const,
          status: "failed",
          isError: true,
          summary: "Partial child result",
        },
      ])(
        "reports $label with its actual task, tool-result and persisted status",
        async ({ finalText, stopReason, status, isError, summary }) => {
          const f = fixture((context) => {
            if (userText(context) === "Child result task") {
              const stream = createAssistantMessageEventStream();
              const message = createAssistantMessage(MODEL);
              message.content = finalText ? [{ type: "text", text: finalText }] : [];
              message.stopReason = stopReason;
              stream.push({ type: "start", partial: message });
              if (finalText)
                stream.push({
                  type: "text_delta",
                  contentIndex: 0,
                  delta: finalText,
                  partial: message,
                });
              if (stopReason === "error" || stopReason === "aborted") {
                message.errorMessage = "Fixture child ended early";
                stream.push({ type: "error", reason: stopReason, error: message });
              } else stream.push({ type: "done", reason: stopReason, message });
              return stream;
            }
            return results(context).length === 0
              ? response("", [
                  {
                    id: "child-result-delegate",
                    name: "delegate_task",
                    arguments: { prompt: "Child result task", description: "Inspect child result" },
                  },
                ])
              : response("Parent received the child result");
          });
          const session = AgentSession.start({
            backend: f.process,
            cwd: root,
            internalId: "native-child-result",
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
          const id = session.getBackendSessionId()!;
          await f.send(id, "Parent child-result task");
          expect(session.getTasks()).toEqual([expect.objectContaining({ status, summary })]);
          const saved = await new NodeNativeSessionStorage(join(data, "sessions")).load(id);
          expect(saved?.events).toContainEqual(
            expect.objectContaining({
              update: expect.objectContaining({ sessionUpdate: "task_ended", status, summary }),
            })
          );
          expect(saved?.messages).toContainEqual(
            expect.objectContaining({
              role: "toolResult",
              toolCallId: "child-result-delegate",
              isError,
              content: [{ type: "text", text: summary }],
            })
          );
        }
      );

      it("returns a limited child's actual closing summary and reason to its parent (https://github.com/ItsDalk-Lane/Scribe/issues/31)", async () => {
        await writeFile(join(root, "child-summary.md"), "Actual child note");
        const f = fixture(
          (context) => {
            if (userText(context) === "Limited child") {
              return results(context).length > 0
                ? response("Read child-summary.md; remaining notes were not checked.")
                : response("", [
                    {
                      id: "limited-read",
                      name: "read_note",
                      arguments: { path: "child-summary.md" },
                    },
                  ]);
            }
            return results(context).length > 0
              ? response("The child checked one note and reached its limit.")
              : response("", [
                  {
                    id: "delegate-summary",
                    name: "delegate_task",
                    arguments: { prompt: "Limited child", description: "Inspect notes" },
                  },
                ]);
          },
          undefined,
          1
        );
        const id = await f.open();
        await f.send(id, "Parent task");
        const ended = f.events
          .map((event) => event.update)
          .find((update) => update.sessionUpdate === "task_ended");
        expect(ended).toMatchObject({
          stopReason: "max_turn_requests",
          summary: expect.stringContaining(
            "Read child-summary.md; remaining notes were not checked."
          ),
        });
        const record = await new NodeNativeSessionStorage(join(data, "sessions")).load(id);
        expect(record?.messages).toContainEqual(
          expect.objectContaining({
            role: "toolResult",
            content: [
              expect.objectContaining({ text: expect.stringContaining("Read child-summary.md") }),
            ],
          })
        );
        expect(f.events.map((event) => event.update)).toContainEqual(
          expect.objectContaining({ sessionUpdate: "turn_ended", stopReason: "max_turn_requests" })
        );
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
        expect(ended[0].stopReason).toBe("max_turn_requests");
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
      const posix = process.platform === "win32" ? it.skip : it;
      it("keeps an enabled plugin entrypoint byte-identical in Auto mode when every approval is denied", async () => {
        const configEntry = [OBSIDIAN_DEFAULT_CONFIG_DIR, "plugins", "fixture"].join("/");
        await mkdir(join(root, ...configEntry.split("/")), { recursive: true });
        const pluginEntry = join(root, ...configEntry.split("/"), "main.js");
        await writeFile(pluginEntry, "/* MANUAL ENTRY */");
        let count = 0;
        const prompts: string[] = [];
        const f = fixture(() =>
          ++count === 1
            ? response("", [
                {
                  id: "write-code",
                  name: "write_note",
                  arguments: {
                    path: `${configEntry}/main.js`,
                    content: "/* replacement */",
                  },
                },
                { id: "cmd-probe", name: "run_command", arguments: { command: "printf harmless" } },
              ])
            : response("done")
        );
        f.process.setPermissionPrompter(async (prompt) => {
          prompts.push(prompt.toolCall.kind ?? "unknown");
          return { outcome: { outcome: "selected", optionId: "reject_once" } };
        });
        const id = await f.open();
        await f.process.setSessionMode({ sessionId: id, modeId: "auto" });
        await f.send(id);
        expect(await readFile(pluginEntry, "utf8")).toBe("/* MANUAL ENTRY */");
        expect(prompts.sort()).toEqual(["edit", "execute"]);
      });

      posix(
        "refuses to write through a dangling symlink that resolves outside the vault (https://github.com/ItsDalk-Lane/Scribe/issues/11)",
        async () => {
          const outsideFile = join(data, "uncreated.md");
          await symlink(outsideFile, join(root, "looks-safe.md"));
          let count = 0;
          const f = fixture(() =>
            ++count === 1
              ? response("", [
                  {
                    id: "escape",
                    name: "write_note",
                    arguments: { path: "looks-safe.md", content: "OUTSIDE_MARKER" },
                  },
                ])
              : response("done")
          );
          f.process.setPermissionPrompter(async () => ({
            outcome: { outcome: "selected", optionId: "allow_once" },
          }));
          const id = await f.open();
          await f.send(id);
          await expect(access(outsideFile)).rejects.toMatchObject({ code: "ENOENT" });
          await expect(access(join(root, "looks-safe.md"))).rejects.toMatchObject({
            code: "ENOENT",
          });
        }
      );

      posix(
        "keeps the write bound to the approved target when the path is replaced while approval is pending (https://github.com/ItsDalk-Lane/Scribe/issues/11)",
        async () => {
          const outsideFile = join(data, "stolen.md");
          await writeFile(outsideFile, "ORIGINAL-OUTSIDE");
          await writeFile(join(root, "target.md"), "ORIGINAL-INSIDE");
          let count = 0;
          const f = fixture(() =>
            ++count === 1
              ? response("", [
                  {
                    id: "swap",
                    name: "write_note",
                    arguments: { path: "target.md", content: "REPLACEMENT" },
                  },
                ])
              : response("done")
          );
          f.process.setPermissionPrompter(async () => {
            await rm(join(root, "target.md"));
            await symlink(outsideFile, join(root, "target.md"));
            return { outcome: { outcome: "selected", optionId: "allow_once" } };
          });
          const id = await f.open();
          await f.send(id);
          expect(await readFile(outsideFile, "utf8")).toBe("ORIGINAL-OUTSIDE");
        }
      );

      it("keeps a persisted always-deny effective in Auto mode for the identical in-vault target", async () => {
        let attempt = 0;
        const f = fixture(() =>
          ++attempt % 2
            ? response("", [
                {
                  id: `call-${attempt}`,
                  name: "write_note",
                  arguments: { path: "protected.md", content: "SYNTHETIC-DATA" },
                },
              ])
            : response("Finished")
        );
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "reject_always" },
        }));
        f.process.setPermissionPrompter(permission);
        const id = await f.open();
        const send = (promptId: string) =>
          f.process.prompt({
            sessionId: id,
            promptId,
            prompt: [{ type: "text", text: promptId }],
          });
        await send("first");
        expect(permission).toHaveBeenCalledTimes(1);
        await f.process.setSessionMode({ sessionId: id, modeId: "auto" });
        await send("retry");
        await expect(access(join(root, "protected.md"))).rejects.toMatchObject({ code: "ENOENT" });
        expect(permission).toHaveBeenCalledTimes(1);
      });

      it("delivers the queued message to the model exactly once after Send now cancels the running reply", async () => {
        let started!: () => void;
        const ready = new Promise<void>((resolve) => {
          started = resolve;
        });
        let round = 0;
        const f = fixture((_context: TranscriptContext, options?: { signal?: AbortSignal }) => {
          round++;
          if (round === 1) {
            const stream = createAssistantMessageEventStream();
            started();
            options?.signal?.addEventListener(
              "abort",
              () => {
                const message = createAssistantMessage(MODEL);
                message.stopReason = "aborted";
                stream.push({ type: "error", reason: "aborted", error: message });
              },
              { once: true }
            );
            return stream;
          }
          return response(`answer ${round}`);
        });
        const id = await f.open();
        const running = f.process.prompt({
          sessionId: id,
          promptId: "first",
          prompt: [{ type: "text", text: "first user turn" }],
        });
        await ready;
        const queued = f.process.prompt({
          sessionId: id,
          promptId: "queued",
          prompt: [{ type: "text", text: "Please read immediately" }],
        });
        await f.process.cancel({ sessionId: id, keepUnread: true });
        await Promise.all([running, queued]);
        expect(f.contexts.length).toBeGreaterThanOrEqual(2);
        expect(JSON.stringify(f.contexts.at(-1))).toContain("Please read immediately");
        expect(
          f.events.filter(
            (event) =>
              event.update.sessionUpdate === "message_delivered" &&
              event.update.promptId === "queued"
          )
        ).toHaveLength(1);
      });
    });

    describe("setSessionMode", () => {
      function lastUserText(context: TranscriptContext): string {
        const last = context.messages.filter((message) => message.role === "user").at(-1);
        return last && last.role === "user"
          ? typeof last.content === "string"
            ? last.content
            : last.content.flatMap((part) => (part.type === "text" ? [part.text] : [])).join("")
          : "";
      }

      it("allows a manual switch from plan to auto before any plan is approved", async () => {
        const f = fixture((context) =>
          results(context).length === 0
            ? response("", [
                {
                  id: "manual-switch-write",
                  name: "write_note",
                  arguments: { path: "manual-switch.md", content: "Written after mode switch" },
                },
              ])
            : response("Done")
        );
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "reject_once" },
        }));
        f.process.setPermissionPrompter(permission);
        const id = await f.open();
        await f.process.setSessionMode({ sessionId: id, modeId: "plan" });
        await f.process.setSessionMode({ sessionId: id, modeId: "auto" });
        await f.send(id);
        expect(await readFile(join(root, "manual-switch.md"), "utf8")).toBe(
          "Written after mode switch"
        );
        expect(permission).not.toHaveBeenCalled();
      });

      it("exposes full mode in the picker state and allows every action without asking, including commands and config-dir writes (https://github.com/ItsDalk-Lane/Scribe/issues/38)", async () => {
        const f = fixture((context) =>
          results(context).length === 0
            ? response("", [
                {
                  id: "full-note-write",
                  name: "write_note",
                  arguments: { path: "full-note.md", content: "Full wrote inside" },
                },
                {
                  id: "full-config-write",
                  name: "write_note",
                  arguments: {
                    path: `${OBSIDIAN_DEFAULT_CONFIG_DIR}/full-test.md`,
                    content: "Full wrote config",
                  },
                },
                {
                  id: "full-command",
                  name: "run_command",
                  arguments: { command: `"${process.execPath}" -p "full-ok"` },
                },
              ])
            : response("Done")
        );
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "reject_once" },
        }));
        f.process.setPermissionPrompter(permission);
        const id = await f.open();
        const state = await f.process.setSessionMode({ sessionId: id, modeId: "full" });
        expect(state.mode?.current).toBe("full");
        expect(state.mode?.options.map((option) => option.value)).toContain("full");
        await f.send(id);
        expect(await readFile(join(root, "full-note.md"), "utf8")).toBe("Full wrote inside");
        expect(
          await readFile(join(root, OBSIDIAN_DEFAULT_CONFIG_DIR, "full-test.md"), "utf8")
        ).toBe("Full wrote config");
        const last = f.contexts.at(-1);
        const commandResult = JSON.stringify(last?.messages.filter((m) => m.role === "toolResult"));
        expect(commandResult).toContain("full-ok");
        expect(permission).not.toHaveBeenCalled();
      });

      it("overrides a saved always-deny rule in full mode and restores the rule after leaving full (https://github.com/ItsDalk-Lane/Scribe/issues/38)", async () => {
        const turns: Record<string, { id: string; name: string; arguments: JsonObject }> = {
          "deny in default": {
            id: "saved-rule-write",
            name: "write_note",
            arguments: { path: "saved-rule.md", content: "FULL-WROTE" },
          },
          "retry in full": {
            id: "saved-rule-write",
            name: "write_note",
            arguments: { path: "saved-rule.md", content: "FULL-WROTE" },
          },
          "back to default": {
            id: "saved-rule-write",
            name: "write_note",
            arguments: { path: "saved-rule.md", content: "FULL-WROTE" },
          },
        };
        const turnIndex: Record<string, number> = {
          "deny in default": 0,
          "retry in full": 1,
          "back to default": 2,
        };
        const f = fixture((context) => {
          const text = lastUserText(context);
          return results(context).length === turnIndex[text]
            ? response("", [turns[text]])
            : response("Done");
        });
        const send = (sessionId: string, promptId: string, text: string) =>
          f.process.prompt({ sessionId, promptId, prompt: [{ type: "text", text }] });
        const permission = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "reject_always" },
        }));
        f.process.setPermissionPrompter(permission);
        const id = await f.open();
        await send(id, "deny-turn", "deny in default");
        await expect(access(join(root, "saved-rule.md"))).rejects.toMatchObject({ code: "ENOENT" });

        await f.process.setSessionMode({ sessionId: id, modeId: "full" });
        await send(id, "full-turn", "retry in full");
        expect(await readFile(join(root, "saved-rule.md"), "utf8")).toBe("FULL-WROTE");

        await f.process.setSessionMode({ sessionId: id, modeId: "default" });
        await writeFile(join(root, "saved-rule.md"), "FULL-WROTE");
        await send(id, "default-turn", "back to default");
        expect(await readFile(join(root, "saved-rule.md"), "utf8")).toBe("FULL-WROTE");
        expect(permission).toHaveBeenCalledTimes(1);
      });

      it("keeps plan approval human in full mode and returns to full after approval (https://github.com/ItsDalk-Lane/Scribe/issues/38)", async () => {
        const count = (context: TranscriptContext) => results(context).length;
        const f = fixture((context) =>
          count(context) === 0
            ? response("", [
                { id: "full-plan", name: "propose_plan", arguments: { plan: "Step one only" } },
              ])
            : count(context) === 1
              ? response("", [
                  {
                    id: "post-plan-write",
                    name: "write_note",
                    arguments: { path: "after-plan.md", content: "Approved into full" },
                  },
                ])
              : response("Done")
        );
        const permission = jest.fn(async (prompt: PermissionPrompt) =>
          prompt.toolCall.isPlanProposal
            ? { outcome: { outcome: "selected" as const, optionId: "allow_once" } }
            : { outcome: { outcome: "selected" as const, optionId: "reject_once" } }
        );
        f.process.setPermissionPrompter(permission);
        const id = await f.open();
        await f.process.setSessionMode({ sessionId: id, modeId: "full" });
        await f.send(id);
        expect(await readFile(join(root, "after-plan.md"), "utf8")).toBe("Approved into full");
        const modes = f.events
          .filter((event) => event.update.sessionUpdate === "current_mode_update")
          .map((event) =>
            event.update.sessionUpdate === "current_mode_update" ? event.update.currentModeId : null
          );
        expect(modes).toEqual(["full", "plan", "full"]);
        expect(permission).toHaveBeenCalledTimes(1);
      });

      it("returns to the mode held before entering plan when a plan is approved (https://github.com/ItsDalk-Lane/Scribe/issues/38)", async () => {
        const f = fixture((context) =>
          results(context).length === 0
            ? response("", [
                { id: "auto-plan", name: "propose_plan", arguments: { plan: "Step one only" } },
              ])
            : response("Done")
        );
        f.process.setPermissionPrompter(async (prompt: PermissionPrompt) =>
          prompt.toolCall.isPlanProposal
            ? { outcome: { outcome: "selected" as const, optionId: "allow_once" } }
            : { outcome: { outcome: "selected" as const, optionId: "allow_once" } }
        );
        const id = await f.open();
        await f.process.setSessionMode({ sessionId: id, modeId: "auto" });
        await f.send(id);
        const modes = f.events
          .filter((event) => event.update.sessionUpdate === "current_mode_update")
          .map((event) =>
            event.update.sessionUpdate === "current_mode_update" ? event.update.currentModeId : null
          );
        expect(modes).toEqual(["auto", "plan", "auto"]);
      });
    });

    describe("stopTask", () => {
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
        expect(f.contexts.map((context) => userText(context))).toEqual([
          "Parent waiting task",
          "Waiting child",
        ]);
        const child = f.events.flatMap((event) =>
          event.update.sessionUpdate === "task_started" && event.update.kind === "subagent"
            ? [event.update]
            : []
        )[0];
        await f.process.stopTask({ sessionId: id, taskId: child.taskId! });
        await running;
        expect(f.contexts.map((context) => userText(context))).toEqual([
          "Parent waiting task",
          "Waiting child",
          "Parent waiting task",
        ]);
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
        const storage = new NodeNativeSessionStorage(join(data, "sessions"));
        const initialTasks = (await storage.journal.read(id)).records
          .filter((record) => record.kind === "subagent_task")
          .map((record) => (record.payload as { task: { id: string; active: boolean } }).task);
        expect(initialTasks.at(-1)?.active).toBe(true);
        await f.process.prompt({
          sessionId: id,
          promptId: "background-followup",
          prompt: [{ type: "text", text: "Report the background work" }],
        });
        const followedTasks = (await storage.journal.read(id)).records
          .filter((record) => record.kind === "subagent_task")
          .map((record) => (record.payload as { task: { id: string; active: boolean } }).task);
        expect(new Set(followedTasks.map((task) => task.id)).size).toBe(1);
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
        const finalTask = (await storage.journal.read(id)).records.findLast(
          (record) => record.kind === "subagent_task"
        )!;
        expect((finalTask.payload as { task: { active: boolean } }).task.active).toBe(false);
      });
    });

    describe("loadSession", () => {
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

    describe("context window wiring", () => {
      async function wiredProcess(
        catalogModels: unknown,
        modelId: string
      ): Promise<{ provider: ProviderChatModel; process: NativeBackendProcess }> {
        const { transformWireToCatalog } =
          await import("@/modelManagement/catalog/catalogTransform");
        const { getSettings, setSettings } = await import("@/settings/model");
        const { configuredModelToCustomModel } = await import("@/modelManagement");
        const { createProviderChatModel } = await import("@/LLMProviders/createProviderChatModel");
        const { fixtureSse } = await import("@/LLMProviders/testing/piFixtures");
        const { __setRequestUrlImpl } = (await import("obsidian")) as unknown as {
          __setRequestUrlImpl: (impl: unknown) => void;
        };
        __setRequestUrlImpl(async () => ({
          status: 200,
          text: fixtureSse({
            id: "reply",
            object: "chat.completion",
            model: modelId,
            created: 1,
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: "response" },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 6998, completion_tokens: 2, total_tokens: 7000 },
          }),
          headers: { "content-type": "text/event-stream" },
          json: {},
          arrayBuffer: new ArrayBuffer(0),
        }));
        const base = getSettings();
        const info = transformWireToCatalog({ fixture: catalogModels })[0].models[modelId];
        const settings = {
          ...base,
          providers: {
            fixture: {
              providerId: "fixture",
              providerType: "openai-compatible",
              origin: { kind: "byok" },
              baseUrl: "https://endpoint.invalid/v1",
              addedAt: 1,
              displayName: "fixture",
              requiresApiKey: false,
            },
          } as typeof base.providers,
          configuredModels: [
            { configuredModelId: modelId, providerId: "fixture", info, configuredAt: 1 },
          ],
          backends: { chat: { enabledModels: [modelId] } } as typeof base.backends,
          agentMode: { ...base.agentMode, backends: {} },
        };
        setSettings(settings);
        const provider = await createProviderChatModel(
          configuredModelToCustomModel({
            provider: settings.providers.fixture,
            configuredModel: settings.configuredModels[0],
            apiKey: "synthetic-key",
          })
        );
        const process = new NativeBackendProcess({
          getModels: () => [
            { baseModelId: modelId, name: modelId, provider: "fixture", effortOptions: [] },
          ],
          createModel: async () => provider,
          getDefaultModelId: () => modelId,
          getSystemPrompt: async () => "Audit assistant",
          createTools: () => ({ tools: [] }),
          storage: {
            list: async () => [],
            load: async () => null,
            save: async () => {},
          },
        });
        processes.push(process);
        return { provider, process };
      }

      it("uses the configured catalog window for usage and the auto-compaction threshold through the real model factories", async () => {
        const { getSettings, setSettings } = await import("@/settings/model");
        const previous = getSettings();
        try {
          const { provider, process } = await wiredProcess(
            {
              id: "fixture",
              name: "Fixture",
              models: {
                audited: {
                  id: "audited",
                  name: "audited",
                  reasoning: true,
                  limit: { context: 8192 },
                  reasoningEfforts: ["low", "medium", "high"],
                },
              },
            },
            "audited"
          );
          expect(provider.model.contextWindow).toBe(8192);
          const { sessionId } = await process.newSession({ cwd: root });
          const updates: SessionEvent["update"][] = [];
          process.registerSessionHandler(sessionId, (event) => updates.push(event.update));
          for (const promptId of ["turn-one", "turn-two"]) {
            await process.prompt({
              sessionId,
              promptId,
              prompt: [{ type: "text", text: promptId }],
            });
          }
          const usage = updates.find(
            (update) => update.sessionUpdate === "usage_update"
          ) as unknown as { usage: { usedTokens: number; contextWindow: number } };
          expect(usage.usage).toMatchObject({ usedTokens: 7000, contextWindow: 8192 });
          expect(
            updates
              .filter((update) => update.sessionUpdate === "compaction")
              .map((update) => (update as { status: string }).status)
          ).toEqual(["in_progress", "completed"]);
        } finally {
          setSettings(previous);
        }
      });

      it("keeps an unknown window unreported and skips auto-compaction for it", async () => {
        const { getSettings, setSettings } = await import("@/settings/model");
        const previous = getSettings();
        try {
          const { provider, process } = await wiredProcess(
            {
              id: "fixture",
              name: "Fixture",
              models: { opaque: { id: "opaque", name: "opaque" } },
            },
            "opaque"
          );
          expect(provider.model.contextWindow).toBe(0);
          const { sessionId } = await process.newSession({ cwd: root });
          const updates: SessionEvent["update"][] = [];
          process.registerSessionHandler(sessionId, (event) => updates.push(event.update));
          for (const promptId of ["turn-one", "turn-two"]) {
            await process.prompt({
              sessionId,
              promptId,
              prompt: [{ type: "text", text: promptId }],
            });
          }
          const usage = updates.find(
            (update) => update.sessionUpdate === "usage_update"
          ) as unknown as { usage: { contextWindow: number | undefined } };
          expect(usage.usage.contextWindow).toBeUndefined();
          expect(updates.filter((update) => update.sessionUpdate === "compaction")).toEqual([]);
        } finally {
          setSettings(previous);
        }
      });
    });
  });
});
