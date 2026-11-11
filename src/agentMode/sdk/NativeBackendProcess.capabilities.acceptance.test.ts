import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { App, FileSystemAdapter } from "obsidian";
import { createAssistantMessageEventStream } from "@earendil-works/pi-ai/utils/event-stream";
import type { Context, JsonObject } from "@earendil-works/pi-ai";
import { obj, str } from "@earendil-works/pi-schema";
import { createAssistantMessage, type ProviderChatModel } from "@/LLMProviders/piChatModel";
import { NativeBackendProcess } from "@/agentMode/sdk/NativeBackendProcess";
import { NodeNativeSessionStorage } from "@/agentMode/sdk/NativeSessionStorage";
import { createNativeTools } from "@/agentMode/sdk/nativeTools";
import { NativeCommandTasks } from "@/agentMode/sdk/nativeCommandTasks";
import { defineNativeTool } from "@/agentMode/sdk/nativeToolDefinition";
import type { SubagentSessionSnapshot } from "@/agentMode/session/subagentTypes";
import { isRecord } from "@/utils/obsidianInternals";

const MODEL = {
  id: "capability-fixture",
  name: "Capability fixture",
  api: "openai-completions" as const,
  provider: "fixture",
  baseUrl: "http://localhost/fixture",
  reasoning: false,
  input: ["text" as const],
  contextWindow: 200000,
  maxTokens: 1000,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};
const CREDENTIAL = "fixture-private-service-credential";

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

