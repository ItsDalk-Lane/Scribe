import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs";
import { signOutFromClaude } from "./claudeAuth";
jest.mock("./claudeAuth", () => ({ signOutFromClaude: jest.fn() }));

import type { AgentSession } from "@/agentMode/session/AgentSession";
import type { BackendProcess, BackendState } from "@/agentMode/session/types";
import { resetSettings, setSettings, type CopilotSettings } from "@/settings/model";
import { __resetVaultBaseCache } from "@/utils/vaultPath";
import { FileSystemAdapter, type App } from "obsidian";
import { resolveClaudeBinary } from "./claudeBinaryResolver";
import { probeClaudeVersion } from "./claudeVersion";
import {
  ClaudeBackendDescriptor,
  getClaudeInstallState,
  MCP_SETTLE_POLL_MS,
  MCP_SETTLE_TIMEOUT_MS,
  refreshClaudeInstallState,
  resolveClaudeAutoModePermission,
  subscribeClaudeInstallState,
  updateClaudeFields,
} from "./descriptor";

jest.mock("./claudeBinaryResolver", () => ({
  claudeBinarySearchDirs: jest.fn(() => []),
  resolveClaudeBinary: jest.fn(),
}));

jest.mock("./claudeVersion", () => ({
  ...jest.requireActual("./claudeVersion"),
  probeClaudeVersion: jest.fn(),
}));

const mockResolveClaudeBinary = resolveClaudeBinary as jest.MockedFunction<
  typeof resolveClaudeBinary
>;
const mockProbeClaudeVersion = probeClaudeVersion as jest.MockedFunction<typeof probeClaudeVersion>;

function settingsWithClaudeRuntime(options: {
  path?: string;
  envOverrides?: Record<string, string>;
}): CopilotSettings {
  return {
    agentMode: {
      claudeCli: options.path ? { path: options.path } : undefined,
      backends: {
        claude: {
          envOverrides: options.envOverrides,
        },
      },
    },
  } as unknown as CopilotSettings;
}

Object.defineProperty(AbortSignal.prototype, "throwIfAborted", {
  configurable: true,
  value(this: AbortSignal) {
    if (this.aborted)
      throw this.reason ?? new DOMException("The operation was aborted.", "AbortError");
  },
});

