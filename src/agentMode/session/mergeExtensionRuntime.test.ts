import type { AgentExtensionGroup, AgentExtensionRuntimeSnapshot } from "./extensionInventory";
import { mergeExtensionRuntime } from "./mergeExtensionRuntime";

const groups = (): AgentExtensionGroup[] => [
  {
    kind: "skill",
    status: "partial",
    warnings: [],
    items: [{ id: "skill", name: "review", source: "user" }],
  },
  {
    kind: "plugin",
    status: "partial",
    warnings: [],
    items: [{ id: "plugin", name: "notes@team", source: "user", location: "/plugins/notes" }],
  },
  {
    kind: "command",
    status: "partial",
    warnings: [],
    items: [{ id: "command", name: "summarize", source: "project" }],
  },
  {
    kind: "mcp",
    status: "partial",
    warnings: [],
    items: [{ id: "mcp", name: "docs", source: "user" }],
  },
  {
    kind: "hook",
    status: "partial",
    warnings: [],
    items: [{ id: "hook", name: "Stop", source: "user" }],
  },
];
const runtime = (
  overrides: Partial<AgentExtensionRuntimeSnapshot> = {}
): AgentExtensionRuntimeSnapshot => ({
  skills: ["review"],
  plugins: [{ name: "notes", path: "/plugins/notes" }],
  failedPlugins: [],
  commands: ["summarize"],
  mcpServers: [{ name: "docs", status: "connected", toolCount: 3 }],
  ...overrides,
});

