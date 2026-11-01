import { ClaudeExtensionManager, type ClaudeExtensionFs } from "./extensionManagement";
import type { AgentExtensionScope } from "@/agentMode/session/extensionManagement";
import { discoverClaudeExtensions } from "./discoverExtensions";

const USER: AgentExtensionScope = { kind: "user" };
const PROJECT: AgentExtensionScope = { kind: "project", cwd: "/vault" };

function fixture(initial: Record<string, string> = {}) {
  const files = new Map(Object.entries(initial));
  const missing = () => Object.assign(new Error("missing"), { code: "ENOENT" });
  const io: ClaudeExtensionFs = {
    read: async (path) => {
      if (!files.has(path)) throw missing();
      return files.get(path)!;
    },
    list: async (path) => {
      const keys = [...files.keys()].filter((file) => file.startsWith(`${path}/`));
      if (!keys.length) throw missing();
      return [...new Set(keys.map((file) => file.slice(path.length + 1).split("/")[0]))].sort();
    },
    realpath: async (path) => path,
    write: async (path, content) => {
      files.set(path, content);
    },
    mkdir: async () => {},
    rename: async (from, to) => {
      const entries = [...files.entries()].filter(
        ([file]) => file === from || file.startsWith(`${from}/`)
      );
      if (!entries.length) throw missing();
      for (const [file, content] of entries) {
        files.set(to + file.slice(from.length), content);
        files.delete(file);
      }
    },
    remove: async (path) => {
      files.delete(path);
    },
  };
  const run = jest.fn(async () => "installed");
  const manager = new ClaudeExtensionManager({
    home: "/home",
    cwd: "/vault",
    env: {},
    io,
    run,
    binaryPath: "/bin/claude",
  });
  return { files, io, run, manager };
}

function config(files: Map<string, string>, path: string) {
  return JSON.parse(files.get(path)!);
}

const markdown = (name: string) =>
  `---\nname: ${name}\ndescription: Helps with notes\ncustom: preserved\n---\nRead the notes`;