describe("descriptor", () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  describe("ClaudeBackendDescriptor.auth.getProbeKey()", () => {
    afterEach(() => jest.restoreAllMocks());
    it.each(["CLAUDE_CONFIG_DIR", "XDG_CONFIG_HOME", "ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/379 invalidates authentication when effective %s changes without exposing secrets",
      (variable) => {
        mockResolveClaudeBinary.mockReturnValue("/cli");
        const original = ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}));
        const changed = ClaudeBackendDescriptor.auth.getProbeKey!(
          settingsWithClaudeRuntime({ envOverrides: { [variable]: "private-fixture-value" } })
        );
        expect(changed).not.toBe(original);
        expect(changed).toMatch(/^[a-f0-9]{64}$/);
        expect(changed).not.toContain("private-fixture-value");
      }
    );
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 invalidates a newly resolved CLI", () => {
      mockResolveClaudeBinary.mockReturnValueOnce("/first/cli").mockReturnValueOnce("/second/cli");
      const settings = settingsWithClaudeRuntime({});
      expect(ClaudeBackendDescriptor.auth.getProbeKey!(settings)).not.toBe(
        ClaudeBackendDescriptor.auth.getProbeKey!(settings)
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 preserves identity when override order or provenance changes without changing the effective profile", () => {
      mockResolveClaudeBinary.mockReturnValue("/cli");
      jest.replaceProperty(process, "env", {
        CLAUDE_CONFIG_DIR: "/profile",
        ANTHROPIC_API_KEY: "private-fixture-key",
      });
      const inherited = ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}));
      const overridden = ClaudeBackendDescriptor.auth.getProbeKey!(
        settingsWithClaudeRuntime({
          envOverrides: { ANTHROPIC_API_KEY: "private-fixture-key", CLAUDE_CONFIG_DIR: "/profile" },
        })
      );
      expect(inherited).toBe(overridden);
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 invalidates an inherited credential change", () => {
      mockResolveClaudeBinary.mockReturnValue("/cli");
      jest.replaceProperty(process, "env", { ANTHROPIC_API_KEY: "first-fixture" });
      const original = ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}));
      jest.replaceProperty(process, "env", { ANTHROPIC_API_KEY: "second-fixture" });
      expect(ClaudeBackendDescriptor.auth.getProbeKey!(settingsWithClaudeRuntime({}))).not.toBe(
        original
      );
    });
  });

  describe("ClaudeBackendDescriptor.auth.signOut()", () => {
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 signs out using the session CLI and profile and preserves the resulting account label", async () => {
      mockResolveClaudeBinary.mockReturnValue("/custom/claude");
      jest
        .mocked(signOutFromClaude)
        .mockResolvedValue({ loggedIn: true, label: "zero@example.com (max)" });
      const options = { signal: new AbortController().signal };
      await expect(
        ClaudeBackendDescriptor.auth.signOut!(
          settingsWithClaudeRuntime({ envOverrides: { CLAUDE_CONFIG_DIR: "/custom profile" } }),
          options
        )
      ).resolves.toEqual({ signedIn: true, label: "zero@example.com (max)" });
      expect(signOutFromClaude).toHaveBeenCalledWith(
        "/custom/claude",
        expect.objectContaining({ CLAUDE_CONFIG_DIR: "/custom profile" }),
        options
      );
    });
    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/379 does not claim credentials were removed when the CLI is missing", async () => {
      mockResolveClaudeBinary.mockReturnValue(null);
      await expect(
        ClaudeBackendDescriptor.auth.signOut!(settingsWithClaudeRuntime({}))
      ).rejects.toThrow("Install Claude Code before signing out");
      expect(signOutFromClaude).not.toHaveBeenCalled();
    });
  });
  describe("ClaudeBackendDescriptor.dataDestination()", () => {
    const serverEnvKeys = [
      "ANTHROPIC_BASE_URL",
      "CLAUDE_CODE_USE_BEDROCK",
      "CLAUDE_CODE_USE_VERTEX",
      "CLAUDE_CONFIG_DIR",
    ];
    const saved = serverEnvKeys.map((key) => [key, process.env[key]] as const);
    let configDir: string;
    let vaultBase: string;
    const writeJson = (file: string, value: unknown) => {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
    };
    const destination = (envOverrides: Record<string, string> = {}) =>
      ClaudeBackendDescriptor.dataDestination!(
        settingsWithClaudeRuntime({
          envOverrides: { CLAUDE_CONFIG_DIR: configDir, ...envOverrides },
        }),
        vaultBase
      );
    beforeEach(() => {
      for (const key of serverEnvKeys) delete process.env[key];
      configDir = fs.mkdtempSync(path.join(os.tmpdir(), "claude-config-"));
      vaultBase = fs.mkdtempSync(path.join(os.tmpdir(), "claude-vault-"));
    });
    afterEach(() => {
      for (const [key, value] of saved) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      fs.rmSync(configDir, { recursive: true, force: true });
      fs.rmSync(vaultBase, { recursive: true, force: true });
    });

    it("names Anthropic when nothing sets another server, even with an unreadable settings file", () => {
      writeJson(path.join(configDir, "settings.json"), "{not json");
      expect(destination()).toEqual({ kind: "cloud", label: "Anthropic" });
    });

    it.each([
      [
        "a plugin override sets a cloud base URL",
        () => ({ ANTHROPIC_BASE_URL: "https://proxy.example" }),
        { kind: "cloud", label: "The server set in your Claude Code settings" },
      ],
      [
        "a plugin override sets a local base URL",
        () => ({ ANTHROPIC_BASE_URL: "http://127.0.0.1:4000" }),
        { kind: "local", label: "A server on this computer" },
      ],
      [
        "only the Claude config folder's settings.json turns on Bedrock",
        () => {
          writeJson(path.join(configDir, "settings.json"), {
            env: { CLAUDE_CODE_USE_BEDROCK: "1" },
          });
          return {};
        },
        { kind: "cloud", label: "Amazon Bedrock" },
      ],
      [
        "the vault's .claude/settings.local.json turns on Vertex",
        () => {
          writeJson(path.join(vaultBase, ".claude", "settings.local.json"), {
            env: { CLAUDE_CODE_USE_VERTEX: "1" },
          });
          return {};
        },
        { kind: "cloud", label: "Google Vertex AI" },
      ],
      [
        "the vault's .claude/settings.json turns Bedrock off again",
        () => {
          writeJson(path.join(configDir, "settings.json"), {
            env: { CLAUDE_CODE_USE_BEDROCK: "1" },
          });
          writeJson(path.join(vaultBase, ".claude", "settings.json"), {
            env: { CLAUDE_CODE_USE_BEDROCK: "0" },
          });
          return {};
        },
        { kind: "cloud", label: "Anthropic" },
      ],
    ])(
      "names the destination when %s for https://github.com/logancyang/obsidian-copilot/issues/2889",
      (_source, arrange, expected) => {
        expect(destination(arrange())).toEqual(expected);
      }
    );
  });

  describe("ClaudeBackendDescriptor.checkExtensions()", () => {
    afterEach(() => jest.restoreAllMocks());

    it("checks a temporary Claude session in the requested folder and shuts it down without creating a chat", async () => {
      const runtime = {
        commands: ["review"],
        skills: ["notes"],
        plugins: null,
        failedPlugins: null,
        mcpServers: [],
      };
      const temporary = {
        newSession: jest.fn().mockResolvedValue({ sessionId: "extension-check" }),
        getExtensionRuntime: jest.fn().mockResolvedValue(runtime),
        shutdown: jest.fn().mockResolvedValue(undefined),
      };
      const plugin = {
        app: { vault: {} },
        manifest: { version: "4.0.0" },
      } as unknown as import("@/main").default;
      const create = jest
        .spyOn(ClaudeBackendDescriptor, "createBackendProcess")
        .mockReturnValue(temporary as unknown as BackendProcess);

      const result = await ClaudeBackendDescriptor.checkExtensions!({ plugin, cwd: "/project" });

      expect(result).toBe(runtime);
      expect(create).toHaveBeenCalledWith({
        plugin,
        app: plugin.app,
        clientVersion: "4.0.0",
        descriptor: ClaudeBackendDescriptor,
      });
      expect(temporary.newSession).toHaveBeenCalledWith({ cwd: "/project" });
      expect(temporary.getExtensionRuntime).toHaveBeenCalledWith({
        sessionId: "extension-check",
        startIfNeeded: true,
      });
      expect(temporary.shutdown).toHaveBeenCalledTimes(1);
    });
    it.each([{ kind: "user" as const }, { kind: "project" as const, cwd: "/selected-project" }])(
      "passes $kind scope to the temporary process without changing chat configuration",
      async (scope) => {
        const temporary = {
          newSession: jest.fn().mockResolvedValue({ sessionId: "extension-check" }),
          getExtensionRuntime: jest.fn().mockResolvedValue(null),
          shutdown: jest.fn().mockResolvedValue(undefined),
        };
        const plugin = {
          app: {},
          manifest: { version: "4.0.0" },
        } as unknown as import("@/main").default;
        const create = jest
          .spyOn(ClaudeBackendDescriptor, "createBackendProcess")
          .mockReturnValue(temporary as unknown as BackendProcess);

        await ClaudeBackendDescriptor.checkExtensions!({ plugin, cwd: "/selected-project", scope });

        expect(create).toHaveBeenCalledWith(expect.objectContaining({ configurationScope: scope }));
        expect(temporary.shutdown).toHaveBeenCalledTimes(1);
      }
    );

    it("shuts down the temporary process when the extension check fails", async () => {
      const temporary = {
        newSession: jest.fn().mockResolvedValue({ sessionId: "extension-check" }),
        getExtensionRuntime: jest.fn().mockRejectedValue(new Error("check failed")),
        shutdown: jest.fn().mockResolvedValue(undefined),
      };
      const plugin = {
        app: {},
        manifest: { version: "4.0.0" },
      } as unknown as import("@/main").default;
      jest
        .spyOn(ClaudeBackendDescriptor, "createBackendProcess")
        .mockReturnValue(temporary as unknown as BackendProcess);

      await expect(
        ClaudeBackendDescriptor.checkExtensions!({ plugin, cwd: "/project" })
      ).rejects.toThrow("check failed");

      expect(temporary.shutdown).toHaveBeenCalledTimes(1);
    });

    it.each(["session", "runtime"])(
      "cancels and closes the temporary process while awaiting %s initialization",
      async (phase) => {
        let release!: () => void;
        let markStarted!: () => void;
        const pending = new Promise<void>((resolve) => {
          release = resolve;
        });
        const started = new Promise<void>((resolve) => {
          markStarted = resolve;
        });
        const temporary = {
          newSession: jest.fn(async () => {
            if (phase === "session") {
              markStarted();
              await pending;
            }
            return { sessionId: "extension-check" };
          }),
          getExtensionRuntime: jest.fn(async () => {
            if (phase === "runtime") {
              markStarted();
              await pending;
            }
            return null;
          }),
          shutdown: jest.fn().mockResolvedValue(undefined),
        };
        const plugin = {
          app: {},
          manifest: { version: "4.0.0" },
        } as unknown as import("@/main").default;
        jest
          .spyOn(ClaudeBackendDescriptor, "createBackendProcess")
          .mockReturnValue(temporary as unknown as BackendProcess);
        const controller = new AbortController();
        const check = ClaudeBackendDescriptor.checkExtensions!({
          plugin,
          cwd: "/project",
          signal: controller.signal,
        });
        const cancelled = expect(check).rejects.toMatchObject({ name: "AbortError" });
        await started;

        controller.abort();
        expect(temporary.shutdown).toHaveBeenCalledTimes(1);
        release();
        await cancelled;

        expect(temporary.shutdown).toHaveBeenCalledTimes(1);
        if (phase === "session") expect(temporary.getExtensionRuntime).not.toHaveBeenCalled();
      }
    );

    it("does not create a temporary process when the check has already been cancelled", async () => {
      const create = jest.spyOn(ClaudeBackendDescriptor, "createBackendProcess");
      const controller = new AbortController();
      controller.abort();
      const plugin = {} as import("@/main").default;

      await expect(
        ClaudeBackendDescriptor.checkExtensions!({
          plugin,
          cwd: "/project",
          signal: controller.signal,
        })
      ).rejects.toMatchObject({ name: "AbortError" });

      expect(create).not.toHaveBeenCalled();
    });

    it("returns the still-connecting snapshot and shuts the session down when no update listener is attached (https://github.com/ItsDalk-Lane/Scribe/issues/3)", async () => {
      const pendingRuntime = {
        commands: [],
        skills: null,
        plugins: null,
        failedPlugins: null,
        mcpServers: [{ name: "zread", status: "pending" }],
      };
      const temporary = {
        newSession: jest.fn().mockResolvedValue({ sessionId: "extension-check" }),
        getExtensionRuntime: jest.fn().mockResolvedValue(pendingRuntime),
        shutdown: jest.fn().mockResolvedValue(undefined),
      };
      const plugin = {
        app: {},
        manifest: { version: "4.0.0" },
      } as unknown as import("@/main").default;
      jest
        .spyOn(ClaudeBackendDescriptor, "createBackendProcess")
        .mockReturnValue(temporary as unknown as BackendProcess);

      const result = await ClaudeBackendDescriptor.checkExtensions!({ plugin, cwd: "/project" });

      expect(result).toBe(pendingRuntime);
      expect(temporary.getExtensionRuntime).toHaveBeenCalledTimes(1);
      expect(temporary.shutdown).toHaveBeenCalledTimes(1);
    });

    it("keeps the session only while an update listener settles the pending servers (https://github.com/ItsDalk-Lane/Scribe/issues/3)", async () => {
      jest.useFakeTimers();
      try {
        const pendingRuntime = {
          commands: [],
          skills: null,
          plugins: null,
          failedPlugins: null,
          mcpServers: [{ name: "zread", status: "pending" }],
        };
        const temporary = {
          newSession: jest.fn().mockResolvedValue({ sessionId: "extension-check" }),
          getExtensionRuntime: jest.fn().mockResolvedValue(pendingRuntime),
          getMcpServerStatus: jest.fn().mockResolvedValue([{ name: "zread", status: "pending" }]),
          shutdown: jest.fn().mockResolvedValue(undefined),
        };
        const plugin = {
          app: {},
          manifest: { version: "4.0.0" },
        } as unknown as import("@/main").default;
        jest
          .spyOn(ClaudeBackendDescriptor, "createBackendProcess")
          .mockReturnValue(temporary as unknown as BackendProcess);
        const onUpdate = jest.fn();

        const result = await ClaudeBackendDescriptor.checkExtensions!({
          plugin,
          cwd: "/project",
          onUpdate,
        });

        expect(result).toBe(pendingRuntime);
        expect(temporary.shutdown).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(MCP_SETTLE_TIMEOUT_MS);
        expect(temporary.getExtensionRuntime).toHaveBeenCalledTimes(1);
        expect(temporary.getMcpServerStatus).toHaveBeenCalledTimes(
          MCP_SETTLE_TIMEOUT_MS / MCP_SETTLE_POLL_MS
        );
        expect(temporary.shutdown).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("patches only the server statuses into the confirmed snapshot, keeping the loaded plugins the initial check saw (https://github.com/ItsDalk-Lane/Scribe/issues/3)", async () => {
      jest.useFakeTimers();
      try {
        const pendingRuntime = {
          commands: ["review"],
          skills: ["notes"],
          plugins: [{ name: "ponytail", path: "/plugins/ponytail" }],
          failedPlugins: null,
          mcpServers: [{ name: "zread", status: "pending" }],
        };
        const temporary = {
          newSession: jest.fn().mockResolvedValue({ sessionId: "extension-check" }),
          getExtensionRuntime: jest.fn().mockResolvedValue(pendingRuntime),
          getMcpServerStatus: jest
            .fn()
            .mockResolvedValue([{ name: "zread", status: "connected", toolCount: 3 }]),
          shutdown: jest.fn().mockResolvedValue(undefined),
        };
        const plugin = {
          app: {},
          manifest: { version: "4.0.0" },
        } as unknown as import("@/main").default;
        jest
          .spyOn(ClaudeBackendDescriptor, "createBackendProcess")
          .mockReturnValue(temporary as unknown as BackendProcess);
        const onUpdate = jest.fn();

        const result = await ClaudeBackendDescriptor.checkExtensions!({
          plugin,
          cwd: "/project",
          onUpdate,
        });
        expect(result).toBe(pendingRuntime);

        await jest.advanceTimersByTimeAsync(MCP_SETTLE_POLL_MS);

        expect(onUpdate).toHaveBeenCalledWith({
          commands: ["review"],
          skills: ["notes"],
          plugins: [{ name: "ponytail", path: "/plugins/ponytail" }],
          failedPlugins: null,
          mcpServers: [{ name: "zread", status: "connected", toolCount: 3 }],
        });
        expect(temporary.shutdown).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("marks pending servers unconfirmed when a status read fails", async () => {
      jest.useFakeTimers();
      try {
        const pendingRuntime = {
          commands: [],
          skills: null,
          plugins: null,
          failedPlugins: null,
          mcpServers: [{ name: "slow", status: "pending" }],
        };
        const temporary = {
          newSession: jest.fn().mockResolvedValue({ sessionId: "extension-check" }),
          getExtensionRuntime: jest.fn().mockResolvedValue(pendingRuntime),
          getMcpServerStatus: jest.fn().mockRejectedValue(new Error("query closed")),
          shutdown: jest.fn().mockResolvedValue(undefined),
        };
        const plugin = {
          app: {},
          manifest: { version: "4.0.0" },
        } as unknown as import("@/main").default;
        jest
          .spyOn(ClaudeBackendDescriptor, "createBackendProcess")
          .mockReturnValue(temporary as unknown as BackendProcess);
        const onUpdate = jest.fn();

        await ClaudeBackendDescriptor.checkExtensions!({ plugin, cwd: "/project", onUpdate });
        await jest.advanceTimersByTimeAsync(MCP_SETTLE_POLL_MS);

        expect(onUpdate).toHaveBeenCalledWith({
          commands: [],
          skills: null,
          plugins: null,
          failedPlugins: null,
          mcpServers: [{ name: "slow", status: "unconfirmed" }],
        });
        expect(temporary.shutdown).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });

    it("marks a server that never connects unconfirmed when the settle window closes (https://github.com/ItsDalk-Lane/Scribe/issues/3)", async () => {
      jest.useFakeTimers();
      try {
        const pendingRuntime = {
          commands: [],
          skills: null,
          plugins: null,
          failedPlugins: null,
          mcpServers: [{ name: "slow", status: "pending" }],
        };
        const temporary = {
          newSession: jest.fn().mockResolvedValue({ sessionId: "extension-check" }),
          getExtensionRuntime: jest.fn().mockResolvedValue(pendingRuntime),
          getMcpServerStatus: jest.fn().mockResolvedValue([{ name: "slow", status: "pending" }]),
          shutdown: jest.fn().mockResolvedValue(undefined),
        };
        const plugin = {
          app: {},
          manifest: { version: "4.0.0" },
        } as unknown as import("@/main").default;
        jest
          .spyOn(ClaudeBackendDescriptor, "createBackendProcess")
          .mockReturnValue(temporary as unknown as BackendProcess);
        const onUpdate = jest.fn();

        await ClaudeBackendDescriptor.checkExtensions!({ plugin, cwd: "/project", onUpdate });
        await jest.advanceTimersByTimeAsync(MCP_SETTLE_TIMEOUT_MS);

        expect(onUpdate).toHaveBeenCalledWith({
          commands: [],
          skills: null,
          plugins: null,
          failedPlugins: null,
          mcpServers: [{ name: "slow", status: "unconfirmed" }],
        });
        expect(temporary.shutdown).toHaveBeenCalledTimes(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe("ClaudeBackendDescriptor.createBackendProcess()", () => {
    afterEach(() => {
      resetSettings();
      __resetVaultBaseCache();
    });

    it("refuses to create a process while Claude Code is disabled", () => {
      resetSettings();
      updateClaudeFields({ enabled: false });
      expect(() =>
        ClaudeBackendDescriptor.createBackendProcess({
          plugin: {} as never,
          app: {} as App,
          clientVersion: "test",
          descriptor: ClaudeBackendDescriptor,
        })
      ).toThrow("disabled");
    });

    it("https://github.com/Brevilabs/obsidian-copilot-private/issues/736 hands global and Project sessions only the active vault's managed env", async () => {
      resetSettings();
      __resetVaultBaseCache();
      mockResolveClaudeBinary.mockReturnValue("/usr/local/bin/claude");
      setSettings({
        agentMode: {
          byok: {},
          activeBackend: "claude",
          debugFullFrames: false,
          offerFeedbackCards: true,
          notificationSound: false,
          notificationSoundId: "piano",
          welcomeDismissed: false,
          skills: { folder: "copilot/skills" },
          backends: {},
        },
      });
      const adapter = Object.create(FileSystemAdapter.prototype) as FileSystemAdapter;
      adapter.getBasePath = () => "/active-vault";
      const app = { vault: { adapter, getName: () => "active-vault" } } as unknown as App;

      const process = ClaudeBackendDescriptor.createBackendProcess({
        plugin: {} as never,
        app,
        clientVersion: "4.0.0",
        descriptor: ClaudeBackendDescriptor,
      }) as unknown as {
        opts: {
          getEnvOverrides?: () => Record<string, string> | undefined;
          getManagedEnv?: () => Promise<Readonly<Record<string, string>>>;
        };
      };

      const env = await process.opts.getManagedEnv?.();
      expect(env).toEqual({});
    });
  });

  describe("ClaudeBackendDescriptor.applyInitialSessionConfig()", () => {
    afterEach(() => jest.restoreAllMocks());
    it("uses the chat's explicit reasoning choice and ignores the obsolete settings default", async () => {
      jest.spyOn(ClaudeBackendDescriptor.wire, "effortConfigFor").mockReturnValue({
        id: "effort",
        type: "select",
        name: "Effort",
        currentValue: "low",
        options: [
          { value: "low", name: "Low" },
          { value: "high", name: "High" },
        ],
      });
      const setConfigOption = jest.fn(async () => undefined);
      const session = {
        getState: () => ({
          model: {
            current: { baseModelId: "sonnet", effort: "low" },
            availableModels: [
              {
                baseModelId: "sonnet",
                effortOptions: [
                  { value: "low", label: "Low" },
                  { value: "high", label: "High" },
                ],
              },
            ],
          },
        }),
        setConfigOption,
      } as unknown as AgentSession;
      const settings = settingsWithClaudeRuntime({});
      settings.agentMode.backends.claude!.defaultModel = { baseModelId: "sonnet", effort: "high" };
      await ClaudeBackendDescriptor.applyInitialSessionConfig!(session, settings);
      expect(setConfigOption).not.toHaveBeenCalled();
      await ClaudeBackendDescriptor.applyInitialSessionConfig!(session, settings, {
        baseModelId: "sonnet",
        effort: "high",
      });
      expect(setConfigOption).toHaveBeenCalledWith("effort", "high");
    });
  });

  describe("getClaudeInstallState()", () => {
    it("returns a stable absent state when no executable resolves", () => {
      mockResolveClaudeBinary.mockReturnValue(null);

      const first = getClaudeInstallState(settingsWithClaudeRuntime({}));

      expect(first).toEqual({ kind: "absent" });
      expect(getClaudeInstallState(settingsWithClaudeRuntime({}))).toBe(first);
    });

    it("reports checking for an executable that has not been probed yet", () => {
      mockResolveClaudeBinary.mockReturnValue("/unprobed/claude");

      expect(
        getClaudeInstallState(settingsWithClaudeRuntime({ path: "/unprobed/claude" }))
      ).toEqual({ kind: "checking", source: "custom" });
    });

    it("returns the probed state regardless of the order of environment overrides", async () => {
      mockResolveClaudeBinary.mockReturnValue("/ordered/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      await refreshClaudeInstallState(
        settingsWithClaudeRuntime({
          path: "/ordered/claude",
          envOverrides: { ZED: "last", ALPHA: "first" },
        })
      );

      expect(
        getClaudeInstallState(
          settingsWithClaudeRuntime({
            path: "/ordered/claude",
            envOverrides: { ALPHA: "first", ZED: "last" },
          })
        )
      ).toEqual({ kind: "ready", source: "custom", version: "2.1.206" });
    });

    it("reports checking again when the environment overrides change for the same executable", async () => {
      mockResolveClaudeBinary.mockReturnValue("/env-keyed/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      await refreshClaudeInstallState(
        settingsWithClaudeRuntime({ path: "/env-keyed/claude", envOverrides: { PROFILE: "a" } })
      );

      expect(
        getClaudeInstallState(
          settingsWithClaudeRuntime({ path: "/env-keyed/claude", envOverrides: { PROFILE: "b" } })
        )
      ).toEqual({ kind: "checking", source: "custom" });
    });
  });

  describe("refreshClaudeInstallState()", () => {
    it("returns absent without probing when no executable resolves", async () => {
      mockResolveClaudeBinary.mockReturnValue(null);

      await expect(refreshClaudeInstallState(settingsWithClaudeRuntime({}), true)).resolves.toEqual(
        { kind: "absent" }
      );
      expect(mockProbeClaudeVersion).not.toHaveBeenCalled();
    });

    it("probes the managed executable and publishes a ready state for a supported version", async () => {
      mockResolveClaudeBinary.mockReturnValue("/managed/bin/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      const settings = settingsWithClaudeRuntime({});

      await expect(refreshClaudeInstallState(settings, true)).resolves.toEqual({
        kind: "ready",
        source: "managed",
        version: "2.1.206",
      });
      expect(getClaudeInstallState(settings)).toEqual({
        kind: "ready",
        source: "managed",
        version: "2.1.206",
      });
    });

    it("reuses the cached state unless a forced refresh is requested", async () => {
      mockResolveClaudeBinary.mockReturnValue("/forced/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      const settings = settingsWithClaudeRuntime({ path: "/forced/claude" });

      await refreshClaudeInstallState(settings);
      await refreshClaudeInstallState(settings);
      expect(mockProbeClaudeVersion).toHaveBeenCalledTimes(1);

      await refreshClaudeInstallState(settings, true);
      expect(mockProbeClaudeVersion).toHaveBeenCalledTimes(2);
    });
  });

  describe("subscribeClaudeInstallState()", () => {
    it("notifies the listener of install state changes until it unsubscribes", async () => {
      mockResolveClaudeBinary.mockReturnValue("/subscribed/claude");
      mockProbeClaudeVersion.mockResolvedValue({ kind: "supported", version: "2.1.206" });
      const listener = jest.fn();
      const unsubscribe = subscribeClaudeInstallState(listener);

      await refreshClaudeInstallState(settingsWithClaudeRuntime({ path: "/subscribed/claude" }));
      expect(listener).toHaveBeenCalled();

      listener.mockClear();
      unsubscribe();
      await refreshClaudeInstallState(
        settingsWithClaudeRuntime({ path: "/subscribed/claude" }),
        true
      );
      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe("ClaudeBackendDescriptor.applySelection()", () => {
    function makeSession(currentBaseModelId: string): {
      session: AgentSession;
      applyModelWireId: jest.Mock;
    } {
      const state: BackendState = {
        model: {
          current: { baseModelId: currentBaseModelId, effort: null },
          availableModels: [],
          apply: { kind: "setModel" },
        },
        mode: null,
      };
      const applyModelWireId = jest.fn(async () => undefined);
      return {
        session: {
          getState: () => state,
          applyModelWireId,
        } as unknown as AgentSession,
        applyModelWireId,
      };
    }

    it.each([null, "removed", "high"])(
      "https://github.com/Brevilabs/obsidian-copilot-private/issues/219 applies a concrete effort for preference %p",
      async (effort) => {
        const spy = jest.spyOn(ClaudeBackendDescriptor.wire, "effortConfigFor").mockReturnValue({
          id: "effort",
          type: "select",
          name: "Effort",
          currentValue: "high",
          options: [
            { value: "low", name: "Low" },
            { value: "high", name: "High" },
          ],
        });
        const setConfigOption = jest.fn();
        const session = {
          getState: () => ({
            model: {
              current: { baseModelId: "sonnet", effort: "high" },
              availableModels: [
                {
                  baseModelId: "sonnet",
                  effortOptions: [
                    { value: "high", label: "High" },
                    { value: "low", label: "Low" },
                  ],
                },
              ],
            },
          }),
          setConfigOption,
        } as unknown as AgentSession;
        try {
          await ClaudeBackendDescriptor.applySelection(session, { baseModelId: "sonnet", effort });
          expect(setConfigOption).toHaveBeenCalledWith(
            "effort",
            effort === "high" ? "high" : "low"
          );
        } finally {
          spy.mockRestore();
        }
      }
    );

    it("skips the model write for an ordinary same-model selection", async () => {
      const { session, applyModelWireId } = makeSession("sonnet");

      await ClaudeBackendDescriptor.applySelection(session, {
        baseModelId: "sonnet",
        effort: null,
      });

      expect(applyModelWireId).not.toHaveBeenCalled();
    });
  });

  describe("resolveClaudeAutoModePermission()", () => {
    it("falls back to Claude's classifier mode when nothing is persisted", () => {
      expect(resolveClaudeAutoModePermission({ agentMode: {} } as CopilotSettings)).toBe("auto");
    });

    it("returns the persisted permission mode", () => {
      const settings = {
        agentMode: { backends: { claude: { autoModePermission: "acceptEdits" } } },
      } as unknown as CopilotSettings;

      expect(resolveClaudeAutoModePermission(settings)).toBe("acceptEdits");
    });
  });

  describe("ClaudeBackendDescriptor.getModeMapping()", () => {
    afterEach(() => {
      resetSettings();
    });

    it("points the auto pill at Claude's classifier mode by default", () => {
      resetSettings();

      expect(ClaudeBackendDescriptor.getModeMapping?.(null, null)).toEqual({
        kind: "setMode",
        canonical: { default: "default", plan: "plan", auto: "auto" },
      });
    });

    it("points the auto pill at the user's configured permission mode", () => {
      updateClaudeFields({ autoModePermission: "bypassPermissions" });

      expect(ClaudeBackendDescriptor.getModeMapping?.(null, null)?.canonical.auto).toBe(
        "bypassPermissions"
      );
    });
  });
});