function service() {
  const starts = { alpha: deferred(), beta: deferred(), parent: deferred() };
  const release = { alpha: deferred(), beta: deferred(), parent: deferred() };
  const cancelled = new Set<string>();
  const effects: string[] = [];
  const calls: string[] = [];
  let mode: "held" | "immediate" | "auth" | "disconnect" = "held";
  const invoke = async (
    key: keyof typeof starts,
    signal: AbortSignal | undefined,
    credential: string
  ) => {
    calls.push(key);
    starts[key].resolve();
    if (credential !== CREDENTIAL) throw new Error("external_auth_expired");
    if (mode === "auth") throw new Error("external_auth_expired");
    if (mode === "disconnect") throw new Error("external_service_disconnected");
    if (mode === "held")
      await new Promise<void>((resolve, reject) => {
        const abort = () => {
          cancelled.add(key);
          reject(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", abort, { once: true });
        if (signal?.aborted) abort();
        void release[key].promise.then(() => {
          signal?.removeEventListener("abort", abort);
          resolve();
        });
      });
    signal?.throwIfAborted();
    effects.push(key);
    return {
      content: [{ type: "text" as const, text: `service_written_${key}` }],
      details: undefined,
    };
  };
  return {
    starts,
    release,
    cancelled,
    effects,
    calls,
    invoke,
    setMode: (value: typeof mode) => {
      mode = value;
    },
  };
}

function fixture(
  root: string,
  storage: NodeNativeSessionStorage,
  remote: ReturnType<typeof service>
) {
  const requests: Context[] = [];
  const observers = new Set<() => void>();
  let snapshots: readonly SubagentSessionSnapshot[] = [];
  let connectionOpen = true;
  const provider: ProviderChatModel = {
    model: MODEL,
    stream: () => reply("unused"),
    agentStream: (context) => {
      requests.push(JSON.parse(JSON.stringify(context)) as Context);
      const users = context.messages
        .filter((message) => message.role === "user")
        .map((message) =>
          typeof message.content === "string" ? message.content : JSON.stringify(message.content)
        );
      const child = users.find(
        (text) => text === "capability-child-alpha" || text === "capability-child-beta"
      );
      const last = context.messages.at(-1);
      if (child) {
        if (
          !context.messages.some(
            (message) => message.role === "toolResult" && message.toolName === "service_write"
          )
        )
          return reply("", [
            {
              id: "external-call",
              name: "service_write",
              arguments: { key: child.endsWith("alpha") ? "alpha" : "beta" },
            },
          ]);
        return reply(
          last?.role === "toolResult" ? JSON.stringify(last.content) : "child service completed"
        );
      }
      const index = context.messages.findLastIndex((message) => message.role === "user");
      const current = context.messages[index];
      const text =
        current?.role === "user"
          ? typeof current.content === "string"
            ? current.content
            : JSON.stringify(current.content)
          : "";
      const after = context.messages.slice(index + 1);
      if (
        text.includes("start capabilities") &&
        !after.some(
          (message) => message.role === "toolResult" && message.toolName === "delegate_task"
        )
      )
        return reply(
          "",
          (text.includes("two") ? ["alpha", "beta"] : ["alpha"]).map((key) => ({
            id: `delegate-${key}`,
            name: "delegate_task",
            arguments: { prompt: `capability-child-${key}`, description: key, background: true },
          }))
        );
      if (
        text.includes("parent service") &&
        !after.some(
          (message) => message.role === "toolResult" && message.toolName === "service_write"
        )
      )
        return reply("", [
          { id: "parent-external", name: "service_write", arguments: { key: "parent" } },
        ]);
      return reply(
        last?.role === "toolResult" ? JSON.stringify(last.content) : "main stays available"
      );
    },
  };
  const adapter = new FileSystemAdapter();
  adapter.getBasePath = () => root;
  const process = new NativeBackendProcess({
    getModels: () => [
      { baseModelId: MODEL.id, name: MODEL.name, provider: MODEL.provider, effortOptions: [] },
    ],
    getDefaultModelId: () => MODEL.id,
    createModel: async () => provider,
    getSystemPrompt: async () => "Controlled external capability acceptance",
    storage,
    createTools: (context) => {
      const commands = new NativeCommandTasks({
        cwd: root,
        sessionId: context.sessionId,
        outputDirectory: join(root, ".scribe/chats/v2/tasks"),
        emit: context.emit,
      });
      const scope = context.runId ?? "main";
      return {
        tools: [
          ...createNativeTools({
            ...context,
            app: { vault: { adapter } } as unknown as App,
            commandTasks: commands,
          }),
          defineNativeTool(
            "service_write",
            "Controlled external write",
            "Call a controlled shared external connection",
            obj({ key: str() }),
            async (_id, args, signal) => {
              if (!connectionOpen) throw new Error("external_service_disconnected");
              if (args.key !== "alpha" && args.key !== "beta" && args.key !== "parent")
                throw new Error("unknown service scope");
              return remote.invoke(args.key, signal, CREDENTIAL);
            }
          ),
        ],
        shutdown: async () => {
          await commands.shutdown();
          if (scope === "main") connectionOpen = false;
        },
      };
    },
  });
  process.setPermissionPrompter(async () => ({
    outcome: { outcome: "selected", optionId: "allow_once" },
  }));
  const observe = (id: string) =>
    process.registerSessionHandler(id, (event) => {
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
    requests,
    observe,
    until,
    snapshots: () => snapshots,
    connectionOpen: () => connectionOpen,
  };
}

describe("NativeBackendProcess capabilities acceptance", () => {
  describe("NativeBackendProcess", () => {
    let root: string;
    const processes: NativeBackendProcess[] = [];
    beforeEach(async () => {
      root = await mkdtemp(join(tmpdir(), "scribe-capability-acceptance-"));
    });
    afterEach(async () => {
      await Promise.allSettled(processes.splice(0).map((process) => process.shutdown()));
      await rm(root, { recursive: true, force: true });
    });

    describe("stopSubagent()", () => {
      it("cancels only the selected child's shared-service request while its sibling finishes on the same connection T4-04 (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const remote = service();
        const storage = new NodeNativeSessionStorage(join(root, ".scribe/chats/v2"));
        const f = fixture(root, storage, remote);
        processes.push(f.process);
        const { sessionId } = await f.process.newSession({ cwd: root });
        f.observe(sessionId);
        await f.process.prompt({
          sessionId,
          promptId: "start",
          prompt: [{ type: "text", text: "start capabilities two" }],
        });
        await Promise.all([remote.starts.alpha.promise, remote.starts.beta.promise]);
        const alpha = (await f.process.listSubagentSessions({ sessionId })).find(
          (child) => child.name === "alpha"
        )!;
        await f.process.stopSubagent({ sessionId, subagentId: alpha.id });
        expect(remote.cancelled).toEqual(new Set(["alpha"]));
        expect(f.connectionOpen()).toBe(true);
        const beta = (await f.process.listSubagentSessions({ sessionId })).find(
          (child) => child.name === "beta"
        )!;
        expect(beta.runs[0].endedAt).toBeUndefined();
        remote.release.beta.resolve();
        await f.until(() =>
          f.snapshots().some((child) => child.id === beta.id && !!child.runs[0].endedAt)
        );
        expect(remote.effects).toEqual(["beta"]);
        expect(
          (await f.process.listSubagentSessions({ sessionId })).find(
            (child) => child.id === beta.id
          )?.runs[0].result
        ).toContain("service_written_beta");
      });
    });

    describe("resumeSession()", () => {
      it("never replays an external write that completed before its tool result could be saved T4-05 (https://github.com/ItsDalk-Lane/Scribe/issues/50)", async () => {
        const remote = service();
        remote.setMode("immediate");
        const directory = join(root, ".scribe/chats/v2");
        const storage = new NodeNativeSessionStorage(directory);
        const append = storage.append.bind(storage);
        const failed = deferred();
        jest
          .spyOn(storage, "append")
          .mockImplementation(async (sessionId, kind, payload, options) => {
            if (
              kind === "tool_result" &&
              isRecord(payload) &&
              isRecord(payload.message) &&
              payload.message.toolName === "service_write"
            ) {
              failed.resolve();
              throw new Error("Simulated disk failure after external write");
            }
            return append(sessionId, kind, payload, options);
          });
        const f = fixture(root, storage, remote);
        processes.push(f.process);
        const { sessionId } = await f.process.newSession({ cwd: root });
        f.observe(sessionId);
        const prompt = f.process
          .prompt({
            sessionId,
            promptId: "write",
            prompt: [{ type: "text", text: "start capabilities one" }],
          })
          .catch(() => {});
        await failed.promise;
        await prompt;
        expect(remote.effects).toEqual(["alpha"]);
        await Promise.allSettled([f.process.shutdown()]);
        const coldStorage = new NodeNativeSessionStorage(directory);
        const saved = await coldStorage.load(sessionId);
        expect(JSON.stringify(saved?.subagents?.[0].context)).toContain("结果未知");
        const calls = remote.calls.length;
        const cold = fixture(root, coldStorage, remote);
        processes.push(cold.process);
        await cold.process.resumeSession({ sessionId, cwd: root });
        expect(cold.requests).toEqual([]);
        expect(remote.calls).toHaveLength(calls);
        expect(remote.effects).toEqual(["alpha"]);
        expect(await readFile(join(directory, `${sessionId}.jsonl`), "utf8")).not.toContain(
          CREDENTIAL
        );
      });
      it.each(["auth", "disconnect"] as const)(
        "preserves matching parent and child %s failures without credential copies or automatic calls after cold restore T4-05 (https://github.com/ItsDalk-Lane/Scribe/issues/50)",
        async (mode) => {
          const remote = service();
          remote.setMode(mode);
          const directory = join(root, ".scribe/chats/v2");
          const storage = new NodeNativeSessionStorage(directory);
          const f = fixture(root, storage, remote);
          processes.push(f.process);
          const { sessionId } = await f.process.newSession({ cwd: root });
          f.observe(sessionId);
          await f.process.prompt({
            sessionId,
            promptId: "parent",
            prompt: [{ type: "text", text: "parent service" }],
          });
          await f.process.prompt({
            sessionId,
            promptId: "child",
            prompt: [{ type: "text", text: "start capabilities one" }],
          });
          await f.until(() => !!f.snapshots()[0]?.runs[0].endedAt);
          const expected =
            mode === "auth" ? "external_auth_expired" : "external_service_disconnected";
          const saved = await storage.load(sessionId);
          const results = saved?.journalRecords?.filter(
            (fact) =>
              fact.kind === "tool_result" &&
              isRecord(fact.payload) &&
              isRecord(fact.payload.message) &&
              fact.payload.message.toolName === "service_write"
          );
          expect(results).toHaveLength(2);
          expect(results?.every((fact) => JSON.stringify(fact.payload).includes(expected))).toBe(
            true
          );
          const bytes = await readFile(join(directory, `${sessionId}.jsonl`), "utf8");
          expect(bytes).not.toContain(CREDENTIAL);
          expect(JSON.stringify(f.requests)).not.toContain(CREDENTIAL);
          await f.process.closeSession({ sessionId });
          const calls = remote.calls.length;
          const cold = fixture(root, new NodeNativeSessionStorage(directory), remote);
          processes.push(cold.process);
          await cold.process.resumeSession({ sessionId, cwd: root });
          expect(cold.requests).toEqual([]);
          expect(remote.calls).toHaveLength(calls);
          expect(remote.effects).toEqual([]);
        }
      );
    });
  });
});
