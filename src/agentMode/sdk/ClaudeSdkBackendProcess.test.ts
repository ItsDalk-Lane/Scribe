import type {
  CanUseTool,
  HookCallback,
  ModelInfo,
  SDKMessage,
  SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type {
  BackendDescriptor,
  PromptInput,
  SessionEvent,
  TurnEnd,
} from "@/agentMode/session/types";
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const queryMock = jest.fn();
const createSdkMcpServerMock = jest.fn((opts: unknown) => ({ type: "sdk", instance: opts }));

jest.mock("@anthropic-ai/claude-agent-sdk", () => ({
  query: (...args: unknown[]) => queryMock(...args),
  createSdkMcpServer: (opts: unknown) => createSdkMcpServerMock(opts),
  tool: (name: string, description: string, inputSchema: unknown, handler: unknown) => ({
    name,
    description,
    inputSchema,
    handler,
  }),
}));

const FAKE_CATALOG: ModelInfo[] = [
  {
    value: "claude-fake-pro",
    displayName: "Claude Fake Pro",
    description: "test",
    supportsEffort: true,
    supportedEffortLevels: ["low", "medium", "high"],
  },
  {
    value: "claude-fake-mini",
    displayName: "Claude Fake Mini",
    description: "test",
    supportsEffort: false,
  },
];

jest.mock("@/logger", () => ({
  logInfo: jest.fn(),
  logWarn: jest.fn(),
  logError: jest.fn(),
}));

jest.mock("@/settings/model", () => ({
  getSettings: () => ({ agentMode: { debugFullFrames: false } }),
}));

jest.mock("@/agentMode/session/debugSink", () => ({
  frameSink: { append: jest.fn() },
  formatPayload: () => "",
}));

jest.mock("./effortOption", () => ({
  ...jest.requireActual("./effortOption"),
  getCachedSdkCatalog: jest.fn(),
}));

import {
  ClaudeSdkBackendProcess,
  type ClaudeSdkBackendProcessOptions,
  promptInputToAnthropicContent,
  runSubagentsInBackground,
} from "./ClaudeSdkBackendProcess";
import { CLAUDE_DISCONNECTED_MESSAGE } from "./claudeLiveQuery";
import { sha256 } from "@/utils/hash";
import { FakeClaudeQuery, SessionEventRecorder } from "./testing/fakeClaudeQuery";
import { getCachedSdkCatalog } from "./effortOption";
import { AuthRequiredError } from "@/agentMode/session/errors";
import { AgentSession } from "@/agentMode/session/AgentSession";

beforeEach(() => {
  (getCachedSdkCatalog as jest.Mock).mockReturnValue(FAKE_CATALOG);
});

function fakeDescriptor(): BackendDescriptor {
  return {
    id: "claude",
    displayName: "Claude",
    showModelDescriptions: true,
    wire: {
      encode: (sel: { baseModelId: string; effort: string | null }) => sel.baseModelId,
      decode: (id: string) => ({
        selection: { baseModelId: id, effort: null },
        provider: "anthropic",
      }),
      effortConfigFor: (baseModelId: string) => {
        const m = FAKE_CATALOG.find((x) => x.value === baseModelId);
        if (!m?.supportsEffort) return null;
        const levels = m.supportedEffortLevels ?? [];
        if (levels.length === 0) return null;
        return {
          id: "effort",
          type: "select",
          category: "thought_level",
          name: "Effort",
          currentValue: levels[0],
          options: levels.map((v) => ({ value: v, name: v })),
        };
      },
    },
  } as unknown as BackendDescriptor;
}

const ISSUE_175 = "https://github.com/Brevilabs/obsidian-copilot-private/issues/175";

let fakes: FakeClaudeQuery[] = [];

interface QueryArgs {
  prompt: AsyncIterable<SDKUserMessage>;
  options: Record<string, unknown>;
}

function answering(script: SDKMessage[] | ((turn: number) => SDKMessage[])) {
  return ({ prompt }: QueryArgs): FakeClaudeQuery => {
    const fake = new FakeClaudeQuery(prompt);
    fakes.push(fake);
    void (async () => {
      for (let turn = 0; ; turn++) {
        const input = await fake.nextInput(turn);
        fake.echo(input);
        fake.emit(...(typeof script === "function" ? script(turn) : script));
      }
    })();
    return fake;
  };
}

function silent() {
  return ({ prompt }: QueryArgs): FakeClaudeQuery => {
    const fake = new FakeClaudeQuery(prompt);
    fakes.push(fake);
    return fake;
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i++) await Promise.resolve();
}

function streamEvent(event: object): SDKMessage {
  return {
    type: "stream_event",
    event,
    parent_tool_use_id: null,
    uuid: "uuid-x" as `${string}-${string}-${string}-${string}-${string}`,
    session_id: "irrelevant",
  } as SDKMessage;
}

function resultMessage(): SDKMessage {
  return {
    type: "result",
    subtype: "success",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: false,
    num_turns: 1,
    result: "ok",
    stop_reason: "end_turn",
    total_cost_usd: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usage: {} as any,
    modelUsage: {},
    permission_denials: [],
    uuid: "uuid-r" as `${string}-${string}-${string}-${string}-${string}`,
    session_id: "irrelevant",
  };
}

const USAGE_LIMIT_MESSAGE = "You've hit your session limit · resets 6:30pm (America/New_York)";

function usageLimitMessages(): SDKMessage[] {
  return [
    {
      type: "rate_limit_event",
      rate_limit_info: {
        status: "rejected",
        resetsAt: 1_784_154_600,
        rateLimitType: "five_hour",
        overageStatus: "rejected",
        overageDisabledReason: "org_level_disabled",
        isUsingOverage: false,
      },
      uuid: "uuid-limit" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "irrelevant",
    },
    {
      type: "assistant",
      error: "rate_limit",
      message: {
        model: "<synthetic>",
        role: "assistant",
        stop_reason: "stop_sequence",
        content: [{ type: "text", text: USAGE_LIMIT_MESSAGE }],
      },
      parent_tool_use_id: null,
      uuid: "uuid-assistant" as `${string}-${string}-${string}-${string}-${string}`,
      session_id: "irrelevant",
    },
    {
      ...resultMessage(),
      is_error: true,
      api_error_status: 429,
      result: USAGE_LIMIT_MESSAGE,
      stop_reason: "stop_sequence",
    },
  ] as SDKMessage[];
}

function getPromptQueryCalls(): unknown[][] {
  return queryMock.mock.calls.filter((c) => {
    const opts = (c[0] as { options?: { cwd?: unknown } } | undefined)?.options;
    return opts?.cwd !== undefined;
  });
}

function makeProc(extra: Partial<ClaudeSdkBackendProcessOptions> = {}): ClaudeSdkBackendProcess {
  return new ClaudeSdkBackendProcess({
    pathToClaudeCodeExecutable: "/usr/local/bin/claude",
    app: { vault: {} } as unknown as import("obsidian").App,
    clientVersion: "1.2.3",
    descriptor: fakeDescriptor(),
    ...extra,
  });
}

const USAGE_METHOD = "usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET";

const WEEKLY_21_PERCENT = {
  rate_limits_available: true,
  rate_limits: { seven_day: { utilization: 21 } },
};

let planUsage: () => Promise<unknown> = async () => ({});

async function promptReportingPlanUsage(
  proc: ClaudeSdkBackendProcess,
  sessionId: string,
  usage: () => Promise<unknown>
): Promise<void> {
  planUsage = usage;
  queryMock.mockImplementation((args: QueryArgs) =>
    Object.assign(answering([resultMessage()])(args), { [USAGE_METHOD]: () => planUsage() })
  );
  await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });
  await flushMicrotasks();
}

function planUsageUpdates(events: SessionEvent[]): SessionEvent["update"][] {
  return events.map((e) => e.update).filter((u) => u.sessionUpdate === "plan_usage_update");
}

interface Collector {
  events: SessionEvent[];
  turnEnds: Array<(end: TurnEnd) => void>;
}

const collectors = new WeakMap<ClaudeSdkBackendProcess, Map<string, Collector>>();

function collectorsOf(proc: ClaudeSdkBackendProcess): Map<string, Collector> {
  let bySession = collectors.get(proc);
  if (!bySession) {
    bySession = new Map();
    collectors.set(proc, bySession);
  }
  return bySession;
}

function registerCollector(proc: ClaudeSdkBackendProcess, sessionId: string): SessionEvent[] {
  const collector: Collector = { events: [], turnEnds: [] };
  collectorsOf(proc).set(sessionId, collector);
  proc.registerSessionHandler(sessionId, (event) => {
    const { update } = event;
    if (update.sessionUpdate === "turn_ended") collector.turnEnds.shift()?.(update);
    else if (
      update.sessionUpdate !== "message_delivered" &&
      update.sessionUpdate !== "turn_started"
    )
      collector.events.push(event);
  });
  return collector.events;
}

