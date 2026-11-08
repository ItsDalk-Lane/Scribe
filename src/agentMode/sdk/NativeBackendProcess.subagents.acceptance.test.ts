import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execPath } from "node:process";
import type { SessionUpdate } from "@/agentMode/session/types";
import { App, FileSystemAdapter } from "obsidian";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { Context, JsonObject } from "@earendil-works/pi-ai";
import { createAssistantMessage, type ProviderChatModel } from "@/LLMProviders/piChatModel";
import { NativeBackendProcess } from "@/agentMode/sdk/NativeBackendProcess";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";
import { AgentSession } from "@/agentMode/session/AgentSession";
import { USER_SENDER } from "@/constants";

const MODEL = {
  id: "child-acceptance",
  name: "Child acceptance",
  api: "openai-completions" as const,
  provider: "fixture",
  baseUrl: "http://localhost/fixture",
  reasoning: false,
  input: ["text" as const],
  contextWindow: 200000,
  maxTokens: 2000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function userText(context: Context): string {
  return context.messages
    .filter((message) => message.role === "user")
    .map((message) =>
      typeof message.content === "string" ? message.content : JSON.stringify(message.content)
    )
    .join("\n");
}

function reply(
  text: string,
  calls: Array<{ id: string; name: string; arguments: JsonObject }> = []
) {
  const source = createAssistantMessageEventStream();
  const message = createAssistantMessage(MODEL);
  message.content = [
    ...(text ? [{ type: "text" as const, text }] : []),
    ...calls.map((call) => ({ type: "toolCall" as const, ...call })),
  ];
  message.stopReason = calls.length ? "toolUse" : "stop";
  source.push({ type: "start", partial: message });
  source.push({ type: "done", reason: message.stopReason, message });
  return source;
}

function fixture(
  root: string,
  storage: NodeNativeSessionStorage,
  holdChild = false,
  reportDiscovery = false,
  commandScenario = false
) {
  const releaseChild = deferred();
  const childStarted = deferred();
  const actualDiscoveryRequest = deferred();
  const requests: Context[] = [];
  const observers = new Set<() => void>();
  const events: SessionUpdate[] = [];
  let snapshots: readonly SubagentSessionSnapshot[] = [];
  let childRequests = 0;
  const provider: ProviderChatModel = {
    model: MODEL,
    stream: () => reply("unused"),
    agentStream: (context, options) => {
      requests.push(JSON.parse(JSON.stringify(context)) as Context);
      if (
        JSON.stringify(context.messages).includes("unique child discovery") &&
        !userText(context).includes("child phase")
      )
        actualDiscoveryRequest.resolve();
      if (userText(context).includes("child phase")) {
        childRequests++;
        childStarted.resolve();
        if (commandScenario) {
          if (userText(context).includes("finish command"))
            return reply("child command work complete");
          if (
            !context.messages.some(
              (message) => message.role === "toolResult" && message.toolName === "run_command"
            )
          )
            return reply("", [
              {
                id: "owned-command",
                name: "run_command",
                arguments: {
                  command: `"${execPath}" -e "process.stdout.write('${userText(context).includes("command A") ? "owned-A" : "owned-B"}');setInterval(()=>{},1000)"`,
                  background: true,
                },
              },
            ]);
          return reply("", [{ id: "wait", name: "wait_for_message", arguments: {} }]);
        }

        if (reportDiscovery && childRequests === 1)
          return reply("", [
            {
              id: "discovery",
              name: "send_parent_message",
              arguments: { text: "unique child discovery", kind: "discovery" },
            },
          ]);
        if (holdChild && childRequests === 1) {
          const source = createAssistantMessageEventStream();
          const abort = () => {
            const message = createAssistantMessage(MODEL);
            message.stopReason = "aborted";
            source.push({ type: "error", reason: "aborted", error: message });
          };
          options?.signal?.addEventListener("abort", abort, { once: true });
          void releaseChild.promise.then(() => {
            options?.signal?.removeEventListener("abort", abort);
            const message = createAssistantMessage(MODEL);
            message.content = [{ type: "text", text: "child original conclusion" }];
            message.stopReason = "stop";
            source.push({ type: "done", reason: "stop", message });
          });
          return source;
        }
        return reply(
          userText(context).includes("child continue")
            ? "child continued using original conclusion"
            : "child original conclusion"
        );
      }
      const userIndex = context.messages.findLastIndex((message) => message.role === "user");
      const current = context.messages[userIndex];
      const currentText =
        current?.role === "user"
          ? typeof current.content === "string"
            ? current.content
            : JSON.stringify(current.content)
          : "";
      const startsTask =
        currentText.includes("Start child") && !currentText.includes("scribe_collaboration");
      if (
        startsTask &&
        !context.messages
          .slice(userIndex + 1)
          .some((message) => message.role === "toolResult" && message.toolName === "delegate_task")
      )
        return reply(
          "",
          commandScenario
            ? ["A", "B"].map((name) => ({
                id: `delegate-${name}`,
                name: "delegate_task",
                arguments: {
                  prompt: `child phase command ${name}`,
                  description: name,
                  background: true,
                },
              }))
            : [
                {
                  id: "delegate",
                  name: "delegate_task",
                  arguments: { prompt: "child phase", description: "资料核对", background: true },
                },
              ]
        );
      return reply("main can finish while child works");
    },
  };
  const createModel = jest.fn(async () => provider);
  const adapter = new FileSystemAdapter();
  adapter.getBasePath = () => root;
  const process = new NativeBackendProcess({
    getModels: () => [
      { baseModelId: MODEL.id, name: MODEL.name, provider: MODEL.provider, effortOptions: [] },
    ],
    getDefaultModelId: () => MODEL.id,
    createModel,
    getSystemPrompt: async () => "Obsidian acceptance assistant",
    storage,
    createTools: (context) => {
      const commands = new NativeCommandTasks({
        cwd: root,
        sessionId: context.sessionId,
        outputDirectory: join(root, ".scribe/chats/v2/tasks"),
        emit: context.emit,
      });
      return {
        tools: createNativeTools({
          ...context,
          app: { vault: { adapter } } as unknown as App,
          commandTasks: commands,
        }),
        shutdown: () => commands.shutdown(),
      };
    },
  });
  const observe = (sessionId: string) =>
    process.registerSessionHandler(sessionId, (event) => {
      events.push(event.update);
      if (event.update.sessionUpdate === "subagents_updated") snapshots = event.update.subagents;
      for (const observer of observers) observer();
    });
  const until = (condition: () => boolean) =>
    new Promise<void>((resolve) => {
      const check = () => {
        if (condition()) {
          observers.delete(check);
          resolve();
        }
      };
      observers.add(check);
      check();
    });
  return {
    process,
    createModel,
    requests,
    events,
    observe,
    until,
    releaseChild,
    childStarted,
    actualDiscoveryRequest,
    snapshots: () => snapshots,
  };
}

describe("NativeBackendProcess subagent acceptance", () => {
  describe("NativeBackendProcess", () => {
    let root: string;
    const processes: NativeBackendProcess[] = [];
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "scribe-child-acceptance-"));
    });
    afterEach(async () => {
      await Promise.all(processes.splice(0).map((process) => process.shutdown()));
      await rm(root, { recursive: true, force: true });
    });

    describe("sendSubagentMessage()", () => {
      it("shows a child's discovery as sourced collaboration while its real parent request receives it exactly once https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture(
          root,
          new NodeNativeSessionStorage(join(root, ".scribe/chats/v2")),
          false,
          true
        );
        processes.push(f.process);
        const displayed = AgentSession.start({
          backend: f.process,
          cwd: root,
          internalId: "live-ui-contract",
          backendId: "native",
        });
        try {
          await displayed.ready;
          await displayed.sendPrompt("Start child").turn;
          await new Promise<void>((resolve) => {
            const check = () => {
              const child = displayed.getSubagentSessions()[0];
              if (
                child?.runs[0].endedAt &&
                child.messages
                  .filter((message) => message.direction === "to_parent")
                  .every((message) => message.state === "delivered")
              ) {
                unsubscribe();
                resolve();
              }
            };
            const unsubscribe = displayed.subscribe({
              onTasksChanged: check,
              onMessagesChanged: check,
              onStatusChanged: check,
            });
            check();
          });
          await f.actualDiscoveryRequest.promise;
          const messages = displayed.store.getDisplayMessages();
          expect(messages.filter((message) => message.sender === USER_SENDER)).toHaveLength(1);
          expect(
            messages.some(
              (message) =>
                message.sender !== USER_SENDER && message.message.includes("unique child discovery")
            )
          ).toBe(true);
          const requests = f.requests.filter(
            (request) =>
              JSON.stringify(request.messages).includes("unique child discovery") &&
              !userText(request).includes("child phase")
          );
          expect(requests.length).toBeGreaterThan(0);
          for (const request of requests)
            expect(JSON.stringify(request.messages).match(/unique child discovery/g)).toHaveLength(
              1
            );
        } finally {
          await displayed.dispose();
        }
      });

      it("stops a child's real background command while its sibling keeps working and cleans the sibling's command on normal completion https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture(
          root,
          new NodeNativeSessionStorage(join(root, ".scribe/chats/v2")),
          false,
          false,
          true
        );
        processes.push(f.process);
        const { sessionId } = await f.process.newSession({ cwd: root });
        f.observe(sessionId);
        await f.process.setSessionMode({ sessionId, modeId: "full" });
        await f.process.prompt({
          sessionId,
          promptId: "commands",
          prompt: [{ type: "text", text: "Start child commands" }],
        });
        await f.until(
          () =>
            f.snapshots().length === 2 &&
            f.snapshots().every((child) => child.runs[0].status === "awaiting_input")
        );
        const [a, b] = ["A", "B"].map(
          (name) => f.snapshots().find((child) => child.name === name)!
        );
        const started = f.events.filter(
          (event) => event.sessionUpdate === "task_started" && event.kind === "command"
        );
        const commandA = started.find(
          (event) => event.sessionUpdate === "task_started" && event.command?.includes("owned-A")
        )!;
        const commandB = started.find(
          (event) => event.sessionUpdate === "task_started" && event.command?.includes("owned-B")
        )!;
        if (commandA.sessionUpdate !== "task_started" || commandB.sessionUpdate !== "task_started")
          throw new Error("Missing owned command");
        await f.process.stopSubagent({ sessionId, subagentId: a.id });
        expect(f.events).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "task_ended",
            taskId: commandA.taskId,
            status: "stopped",
          })
        );
        expect(f.events).not.toContainEqual(
          expect.objectContaining({ sessionUpdate: "task_ended", taskId: commandB.taskId })
        );
        expect(f.snapshots().find((child) => child.id === b.id)!.runs[0].endedAt).toBeUndefined();
        await f.process.sendSubagentMessage({
          sessionId,
          subagentId: b.id,
          text: "finish command",
          mode: "enqueue",
        });
        await f.until(() => !!f.snapshots().find((child) => child.id === b.id)?.runs[0].endedAt);
        expect(f.events).toContainEqual(
          expect.objectContaining({
            sessionUpdate: "task_ended",
            taskId: commandB.taskId,
            status: "stopped",
          })
        );
        expect(f.snapshots().find((child) => child.id === b.id)!.runs[0].result).toBe(
          "child command work complete"
        );
        const input = f
          .snapshots()
          .find((child) => child.id === b.id)!
          .messages.find((message) => message.text === "finish command")!;
        expect(input.deliverySeq).toEqual(expect.any(Number));
        const restored = await new NodeNativeSessionStorage(join(root, ".scribe/chats/v2")).load(
          sessionId
        );
        expect(
          restored?.subagents
            ?.find((child) => child.snapshot.id === b.id)
            ?.snapshot.messages.find((message) => message.id === input.id)?.deliverySeq
        ).toBe(input.deliverySeq);
      });

      it("keeps a stable child across a completed parent turn and cold restore with its real native context https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const directory = join(root, ".scribe/chats/v2");
        const storage = new NodeNativeSessionStorage(directory);
        const first = fixture(root, storage, true);
        processes.push(first.process);
        const { sessionId } = await first.process.newSession({ cwd: root, projectId: "project" });
        first.observe(sessionId);
        await first.process.prompt({
          sessionId,
          promptId: "main-first",
          prompt: [{ type: "text", text: "Start child" }],
        });
        await first.childStarted.promise;
        const active = await first.process.listSubagentSessions({ sessionId });
        expect(active).toHaveLength(1);
        expect(active[0].runs[0].endedAt).toBeUndefined();
        first.releaseChild.resolve();
        await first.until(() => !!first.snapshots()[0]?.runs[0].endedAt);
        await first.process.closeSession({ sessionId });
        const restored = fixture(root, new NodeNativeSessionStorage(directory));
        processes.push(restored.process);
        expect(await restored.process.listSubagentSessions({ sessionId })).toHaveLength(1);
        expect(restored.createModel).not.toHaveBeenCalled();
        expect(restored.requests).toHaveLength(0);
        await restored.process.resumeSession({ sessionId, cwd: root, projectId: "project" });
        restored.observe(sessionId);
        await restored.process.sendSubagentMessage({
          sessionId,
          subagentId: active[0].id,
          text: "child continue",
          mode: "wake",
        });
        await restored.until(
          () =>
            restored.snapshots()[0]?.runs.length === 2 && !!restored.snapshots()[0]?.runs[1].endedAt
        );
        const children = await restored.process.listSubagentSessions({ sessionId });
        expect(children[0].id).toBe(active[0].id);
        expect(children[0].runs[1].id).not.toBe(active[0].runs[0].id);
        expect(JSON.stringify(restored.requests)).toContain("child original conclusion");
        expect(JSON.stringify(restored.requests)).toContain("child continue");
        expect(children[0].runs[1].result).toContain("continued using original conclusion");
        expect(await readFile(join(directory, `${sessionId}.jsonl`), "utf8")).toContain(
          active[0].id
        );
      });
    });

    describe("listSubagentSessions()", () => {
      it("retains the earliest recoverable child after twenty-five completed tasks and a cold directory query https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const directory = join(root, ".scribe/chats/v2");
        const f = fixture(root, new NodeNativeSessionStorage(directory));
        processes.push(f.process);
        const { sessionId } = await f.process.newSession({ cwd: root });
        f.observe(sessionId);
        let firstId = "";
        for (let index = 0; index < 25; index++) {
          await f.process.prompt({
            sessionId,
            promptId: `main-${index}`,
            prompt: [{ type: "text", text: `Start child ${index}` }],
          });
          await f.until(
            () =>
              f.snapshots().length === index + 1 &&
              f.snapshots().every((child) => !!child.runs[0]?.endedAt)
          );
          firstId ||= f.snapshots()[0].id;
        }
        await f.process.closeSession({ sessionId });
        const reopened = fixture(root, new NodeNativeSessionStorage(directory));
        processes.push(reopened.process);
        const children = await reopened.process.listSubagentSessions({ sessionId });
        expect(children).toHaveLength(25);
        expect(children.find((child) => child.id === firstId)?.runs[0].result).toBe(
          "child original conclusion"
        );
        expect(reopened.createModel).not.toHaveBeenCalled();
      }, 30000);

      it("rejects a sibling chat's attempt to send into another child's retained context https://github.com/ItsDalk-Lane/Scribe/issues/50", async () => {
        const f = fixture(root, new NodeNativeSessionStorage(join(root, ".scribe/chats/v2")));
        processes.push(f.process);
        const { sessionId } = await f.process.newSession({ cwd: root });
        f.observe(sessionId);
        await f.process.prompt({
          sessionId,
          promptId: "main",
          prompt: [{ type: "text", text: "Start child" }],
        });
        await f.until(() => !!f.snapshots()[0]?.runs[0].endedAt);
        const child = (await f.process.listSubagentSessions({ sessionId }))[0];
        const peer = await f.process.newSession({ cwd: root });
        expect(await f.process.listSubagentSessions({ sessionId: peer.sessionId })).toEqual([]);
        await expect(
          f.process.sendSubagentMessage({
            sessionId: peer.sessionId,
            subagentId: child.id,
            text: "unauthorized",
            mode: "wake",
          })
        ).rejects.toThrow();
        expect((await f.process.listSubagentSessions({ sessionId }))[0].runs).toHaveLength(1);
      });
    });
  });
});