describe("extensionManagement", () => {
  describe("ClaudeExtensionManager", () => {
    describe("list()", () => {
      it("resolves a relative Claude config directory against the query folder or home and uses the same directory for discovery, writes and CLI operations", async () => {
        const { io, files, run } = fixture({
          "/vault/profile/commands/review.md": "Project profile command",
          "/home/profile/commands/review.md": "Home profile command",
        });
        for (const cwd of ["/vault", null]) {
          const base = cwd ?? "/home";
          const input = {
            home: "/home",
            cwd,
            env: { CLAUDE_CONFIG_DIR: "profile", EXTRA: "kept" },
            io,
            run,
            binaryPath: "/bin/claude",
          };
          const manager = new ClaudeExtensionManager(input);
          const direct = await discoverClaudeExtensions({ ...input, fs: io });
          expect(direct.find((group) => group.kind === "command")!.items[0]?.target?.path).toBe(
            `${base}/profile/commands/review.md`
          );
          expect((await manager.list("command", USER))[0]?.target?.path).toBe(
            `${base}/profile/commands/review.md`
          );
          await manager.save({
            kind: "mcp",
            scope: USER,
            name: "notes",
            config: { command: "server" },
          });
          expect(config(files, `${base}/profile/.claude.json`).mcpServers.notes).toEqual({
            command: "server",
          });
          await manager.pluginAction({ action: "install", scope: USER, plugin: "notes@team" });
          expect(run).toHaveBeenLastCalledWith(
            "/bin/claude",
            ["plugin", "install", "notes@team", "--scope", "user"],
            undefined,
            { CLAUDE_CONFIG_DIR: `${base}/profile`, EXTRA: "kept" }
          );
          expect(input.env.CLAUDE_CONFIG_DIR).toBe("profile");
        }
      });
      it("uses the selected project's explicit plugin overrides without changing the user view", async () => {
        const { manager } = fixture({
          "/home/.claude/settings.json": JSON.stringify({ enabledPlugins: { "notes@team": true } }),
          "/vault/.claude/settings.json": JSON.stringify({
            enabledPlugins: { "notes@team": false },
          }),
          "/home/.claude/plugins/installed_plugins.json": JSON.stringify({
            plugins: { "notes@team": [{ scope: "user", installPath: "/plugin" }] },
          }),
          "/plugin/.claude-plugin/plugin.json": '{"name":"notes"}',
          "/plugin/agents/check.md": markdown("check"),
        });
        expect((await manager.list("plugin", USER))[0]).toMatchObject({
          enabled: true,
          target: { scope: USER },
        });
        expect((await manager.list("subagent", PROJECT))[0]).toMatchObject({
          enabled: false,
          parentPluginId: "notes@team",
          target: { scope: PROJECT },
        });
      });
      it("keeps user and project rows separate and carries exact plugin ownership and disabled state", async () => {
        const { manager } = fixture({
          "/home/.claude/agents/user.md": markdown("user"),
          "/vault/.claude/agents/project.md": markdown("project"),
          "/home/.claude/settings.json": JSON.stringify({
            enabledPlugins: { "notes@team": false },
          }),
          "/home/.claude/plugins/installed_plugins.json": JSON.stringify({
            plugins: { "notes@team": [{ scope: "user", installPath: "/plugin" }] },
          }),
          "/plugin/.claude-plugin/plugin.json": JSON.stringify({
            name: "notes",
            mcpServers: { docs: { command: "private" } },
          }),
          "/plugin/agents/check.md": markdown("check"),
        });
        const user = await manager.list("subagent", USER),
          project = await manager.list("subagent", PROJECT);
        expect(user.map((item) => item.name)).toEqual(["user", "check"]);
        expect(project.map((item) => item.name)).toEqual(["project"]);
        expect(user[1]).toMatchObject({
          parentPluginId: "notes@team",
          enabled: false,
          readOnly: true,
          capabilities: { edit: false, delete: false, toggle: false },
        });
        expect((await manager.list("mcp", USER))[0]).toMatchObject({
          parentPluginId: "notes@team",
          target: { scope: USER },
        });
      });
    });
    describe("details()", () => {
      it.each(["command", "http", "prompt", "agent"])(
        "reports valid trigger events for %s hooks",
        async (type) => {
          const { manager } = fixture({
            "/vault/.claude/settings.json": JSON.stringify({
              hooks: {
                Stop: [
                  {
                    hooks: [
                      {
                        type,
                        command: "echo ok",
                        prompt: "Check",
                        url: "https://example.com/hook",
                      },
                    ],
                  },
                ],
              },
            }),
          });
          const details = await manager.details((await manager.list("hook", PROJECT))[0]);
          expect(details.hookEvents).toContain("Stop");
          expect(details.hookEvents?.includes("SessionStart")).toBe(type === "command");
          expect(details.hookEvents?.includes("PermissionRequest")).toBe(type !== "agent");
          expect(details.hookEvents?.includes("Notification")).toBe(
            type === "command" || type === "http"
          );
        }
      );
      it("returns editable fields with a conflict token and reports invalid or removed configuration", async () => {
        const { manager, files } = fixture({
          "/vault/.mcp.json": JSON.stringify({
            mcpServers: {
              docs: {
                type: "http",
                url: "https://docs.example/mcp",
                headers: { Authorization: "private" },
                future: 7,
              },
            },
          }),
        });
        const item = (await manager.list("mcp", PROJECT))[0];
        expect(await manager.details(item)).toMatchObject({
          revision: expect.any(String),
          config: { future: 7, headers: { Authorization: "private" } },
        });
        files.set("/vault/.mcp.json", "invalid");
        await expect(manager.details(item)).rejects.toThrow("格式");
        files.delete("/vault/.mcp.json");
        await expect(manager.details(item)).rejects.toThrow("不存在");
      });
    });
    describe("save()", () => {
      it.each([
        { type: "prompt", prompt: "" },
        { type: "agent", prompt: " " },
        { type: "http", url: "file:///tmp/unsafe" },
        { type: "http", url: "invalid" },
        { type: "unknown", command: "echo unchanged" },
        { type: "command", command: "echo unchanged", timeout: -1 },
        { type: "prompt", prompt: "Check", event: "SessionStart" },
        { type: "agent", prompt: "Check", event: "PermissionRequest" },
        { type: "http", url: "https://example.com/hook", event: "SessionStart" },
      ])("rejects invalid $type hooks without changing the original file", async (invalid) => {
        const file = "/vault/.claude/settings.json";
        const before = JSON.stringify({
          hooks: { Stop: [{ hooks: [{ type: "command", command: "echo original" }] }] },
        });
        const { manager, files } = fixture({ [file]: before });
        const original = await manager.details((await manager.list("hook", PROJECT))[0]);
        await expect(
          manager.save({ kind: "hook", scope: PROJECT, name: "Stop", original, config: invalid })
        ).rejects.toThrow();
        expect(files.get(file)).toBe(before);
      });
      it("does not introduce a model or tools when editing a subagent without overrides", async () => {
        const file = "/vault/.claude/agents/review.md";
        const { manager, files } = fixture({ [file]: markdown("review") });
        const original = await manager.details((await manager.list("subagent", PROJECT))[0]);
        await manager.save({
          kind: "subagent",
          scope: PROJECT,
          name: "review",
          original,
          content: "New instructions",
          config: { ...original.config, description: "After", model: undefined, tools: undefined },
        });
        const saved = await manager.details((await manager.list("subagent", PROJECT))[0]);
        expect(saved.config).toMatchObject({ description: "After", custom: "preserved" });
        expect(saved.config).not.toHaveProperty("model");
        expect(saved.config).not.toHaveProperty("tools");
        expect(files.get(file)).toContain("New instructions");
      });
      it.each([
        { type: "prompt", prompt: "Check the result", model: "haiku" },
        { type: "agent", prompt: "Review the result", tools: ["Read"] },
        {
          type: "http",
          url: "https://example.com/hook",
          headers: { Authorization: "Bearer $TOKEN" },
          allowedEnvVars: ["TOKEN"],
        },
      ])("preserves a $type hook through editing, disabling and restoring", async (hook) => {
        const file = "/vault/.claude/settings.json";
        const { manager, files } = fixture({
          [file]: JSON.stringify({ hooks: { Stop: [{ hooks: [hook] }] } }),
        });
        const original = await manager.details((await manager.list("hook", PROJECT))[0]);
        await manager.save({
          kind: "hook",
          scope: PROJECT,
          name: "Stop",
          original,
          config: { timeout: 15 },
        });
        expect(config(files, file).hooks.Stop[0].hooks).toEqual([{ ...hook, timeout: 15 }]);
        await manager.toggle(
          await manager.details((await manager.list("hook", PROJECT))[0]),
          false
        );
        const disabled = await manager.details((await manager.list("hook", PROJECT))[0]);
        await manager.save({
          kind: "hook",
          scope: PROJECT,
          name: "Stop",
          original: disabled,
          config: { timeout: 25 },
        });
        await manager.toggle(await manager.details((await manager.list("hook", PROJECT))[0]), true);
        expect(
          config(files, file).hooks.Stop.flatMap((group: { hooks: unknown[] }) => group.hooks)
        ).toEqual([{ ...hook, timeout: 25 }]);
      });
      it("changes only the selected hook matcher and keeps sibling hooks on their original matcher", async () => {
        const { manager, files } = fixture({
          "/vault/.claude/settings.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  future: 8,
                  hooks: [
                    { type: "command", command: "first" },
                    { type: "command", command: "second" },
                  ],
                },
              ],
            },
          }),
        });
        const original = await manager.details((await manager.list("hook", PROJECT))[0]);
        await manager.save({
          kind: "hook",
          scope: PROJECT,
          name: "PreToolUse",
          original,
          config: { matcher: "Read" },
        });
        expect(config(files, "/vault/.claude/settings.json").hooks.PreToolUse).toEqual([
          { matcher: "Bash", future: 8, hooks: [{ type: "command", command: "second" }] },
          { matcher: "Read", future: 8, hooks: [{ type: "command", command: "first" }] },
        ]);
      });
      it("moves skill support files with a renamed skill and renames both active and disabled MCP keys", async () => {
        const { manager, files } = fixture({
          "/vault/.claude/skills/old/SKILL.md": markdown("old"),
          "/vault/.claude/skills/old/scripts/read.js": "support",
          "/vault/.mcp.json": JSON.stringify({
            mcpServers: { old: { command: "server", future: 8 } },
          }),
        });
        const skill = await manager.details((await manager.list("skill", PROJECT))[0]);
        await manager.save({
          kind: "skill",
          scope: PROJECT,
          name: "new",
          original: skill,
          content: skill.content,
        });
        expect(files.get("/vault/.claude/skills/new/scripts/read.js")).toBe("support");
        expect(files.has("/vault/.claude/skills/old/SKILL.md")).toBe(false);
        await manager.save({
          kind: "mcp",
          scope: PROJECT,
          name: "next",
          original: await manager.details((await manager.list("mcp", PROJECT))[0]),
        });
        expect(config(files, "/vault/.mcp.json").mcpServers).toEqual({
          next: { command: "server", future: 8 },
        });
        await manager.toggle(await manager.details((await manager.list("mcp", PROJECT))[0]), false);
        await manager.save({
          kind: "mcp",
          scope: PROJECT,
          name: "final",
          original: await manager.details((await manager.list("mcp", PROJECT))[0]),
        });
        const disabled = (await manager.list("mcp", PROJECT))[0];
        expect(disabled.name).toBe("final");
        await manager.toggle(await manager.details(disabled), true);
        expect(config(files, "/vault/.mcp.json").mcpServers).toEqual({
          final: { command: "server", future: 8 },
        });
      });
      it("edits JSONC locally without removing comments, unknown keys, or unseen server fields", async () => {
        const { manager, files } = fixture({
          "/vault/.mcp.json":
            '{\n// keep\n"future":8,"mcpServers":{"docs":{"type":"http","url":"https://old.example","headers":{"Authorization":"private"},"future":9}}}',
        });
        const details = await manager.details((await manager.list("mcp", PROJECT))[0]);
        await manager.save({
          kind: "mcp",
          scope: PROJECT,
          name: "docs",
          original: details,
          config: { url: "https://new.example" },
        });
        expect(files.get("/vault/.mcp.json")).toContain("// keep");
        expect(files.get("/vault/.mcp.json")).toContain('"future":8');
        expect((await manager.details((await manager.list("mcp", PROJECT))[0])).config).toEqual({
          type: "http",
          url: "https://new.example",
          headers: { Authorization: "private" },
          future: 9,
        });
      });
      it("creates scoped Markdown skills and agents while preserving supplied metadata and allowing name changes", async () => {
        const { manager, files } = fixture();
        await manager.save({
          kind: "skill",
          scope: USER,
          name: "review",
          content: markdown("review"),
        });
        expect(files.has("/home/.claude/skills/review/SKILL.md")).toBe(true);
        await manager.save({
          kind: "subagent",
          scope: PROJECT,
          name: "check",
          content: "Read notes",
          config: { description: "Checks notes", tools: "Read, Grep" },
        });
        const details = await manager.details((await manager.list("subagent", PROJECT))[0]);
        await manager.save({
          kind: "subagent",
          scope: PROJECT,
          name: "verify",
          content: details.content,
          original: details,
        });
        expect(files.has("/vault/.claude/agents/check.md")).toBe(false);
        expect(files.get("/vault/.claude/agents/verify.md")).toContain("tools: Read, Grep");
      });
      it("adds multiple hooks for the same event and stores matcher at the group level", async () => {
        const { manager, files } = fixture();
        await manager.save({
          kind: "hook",
          scope: PROJECT,
          name: "PreToolUse",
          config: { type: "command", command: "first", timeout: 20, matcher: "Read" },
        });
        await manager.save({
          kind: "hook",
          scope: PROJECT,
          name: "PreToolUse",
          config: { type: "command", command: "second", timeout: 40, matcher: "Bash" },
        });
        expect(config(files, "/vault/.claude/settings.json").hooks.PreToolUse).toEqual([
          { matcher: "Read", hooks: [{ type: "command", command: "first", timeout: 20 }] },
          { matcher: "Bash", hooks: [{ type: "command", command: "second", timeout: 40 }] },
        ]);
      });
      it("rejects stale revisions, source changes, collisions, traversal, and symlink write targets without altering files", async () => {
        const { manager, files, io } = fixture({
          "/vault/.mcp.json": JSON.stringify({ mcpServers: { docs: { command: "original" } } }),
        });
        const details = await manager.details((await manager.list("mcp", PROJECT))[0]);
        files.set("/vault/.mcp.json", '{"mcpServers":{"docs":{"command":"external"}}}');
        await expect(
          manager.save({
            kind: "mcp",
            scope: PROJECT,
            name: "docs",
            original: details,
            config: { command: "overwrite" },
          })
        ).rejects.toThrow("其他程序");
        await expect(
          manager.save({ kind: "mcp", scope: USER, name: "docs", original: details })
        ).rejects.toThrow("来源");
        await expect(
          manager.save({ kind: "command", scope: PROJECT, name: "../escape", content: "bad" })
        ).rejects.toThrow("名称");
        io.realpath = async (path) =>
          path === "/vault/.claude/commands/review.md" ? "/elsewhere/review.md" : path;
        await expect(
          manager.save({ kind: "command", scope: PROJECT, name: "review", content: "bad" })
        ).rejects.toThrow("链接");
        expect(files.get("/vault/.mcp.json")).toContain("external");
      });
    });
    describe("toggle()", () => {
      it.each([undefined, JSON.stringify({ future: { retained: true } })])(
        "reads installed plugin metadata and safely creates its exact enable preference when the initial settings are %p",
        async (initial) => {
          const settingsPath = "/home/.claude/settings.json";
          const { manager, files, run } = fixture({
            "/home/.claude/plugins/installed_plugins.json": JSON.stringify({
              plugins: { "notes@team": [{ scope: "user", installPath: "/plugin" }] },
            }),
            "/plugin/.claude-plugin/plugin.json": '{"name":"notes"}',
            ...(initial === undefined ? {} : { [settingsPath]: initial }),
          });
          const item = (await manager.list("plugin", USER))[0];
          expect(item.availability).toBeUndefined();
          const original = await manager.details(item);
          expect(original).toMatchObject({
            item: { location: "/plugin" },
            config: {},
            revision: expect.any(String),
          });
          files.set(settingsPath, JSON.stringify({ external: "keep" }));
          await expect(manager.toggle(original, false)).rejects.toThrow("其他程序");
          expect(config(files, settingsPath)).toEqual({ external: "keep" });
          if (initial === undefined) files.delete(settingsPath);
          else files.set(settingsPath, initial);
          await manager.toggle(await manager.details(item), false);
          expect(config(files, settingsPath)).toEqual({
            ...(initial ? JSON.parse(initial) : {}),
            enabledPlugins: { "notes@team": false },
          });
          await manager.toggle(
            await manager.details((await manager.list("plugin", USER))[0]),
            true
          );
          expect(config(files, settingsPath).enabledPlugins["notes@team"]).toBe(true);
          expect(run).not.toHaveBeenCalled();
        }
      );
      it("retains both the stopped hook and an active sibling after array indexes shift", async () => {
        const { manager } = fixture({
          "/vault/.claude/settings.json": JSON.stringify({
            hooks: {
              Stop: [
                {
                  hooks: [
                    { type: "command", command: "first" },
                    { type: "command", command: "second" },
                  ],
                },
              ],
            },
          }),
        });
        await manager.toggle(
          await manager.details((await manager.list("hook", PROJECT))[0]),
          false
        );
        const items = await manager.list("hook", PROJECT);
        expect(items).toHaveLength(2);
        expect(new Set(items.map((item) => item.id)).size).toBe(2);
        expect(items.filter((item) => item.enabled === false)).toHaveLength(1);
        await manager.toggle(
          await manager.details(items.find((item) => item.enabled !== false)!),
          false
        );
        const stopped = await manager.list("hook", PROJECT);
        expect(stopped).toHaveLength(2);
        expect(stopped.every((item) => item.enabled === false)).toBe(true);
        expect(
          new Set(
            (await Promise.all(stopped.map((item) => manager.details(item)))).map(
              (details) => details.config?.command
            )
          )
        ).toEqual(new Set(["first", "second"]));
      });
      it("rolls back the stop record when active configuration changes during a two-file operation", async () => {
        const { manager, files, io } = fixture({
          "/vault/.mcp.json": JSON.stringify({ mcpServers: { docs: { command: "server" } } }),
        });
        const details = await manager.details((await manager.list("mcp", PROJECT))[0]),
          rename = io.rename;
        io.rename = async (from, to) => {
          await rename(from, to);
          if (to.endsWith("/.scribe/extensions.json"))
            files.set(
              "/vault/.mcp.json",
              JSON.stringify({ mcpServers: { docs: { command: "external" } } })
            );
        };
        await expect(manager.toggle(details, false)).rejects.toThrow("其他程序");
        expect(config(files, "/vault/.claude/.scribe/extensions.json").disabledMcp).toBeUndefined();
        expect(config(files, "/vault/.mcp.json").mcpServers.docs.command).toBe("external");
      });
      it("removes a disabled MCP server from active configuration and restores its entire configuration", async () => {
        const server = {
          command: "node",
          args: ["server"],
          env: { TOKEN: "private" },
          future: { key: 8 },
        };
        const { manager, files } = fixture({
          "/home/.claude.json": JSON.stringify({ other: 9, mcpServers: { docs: server } }),
        });
        await manager.toggle(await manager.details((await manager.list("mcp", USER))[0]), false);
        expect(config(files, "/home/.claude.json")).toEqual({ other: 9, mcpServers: {} });
        const disabled = (await manager.list("mcp", USER))[0];
        expect(disabled.enabled).toBe(false);
        await manager.toggle(await manager.details(disabled), true);
        expect(config(files, "/home/.claude.json")).toEqual({
          other: 9,
          mcpServers: { docs: server },
        });
      });
      it("preserves hook matcher and unknown group fields across disable, edit, and restore", async () => {
        const { manager, files } = fixture({
          "/vault/.claude/settings.json": JSON.stringify({
            hooks: {
              PreToolUse: [
                {
                  matcher: "Bash",
                  future: "keep",
                  hooks: [{ type: "command", command: "original", timeout: 33 }],
                },
              ],
            },
          }),
        });
        await manager.toggle(
          await manager.details((await manager.list("hook", PROJECT))[0]),
          false
        );
        let disabled = (await manager.list("hook", PROJECT))[0];
        expect(disabled.enabled).toBe(false);
        const details = await manager.details(disabled);
        await manager.save({
          kind: "hook",
          name: "PreToolUse",
          scope: PROJECT,
          original: details,
          config: { command: "updated", matcher: "Read" },
        });
        disabled = (await manager.list("hook", PROJECT))[0];
        await manager.toggle(await manager.details(disabled), true);
        const groups = config(files, "/vault/.claude/settings.json").hooks.PreToolUse;
        expect(groups[groups.length - 1]).toEqual({
          matcher: "Read",
          future: "keep",
          hooks: [{ type: "command", command: "updated", timeout: 33 }],
        });
      });
      it("preserves Markdown content while disabling and restoring it and rejects plugin-owned writes", async () => {
        const { manager, files } = fixture({ "/vault/.claude/commands/review.md": "Review notes" });
        await manager.toggle(
          await manager.details((await manager.list("command", PROJECT))[0]),
          false
        );
        expect(files.has("/vault/.claude/commands/review.md")).toBe(false);
        let item = (await manager.list("command", PROJECT))[0];
        expect(item.enabled).toBe(false);
        await manager.toggle(await manager.details(item), true);
        item = (await manager.list("command", PROJECT))[0];
        const details = await manager.details(item);
        await expect(
          manager.toggle({ ...details, item: { ...item, parentPluginId: "parent" } }, false)
        ).rejects.toThrow("不能单独修改");
        expect(files.get("/vault/.claude/commands/review.md")).toBe("Review notes");
      });
    });
    describe("delete()", () => {
      it("does not uninstall a user plugin from a project's inherited enablement override", async () => {
        const { manager, run } = fixture({
          "/home/.claude/settings.json": JSON.stringify({ enabledPlugins: { "notes@team": true } }),
          "/vault/.claude/settings.json": JSON.stringify({
            enabledPlugins: { "notes@team": false },
          }),
          "/home/.claude/plugins/installed_plugins.json": JSON.stringify({
            plugins: { "notes@team": [{ scope: "user", installPath: "/plugin" }] },
          }),
          "/plugin/.claude-plugin/plugin.json": '{"name":"notes"}',
        });
        const inherited = (await manager.list("plugin", PROJECT))[0];
        await expect(manager.delete(await manager.details(inherited))).rejects.toThrow();
        expect(inherited.capabilities).toMatchObject({
          toggle: true,
          delete: false,
          update: false,
        });
        expect(run).not.toHaveBeenCalled();
        await manager.toggle(await manager.details(inherited), true);
        expect((await manager.list("plugin", USER))[0].capabilities?.delete).toBe(true);
      });
      it("selects the project's installation independently of registry order when the same plugin is also installed for the user", async () => {
        const { manager, run } = fixture({
          "/vault/.claude/settings.json": JSON.stringify({
            enabledPlugins: { "notes@team": true },
          }),
          "/home/.claude/plugins/installed_plugins.json": JSON.stringify({
            plugins: {
              "notes@team": [
                { scope: "project", projectPath: "/vault", installPath: "/project-plugin" },
                { scope: "user", installPath: "/user-plugin" },
              ],
            },
          }),
          "/project-plugin/.claude-plugin/plugin.json": '{"name":"notes"}',
          "/user-plugin/.claude-plugin/plugin.json": '{"name":"notes"}',
        });
        const item = (await manager.list("plugin", PROJECT))[0];
        await manager.delete(await manager.details(item));
        expect(run).toHaveBeenCalledWith(
          "/bin/claude",
          ["plugin", "uninstall", "notes@team", "--scope", "project", "--keep-data"],
          "/vault",
          {}
        );
      });
      it("uninstalls an official local-scope plugin from its original installation scope", async () => {
        const { manager, run } = fixture({
          "/home/.claude/plugins/installed_plugins.json": JSON.stringify({
            plugins: {
              "notes@team": [{ scope: "local", projectPath: "/vault", installPath: "/plugin" }],
            },
          }),
          "/vault/.claude/settings.local.json": JSON.stringify({
            enabledPlugins: { "notes@team": true },
          }),
          "/plugin/.claude-plugin/plugin.json": '{"name":"notes"}',
        });
        const item = (await manager.list("plugin", PROJECT))[0];
        await manager.delete(await manager.details(item));
        expect(run).toHaveBeenCalledWith(
          "/bin/claude",
          ["plugin", "uninstall", "notes@team", "--scope", "local", "--keep-data"],
          "/vault",
          {}
        );
      });
      it("moves an entire disabled skill directory into recovery so support files do not remain discoverable", async () => {
        const { manager, files } = fixture({
          "/vault/.claude/skills/review/SKILL.md.disabled": markdown("review"),
          "/vault/.claude/skills/review/assets/example.md": "support",
        });
        await manager.delete(await manager.details((await manager.list("skill", PROJECT))[0]));
        expect(await manager.list("skill", PROJECT)).toEqual([]);
        expect(
          [...files.keys()].some((path) => path.startsWith("/vault/.claude/skills/review/"))
        ).toBe(false);
        expect(
          [...files.entries()].some(
            ([path, content]) => path.includes("/.scribe/trash/") && content === "support"
          )
        ).toBe(true);
      });
      it("moves owned Markdown to recovery storage and removes only the selected JSON property", async () => {
        const { manager, files } = fixture({
          "/vault/.claude/commands/review.md": "Keep recoverable",
          "/vault/.mcp.json": JSON.stringify({
            future: 8,
            mcpServers: { one: { command: "one" }, two: { command: "two" } },
          }),
        });
        await manager.delete(await manager.details((await manager.list("command", PROJECT))[0]));
        expect(
          [...files.keys()].some(
            (key) => key.includes("/.scribe/trash/") && files.get(key) === "Keep recoverable"
          )
        ).toBe(true);
        await manager.delete(await manager.details((await manager.list("mcp", PROJECT))[0]));
        expect(config(files, "/vault/.mcp.json")).toEqual({
          future: 8,
          mcpServers: { two: { command: "two" } },
        });
      });
    });
    describe("import()", () => {
      it("imports multiple named MCP configurations and refuses invalid batches before writing", async () => {
        const { manager, files } = fixture();
        await manager.import({
          kind: "mcp",
          scope: PROJECT,
          content: JSON.stringify({
            mcpServers: {
              first: { command: "node" },
              second: { type: "sse", url: "https://docs.example/sse" },
            },
          }),
        });
        expect((await manager.list("mcp", PROJECT)).map((item) => item.name)).toEqual([
          "first",
          "second",
        ]);
        const before = [...files.entries()];
        await expect(
          manager.import({
            kind: "mcp",
            scope: USER,
            content: JSON.stringify({ valid: { command: "node" }, invalid: {} }),
          })
        ).rejects.toThrow("启动命令");
        expect([...files.entries()]).toEqual(before);
      });
    });
    describe("pluginAction()", () => {
      it("rejects a direct update or uninstall request that crosses the selected configuration scope", async () => {
        const { manager, run } = fixture();
        for (const action of ["update", "uninstall"] as const) {
          await expect(
            manager.pluginAction({
              action,
              scope: PROJECT,
              plugin: "notes@team",
              installationScope: "user",
            })
          ).rejects.toThrow();
        }
        expect(run).not.toHaveBeenCalled();
      });
      it("keeps a disabled local plugin disabled when its reference is updated", async () => {
        const { manager } = fixture({
          "/plugin/.claude-plugin/plugin.json": '{"name":"notes"}',
        });
        await manager.pluginAction({
          action: "install",
          scope: USER,
          plugin: "/plugin",
          local: true,
        });
        const item = (await manager.list("plugin", USER))[0];
        await manager.toggle(await manager.details(item), false);
        await manager.pluginAction({ action: "update", scope: USER, plugin: item.id, local: true });
        expect(await manager.localPlugins()).toEqual([]);
        expect((await manager.list("plugin", USER))[0].enabled).toBe(false);
      });
      it("executes official CLI operations with separate arguments and preserves the selected scope and marketplace", async () => {
        const { manager, run } = fixture();
        await manager.pluginAction({
          action: "install",
          scope: PROJECT,
          plugin: "notes;echo",
          marketplace: "owner/catalog",
        });
        expect(run).toHaveBeenCalledWith(
          "/bin/claude",
          [
            "plugin",
            "install",
            "notes;echo",
            "--scope",
            "project",
            "--marketplace",
            "owner/catalog",
          ],
          "/vault",
          {}
        );
        await expect(
          manager.pluginAction({ action: "install", scope: USER, plugin: "--danger" })
        ).rejects.toThrow("有效");
      });
      it("persists local plugin references for SDK loading instead of modifying plugin package files", async () => {
        const { manager, run } = fixture({
          "/plugin/.claude-plugin/plugin.json": '{"name":"notes"}',
        });
        await manager.pluginAction({
          action: "install",
          scope: USER,
          plugin: "/plugin",
          local: true,
        });
        expect(await manager.localPlugins()).toEqual([{ type: "local", path: "/plugin" }]);
        const item = (await manager.list("plugin", USER))[0];
        await manager.toggle(await manager.details(item), false);
        expect(await manager.localPlugins()).toEqual([]);
        expect(run).not.toHaveBeenCalled();
        await manager.pluginAction({
          action: "uninstall",
          scope: USER,
          plugin: "/plugin",
          local: true,
        });
        expect(await manager.list("plugin", USER)).toEqual([]);
      });
    });
    describe("marketplaces()", () => {
      it("returns typed local marketplace entries without installing or executing anything", async () => {
        const { manager, run } = fixture({
          "/home/.claude/plugins/known_marketplaces.json": JSON.stringify({
            team: { source: { repo: "owner/catalog" }, installLocation: "/market" },
          }),
          "/market/.claude-plugin/marketplace.json": JSON.stringify({
            plugins: [{ name: "notes", description: "Note helpers" }],
          }),
        });
        expect(await manager.marketplaces()).toEqual([
          {
            name: "team",
            source: "owner/catalog",
            plugins: [{ id: "notes@team", name: "notes", description: "Note helpers" }],
          },
        ]);
        expect(run).not.toHaveBeenCalled();
      });
    });
    describe("localPlugins()", () => {
      it("applies project-local reference overrides and removes duplicate paths", async () => {
        const { manager } = fixture({
          "/home/.claude/.scribe/extensions.json": JSON.stringify({
            localPlugins: {
              first: { path: "/plugin", enabled: true },
              other: { path: "/plugin", enabled: true },
            },
          }),
          "/vault/.claude/.scribe/extensions.json": JSON.stringify({
            localPlugins: { first: { path: "/plugin", enabled: false } },
          }),
        });
        expect(await manager.localPlugins()).toEqual([{ type: "local", path: "/plugin" }]);
      });
    });
  });
});