let promptSeq = 0;

function promptTurn(
  proc: ClaudeSdkBackendProcess,
  input: Omit<PromptInput, "promptId">
): Promise<TurnEnd> {
  if (!collectorsOf(proc).has(input.sessionId)) registerCollector(proc, input.sessionId);
  const collector = collectorsOf(proc).get(input.sessionId)!;
  return new Promise((resolve, reject) => {
    collector.turnEnds.push(resolve);
    proc.prompt({ ...input, promptId: `prompt-${++promptSeq}` }).catch(reject);
  });
}

function errorResultMessage(errors: string[]): SDKMessage {
  return {
    type: "result",
    subtype: "error_during_execution",
    duration_ms: 1,
    duration_api_ms: 1,
    is_error: true,
    num_turns: 1,
    stop_reason: null,
    total_cost_usd: 0,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    usage: {} as any,
    modelUsage: {},
    permission_denials: [],
    errors,
    uuid: "uuid-e" as `${string}-${string}-${string}-${string}-${string}`,
    session_id: "irrelevant",
  };
}

Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
  configurable: true,
  value(this: AbortSignal) {
    if (this.aborted)
      throw this.reason ?? new DOMException("The operation was aborted.", "AbortError");
  },
});

describe("ClaudeSdkBackendProcess", () => {
  describe("promptInputToAnthropicContent()", () => {
    it("returns a plain string when the prompt is text-only", () => {
      const result = promptInputToAnthropicContent({
        sessionId: "s1",
        promptId: "p1",
        prompt: [
          { type: "text", text: "hello" },
          { type: "text", text: "world" },
        ],
      });
      expect(result).toBe("hello\nworld");
    });

    it("returns content blocks when an image is attached", () => {
      const result = promptInputToAnthropicContent({
        sessionId: "s1",
        promptId: "p1",
        prompt: [
          { type: "text", text: "describe" },
          { type: "image", mimeType: "image/png", data: "aGVsbG8=" },
        ],
      });
      expect(result).toEqual([
        { type: "text", text: "describe" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "aGVsbG8=" },
        },
      ]);
    });

    it("normalizes jpg media types before sending image blocks", () => {
      const result = promptInputToAnthropicContent({
        sessionId: "s1",
        promptId: "p1",
        prompt: [
          { type: "text", text: "describe" },
          { type: "image", mimeType: "image/jpg", data: "aGVsbG8=" },
        ],
      });
      expect(result).toEqual([
        { type: "text", text: "describe" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: "aGVsbG8=" },
        },
      ]);
    });

    it("omits image media types Anthropic does not accept", () => {
      const result = promptInputToAnthropicContent({
        sessionId: "s1",
        promptId: "p1",
        prompt: [
          { type: "text", text: "describe" },
          { type: "image", mimeType: "image/heic", data: "aGVsbG8=" },
        ],
      });
      expect(result).toEqual([
        { type: "text", text: "describe" },
        { type: "text", text: "[Unsupported image attachment omitted: image/heic]" },
      ]);
    });

    it("represents resource_link as a defensive text reference", () => {
      const result = promptInputToAnthropicContent({
        sessionId: "s1",
        promptId: "p1",
        prompt: [
          { type: "text", text: "see the doc" },
          { type: "resource_link", uri: "vault://README.md", name: "README" },
          { type: "image", mimeType: "image/jpeg", data: "ZmFrZQ==" },
        ],
      });
      expect(result).toEqual([
        { type: "text", text: "see the doc" },
        { type: "text", text: "[Attached resource: README]" },
        {
          type: "image",
          source: { type: "base64", media_type: "image/jpeg", data: "ZmFrZQ==" },
        },
      ]);
    });
  });

  describe("runSubagentsInBackground()", () => {
    const invoke = (toolName: string, toolInput: unknown) =>
      runSubagentsInBackground(
        {
          hook_event_name: "PreToolUse",
          tool_name: toolName,
          tool_input: toolInput,
          tool_use_id: "tool-1",
        } as Parameters<HookCallback>[0],
        "tool-1",
        { signal: new AbortController().signal }
      );

    it.each(["Agent", "Task"])(
      `runs a %s call that does not choose in the background, keeping its other input (${ISSUE_175})`,
      async (toolName) => {
        await expect(
          invoke(toolName, { description: "Inspect the vault", isolation: "remote" })
        ).resolves.toEqual({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            updatedInput: {
              description: "Inspect the vault",
              isolation: "remote",
              run_in_background: true,
            },
          },
        });
      }
    );

    it.each([false, true, "false", "true"])(
      `leaves a subagent whose model chose run_in_background %p to that choice (${ISSUE_175})`,
      async (choice) => {
        await expect(
          invoke("Agent", { prompt: "Count words", run_in_background: choice })
        ).resolves.toEqual({});
      }
    );

    it("leaves Bash and other tools to the model's own choice", async () => {
      await expect(invoke("Bash", { command: "sleep 20" })).resolves.toEqual({});
      await expect(invoke("Read", { file_path: "note.md" })).resolves.toEqual({});
    });

    it("treats malformed subagent input as empty input", async () => {
      await expect(invoke("Agent", null)).resolves.toEqual({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          updatedInput: { run_in_background: true },
        },
      });
    });
  });

  describe("ClaudeSdkBackendProcess", () => {
    beforeEach(() => {
      queryMock.mockReset();
      createSdkMcpServerMock.mockClear();
      fakes = [];
    });

    describe("getExtensionRuntime()", () => {
      it("returns unavailable for an unopened query without starting Claude or sending a message", async () => {
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        expect(await proc.getExtensionRuntime({ sessionId })).toBeNull();
        expect(await proc.getExtensionRuntime({ sessionId: "unknown" })).toBeNull();
        expect(queryMock).not.toHaveBeenCalled();
        await proc.shutdown();
      });

      it("starts one query only when explicitly requested and never sends a prompt during the check", async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/project-vault" });

        const snapshots = await Promise.all([
          proc.getExtensionRuntime({ sessionId, startIfNeeded: true }),
          proc.getExtensionRuntime({ sessionId, startIfNeeded: true }),
        ]);

        expect(snapshots).toEqual([
          {
            commands: [],
            skills: null,
            subagents: [],
            plugins: [],
            failedPlugins: null,
            pluginErrorCount: 0,
            mcpServers: [],
          },
          {
            commands: [],
            skills: null,
            subagents: [],
            plugins: [],
            failedPlugins: null,
            pluginErrorCount: 0,
            mcpServers: [],
          },
        ]);
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(queryMock.mock.calls[0][0].options.cwd).toBe("/project-vault");
        expect(fakes[0].inputs).toEqual([]);
        await proc.shutdown();
      });

      it("loads persisted local plugin directories into the SDK query for the current project", async () => {
        queryMock.mockImplementation(silent());
        const getLocalPlugins = jest.fn(async () => [
          { type: "local" as const, path: "/local/notes" },
        ]);
        const proc = makeProc({ getLocalPlugins });
        const { sessionId } = await proc.newSession({ cwd: "/selected-project" });
        await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });
        expect(getLocalPlugins).toHaveBeenCalledWith("/selected-project");
        expect(queryMock.mock.calls[0][0].options.plugins).toEqual([
          { type: "local", path: "/local/notes" },
        ]);
        expect(fakes[0].inputs).toEqual([]);
        await proc.shutdown();
      });

      it("checks only user settings and user local plugins when the user scope is selected", async () => {
        queryMock.mockImplementation(silent());
        const getLocalPlugins = jest.fn(async () => []);
        const proc = makeProc({
          getLocalPlugins,
          configurationScope: { kind: "user" },
        });
        const { sessionId } = await proc.newSession({ cwd: "/selected-project" });

        await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });

        expect(queryMock.mock.calls[0][0].options.settingSources).toEqual(["user"]);
        expect(getLocalPlugins).toHaveBeenCalledWith(null);
        const checkCwd = queryMock.mock.calls[0][0].options.cwd as string;
        expect(checkCwd).not.toBe("/selected-project");
        expect(await readdir(checkCwd)).toEqual([]);
        expect(fakes[0].inputs).toEqual([]);
        await proc.shutdown();
        await expect(stat(checkCwd)).rejects.toMatchObject({ code: "ENOENT" });
      });

      it("keeps a relative user configuration directory bound to the original folder during an isolated user check", async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc({
          configurationScope: { kind: "user" },
          getEnvOverrides: () => ({ CLAUDE_CONFIG_DIR: "configs/claude" }),
        });
        const { sessionId } = await proc.newSession({ cwd: "/selected-project" });

        await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });

        expect(queryMock.mock.calls[0][0].options.env.CLAUDE_CONFIG_DIR).toBe(
          path.resolve("/selected-project", "configs/claude")
        );
        await proc.shutdown();
      });

      it("includes inherited settings when checking the current project scope", async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc({
          configurationScope: { kind: "project", cwd: "/selected-project" },
        });
        const { sessionId } = await proc.newSession({ cwd: "/selected-project" });

        await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });

        expect(queryMock.mock.calls[0][0].options.settingSources).toEqual([
          "user",
          "project",
          "local",
        ]);
        expect(fakes[0].inputs).toEqual([]);
        await proc.shutdown();
      });

      it("reports registered hooks and effective policy without executing hooks or sending messages", async () => {
        const hooks = [
          {
            event: "PreToolUse",
            matcher: "Read",
            source: "pluginHook",
            pluginName: "notes",
            type: "command",
            commandText: "check-note",
          },
          {
            event: "Stop",
            matcher: "",
            source: "userSettings",
            type: "command",
            commandText: "save-note",
            disabled: true,
          },
        ];
        queryMock.mockImplementation(({ prompt }: QueryArgs) => {
          const fake = new FakeClaudeQuery(prompt);
          Object.assign(fake, {
            getHooksListing: jest.fn(async () => ({
              hooks,
              policy: { disabledByPolicy: false, allDisabled: false, policyHookCount: 0 },
            })),
          });
          fakes.push(fake);
          return fake;
        });
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/selected-project" });

        const snapshot = await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });

        expect(snapshot).toEqual(
          expect.objectContaining({
            hooks: hooks.map(({ commandText, ...hook }) => ({
              ...hook,
              commandHash: sha256(commandText),
            })),
            hooksDisabled: false,
          })
        );
        expect(JSON.stringify(snapshot)).not.toContain("check-note");
        expect(JSON.stringify(snapshot)).not.toContain("save-note");
        expect(fakes[0].inputs).toEqual([]);
        await proc.shutdown();
      });

      it("keeps a failed hooks check unknown while preserving successful extension reports", async () => {
        queryMock.mockImplementation(({ prompt }: QueryArgs) => {
          const fake = new FakeClaudeQuery(prompt);
          Object.assign(fake, {
            getHooksListing: jest.fn(async () => {
              throw new Error("unsupported hooks listing");
            }),
          });
          fakes.push(fake);
          return fake;
        });
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/selected-project" });

        const snapshot = await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });

        expect(snapshot).toEqual(
          expect.objectContaining({ commands: [], hooks: null, checkErrors: ["hook"] })
        );
        expect(fakes[0].inputs).toEqual([]);
        await proc.shutdown();
      });

      it("preserves an unavailable plugin report when reload fails instead of reporting an empty installed set", async () => {
        queryMock.mockImplementation(({ prompt }: QueryArgs) => {
          const fake = new FakeClaudeQuery(prompt);
          fake.reloadPlugins.mockRejectedValue(new Error("reload unavailable"));
          fakes.push(fake);
          return fake;
        });
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/selected-project" });

        const snapshot = await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });

        expect(snapshot).toEqual(
          expect.objectContaining({ plugins: null, checkErrors: ["plugin"] })
        );
        expect(fakes[0].inputs).toEqual([]);
        await proc.shutdown();
      });

      it("keeps malformed hook reports unknown without discarding successful commands", async () => {
        queryMock.mockImplementation(({ prompt }: QueryArgs) => {
          const fake = new FakeClaudeQuery(prompt);
          Object.assign(fake, {
            getHooksListing: jest.fn(async () => ({ hooks: [{ event: "Stop" }] })),
          });
          fakes.push(fake);
          return fake;
        });
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/selected-project" });

        const snapshot = await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });

        expect(snapshot).toEqual(
          expect.objectContaining({ commands: [], hooks: null, checkErrors: ["hook"] })
        );
        expect(fakes[0].inputs).toEqual([]);
        await proc.shutdown();
      });

      it("reports built-in commands separately so their availability is visible without user-edit controls", async () => {
        queryMock.mockImplementation(({ prompt }: QueryArgs) => {
          const fake = new FakeClaudeQuery(prompt);
          fake.reloadPlugins.mockRejectedValue(new Error("reload unavailable"));
          fake.supportedCommands.mockResolvedValue([
            { name: "help", description: "Help", argumentHint: "", builtin: true },
            { name: "review", description: "Review", argumentHint: "" },
          ]);
          fakes.push(fake);
          return fake;
        });
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/selected-project" });

        const snapshot = await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });

        expect(snapshot).toEqual(
          expect.objectContaining({ commands: ["review"], builtinCommands: ["help"] })
        );
        expect(fakes[0].inputs).toEqual([]);
        await proc.shutdown();
      });

      it("cancels an extension check while its environment is still being prepared", async () => {
        let releaseEnvironment!: (env: Record<string, string>) => void;
        let markPreparing!: () => void;
        const preparing = new Promise<void>((resolve) => {
          markPreparing = resolve;
        });
        const environment = new Promise<Record<string, string>>((resolve) => {
          releaseEnvironment = resolve;
        });
        const proc = makeProc({
          getManagedEnv: () => {
            markPreparing();
            return environment;
          },
        });
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const check = proc.getExtensionRuntime({ sessionId, startIfNeeded: true });
        const cancelled = expect(check).rejects.toMatchObject({ name: "AbortError" });
        await preparing;

        await proc.shutdown();
        releaseEnvironment({});
        await cancelled;

        expect(queryMock).not.toHaveBeenCalled();
      });

      it("reads only the existing live query and leaves its prompt stream untouched", async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await proc.prompt({
          sessionId,
          promptId: "initial",
          prompt: [{ type: "text", text: "Hello" }],
        });
        const fake = fakes[0];
        await fake.nextInput(0);
        fake.supportedCommands.mockResolvedValue([
          { name: "review", description: "Review", argumentHint: "" },
        ]);
        fake.mcpServerStatus.mockResolvedValue([
          { name: "notes", status: "connected", tools: [{ name: "search" }] },
        ]);

        expect(await proc.getExtensionRuntime({ sessionId })).toEqual({
          commands: ["review"],
          skills: null,
          plugins: null,
          failedPlugins: null,
          mcpServers: [{ name: "notes", status: "connected", toolCount: 1 }],
        });
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(fake.inputs.map(({ uuid }) => uuid)).toEqual(["initial"]);
        expect(fake.close).not.toHaveBeenCalled();
        expect(fake.reloadPlugins).not.toHaveBeenCalled();

        await proc.closeSession({ sessionId });
        expect(await proc.getExtensionRuntime({ sessionId })).toBeNull();
        expect(queryMock).toHaveBeenCalledTimes(1);
        await proc.shutdown();
      });
    });

    describe("getMcpServerStatus()", () => {
      it("answers null until the session's query has started, then reports the mapped statuses (https://github.com/ItsDalk-Lane/Scribe/issues/3)", async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        expect(await proc.getMcpServerStatus({ sessionId })).toBeNull();
        expect(await proc.getMcpServerStatus({ sessionId: "unknown" })).toBeNull();

        await proc.getExtensionRuntime({ sessionId, startIfNeeded: true });
        const fake = fakes[0];
        fake.mcpServerStatus.mockResolvedValue([
          { name: "zread", status: "connected", tools: [{ name: "read", description: "" }] },
          { name: "slow", status: "pending" },
        ]);

        expect(await proc.getMcpServerStatus({ sessionId })).toEqual([
          { name: "zread", status: "connected", toolCount: 1 },
          { name: "slow", status: "pending" },
        ]);
        expect(fake.inputs).toEqual([]);
        await proc.shutdown();
      });
    });

    describe("newSession()", () => {
      it("returns BackendState with current model + effort options from the cached catalog", async () => {
        const proc = makeProc();

        const resp = await proc.newSession({ cwd: "/vault" });
        expect(resp.state.model?.current.baseModelId).toBe("claude-fake-pro");
        const ids = resp.state.model?.availableModels.map((m) => m.baseModelId);
        expect(ids).toContain("claude-fake-pro");
        expect(ids).toContain("claude-fake-mini");
        const pro = resp.state.model?.availableModels.find(
          (m) => m.baseModelId === "claude-fake-pro"
        );
        expect(pro?.effortOptions.map((o) => o.value)).toEqual(["low", "medium", "high"]);
        expect(pro?.description).toBe("test");
      });

      it.each(["/usr/local/bin/claude", "/other/claude"])(
        "refreshes the catalog after shutdown and reopening with %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/625)",
        async (pathToClaudeCodeExecutable) => {
          const actual = jest.requireActual<typeof import("./effortOption")>("./effortOption");
          (getCachedSdkCatalog as jest.Mock).mockImplementation(actual.getCachedSdkCatalog);
          const changedCatalog = [
            { value: "claude-new", displayName: "New", description: "Updated" },
          ];
          queryMock
            .mockReturnValueOnce({
              initializationResult: async () => ({ models: FAKE_CATALOG }),
              close: jest.fn(),
            })
            .mockReturnValueOnce({
              initializationResult: async () => ({ models: changedCatalog }),
              close: jest.fn(),
            });
          const getEnvOverrides = () => ({ AUDIT_CATALOG: pathToClaudeCodeExecutable });
          const first = makeProc({ getEnvOverrides });
          expect((await first.newSession({ cwd: "/vault" })).state.model?.current.baseModelId).toBe(
            "claude-fake-pro"
          );
          await first.shutdown();
          const second = makeProc({ pathToClaudeCodeExecutable, getEnvOverrides });

          const refreshed = await second.newSession({ cwd: "/vault" });

          expect(refreshed.state.model?.availableModels.map((model) => model.baseModelId)).toEqual([
            "claude-new",
          ]);
          expect(queryMock).toHaveBeenCalledTimes(2);
          await second.shutdown();
        }
      );

      it("honors persisted default model when it appears in the catalog", async () => {
        const proc = makeProc({ getDefaultModelId: () => "claude-fake-mini" });

        const resp = await proc.newSession({ cwd: "/vault" });
        expect(resp.state.model?.current.baseModelId).toBe("claude-fake-mini");
        const miniEffort = resp.state.model?.availableModels.find(
          (m) => m.baseModelId === "claude-fake-mini"
        )?.effortOptions;
        expect(miniEffort).toEqual([]);
      });

      it("falls back to catalog default when the default model is gone", async () => {
        const proc = makeProc({ getDefaultModelId: () => "claude-removed-by-cli-upgrade" });

        const resp = await proc.newSession({ cwd: "/vault" });
        expect(resp.state.model?.current.baseModelId).toBe("claude-fake-pro");
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/219 sends the initialized model and lowest effort on the first prompt", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const promptCalls = getPromptQueryCalls();
        expect(promptCalls).toHaveLength(1);
        const call = promptCalls[0][0] as { options: { model?: string; effort?: string } };
        expect(call.options.model).toBe("claude-fake-pro");
        expect(call.options.effort).toBe("low");
      });

      it("does not open a session when Claude Code is unsupported", async () => {
        const checkCompatibility = jest
          .fn()
          .mockRejectedValue(new Error("Claude Code 2.1.205 is not supported"));
        const proc = makeProc({ checkCompatibility });

        await expect(proc.newSession({ cwd: "/vault" })).rejects.toThrow(
          "Claude Code 2.1.205 is not supported"
        );
        expect(queryMock).not.toHaveBeenCalled();
      });

      it("shares a successful compatibility check across sessions", async () => {
        const checkCompatibility = jest.fn().mockResolvedValue(undefined);
        const proc = makeProc({ checkCompatibility });

        await Promise.all([
          proc.newSession({ cwd: "/vault-a" }),
          proc.newSession({ cwd: "/vault-b" }),
        ]);

        expect(checkCompatibility).toHaveBeenCalledTimes(1);
      });

      it("retries compatibility after a failed check", async () => {
        const checkCompatibility = jest
          .fn()
          .mockRejectedValueOnce(new Error("upgrade required"))
          .mockResolvedValueOnce(undefined);
        const proc = makeProc({ checkCompatibility });

        await expect(proc.newSession({ cwd: "/vault" })).rejects.toThrow("upgrade required");
        await expect(proc.newSession({ cwd: "/vault" })).resolves.toBeDefined();
        expect(checkCompatibility).toHaveBeenCalledTimes(2);
      });

      it("threads the backend's env overrides into the probe on a cold cache", async () => {
        (getCachedSdkCatalog as jest.Mock).mockReturnValue(undefined);
        const initializationResult = jest.fn().mockResolvedValue({ models: FAKE_CATALOG });
        queryMock.mockReturnValue({
          initializationResult,
          close: jest.fn(),
        });

        const proc = makeProc({ getEnvOverrides: () => ({ ANTHROPIC_MODEL: "claude-fable-5" }) });

        await proc.newSession({ cwd: "/vault" });

        const probeCall = queryMock.mock.calls[0][0] as {
          options: { pathToClaudeCodeExecutable: string; env?: Record<string, string> };
        };
        expect(probeCall.options.env).toEqual({
          ...process.env,
          ANTHROPIC_MODEL: "claude-fable-5",
        });
      });
    });

    describe("prompt()", () => {
      it(`resolves once the prompt is queued on the chat's live query, which reports its delivery and turn when Claude echoes it (${ISSUE_175})`, async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const recorder = new SessionEventRecorder();
        proc.registerSessionHandler(sessionId, recorder.handler);

        await proc.prompt({ sessionId, promptId: "p1", prompt: [{ type: "text", text: "hi" }] });
        const sent = await fakes[0].nextInput();
        expect(recorder.updates()).toEqual([]);
        fakes[0].echo(sent);
        fakes[0].emit(resultMessage());
        await recorder.waitFor("turn_ended");

        expect(sent).toMatchObject({ uuid: "p1", message: { role: "user", content: "hi" } });
        expect(recorder.updates()).toEqual([
          { sessionUpdate: "message_delivered", promptId: "p1" },
          { sessionUpdate: "turn_started", turnId: expect.any(String) },
          {
            sessionUpdate: "turn_ended",
            turnId: (recorder.updates()[1] as { turnId: string }).turnId,
            stopReason: "end_turn",
          },
        ]);
      });

      it(`keeps one query for the whole chat, so a later prompt never starts a query or passes resume (${ISSUE_175})`, async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "1" }] });
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "2" }] });

        const promptCalls = getPromptQueryCalls();
        expect(promptCalls).toHaveLength(1);
        expect(fakes[0].inputs.map((input) => input.message.content)).toEqual(["1", "2"]);
        const { options } = promptCalls[0][0] as { options: Record<string, unknown> };
        expect(options.sessionId).toBe(sessionId);
        expect(options.resume).toBeUndefined();
      });

      it(`after Claude exits unexpectedly, reports the disconnect and resumes the chat in a new query on the next prompt (${ISSUE_175})`, async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const recorder = new SessionEventRecorder();
        proc.registerSessionHandler(sessionId, recorder.handler);
        await proc.prompt({ sessionId, promptId: "p1", prompt: [{ type: "text", text: "1" }] });
        await recorder.waitFor("turn_ended");

        fakes[0].fail(new Error("process exited with code 1"));
        const disconnected = await recorder.waitFor("session_disconnected");
        await proc.prompt({ sessionId, promptId: "p2", prompt: [{ type: "text", text: "2" }] });
        await recorder.waitFor("turn_ended", () => true, 1);

        expect(disconnected.error).toEqual(new Error("process exited with code 1"));
        const [first, second] = getPromptQueryCalls().map(
          (call) => (call[0] as { options: Record<string, unknown> }).options
        );
        expect(first.sessionId).toBe(sessionId);
        expect(second.resume).toBe(sessionId);
        expect(second.sessionId).toBeUndefined();
        expect(fakes[1].inputs.map((input) => input.uuid)).toEqual(["p2"]);
      });

      it(`withdraws a prompt Claude never received when it exits, and says it disconnected (${ISSUE_175})`, async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const recorder = new SessionEventRecorder();
        proc.registerSessionHandler(sessionId, recorder.handler);
        await proc.prompt({ sessionId, promptId: "p1", prompt: [{ type: "text", text: "1" }] });
        await fakes[0].nextInput();

        fakes[0].end();
        await recorder.waitFor("session_disconnected");

        expect(recorder.updates()).toEqual([
          { sessionUpdate: "messages_withdrawn", promptIds: ["p1"] },
          { sessionUpdate: "session_disconnected", error: new Error(CLAUDE_DISCONNECTED_MESSAGE) },
        ]);
      });

      it("emits SDK text deltas as agent_message_chunk events and ends the turn with end_turn", async () => {
        queryMock.mockImplementation(
          answering([
            streamEvent({ type: "message_start", message: {} }),
            streamEvent({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "hello" },
            }),
            resultMessage(),
          ])
        );
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const events = registerCollector(proc, sessionId);

        const resp = await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        expect(resp.stopReason).toBe("end_turn");
        expect(events.map((e) => e.update)).toEqual([
          { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
        ]);
      });

      it("attaches Copilot's MCP servers over HTTP and pre-approves their tools on every turn", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({
          cwd: "/vault",
          mcpServers: [
            {
              name: "obsidian-copilot",
              url: "http://127.0.0.1:4100/mcp",
              headers: { Authorization: "Bearer t0k3n" },
            },
          ],
        });

        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const { options } = getPromptQueryCalls()[0][0] as { options: Record<string, unknown> };
        expect(options.mcpServers).toEqual({
          "obsidian-copilot": {
            type: "http",
            url: "http://127.0.0.1:4100/mcp",
            headers: { Authorization: "Bearer t0k3n" },
          },
        });
        expect(options.allowedTools).toEqual([
          "Read",
          "Glob",
          "Grep",
          "LS",
          "mcp__obsidian-copilot",
        ]);
      });

      it.each([
        ["/compact", "manual"],
        ["/compact keep the file names", "manual"],
        ["write a poem", "auto"],
      ])(
        "labels the compaction a %j turn reports as %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/635)",
        async (text, trigger) => {
          queryMock.mockImplementation(
            answering([
              {
                type: "system",
                subtype: "status",
                status: "compacting",
                uuid: "compaction-1",
                session_id: "irrelevant",
              } as unknown as SDKMessage,
              resultMessage(),
            ])
          );
          const proc = makeProc();
          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          const events = registerCollector(proc, sessionId);

          await promptTurn(proc, { sessionId, prompt: [{ type: "text", text }] });

          expect(events.map((e) => e.update)).toEqual([
            { sessionUpdate: "compaction", id: "compaction-1", status: "in_progress", trigger },
          ]);
        }
      );

      it(`starts the chat's query with the claude_code preset, prompt echoes, interrupts that spare background agents, the background-subagent hook, and a fresh session id (${ISSUE_175})`, async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const promptCalls = getPromptQueryCalls();
        expect(promptCalls).toHaveLength(1);
        const { options } = promptCalls[0][0] as { options: Record<string, unknown> };
        expect(options.pathToClaudeCodeExecutable).toBe("/usr/local/bin/claude");
        expect(options.mcpServers).toBeUndefined();
        expect(options.disallowedTools).toBeUndefined();
        expect(options.extraArgs).toEqual({ "replay-user-messages": null });
        expect(options.perTaskStopAffordance).toBe(true);
        expect(options.hooks).toEqual({ PreToolUse: [{ hooks: [runSubagentsInBackground] }] });
        expect(options.sessionId).toBe(sessionId);
        expect(options.resume).toBeUndefined();
        expect(options.systemPrompt).toEqual({
          type: "preset",
          preset: "claude_code",
          excludeDynamicSections: true,
          append: undefined,
        });
      });

      it("asks Claude to report its session state, so the chat knows when its subagents and the replies about them are done, and keeps the backend's env overrides (https://github.com/Brevilabs/obsidian-copilot-private/issues/757)", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc({ getEnvOverrides: () => ({ CLAUDE_CONFIG_DIR: "/config" }) });
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const { options } = getPromptQueryCalls()[0][0] as {
          options: { env?: Record<string, string> };
        };
        expect(options.env).toEqual({
          ...process.env,
          CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: "1",
          CLAUDE_CONFIG_DIR: "/config",
        });
      });

      it("auto-allows only read tools so Write and Edit follow the session's permission mode and reach Copilot's prompt in Default mode (https://github.com/Brevilabs/obsidian-copilot-private/issues/690)", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const { options } = getPromptQueryCalls()[0][0] as { options: Record<string, unknown> };
        expect(options.allowedTools).toEqual(["Read", "Glob", "Grep", "LS"]);
      });

      it("has Claude load every AGENTS.md beside any CLAUDE.md, so vault and project instructions apply without a generated CLAUDE.md (https://github.com/logancyang/obsidian-copilot/issues/3662)", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault/Projects/Research" });

        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const { options } = getPromptQueryCalls()[0][0] as { options: Record<string, unknown> };
        expect(options.settings).toEqual({
          pluginConfigs: {
            "agents-md@builtin": { options: { instructionFiles: "claude-md-and-agents-md" } },
          },
        });
      });

      it("forwards the composed system prompt via systemPrompt append on the claude_code preset", async () => {
        queryMock.mockImplementation(
          answering([streamEvent({ type: "message_start", message: {} }), resultMessage()])
        );

        const proc = makeProc({ getSystemPromptAppend: () => "DO THIS THING WITH SKILLS" });

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const calls = getPromptQueryCalls();
        const opts = (calls[0][0] as { options: Record<string, unknown> }).options;
        expect(opts.systemPrompt).toEqual({
          type: "preset",
          preset: "claude_code",
          excludeDynamicSections: true,
          append: "DO THIS THING WITH SKILLS",
        });
      });

      it("captures the system prompt at newSession time and ignores later setting changes mid-session", async () => {
        queryMock.mockImplementation(
          answering([streamEvent({ type: "message_start", message: {} }), resultMessage()])
        );

        let current = "FIRST DIRECTIVE";
        const proc = makeProc({ getSystemPromptAppend: () => current });

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        current = "SECOND DIRECTIVE";
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const opts = (getPromptQueryCalls()[0][0] as { options: Record<string, unknown> }).options;
        expect(opts.systemPrompt).toEqual({
          type: "preset",
          preset: "claude_code",
          excludeDynamicSections: true,
          append: "FIRST DIRECTIVE",
        });
      });

      it("disables thinking when the extended-thinking toggle is off", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc({ getEnableThinking: () => false });

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const call = getPromptQueryCalls()[0][0] as { options: { thinking?: unknown } };
        expect(call.options.thinking).toEqual({ type: "disabled" });
      });

      it("requests summarized adaptive thinking when the toggle is on", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc({ getEnableThinking: () => true });

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        const call = getPromptQueryCalls()[0][0] as { options: { thinking?: unknown } };
        expect(call.options.thinking).toEqual({ type: "adaptive", display: "summarized" });
      });

      it(`applies an extended-thinking toggle flipped mid-chat to the running query before the next prompt, without restarting it (${ISSUE_175})`, async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        let thinking = true;
        const proc = makeProc({ getEnableThinking: () => thinking });
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "1" }] });

        thinking = false;
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "2" }] });
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "3" }] });
        thinking = true;
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "4" }] });

        expect(fakes[0].setMaxThinkingTokens.mock.calls).toEqual([
          [0, undefined],
          [31_999, "summarized"],
        ]);
        expect(getPromptQueryCalls()).toHaveLength(1);
      });

      it("keeps each chat's permission and question requests bound to its own session for https://github.com/logancyang/obsidian-copilot/issues/2948", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId: sessionA } = await proc.newSession({ cwd: "/vault/a" });
        const { sessionId: sessionB } = await proc.newSession({ cwd: "/vault/b" });
        const permissionPrompter = jest.fn(async () => ({
          outcome: { outcome: "selected" as const, optionId: "allow_once" },
        }));
        const questionPrompter = jest.fn(async () => ({ "Continue?": "Yes" }));
        proc.setPermissionPrompter(permissionPrompter);
        proc.setAskUserQuestionPrompter(questionPrompter);

        await Promise.all([
          promptTurn(proc, { sessionId: sessionA, prompt: [{ type: "text", text: "A" }] }),
          promptTurn(proc, { sessionId: sessionB, prompt: [{ type: "text", text: "B" }] }),
        ]);
        const [callA, callB] = getPromptQueryCalls().map(
          (call) => (call[0] as { options: { canUseTool: CanUseTool } }).options.canUseTool
        );

        await callA("Edit", { file_path: "/vault/a/note.md" }, {
          signal: new AbortController().signal,
          toolUseID: "tool-a",
        } as never);
        await callB(
          "AskUserQuestion",
          { questions: [{ question: "Continue?", options: [{ label: "Yes" }] }] },
          { signal: new AbortController().signal, toolUseID: "tool-b" } as never
        );

        expect(permissionPrompter).toHaveBeenLastCalledWith(
          expect.objectContaining({ sessionId: sessionA })
        );
        expect(questionPrompter).toHaveBeenLastCalledWith(
          expect.objectContaining({ sessionId: sessionB, requestId: "tool-b" })
        );
      });

      it("ends the turn with Claude's reset message when a success-shaped result reports usage exhaustion", async () => {
        queryMock.mockImplementation(answering(usageLimitMessages()));

        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        const end = await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        expect(end.error).toEqual(new Error(USAGE_LIMIT_MESSAGE));
      });

      it("does not start a query when its session closes during environment preparation https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        let finishEnvironment!: (env: Record<string, string>) => void;
        const environment = new Promise<Record<string, string>>((resolve) => {
          finishEnvironment = resolve;
        });
        const backend = makeProc({ getManagedEnv: async () => environment });
        const { sessionId } = await backend.newSession({ cwd: "/vault" });
        queryMock.mockImplementation(answering([resultMessage()]));
        const pending = promptTurn(backend, { sessionId, prompt: [] });
        await flushMicrotasks();
        await backend.closeSession({ sessionId });
        finishEnvironment({});
        await expect(pending).rejects.toThrow(
          `Session ${sessionId} closed before its prompt was sent`
        );
        expect(getPromptQueryCalls()).toHaveLength(0);
      });

      describe("authentication", () => {
        it("rejects with AuthRequiredError and never spawns query when not signed in", async () => {
          queryMock.mockImplementation(answering([resultMessage()]));
          const checkAuth = jest.fn().mockResolvedValue(false);
          const proc = makeProc({ checkAuth });

          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          proc.registerSessionHandler(sessionId, () => {});

          await expect(
            promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] })
          ).rejects.toBeInstanceOf(AuthRequiredError);
          expect(getPromptQueryCalls()).toHaveLength(0);
        });

        it("checks auth only once across turns once signed in (cached)", async () => {
          queryMock.mockImplementation(answering([resultMessage()]));
          const checkAuth = jest.fn().mockResolvedValue(true);
          const proc = makeProc({ checkAuth });

          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          proc.registerSessionHandler(sessionId, () => {});

          await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "1" }] });
          await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "2" }] });

          expect(checkAuth).toHaveBeenCalledTimes(1);
          expect(getPromptQueryCalls()).toHaveLength(1);
        });

        it("re-checks auth on the next turn when a turn ends non-success with no errors", async () => {
          const checkAuth = jest.fn().mockResolvedValue(true);
          const proc = makeProc({ checkAuth });

          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          proc.registerSessionHandler(sessionId, () => {});

          queryMock.mockImplementation(
            answering((turn) => [turn === 0 ? errorResultMessage([]) : resultMessage()])
          );
          await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "1" }] });
          expect(checkAuth).toHaveBeenCalledTimes(1);

          await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "2" }] });
          expect(checkAuth).toHaveBeenCalledTimes(2);
        });
      });

      describe("plan usage", () => {
        it("publishes a reading to every live session, not only the one that took the turn", async () => {
          const proc = makeProc();
          const first = await proc.newSession({ cwd: "/vault" });
          const second = await proc.newSession({ cwd: "/vault" });
          const firstEvents = registerCollector(proc, first.sessionId);
          const secondEvents = registerCollector(proc, second.sessionId);

          await promptReportingPlanUsage(proc, first.sessionId, async () => WEEKLY_21_PERCENT);

          for (const events of [firstEvents, secondEvents]) {
            expect(planUsageUpdates(events)).toMatchObject([
              {
                sessionUpdate: "plan_usage_update",
                planUsage: { windows: [{ id: "seven_day", percent: 21 }] },
              },
            ]);
          }
        });

        it("clears the meters when the account turns out not to be metered by plan caps (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
          const proc = makeProc();
          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          const events = registerCollector(proc, sessionId);
          await promptReportingPlanUsage(proc, sessionId, async () => WEEKLY_21_PERCENT);

          await promptReportingPlanUsage(proc, sessionId, async () => ({
            rate_limits_available: false,
          }));

          expect(planUsageUpdates(events).at(-1)).toEqual({
            sessionUpdate: "plan_usage_update",
            planUsage: null,
          });
        });

        it("keeps showing the last good reading when the usage call fails", async () => {
          const proc = makeProc();
          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          const events = registerCollector(proc, sessionId);
          await promptReportingPlanUsage(proc, sessionId, async () => WEEKLY_21_PERCENT);
          const publishedBefore = planUsageUpdates(events).length;

          await promptReportingPlanUsage(proc, sessionId, () =>
            Promise.reject(new Error("transport closed"))
          );

          expect(planUsageUpdates(events)).toHaveLength(publishedBefore);
          const later = await proc.newSession({ cwd: "/vault" });
          expect(planUsageUpdates(registerCollector(proc, later.sessionId))).toMatchObject([
            { planUsage: { windows: [{ id: "seven_day", percent: 21 }] } },
          ]);
        });
      });
    });

    describe("registerSessionHandler()", () => {
      it("buffers events emitted before a session handler is registered and replays them", async () => {
        queryMock.mockImplementation(
          answering([
            streamEvent({ type: "message_start", message: {} }),
            streamEvent({
              type: "content_block_delta",
              index: 0,
              delta: { type: "text_delta", text: "buffered" },
            }),
            resultMessage(),
          ])
        );

        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await proc.prompt({ sessionId, promptId: "p1", prompt: [{ type: "text", text: "hi" }] });

        const seen: SessionEvent[] = [];
        await new Promise<void>((turnEnded) =>
          proc.registerSessionHandler(sessionId, (e) => {
            seen.push(e);
            if (e.update.sessionUpdate === "turn_ended") turnEnded();
          })
        );

        expect(seen.map((e) => e.update)).toContainEqual({
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "buffered" },
        });
      });

      it("replays the last read plan caps to a session registered afterwards", async () => {
        const proc = makeProc();
        const first = await proc.newSession({ cwd: "/vault" });
        registerCollector(proc, first.sessionId);
        await promptReportingPlanUsage(proc, first.sessionId, async () => WEEKLY_21_PERCENT);
        const second = await proc.newSession({ cwd: "/vault" });

        const events = registerCollector(proc, second.sessionId);

        expect(planUsageUpdates(events)).toMatchObject([
          {
            sessionUpdate: "plan_usage_update",
            planUsage: { windows: [{ id: "seven_day", label: "Weekly", percent: 21 }] },
          },
        ]);
      });

      it("sends no plan caps to a session registered before any were read", async () => {
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        const events = registerCollector(proc, sessionId);

        expect(planUsageUpdates(events)).toEqual([]);
      });

      it("does not replay a plan window whose reset has already passed (https://github.com/logancyang/obsidian-copilot-preview/issues/193)", async () => {
        const proc = makeProc();
        const first = await proc.newSession({ cwd: "/vault" });
        registerCollector(proc, first.sessionId);
        await promptReportingPlanUsage(proc, first.sessionId, async () => ({
          rate_limits_available: true,
          rate_limits: {
            five_hour: {
              utilization: 88,
              resets_at: new Date(Date.now() - 60_000).toISOString(),
            },
            seven_day: {
              utilization: 21,
              resets_at: new Date(Date.now() + 3_600_000).toISOString(),
            },
          },
        }));
        const second = await proc.newSession({ cwd: "/vault" });

        const events = registerCollector(proc, second.sessionId);

        expect(planUsageUpdates(events)).toMatchObject([
          { planUsage: { windows: [{ id: "seven_day" }] } },
        ]);
      });
    });

    describe("setSessionModel()", () => {
      it.each(["empty", "failed"])(
        "keeps an explicit model usable and respects its switch when discovery is %s (https://github.com/Brevilabs/obsidian-copilot-private/issues/625)",
        async (probeResult) => {
          (getCachedSdkCatalog as jest.Mock).mockReturnValue(null);
          queryMock.mockReturnValue({
            initializationResult: () =>
              probeResult === "failed"
                ? Promise.reject(new Error("probe unavailable"))
                : Promise.resolve({ models: [] }),
            close: jest.fn(),
          });
          let enabled = [
            { baseModelId: "claude-fake-mini", name: "Mini", credentialState: "ok" as const },
          ];
          const descriptor = {
            ...fakeDescriptor(),
            usesConfiguredModels: false,
            getEnabledModelEntries: () => enabled,
          };
          const proc = makeProc({ descriptor });
          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          const state = await proc.setSessionModel({ sessionId, modelId: "claude-fake-mini" });
          expect(state.model?.current.baseModelId).toBe("claude-fake-mini");
          const session = new AgentSession({
            backend: proc,
            backendSessionId: sessionId,
            internalId: "failed-discovery-chat",
            backendId: "claude",
            getDescriptor: () => descriptor,
          });
          session.completeResume(state);
          await session.ready;
          queryMock.mockImplementation(answering([resultMessage()]));

          expect(await session.sendPrompt("use the enabled model").turn).toBe("end_turn");
          expect(getPromptQueryCalls()).toHaveLength(1);
          enabled = [];
          expect(await session.sendPrompt("model is now disabled").turn).toBe("refusal");
          expect(getPromptQueryCalls()).toHaveLength(1);
          await proc.shutdown();
        }
      );
    });

    describe("setSessionConfigOption()", () => {
      it("sets the effort level on the session state and sends it with the next prompt", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, () => {});
        const stateAfter = await proc.setSessionConfigOption({
          sessionId,
          configId: "effort",
          value: "high",
        });
        expect(stateAfter.model?.current.effort).toBe("high");

        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });
        const promptCalls = getPromptQueryCalls();
        expect(promptCalls).toHaveLength(1);
        const call = promptCalls[0][0] as { options: { effort?: string } };
        expect(call.options.effort).toBe("high");
      });

      it(`applies a new effort level to the chat's running query (${ISSUE_175})`, async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        await proc.setSessionConfigOption({ sessionId, configId: "effort", value: "high" });

        expect(fakes[0].applyFlagSettings).toHaveBeenCalledWith({ effortLevel: "high" });
      });

      it("rejects an effort level the session's model does not support", async () => {
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await expect(
          proc.setSessionConfigOption({ sessionId, configId: "effort", value: "max" })
        ).rejects.toThrow("Effort 'max' not supported by claude-fake-pro");
      });
    });

    describe("setSessionMode()", () => {
      it.each(["default", "plan", "acceptEdits", "auto", "bypassPermissions"])(
        "carries the %s permission mode into the next turn",
        async (modeId) => {
          queryMock.mockImplementation(answering([resultMessage()]));
          const proc = makeProc();

          const { sessionId } = await proc.newSession({ cwd: "/vault" });
          proc.registerSessionHandler(sessionId, () => {});
          await proc.setSessionMode({ sessionId, modeId });
          await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

          const call = getPromptQueryCalls()[0][0] as { options: { permissionMode?: string } };
          expect(call.options.permissionMode).toBe(modeId);
        }
      );

      it(`switches the running query's permission mode and model in place (${ISSUE_175})`, async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        await proc.setSessionMode({ sessionId, modeId: "plan" });
        await proc.setSessionModel({ sessionId, modelId: "claude-fake-mini" });

        expect(fakes[0].setPermissionMode).toHaveBeenCalledWith("plan");
        expect(fakes[0].setModel).toHaveBeenCalledWith("claude-fake-mini");
        expect(getPromptQueryCalls()).toHaveLength(1);
      });

      it(`rejects a mode the running query refuses and keeps the old one, so the chat never claims a mode Claude is not in (${ISSUE_175})`, async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await proc.setSessionMode({ sessionId, modeId: "default" });
        const recorder = new SessionEventRecorder();
        proc.registerSessionHandler(sessionId, recorder.handler);
        await proc.prompt({ sessionId, promptId: "p1", prompt: [{ type: "text", text: "1" }] });
        await recorder.waitFor("turn_ended");
        fakes[0].setPermissionMode.mockRejectedValueOnce(new Error("control request failed"));

        await expect(
          proc.setSessionMode({ sessionId, modeId: "bypassPermissions" })
        ).rejects.toThrow("control request failed");
        fakes[0].fail(new Error("process exited with code 1"));
        await recorder.waitFor("session_disconnected");
        await proc.prompt({ sessionId, promptId: "p2", prompt: [{ type: "text", text: "2" }] });

        const reconnected = getPromptQueryCalls()[1][0] as { options: { permissionMode?: string } };
        expect(reconnected.options.permissionMode).toBe("default");
      });

      it(`starts the query in a mode chosen while the query was still starting (${ISSUE_175})`, async () => {
        let finishEnvironment!: (env: Record<string, string>) => void;
        const environment = new Promise<Record<string, string>>((resolve) => {
          finishEnvironment = resolve;
        });
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc({ getManagedEnv: async () => environment });
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const turn = promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "hi" }] });

        await proc.setSessionMode({ sessionId, modeId: "plan" });
        finishEnvironment({});
        await turn;

        const call = getPromptQueryCalls()[0][0] as { options: { permissionMode?: string } };
        expect(call.options.permissionMode).toBe("plan");
      });

      it("rejects a permission mode the SDK does not define", async () => {
        const proc = makeProc();

        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await expect(proc.setSessionMode({ sessionId, modeId: "dontAsk" })).rejects.toThrow(
          "Unsupported mode dontAsk"
        );
      });
    });

    describe("refreshSessionConfiguration()", () => {
      it("closes only the stale live query and reads fresh settings when the next natural prompt resumes the same chat", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        let environment = { CONFIG_MARKER: "old" };
        const backend = makeProc({ getManagedEnv: async () => environment });
        const { sessionId } = await backend.newSession({ cwd: "/vault" });
        await promptTurn(backend, { sessionId, prompt: [] });
        environment = { CONFIG_MARKER: "updated" };
        backend.refreshSessionConfiguration(sessionId);
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect(fakes[0].close).toHaveBeenCalledTimes(1);
        await promptTurn(backend, { sessionId, prompt: [] });
        expect(queryMock).toHaveBeenCalledTimes(2);
        const nextOptions = queryMock.mock.calls[1][0].options;
        expect(nextOptions.resume).toBe(sessionId);
        expect(nextOptions.env.CONFIG_MARKER).toBe("updated");
      });
    });

    describe("closeSession()", () => {
      it("terminates only the closing session's live query https://github.com/Brevilabs/obsidian-copilot-private/issues/429", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const backend = makeProc();
        const first = await backend.newSession({ cwd: "/vault" });
        const sibling = await backend.newSession({ cwd: "/vault" });
        await promptTurn(backend, { sessionId: first.sessionId, prompt: [] });
        await promptTurn(backend, { sessionId: sibling.sessionId, prompt: [] });

        await backend.closeSession({ sessionId: first.sessionId });

        expect(fakes[0].close).toHaveBeenCalledTimes(1);
        expect(fakes[1].close).not.toHaveBeenCalled();
        await expect(
          promptTurn(backend, { sessionId: first.sessionId, prompt: [] })
        ).rejects.toThrow("Unknown session");
      });
    });

    describe("cancel()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/789 interrupts the live query but leaves unread messages with Claude when asked to keep them", async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await proc.prompt({ sessionId, promptId: "p1", prompt: [{ type: "text", text: "hi" }] });
        await proc.prompt({ sessionId, promptId: "p2", prompt: [{ type: "text", text: "next" }] });

        await proc.cancel({ sessionId, keepUnread: true });

        expect(fakes[0].interrupt).toHaveBeenCalledTimes(1);
        expect(fakes[0].cancelAsyncMessage).not.toHaveBeenCalled();
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/747 interrupts the chat's live query, withdrawing every message Claude has not read yet, and keeps it open so the next message continues the same query", async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await proc.prompt({ sessionId, promptId: "p1", prompt: [{ type: "text", text: "hi" }] });

        await proc.cancel({ sessionId });
        await proc.prompt({ sessionId, promptId: "p2", prompt: [{ type: "text", text: "next" }] });

        expect(fakes[0].interrupt).toHaveBeenCalledTimes(1);
        expect(fakes[0].close).not.toHaveBeenCalled();
        expect(queryMock).toHaveBeenCalledTimes(1);
        expect((await fakes[0].nextInput(1)).uuid).toBe("p2");
      });

      it(`waits for a query that is still starting, so Stop pressed during setup still interrupts it (${ISSUE_175})`, async () => {
        let finishEnvironment!: (env: Record<string, string>) => void;
        const environment = new Promise<Record<string, string>>((resolve) => {
          finishEnvironment = resolve;
        });
        queryMock.mockImplementation(silent());
        const proc = makeProc({ getManagedEnv: async () => environment });
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        const sending = proc.prompt({
          sessionId,
          promptId: "p1",
          prompt: [{ type: "text", text: "hi" }],
        });

        const cancelling = proc.cancel({ sessionId });
        finishEnvironment({});
        await Promise.all([sending, cancelling]);

        expect(fakes[0].interrupt).toHaveBeenCalledTimes(1);
      });
    });

    describe("withdraw()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/747 asks Claude to cancel the queued message by its prompt id and reports whether it did", async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc();
        const events: SessionEvent[] = [];
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        proc.registerSessionHandler(sessionId, (event) => events.push(event));
        await proc.prompt({ sessionId, promptId: "p1", prompt: [{ type: "text", text: "hi" }] });
        fakes[0].cancelAsyncMessage.mockResolvedValue(true);

        await expect(proc.withdraw({ sessionId, promptId: "p1" })).resolves.toBe(true);

        expect(fakes[0].cancelAsyncMessage).toHaveBeenCalledWith("p1");
        expect(events.map((e) => e.update)).toContainEqual({
          sessionUpdate: "messages_withdrawn",
          promptIds: ["p1"],
        });
      });

      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/747 reports nothing withdrawn for a chat whose query is not running", async () => {
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });

        await expect(proc.withdraw({ sessionId, promptId: "p1" })).resolves.toBe(false);
      });
    });

    describe("stopTask()", () => {
      it("https://github.com/Brevilabs/obsidian-copilot-private/issues/748 asks Claude to stop that task on the chat's live query, without interrupting or closing it", async () => {
        queryMock.mockImplementation(silent());
        const proc = makeProc();
        const { sessionId } = await proc.newSession({ cwd: "/vault" });
        await proc.prompt({ sessionId, promptId: "p1", prompt: [{ type: "text", text: "hi" }] });

        await proc.stopTask({ sessionId, taskId: "bg-task-1" });

        expect(fakes[0].stopTask).toHaveBeenCalledWith("bg-task-1");
        expect(fakes[0].interrupt).not.toHaveBeenCalled();
        expect(fakes[0].close).not.toHaveBeenCalled();
      });
    });

    describe("shutdown()", () => {
      it("aborts a cold catalog probe so a cancelled check cannot leave a startup process running", async () => {
        (getCachedSdkCatalog as jest.Mock).mockReturnValue(null);
        let rejectInitialization!: (reason: Error) => void;
        let markStarted!: () => void;
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const initialization = new Promise<never>((_resolve, reject) => {
          rejectInitialization = reject;
        });
        const probe = { initializationResult: () => initialization, close: jest.fn() };
        let probeSignal!: AbortSignal;
        queryMock.mockImplementation(({ options }: QueryArgs) => {
          probeSignal = (options.abortController as AbortController).signal;
          probeSignal.addEventListener(
            "abort",
            () => rejectInitialization(new Error("cancelled")),
            { once: true }
          );
          markStarted();
          return probe;
        });
        const proc = makeProc();
        const opening = proc.newSession({ cwd: "/vault" });
        const cancelled = expect(opening).rejects.toMatchObject({ name: "AbortError" });
        await started;

        await proc.shutdown();
        await cancelled;

        expect(probeSignal.aborted).toBe(true);
        expect(probe.close).toHaveBeenCalledTimes(1);
        expect(queryMock).toHaveBeenCalledTimes(1);
      });

      it("closes every chat's live query", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const first = await proc.newSession({ cwd: "/vault" });
        const second = await proc.newSession({ cwd: "/vault" });
        await promptTurn(proc, { sessionId: first.sessionId, prompt: [] });
        await promptTurn(proc, { sessionId: second.sessionId, prompt: [] });

        await proc.shutdown();

        expect(fakes.map((fake) => fake.close.mock.calls.length)).toEqual([1, 1]);
      });
    });

    describe("resumeSession()", () => {
      it("reopens the session with the seeded model state and sends its next prompt as a resume, replaying nothing", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProc();
        const sessionId = "resumed-session";
        const events = registerCollector(proc, sessionId);

        const resp = await proc.resumeSession({ sessionId, cwd: "/vault" });
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "continue" }] });

        expect(resp.sessionId).toBe(sessionId);
        expect(resp.state.model?.current.baseModelId).toBe("claude-fake-pro");
        expect(events).toEqual([]);
        const { options } = getPromptQueryCalls()[0][0] as { options: Record<string, unknown> };
        expect(options.resume).toBe(sessionId);
        expect(options.sessionId).toBeUndefined();
      });
    });

    describe("loadSession()", () => {
      const cwd = "/vault";
      const sessionId = "11111111-2222-3333-4444-555555555555";
      let configDir: string;

      beforeEach(async () => {
        configDir = await mkdtemp(path.join(os.tmpdir(), "claude-config-"));
      });
      afterEach(async () => {
        await rm(configDir, { recursive: true, force: true });
      });

      function makeProcWithConfigDir(): ClaudeSdkBackendProcess {
        return makeProc({ getEnvOverrides: () => ({ CLAUDE_CONFIG_DIR: configDir }) });
      }

      async function writeTranscript(...entries: object[]): Promise<void> {
        const dir = path.join(configDir, "projects", cwd.replace(/[^a-zA-Z0-9]/g, "-"));
        await mkdir(dir, { recursive: true });
        await writeFile(
          path.join(dir, `${sessionId}.jsonl`),
          entries.map((entry) => `${JSON.stringify(entry)}\n`).join("")
        );
      }

      it("delivers the transcript's prompt, thinking, reply, and tool call with its result to the session handler, in order, before it resolves", async () => {
        await writeTranscript(
          { type: "user", uuid: "u-1", message: { role: "user", content: "rename the note" } },
          {
            type: "assistant",
            message: { role: "assistant", content: [{ type: "thinking", thinking: "Use mv." }] },
          },
          {
            type: "assistant",
            message: {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "tool-mv",
                  name: "Bash",
                  input: { command: "mv a.md b.md" },
                },
              ],
            },
          },
          {
            type: "user",
            uuid: "u-2",
            message: {
              role: "user",
              content: [{ type: "tool_result", tool_use_id: "tool-mv", content: "" }],
            },
          },
          {
            type: "assistant",
            message: { role: "assistant", content: [{ type: "text", text: "Renamed." }] },
          }
        );
        const proc = makeProcWithConfigDir();
        const events = registerCollector(proc, sessionId);

        const deliveredAtResolve = await proc
          .loadSession({ sessionId, cwd })
          .then(() => events.map((e) => [e.update.sessionUpdate, e.sessionId]));

        expect(deliveredAtResolve).toEqual([
          ["user_message_chunk", sessionId],
          ["agent_thought_chunk", sessionId],
          ["tool_call", sessionId],
          ["tool_call_update", sessionId],
          ["agent_message_chunk", sessionId],
        ]);
        expect(events[3].update).toMatchObject({ toolCallId: "tool-mv", status: "completed" });
      });

      it("returns the same session id and model state resumeSession returns and sends its next prompt as a resume", async () => {
        await writeTranscript({ type: "user", uuid: "u-1", message: { content: "hello" } });
        queryMock.mockImplementation(answering([resultMessage()]));
        const resumed = await makeProcWithConfigDir().resumeSession({ sessionId, cwd });
        const proc = makeProcWithConfigDir();
        registerCollector(proc, sessionId);

        const loaded = await proc.loadSession({ sessionId, cwd });
        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "continue" }] });

        expect(loaded).toEqual(resumed);
        const { options } = getPromptQueryCalls()[0][0] as { options: Record<string, unknown> };
        expect(options.resume).toBe(sessionId);
      });

      it("carries the replayed task list into the next live turn so a TaskUpdate updates a task created before reopening", async () => {
        await writeTranscript(
          {
            type: "assistant",
            message: {
              content: [
                {
                  type: "tool_use",
                  id: "create-1",
                  name: "TaskCreate",
                  input: { subject: "Collect sources" },
                },
              ],
            },
          },
          {
            type: "user",
            uuid: "u-1",
            message: {
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "create-1",
                  content: "Task #1 created successfully: Collect sources",
                },
              ],
            },
          }
        );
        queryMock.mockImplementation(
          answering([
            streamEvent({ type: "message_start", message: {} }),
            streamEvent({
              type: "content_block_start",
              index: 0,
              content_block: {
                type: "tool_use",
                id: "update-1",
                name: "TaskUpdate",
                input: { taskId: "1", status: "completed" },
              },
            }),
            resultMessage(),
          ])
        );
        const proc = makeProcWithConfigDir();
        const events = registerCollector(proc, sessionId);
        await proc.loadSession({ sessionId, cwd });
        events.length = 0;

        await promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "mark it done" }] });

        expect(events.map((e) => e.update)).toContainEqual({
          sessionUpdate: "plan",
          entries: [{ content: "Collect sources", status: "completed", priority: "medium" }],
        });
      });

      it("https://github.com/logancyang/obsidian-copilot/issues/3643 rejects, and sends no later prompt as a resume, when the session's transcript is not on this machine", async () => {
        queryMock.mockImplementation(answering([resultMessage()]));
        const proc = makeProcWithConfigDir();
        const events = registerCollector(proc, sessionId);

        await expect(proc.loadSession({ sessionId, cwd })).rejects.toThrow(sessionId);
        await expect(
          promptTurn(proc, { sessionId, prompt: [{ type: "text", text: "continue" }] })
        ).rejects.toThrow();

        expect(events).toEqual([]);
        expect(getPromptQueryCalls()).toEqual([]);
      });
    });

    describe("sessionExistsLocally()", () => {
      const cwd = "/vault";
      const projectDir = cwd.replace(/[^a-zA-Z0-9]/g, "-");
      let configDir: string;

      beforeEach(async () => {
        configDir = await mkdtemp(path.join(os.tmpdir(), "claude-config-"));
      });
      afterEach(async () => {
        await rm(configDir, { recursive: true, force: true });
      });

      function makeProcWithConfigDir(): ClaudeSdkBackendProcess {
        return makeProc({ getEnvOverrides: () => ({ CLAUDE_CONFIG_DIR: configDir }) });
      }

      it("returns true when this device has the session transcript on disk", async () => {
        const sessionId = "11111111-2222-3333-4444-555555555555";
        const dir = path.join(configDir, "projects", projectDir);
        await mkdir(dir, { recursive: true });
        await writeFile(path.join(dir, `${sessionId}.jsonl`), "{}\n");

        await expect(
          makeProcWithConfigDir().sessionExistsLocally({ sessionId, cwd })
        ).resolves.toBe(true);
      });

      it("returns false for a session whose transcript never synced to this device", async () => {
        await expect(
          makeProcWithConfigDir().sessionExistsLocally({ sessionId: "absent-session-id", cwd })
        ).resolves.toBe(false);
      });
    });
  });
});
