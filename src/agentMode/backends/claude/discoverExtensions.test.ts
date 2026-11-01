import { discoverClaudeExtensions } from "@/agentMode/backends/claude/discoverExtensions";
import { input, skill } from "@/agentMode/backends/shared/extensionInventoryFixtures";

describe("discoverExtensions", () => {
  describe("discoverClaudeExtensions()", () => {
    it("lists user and project skills, configured servers, enabled plugins and hook events without returning credentials", async () => {
      const result = await discoverClaudeExtensions(
        input(
          {
            "/profile/skills/global/SKILL.md": skill("global"),
            "/vault/.claude/skills/local/SKILL.md": skill("local"),
            "/profile/settings.json": JSON.stringify({
              enabledPlugins: { "test@local": false },
              hooks: { Stop: [{ hooks: [{ type: "command", command: "secret-token" }] }] },
            }),
            "/vault/.mcp.json": JSON.stringify({
              mcpServers: { docs: { command: "secret-token" } },
            }),
            "/profile/commands/review.md": "Review notes",
            "/profile/.claude.json": JSON.stringify({
              mcpServers: { profile: { command: "secret-token" } },
            }),
          },
          { CLAUDE_CONFIG_DIR: "/profile" }
        )
      );
      expect(
        result.find((group) => group.kind === "skill")?.items.map((item) => item.name)
      ).toEqual(["global", "local"]);
      expect(result.find((group) => group.kind === "mcp")?.items.map((item) => item.name)).toEqual([
        "profile",
        "docs",
      ]);
      expect(result.find((group) => group.kind === "plugin")?.items[0].enabled).toBe(false);
      expect(result.find((group) => group.kind === "hook")?.items[0].name).toBe("Stop");
      expect(JSON.stringify(result)).not.toContain("secret-token");
    });
    it("keeps plugin runtime names distinct from user skills with the same short name", async () => {
      const result = await discoverClaudeExtensions(
        input({
          "/home/.claude/skills/check/SKILL.md": skill("check"),
          "/home/.claude/plugins/installed_plugins.json": JSON.stringify({
            plugins: {
              "research-alias@team": [{ scope: "user", installPath: "/plugins/research" }],
            },
          }),
          "/plugins/research/.claude-plugin/plugin.json": JSON.stringify({
            name: "research",
            mcpServers: { docs: { command: "credential-canary" } },
          }),
          "/plugins/research/skills/check/SKILL.md": skill("check"),
          "/plugins/research/commands/review.md": "Review research notes",
        })
      );

      expect(result.find((group) => group.kind === "skill")!.items).toEqual([
        expect.objectContaining({ name: "check", source: "user" }),
        expect.objectContaining({ name: "check", source: "plugin", runtimeName: "research:check" }),
      ]);
      expect(result.find((group) => group.kind === "skill")!.items[0]).not.toHaveProperty(
        "runtimeName"
      );
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
    it("preserves disabled plugin state and excludes registrations from other projects", async () => {
      const result = await discoverClaudeExtensions(
        input({
          "/home/.claude/settings.json": JSON.stringify({
            enabledPlugins: { "review@local": false },
          }),
          "/home/.claude/plugins/installed_plugins.json": JSON.stringify({
            plugins: {
              "review@local": [{ scope: "user", installPath: "/plugins/review" }],
              "other@local": [
                { scope: "local", projectPath: "/other", installPath: "/plugins/other" },
              ],
            },
          }),
          "/plugins/review/.claude-plugin/plugin.json": '{"name":"review"}',
          "/plugins/review/skills/check/SKILL.md": skill("check"),
          "/plugins/other/.claude-plugin/plugin.json": '{"name":"other"}',
        })
      );
      const plugins = result.find((group) => group.kind === "plugin")!.items;
      expect(plugins).toHaveLength(1);
      expect(plugins[0]).toMatchObject({ name: "review@local", enabled: false });
      expect(result.find((group) => group.kind === "skill")!.items[0].enabled).toBe(false);
    });
  });
});
