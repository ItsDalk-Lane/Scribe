import type {
  AgentExtensionGroup,
  AgentExtensionItem,
  AgentExtensionRuntimeSnapshot,
} from "./extensionInventory";

function disabledPluginIds(groups: readonly AgentExtensionGroup[]): Set<string> {
  return new Set(
    (groups.find((group) => group.kind === "plugin")?.items ?? [])
      .filter((plugin) => plugin.enabled === false || plugin.availability === "disabled")
      .map((plugin) => plugin.id)
  );
}

function withoutDisabledChildren(
  group: AgentExtensionGroup,
  disabledParents: Set<string>
): AgentExtensionGroup {
  if (group.kind === "plugin" || disabledParents.size === 0) return group;
  const items = group.items.filter(
    (item) => !item.parentPluginId || !disabledParents.has(item.parentPluginId)
  );
  return items.length === group.items.length ? group : { ...group, items };
}

export interface MergeExtensionRuntimeOptions {
  appendRuntimeEntries?: boolean;
}

export function mergeExtensionRuntime(
  groups: readonly AgentExtensionGroup[],
  runtime: AgentExtensionRuntimeSnapshot | null,
  options: MergeExtensionRuntimeOptions = {}
): readonly AgentExtensionGroup[] {
  if (!runtime) {
    const disabledParents = disabledPluginIds(groups);
    return disabledParents.size
      ? groups.map((group) => withoutDisabledChildren(group, disabledParents))
      : groups;
  }
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
    command: runtime.commands
      ? [
          ...runtime.commands.map(loaded),
          ...(runtime.builtinCommands ?? []).map((name) => ({
            ...loaded(name),
            builtin: true,
            readOnly: true,
          })),
        ]
      : null,
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
    hook:
      runtime.hooks?.map(
        (hook): AgentExtensionItem => ({
          id: `runtime:hook:${JSON.stringify(hook)}`,
          name: hook.event,
          source: "runtime",
          kind: "hook",
          availability: runtime.hooksDisabled || hook.disabled ? "disabled" : "loaded",
          hookIdentity: {
            event: hook.event,
            matcher: hook.matcher,
            commandHash: hook.commandHash ?? "",
            type: hook.type,
            source: hook.source?.replace(/Settings$/, "").replace(/Hook$/, ""),
          },
          ...(hook.pluginName ? { parentPluginId: hook.pluginName } : {}),
        })
      ) ?? null,
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
  const merged: readonly AgentExtensionGroup[] = groups.map((group) => {
    const reported = observed[group.kind];
    if (!reported)
      return {
        ...group,
        items: group.items.map((item) =>
          item.enabled === false && item.parentPluginId
            ? { ...item, availability: "disabled" as const }
            : item
        ),
      };
    const matched = new Set<AgentExtensionItem>();
    const normalizeName = (name: string) => (group.kind === "plugin" ? name.split("@")[0] : name);
    const identity = (item: AgentExtensionItem) => item.runtimeName ?? item.name;
    const normalizePath = (path: string) => path.replace(/\\/g, "/").replace(/\/+$/, "");
    const items = group.items.map((item): AgentExtensionItem => {
      const name = normalizeName(identity(item));
      const uniqueName =
        group.items.filter((entry) => normalizeName(identity(entry)) === name).length === 1;
      const matches = reported.filter((entry) => {
        if (group.kind === "hook") {
          const left = item.hookIdentity,
            right = entry.hookIdentity;
          return Boolean(
            left &&
            right &&
            left.event === right.event &&
            (left.matcher ?? "") === (right.matcher ?? "") &&
            left.commandHash === right.commandHash &&
            (!left.type || !right.type || left.type === right.type) &&
            (!left.source || !right.source || left.source === right.source) &&
            Boolean(item.parentPluginId) === Boolean(entry.parentPluginId) &&
            (!item.parentPluginId ||
              !entry.parentPluginId ||
              (groups
                .find((entry) => entry.kind === "plugin")
                ?.items.find((parent) => parent.id === item.parentPluginId)?.runtimeName ??
                item.parentPluginId.split("@")[0]) === entry.parentPluginId.split("@")[0])
          );
        }
        if (group.kind === "plugin" && item.location && entry.location)
          return normalizePath(item.location) === normalizePath(entry.location);
        if (group.kind === "plugin" && entry.availability === "failed" && entry.name.includes("@"))
          return item.name === entry.name;
        return uniqueName && normalizeName(identity(entry)) === name;
      });
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
      if (item.enabled === false) return { ...item, availability: "disabled" };
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
      items: [
        ...items,
        ...(options.appendRuntimeEntries === false
          ? []
          : reported.filter((item) => !matched.has(item))),
      ],
    };
  });
  const disabledParents = disabledPluginIds(merged);
  return disabledParents.size
    ? merged.map((group) => withoutDisabledChildren(group, disabledParents))
    : merged;
}
