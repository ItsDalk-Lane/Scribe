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
    it("keeps disabled configuration disabled when the running session still reports its previous state", () => {
      const local = groups();
      local[0].items = [{ ...local[0].items[0], enabled: false }];
      expect(mergeExtensionRuntime(local, runtime())[0].items[0]).toMatchObject({
        enabled: false,
        availability: "disabled",
      });
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
