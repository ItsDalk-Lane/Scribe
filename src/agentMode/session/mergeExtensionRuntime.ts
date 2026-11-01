import type {
  AgentExtensionGroup,
  AgentExtensionItem,
  AgentExtensionRuntimeSnapshot,
} from "./extensionInventory";

export function mergeExtensionRuntime(
  groups: readonly AgentExtensionGroup[],
  runtime: AgentExtensionRuntimeSnapshot | null
): readonly AgentExtensionGroup[] {
  if (!runtime) return groups;
  const loaded = (name: string): AgentExtensionItem => ({
    id: `runtime:${name}`,
    name,
    source: "runtime",
    availability: "loaded",
  });
  const plugins: AgentExtensionItem[] | null =
    runtime.plugins?.map((plugin) => ({
      ...loaded(plugin.name),
      id: `runtime:${plugin.name}:${plugin.path}`,
      location: plugin.path,
    })) ?? (runtime.failedPlugins?.length ? [] : null);
  for (const { name, path } of runtime.failedPlugins ?? []) {
    plugins?.push({
      ...loaded(name),
      id: `runtime:error:${name}:${path ?? ""}`,
      availability: "failed",
      location: path,
    });
  }
  const observed = {
    skill:
      runtime.skills?.map(
        (name): AgentExtensionItem => ({
          ...loaded(name),
          availability: runtime.manualSkills?.includes(name) ? "manual_only" : "loaded",
        })
      ) ?? null,
    command: runtime.commands?.map(loaded) ?? null,
    plugin: plugins,
    mcp:
      runtime.mcpServers?.map(
        (server): AgentExtensionItem => ({
          id: `runtime:${server.name}`,
          name: server.name,
          source: "runtime",
          availability: server.status,
          toolCount: server.toolCount,
        })
      ) ?? null,
    hook: null,
    subagent:
      runtime.subagents?.map((agent) => ({
        ...loaded(agent.name),
        description: agent.description,
        builtin: true,
        readOnly: true,
        capabilities: { edit: false, delete: false, toggle: false },
      })) ?? null,
  };
  for (const name of runtime.disabledSkills ?? []) {
    observed.skill?.push({ ...loaded(name), availability: "disabled" });
  }
  return groups.map((group) => {
    const reported = observed[group.kind];
    if (!reported) return group;
    const matched = new Set<AgentExtensionItem>();
    const normalizeName = (name: string) => (group.kind === "plugin" ? name.split("@")[0] : name);
    const identity = (item: AgentExtensionItem) => item.runtimeName ?? item.name;
    const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
    const items = group.items.map((item): AgentExtensionItem => {
      const name = normalizeName(identity(item));
      const uniqueName =
        group.items.filter((entry) => normalizeName(identity(entry)) === name).length === 1;
      const matches = reported.filter((entry) => {
        if (group.kind === "plugin" && item.location && entry.location)
          return normalizePath(item.location) === normalizePath(entry.location);
        if (group.kind === "plugin" && entry.availability === "failed" && entry.name.includes("@"))
          return item.name === entry.name;
        return uniqueName && normalizeName(identity(entry)) === name;
      });
      if (item.enabled === false) {
        for (const match of matches) matched.add(match);
        return { ...item, availability: "disabled" };
      }
      if (matches.length) {
        for (const match of matches) matched.add(match);
        const loadedPlugin =
          group.kind === "plugin" && matches.some((match) => match.availability === "loaded");
        const error = matches.find((match) => match.availability === "failed");
        const match = error ?? matches[0];
        return {
          ...item,
          availability: loadedPlugin && error ? "loaded_with_errors" : match.availability,
          toolCount: match.toolCount,
        };
      }
      if (!uniqueName || (group.kind === "plugin" && runtime.plugins === null)) return item;
      return { ...item, availability: group.kind === "plugin" ? "not_loaded" : "not_listed" };
    });
    return {
      ...group,
      status: "partial",
      warnings:
        group.kind === "plugin" && runtime.pluginErrorCount
          ? [
              ...group.warnings,
              "Claude reported plugin errors; details for each plugin were not provided.",
            ]
          : group.warnings,
      items: [...items, ...reported.filter((item) => !matched.has(item))],
    };
  });
}