describe("mergeExtensionRuntime", () => {
  describe("mergeExtensionRuntime()", () => {
    it("adds runtime-only built-in subagents as read-only and retains discovered custom agent controls", () => {
      const local: AgentExtensionGroup[] = [
        {
          kind: "subagent",
          status: "partial",
          warnings: [],
          items: [
            {
              id: "custom",
              name: "review",
              source: "user",
              capabilities: { edit: true, delete: true, toggle: true },
            },
          ],
        },
      ];
      const result = mergeExtensionRuntime(
        local,
        runtime({
          subagents: [
            { name: "review", description: "Custom" },
            { name: "Explore", description: "Read" },
          ],
        })
      );
      expect(result[0].items[0]).toMatchObject({
        availability: "loaded",
        capabilities: { edit: true },
      });
      expect(result[0].items[1]).toMatchObject({
        name: "Explore",
        builtin: true,
        readOnly: true,
        capabilities: { edit: false, delete: false, toggle: false },
      });
    });
    it("attaches Claude's reported loading and connection states without changing configuration flags", () => {
      const result = mergeExtensionRuntime(groups(), runtime());
      expect(result.slice(0, 3).map((g) => g.items[0].availability)).toEqual([
        "loaded",
        "loaded",
        "loaded",
      ]);
      expect(result[3].items[0]).toMatchObject({ availability: "connected", toolCount: 3 });
      expect(result[4].items[0].availability).toBeUndefined();
      expect(result[0].items[0].enabled).toBeUndefined();
    });
    it("preserves the original groups when no running Claude query exists", () => {
      const local = groups();
      expect(mergeExtensionRuntime(local, null)).toBe(local);
    });
    it("does not mistake missing or failed reports for unloaded extensions", () => {
      const result = mergeExtensionRuntime(
        groups(),
        runtime({
          skills: null,
          commands: null,
          plugins: null,
          failedPlugins: null,
          mcpServers: null,
        })
      );
      expect(result.every((g) => g.items.every((i) => i.availability === undefined))).toBe(true);
    });
    it("marks unreported skills as not listed because hidden skills may still be available", () => {
      const result = mergeExtensionRuntime(
        groups(),
        runtime({ skills: [], commands: [], plugins: [], mcpServers: [] })
      );
      expect(result.map((g) => g.items[0].availability)).toEqual([
        "not_listed",
        "not_loaded",
        "not_listed",
        "not_listed",
        undefined,
      ]);
    });
    it("includes extensions reported by Claude that the local scan did not find", () => {
      const result = mergeExtensionRuntime(
        groups(),
        runtime({
          skills: ["remote-review"],
          mcpServers: [{ name: "remote", status: "needs-auth" }],
        })
      );
      expect(result[0].items[1]).toMatchObject({
        name: "remote-review",
        source: "runtime",
        availability: "loaded",
      });
      expect(result[3].items[1]).toMatchObject({
        name: "remote",
        source: "runtime",
        availability: "needs-auth",
      });
    });
    it("keeps a scope-isolated list free of entries the report knows only from other scopes (https://github.com/ItsDalk-Lane/Scribe/issues/6)", () => {
      const result = mergeExtensionRuntime(
        groups(),
        runtime({
          skills: ["remote-review"],
          mcpServers: [{ name: "remote", status: "connected", toolCount: 1 }],
        }),
        { appendRuntimeEntries: false }
      );
      expect(result[0].items.map((item) => item.name)).toEqual(["review"]);
      expect(result[3].items.map((item) => item.name)).toEqual(["docs"]);
    });
    it("uses the actual loaded state even when a saved flag disagrees", () => {
      const local = groups();
      local[0].items = [{ ...local[0].items[0], enabled: false }];
      expect(mergeExtensionRuntime(local, runtime())[0].items[0]).toMatchObject({
        enabled: false,
        availability: "loaded",
      });
    });
    it("matches registered hooks by event, matcher and command instead of configuration presence", () => {
      const local = groups();
      local[4].items = [
        {
          ...local[4].items[0],
          hookIdentity: { event: "Stop", matcher: "", commandHash: "check-notes" },
        },
      ];
      expect(
        mergeExtensionRuntime(
          local,
          runtime({ hooks: [{ event: "Stop", matcher: "", commandHash: "check-notes" }] })
        )[4].items[0].availability
      ).toBe("loaded");
      expect(mergeExtensionRuntime(local, runtime({ hooks: [] }))[4].items[0].availability).toBe(
        "not_listed"
      );
      expect(
        mergeExtensionRuntime(
          local,
          runtime({
            hooks: [{ event: "Stop", matcher: "", commandHash: "check-notes", disabled: true }],
          })
        )[4].items[0].availability
      ).toBe("disabled");
    });
    it("uses the hook source and owner to keep identical commands from borrowing availability", () => {
      const local = groups();
      local[4].items = [
        {
          id: "user-hook",
          name: "Stop",
          source: "user",
          hookIdentity: { event: "Stop", source: "user", commandHash: "check" },
        },
        {
          id: "project-hook",
          name: "Stop",
          source: "project",
          hookIdentity: { event: "Stop", source: "project", commandHash: "check" },
        },
        {
          id: "plugin-hook",
          name: "Stop",
          source: "plugin",
          parentPluginId: "notes@team",
          hookIdentity: { event: "Stop", source: "plugin", commandHash: "check" },
        },
      ];
      const result = mergeExtensionRuntime(
        local,
        runtime({
          hooks: [
            { event: "Stop", source: "userSettings", commandHash: "check", disabled: true },
            { event: "Stop", source: "projectSettings", commandHash: "check" },
          ],
        })
      );
      expect(result[4].items.slice(0, 3).map((item) => item.availability)).toEqual([
        "disabled",
        "loaded",
        undefined,
      ]);
    });
    it("keeps hooks disabled when the running agent reports a global hook restriction", () => {
      const local = groups();
      local[4].items = [
        { ...local[4].items[0], hookIdentity: { event: "Stop", commandHash: "check" } },
      ];
      expect(
        mergeExtensionRuntime(
          local,
          runtime({ hooksDisabled: true, hooks: [{ event: "Stop", commandHash: "check" }] })
        )[4].items[0].availability
      ).toBe("disabled");
    });
    it("includes native commands as confirmed read-only built-ins", () => {
      const result = mergeExtensionRuntime(groups(), runtime({ builtinCommands: ["help"] }));
      expect(result[2].items.find((item) => item.name === "help")).toMatchObject({
        builtin: true,
        readOnly: true,
        availability: "loaded",
      });
    });
    it("keeps a disabled plugin's child off when no child runtime report was provided", () => {
      const local = groups();
      local[0].items = [{ ...local[0].items[0], parentPluginId: "notes@team", enabled: false }];
      expect(
        mergeExtensionRuntime(local, runtime({ skills: null, plugins: [] }))[0].items[0]
          .availability
      ).toBe("disabled");
    });
    it("hides the children of a disabled plugin from every kind except plugins (https://github.com/ItsDalk-Lane/Scribe/issues/1)", () => {
      const local = groups();
      local[1].items = [{ ...local[1].items[0], enabled: false }];
      const owned = (id: string): AgentExtensionGroup["items"][number] => ({
        id,
        name: id,
        source: "plugin",
        parentPluginId: "plugin",
        readOnly: true,
      });
      local[0].items = [owned("child-skill")];
      local[2].items = [owned("child-command")];
      local[3].items = [owned("child-mcp")];
      local[4].items = [owned("child-hook")];
      const result = mergeExtensionRuntime(
        local,
        runtime({ skills: [], commands: [], plugins: [], mcpServers: [] })
      );
      expect(result.find((group) => group.kind === "plugin")!.items[0].name).toBe("notes@team");
      for (const kind of ["skill", "command", "mcp", "hook"])
        expect(result.find((group) => group.kind === kind)!.items).toEqual([]);
    });
    it("keeps the children of an enabled plugin listed (https://github.com/ItsDalk-Lane/Scribe/issues/1)", () => {
      const local = groups();
      local[0].items = [
        {
          id: "child-skill",
          name: "child-skill",
          source: "plugin",
          parentPluginId: "notes@team",
          readOnly: true,
        },
      ];
      const result = mergeExtensionRuntime(local, runtime({ skills: ["child-skill"] }));
      expect(result[0].items[0].availability).toBe("loaded");
    });
    it("shows a failed plugin even when it is absent from the loaded plugin list", () => {
      const result = mergeExtensionRuntime(
        groups(),
        runtime({ plugins: [], failedPlugins: [{ name: "notes@team" }] })
      );
      expect(result[1].items[0].availability).toBe("failed");
    });
    it("keeps a plugin loaded when Claude reports a failed component", () => {
      const result = mergeExtensionRuntime(
        groups(),
        runtime({ failedPlugins: [{ name: "notes@team" }] })
      );
      expect(result[1].items).toHaveLength(1);
      expect(result[1].items[0].availability).toBe("loaded_with_errors");
    });
    it("attributes a positional loading error by its path instead of showing an unrelated error row", () => {
      const result = mergeExtensionRuntime(
        groups(),
        runtime({ plugins: [], failedPlugins: [{ name: "inline[0]", path: "/plugins/notes" }] })
      );
      expect(result[1].items).toHaveLength(1);
      expect(result[1].items[0]).toMatchObject({ name: "notes@team", availability: "failed" });
    });
    it("does not attribute another marketplace plugin's error to a loaded plugin with the same bare name", () => {
      const local = groups();
      local[1].items = [
        ...local[1].items,
        { id: "other-plugin", name: "notes@other", source: "user", location: "/plugins/other" },
      ];
      const result = mergeExtensionRuntime(
        local,
        runtime({ failedPlugins: [{ name: "notes@other" }] })
      );
      expect(result[1].items.map((i) => i.availability)).toEqual(["loaded", "failed"]);
    });
    it("uses explicit runtime names to match plugin skills, commands and MCP servers", () => {
      const local = groups();
      local[0].items = [{ ...local[0].items[0], runtimeName: "notes:review" }];
      local[2].items = [{ ...local[2].items[0], runtimeName: "notes:summarize" }];
      local[3].items = [{ ...local[3].items[0], runtimeName: "plugin:notes:docs" }];
      const result = mergeExtensionRuntime(
        local,
        runtime({
          skills: ["notes:review"],
          commands: ["notes:summarize"],
          mcpServers: [{ name: "plugin:notes:docs", status: "connected" }],
        })
      );
      expect(result.map((g) => g.items.length)).toEqual([1, 1, 1, 1, 1]);
      expect(result[0].items[0].availability).toBe("loaded");
      expect(result[3].items[0].availability).toBe("connected");
    });
    it("distinguishes manual-only and disabled skills using Claude's own reported state", () => {
      const result = mergeExtensionRuntime(
        groups(),
        runtime({
          skills: ["review", "manual"],
          manualSkills: ["manual"],
          disabledSkills: ["disabled"],
        })
      );
      expect(result[0].items.map((item) => [item.name, item.availability])).toEqual([
        ["review", "loaded"],
        ["manual", "manual_only"],
        ["disabled", "disabled"],
      ]);
    });
    it("shows a plugin error summary without inventing individual plugin failures", () => {
      const result = mergeExtensionRuntime(
        groups(),
        runtime({ pluginErrorCount: 2, failedPlugins: null })
      );
      expect(result[1].items[0].availability).toBe("loaded");
      expect(result[1].warnings).toEqual([
        "Claude reported plugin errors; details for each plugin were not provided.",
      ]);
    });
    it("does not attribute one reported skill to two local files with the same name", () => {
      const local = groups();
      local[0].items = [
        ...local[0].items,
        { id: "project-skill", name: "review", source: "project" },
      ];
      const result = mergeExtensionRuntime(local, runtime())[0].items;
      expect(result.slice(0, 2).map((i) => i.availability)).toEqual([undefined, undefined]);
      expect(result[2]).toMatchObject({
        name: "review",
        source: "runtime",
        availability: "loaded",
      });
    });
  });
});
