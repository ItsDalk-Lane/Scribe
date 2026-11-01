import type {
  AgentExtensionGroup,
  AgentPluginInstallation,
} from "@/agentMode/session/extensionInventory";
import {
  ExtensionInventoryReader,
  object,
  type ExtensionDiscoveryInput,
} from "@/agentMode/backends/shared/extensionInventory";

export async function discoverClaudeExtensions(
  input: ExtensionDiscoveryInput,
  installedPlugins?: readonly unknown[]
): Promise<readonly AgentExtensionGroup[]> {
  const reader = new ExtensionInventoryReader(input);
  const configDir = input.env.CLAUDE_CONFIG_DIR
    ? reader.path.resolve(input.cwd ?? input.home, input.env.CLAUDE_CONFIG_DIR)
    : reader.path.join(input.home, ".claude");
  const scopes: Array<{ folder: string; source: "user" | "project" }> = [
    { folder: configDir, source: "user" },
  ];
  if (input.cwd) scopes.push({ folder: reader.path.join(input.cwd, ".claude"), source: "project" });
  for (const { folder, source } of scopes) {
    await reader.markdown(reader.path.join(folder, "skills"), source, "skill");
    await reader.markdown(reader.path.join(folder, "commands"), source, "command");
    await reader.markdown(reader.path.join(folder, "agents"), source, "subagent");
    for (const name of source === "project"
      ? ["settings.json", "settings.local.json"]
      : ["settings.json"]) {
      const path = reader.path.join(folder, name);
      const config = await reader.config(path);
      reader.named("plugin", config.enabledPlugins, source, undefined, "", "", path, [
        "enabledPlugins",
      ]);
      reader.hooks(config.hooks, source, path);
    }
  }
  const userPath = reader.path.join(
    input.env.CLAUDE_CONFIG_DIR ? configDir : input.home,
    ".claude.json"
  );
  const user = await reader.config(userPath);
  reader.named("mcp", user.mcpServers, "user", undefined, "", "", userPath, ["mcpServers"]);
  if (input.cwd) {
    reader.named(
      "mcp",
      object(object(user.projects)[input.cwd]).mcpServers,
      "project",
      undefined,
      "",
      "",
      userPath,
      ["projects", input.cwd, "mcpServers"]
    );
    const projectMcpPath = reader.path.join(input.cwd, ".mcp.json");
    reader.named(
      "mcp",
      (await reader.config(projectMcpPath)).mcpServers,
      "project",
      undefined,
      "",
      "",
      projectMcpPath,
      ["mcpServers"]
    );
  }
  const registry = await reader.config(
    reader.path.join(configDir, "plugins", "installed_plugins.json")
  );
  const registered: Record<string, unknown[]> = {};
  for (const value of installedPlugins ?? []) {
    const data = object(value);
    if (typeof data.id !== "string") continue;
    (registered[data.id] ??= []).push(data);
  }
  for (const [id, values] of Object.entries(
    installedPlugins ? registered : object(registry.plugins)
  )) {
    if (!Array.isArray(values)) continue;
    const records = values.map(object).filter((data) => typeof data.installPath === "string");
    const installations = records.filter(
      (data) =>
        !(data.scope === "project" || data.scope === "local") || data.projectPath === input.cwd
    );
    const data =
      installations.find((data) => data.scope === "local") ??
      installations.find((data) => data.scope === "project") ??
      installations[0] ??
      records[0];
    if (data && typeof data.installPath === "string") {
      const scope = input.cwd ? "project" : "user";
      const applicable = installations.length > 0;
      const available = applicable && (await reader.directoryExists(data.installPath));
      const allInstallations: AgentPluginInstallation[] = await Promise.all(
        records.map(async (record) => ({
          scope: record.scope === "local" || record.scope === "project" ? record.scope : "user",
          path: record.installPath as string,
          ...(typeof record.projectPath === "string" ? { projectPath: record.projectPath } : {}),
          ...(typeof record.version === "string" ? { version: record.version } : {}),
          available: await reader.directoryExists(record.installPath as string),
        }))
      );
      const plugin = reader.add("plugin", {
        id,
        name: id,
        source: scope,
        installationScope: data.scope === "local" || data.scope === "project" ? data.scope : "user",
        ...(typeof data.version === "string" ? { version: data.version } : {}),
        ...(installedPlugins
          ? { enabled: applicable && data.enabled === true }
          : applicable
            ? {}
            : { enabled: false }),
        installations: allInstallations,
        canEnable: available,
        canDisable: applicable,
        ...(!applicable
          ? { unavailableReason: "Installed only for other projects; unavailable in this scope." }
          : !available
            ? { unavailableReason: "Installed plugin files are missing." }
            : !installedPlugins
              ? { unavailableReason: "Could not read Claude plugin status." }
              : {}),
        target: {
          path: reader.path.join(
            scope === "project" && input.cwd ? reader.path.join(input.cwd, ".claude") : configDir,
            scope === "project" && data.scope === "local" ? "settings.local.json" : "settings.json"
          ),
          format: "json",
          keyPath: ["enabledPlugins", id],
          scope:
            scope === "project" && input.cwd
              ? { kind: "project", cwd: input.cwd }
              : { kind: "user" },
        },
      });
      const ownsInstallation =
        applicable &&
        (data.scope === "user" || data.scope === undefined
          ? scope === "user"
          : scope === "project");
      reader.add("plugin", {
        ...plugin,
        capabilities: {
          edit: false,
          toggle: true,
          delete: ownsInstallation,
          update: ownsInstallation,
        },
      });
      const manifest = await reader.config(
        reader.path.join(data.installPath, ".claude-plugin", "plugin.json")
      );
      await reader.plugin(data.installPath, id, manifest);
    }
  }
  for (const { folder, source } of scopes) {
    const statePath = reader.path.join(folder, ".scribe", "extensions.json");
    const state = await reader.config(statePath);
    for (const [id, value] of Object.entries(object(state.localPlugins))) {
      const spec = object(value);
      if (typeof spec.path !== "string") continue;
      reader.add("plugin", {
        id,
        name: id,
        source,
        target: {
          path: statePath,
          format: "json",
          keyPath: ["localPlugins", id],
          scope:
            source === "project" && input.cwd
              ? { kind: "project", cwd: input.cwd }
              : { kind: "user" },
        },
        enabled: spec.enabled !== false,
      });
      await reader.plugin(
        spec.path,
        id,
        await reader.config(reader.path.join(spec.path, ".claude-plugin", "plugin.json")),
        spec.enabled !== false
      );
    }
    for (const [key, kind] of [
      ["disabledHooks", "hook"],
      ["disabledMcp", "mcp"],
    ] as const) {
      for (const [storageId, value] of Object.entries(object(state[key]))) {
        const saved = object(value),
          item = object(saved.item);
        if (typeof item.id !== "string" || typeof item.name !== "string") continue;
        reader.add(kind, {
          id: `disabled:${storageId}`,
          name: item.name,
          kind,
          source,
          enabled: false,
          target: {
            path: statePath,
            format: "json",
            keyPath: [key, storageId],
            disabled: true,
            scope:
              source === "project" && input.cwd
                ? { kind: "project", cwd: input.cwd }
                : { kind: "user" },
          },
        });
      }
    }
  }
  return reader.result();
}
