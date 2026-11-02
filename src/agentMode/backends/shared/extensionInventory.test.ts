import {
  ExtensionInventoryReader,
  extensionDiscoveryInput,
  object,
} from "@/agentMode/backends/shared/extensionInventory";
import { input, skill } from "@/agentMode/backends/shared/extensionInventoryFixtures";
import { sha256 } from "@/utils/hash";

jest.mock("path", () => jest.requireActual<typeof import("path")>("path").posix);

describe("extensionInventory", () => {
  describe("object()", () => {
    it("accepts configuration objects and uses one stable empty result for missing or invalid shapes", () => {
      const config = { enabled: false };
      expect(object(config)).toBe(config);
      expect(object(null)).toBe(object([]));
      expect(object("invalid")).toEqual({});
    });
  });
  describe("extensionDiscoveryInput()", () => {
    it("uses the child home override while retaining the parent environment without modifying it", () => {
      const original = process.env.HOME;
      const result = extensionDiscoveryInput("/vault", { HOME: "/profile", CODEX_HOME: "/config" });
      expect(result.home).toBe("/profile");
      expect(result.env.CODEX_HOME).toBe("/config");
      expect(result.cwd).toBe("/vault");
      expect(process.env.HOME).toBe(original);
    });
  });
  describe("ExtensionInventoryReader", () => {
    describe("directoryExists()", () => {
      it("accepts existing empty directories and distinguishes missing paths from unreadable ones", async () => {
        const source = input({});
        source.fs!.list = async (path) => {
          if (path === "/empty") return [];
          throw Object.assign(new Error(path), { code: path === "/missing" ? "ENOENT" : "EACCES" });
        };
        const reader = new ExtensionInventoryReader(source);

        expect(await reader.directoryExists("/empty")).toBe(true);
        expect(await reader.directoryExists("/missing")).toBe(false);
        await expect(reader.directoryExists("/unreadable")).rejects.toThrow("/unreadable");
      });
    });
    describe("hooks()", () => {
      it("retains an exact event, matcher and hashed command identity without exposing credentials", () => {
        const reader = new ExtensionInventoryReader(input({}));
        reader.hooks(
          {
            PreToolUse: [
              { matcher: "Bash", hooks: [{ type: "command", command: "check --token secret" }] },
            ],
          },
          "project",
          "/vault/.claude/settings.json"
        );

        const hooks = reader.result().find((group) => group.kind === "hook")!.items;

        expect(hooks[0]).toMatchObject({
          hookIdentity: {
            event: "PreToolUse",
            matcher: "Bash",
            type: "command",
            source: "project",
            commandHash: sha256("check --token secret"),
          },
        });
        expect(JSON.stringify(hooks)).not.toContain("secret");
      });
    });
    describe("config()", () => {
      it("parses local configuration without exposing unreadable file content in diagnostics", async () => {
        const reader = new ExtensionInventoryReader(
          input({ "/config.json": '{"enabled":false}', "/broken.json": "secret-credential" })
        );
        expect(await reader.config("/config.json")).toEqual({ enabled: false });
        expect(await reader.config("/broken.json")).toEqual({});
        expect(JSON.stringify(reader.result())).not.toContain("secret-credential");
        expect(reader.result().every((group) => group.warnings.length > 0)).toBe(true);
      });
    });
    describe("markdown()", () => {
      it("keeps ordinary project skill files editable at their recorded source", async () => {
        const reader = new ExtensionInventoryReader(
          input({
            "/vault/.claude/skills/review/SKILL.md": skill("review"),
          })
        );
        await reader.markdown("/vault/.claude/skills", "project", "skill");
        expect(reader.result().find((group) => group.kind === "skill")!.items).toMatchObject([
          { name: "review", capabilities: { edit: true, delete: true, toggle: true } },
        ]);
      });
      it.each([
        {
          kind: "skill" as const,
          relative: "skills/review/SKILL.md",
          destination: "/shared/review/SKILL.md",
        },
        {
          kind: "skill" as const,
          relative: "skills/review/SKILL.md",
          destination: "/vault/.claude/skills/original/SKILL.md",
        },
        {
          kind: "command" as const,
          relative: "commands/review.md",
          destination: "/shared/review.md",
        },
        {
          kind: "subagent" as const,
          relative: "agents/review.md",
          destination: "/shared/reviewer.md",
        },
      ])(
        "shows linked $kind files as read-only without offering mutations of $destination",
        async ({ kind, relative, destination }) => {
          const location = `/vault/.claude/${relative}`;
          const source = input({ [location]: skill("review") });
          source.fs!.realpath = async (path) => (path === location ? destination : path);
          const reader = new ExtensionInventoryReader(source);
          await reader.markdown(`/vault/.claude/${relative.split("/")[0]}`, "project", kind);
          expect(reader.result().find((group) => group.kind === kind)!.items).toMatchObject([
            {
              location: destination,
              readOnly: true,
              capabilities: { edit: false, delete: false, toggle: false },
            },
          ]);
        }
      );
      it("deduplicates symlinked skill files and stops directory cycles", async () => {
        const source = input({
          "/skills/a/SKILL.md": skill("one"),
          "/skills/b/SKILL.md": skill("one"),
        });
        source.fs!.realpath = async (path) => path.replace("/b", "/a");
        const reader = new ExtensionInventoryReader(source);
        await reader.markdown("/skills", "user", "skill");
        expect(reader.result().find((group) => group.kind === "skill")!.items).toHaveLength(1);
      });
    });
    describe("plugin()", () => {
      it("gives plugin components their manifest namespaces while retaining their displayed names", async () => {
        const reader = new ExtensionInventoryReader(
          input({
            "/plugin/skills/check/SKILL.md": skill("check"),
            "/plugin/commands/review.md": "Review research notes",
          })
        );

        await reader.plugin("/plugin", "research-alias@team", {
          name: "research",
          mcpServers: { docs: { command: "credential-canary" } },
        });

        const result = reader.result();
        expect(result.find((group) => group.kind === "skill")!.items[0]).toMatchObject({
          name: "check",
          source: "plugin",
          runtimeName: "research:check",
        });
        expect(result.find((group) => group.kind === "command")!.items[0]).toMatchObject({
          name: "research-alias:review",
          runtimeName: "research:review",
        });
        expect(result.find((group) => group.kind === "mcp")!.items[0]).toMatchObject({
          name: "research-alias@team:docs",
          runtimeName: "plugin:research:docs",
        });
        expect(JSON.stringify(result)).not.toContain("credential-canary");
      });
      it("uses the marketplace plugin name when no manifest name is present", async () => {
        const reader = new ExtensionInventoryReader(
          input({
            "/plugin/skills/check/SKILL.md": skill("check"),
            "/plugin/commands/review.md": "Review research notes",
            "/plugin/.mcp.json": '{"mcpServers":{"docs":{"command":"unused"}}}',
          })
        );

        await reader.plugin("/plugin", "research@team", {});

        const result = reader.result();
        expect(result.find((group) => group.kind === "skill")!.items[0]).toMatchObject({
          runtimeName: "research:check",
        });
        expect(result.find((group) => group.kind === "command")!.items[0]).toMatchObject({
          runtimeName: "research:review",
        });
        expect(result.find((group) => group.kind === "mcp")!.items[0]).toMatchObject({
          runtimeName: "plugin:research:docs",
        });
      });
      it("reads declared local plugin components while refusing paths outside the plugin", async () => {
        const reader = new ExtensionInventoryReader(
          input({
            "/outside/check/SKILL.md": skill("outside"),
            "/plugin/skills/check/SKILL.md": skill("inside"),
          })
        );
        await reader.plugin("/plugin", "review@local", { skills: "../outside" });
        expect(
          reader
            .result()
            .find((group) => group.kind === "skill")!
            .items.map((item) => item.name)
        ).toEqual(["inside"]);
      });
      it("lists explicit command and agent files and inline command names without loading replaced default folders", async () => {
        const source = input({
          "/plugin/commands/ignored.md": "Default command",
          "/plugin/custom/review.md": "Review instructions",
          "/plugin/agents/ignored.md": skill("ignored"),
          "/plugin/custom/reviewer.md": skill("reviewer"),
        });
        const reader = new ExtensionInventoryReader(source);
        await reader.plugin("/plugin", "review@team", {
          commands: ["./custom/review.md"],
          agents: ["./custom/reviewer.md"],
        });
        expect(reader.result().find((group) => group.kind === "command")!.items).toMatchObject([
          {
            name: "review:review",
            runtimeName: "review:review",
            target: { path: "/plugin/custom/review.md" },
          },
        ]);
        expect(reader.result().find((group) => group.kind === "subagent")!.items).toMatchObject([
          { name: "reviewer", runtimeName: "review:reviewer" },
        ]);

        const inline = new ExtensionInventoryReader(source);
        await inline.plugin("/plugin", "review@team", {
          commands: {
            about: { content: "Explain this plugin", description: "About the plugin" },
            check: { source: "./custom/review.md", description: "Review the notes" },
            outside: { source: "../outside.md" },
          },
        });
        expect(inline.result().find((group) => group.kind === "command")!.items).toMatchObject([
          {
            name: "review:about",
            runtimeName: "review:about",
            description: "About the plugin",
            readOnly: true,
            target: { format: "json", keyPath: ["commands", "about"] },
          },
          {
            name: "review:check",
            runtimeName: "review:check",
            description: "Review the notes",
            readOnly: true,
            target: { format: "markdown", path: "/plugin/custom/review.md" },
          },
        ]);
      });
      it("keeps default skills, hooks and MCP servers alongside extra declarations and lets later MCP entries override earlier ones", async () => {
        const reader = new ExtensionInventoryReader(
          input({
            "/plugin/skills/base/SKILL.md": skill("base"),
            "/plugin/extra/extra/SKILL.md": skill("extra"),
            "/plugin/.mcp.json": JSON.stringify({
              mcpServers: {
                base: { command: "base" },
                shared: { command: "old", description: "old" },
              },
            }),
            "/plugin/extra-mcp.json": JSON.stringify({
              shared: { command: "new", description: "new" },
              extra: { command: "extra" },
            }),
            "/plugin/hooks/hooks.json": JSON.stringify({
              hooks: { SessionStart: [{ hooks: [{ type: "command", command: "base" }] }] },
            }),
            "/plugin/extra-hooks.json": JSON.stringify({
              hooks: { Stop: [{ hooks: [{ type: "command", command: "extra" }] }] },
            }),
          })
        );
        await reader.plugin("/plugin", "review@team", {
          skills: ["./extra"],
          mcpServers: ["./extra-mcp.json", { inline: { command: "inline" } }],
          hooks: [
            "./extra-hooks.json",
            { hooks: { Stop: [{ hooks: [{ type: "command", command: "inline-one" }] }] } },
            { hooks: { Stop: [{ hooks: [{ type: "command", command: "inline-two" }] }] } },
          ],
        });
        const result = reader.result();
        expect(
          result.find((group) => group.kind === "skill")!.items.map((item) => item.name)
        ).toEqual(["base", "extra"]);
        expect(result.find((group) => group.kind === "mcp")!.items).toMatchObject([
          { name: "review@team:base" },
          {
            name: "review@team:shared",
            description: "new",
            target: { path: "/plugin/extra-mcp.json", keyPath: ["shared"] },
          },
          { name: "review@team:extra" },
          { name: "review@team:inline", target: { keyPath: ["mcpServers", 1, "inline"] } },
        ]);
        expect(
          result.find((group) => group.kind === "hook")!.items.map((item) => item.name)
        ).toEqual(["SessionStart", "Stop", "Stop", "Stop"]);
      });
      it("loads skills declared at the plugin root and uses filenames for plugin agents without a name", async () => {
        const reader = new ExtensionInventoryReader(
          input({
            "/plugin/SKILL.md": skill("root-skill"),
            "/plugin/agents/reviewer.md": "Review the notes",
          })
        );
        await reader.plugin("/plugin", "review@team", { skills: "." });
        expect(reader.result().find((group) => group.kind === "skill")!.items).toMatchObject([
          { name: "root-skill" },
        ]);
        expect(reader.result().find((group) => group.kind === "subagent")!.items).toMatchObject([
          { name: "reviewer", runtimeName: "review:reviewer" },
        ]);
      });
      it("does not read escaped or missing component files and reports MCP bundles that need an agent check", async () => {
        const reader = new ExtensionInventoryReader(
          input({
            "/outside.json": JSON.stringify({ leaked: { command: "outside" } }),
            "/plugin/hooks/hooks.json": JSON.stringify({
              hooks: { Stop: [{ hooks: [{ type: "command", command: "stop" }] }] },
            }),
          })
        );
        await reader.plugin("/plugin", "review@team", {
          commands: { missing: { source: "./missing.md" }, empty: {} },
          hooks: ["./hooks/hooks.json", "../outside.json"],
          mcpServers: ["../outside.json", "./server.mcpb"],
        });
        const result = reader.result();
        expect(result.find((group) => group.kind === "command")!.items).toEqual([]);
        expect(result.find((group) => group.kind === "hook")!.items).toHaveLength(1);
        expect(result.find((group) => group.kind === "mcp")).toMatchObject({
          items: [],
          warnings: ["Some plugin components require an agent check to be listed."],
        });
      });
    });
    describe("pluginRule()", () => {
      it("applies disable rules only to matching discovered plugin IDs", () => {
        const reader = new ExtensionInventoryReader(input({}));
        reader.add("plugin", { id: "team.one", name: "team.one", source: "user", enabled: true });
        reader.add("plugin", { id: "other", name: "other", source: "user", enabled: true });
        reader.pluginRule("team.*", false);
        expect(
          reader
            .result()
            .find((group) => group.kind === "plugin")!
            .items.map((item) => item.enabled)
        ).toEqual([false, true]);
      });
    });
  });
});
