import type {
  AgentExtensionGroup,
  AgentExtensionItem,
  AgentExtensionKind,
} from "@/agentMode/session/extensionInventory";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseToml } from "smol-toml";
import { parse as parseYaml } from "yaml";

export interface ExtensionFs {
  read(path: string): Promise<string>;
  list(path: string): Promise<string[]>;
  realpath(path: string): Promise<string>;
}

export interface ExtensionDiscoveryInput {
  home: string;
  cwd: string | null;
  env: Readonly<Record<string, string | undefined>>;
  fs?: ExtensionFs;
  disabledSkills?: readonly string[];
}

type JsonObject = Record<string, unknown>;
type ExtensionSource = AgentExtensionItem["source"];
const EMPTY_OBJECT: JsonObject = Object.freeze({});
const KINDS: readonly AgentExtensionKind[] = [
  "skill",
  "mcp",
  "plugin",
  "command",
  "hook",
  "subagent",
];

export function object(value: unknown): JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : EMPTY_OBJECT;
}

export function extensionDiscoveryInput(
  cwd: string | null,
  overrides: Readonly<Record<string, string>> = {}
): ExtensionDiscoveryInput {
  const env = { ...process.env, ...overrides };
  return {
    cwd,
    home:
      env.HOME || env.USERPROFILE || requireNodeModule<typeof import("node:os")>("os").homedir(),
    env,
  };
}

export class ExtensionInventoryReader {
  readonly path = requireNodeModule<typeof import("node:path")>("path");
  private readonly fs: ExtensionFs;
  private readonly items = new Map<AgentExtensionKind, Map<string, AgentExtensionItem>>();
  private readonly warnings = new Map<AgentExtensionKind, Set<string>>();
  private parentPluginId?: string;

  constructor(readonly input: ExtensionDiscoveryInput) {
    const fs = input.fs
      ? null
      : requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    this.fs = input.fs ?? {
      read: (path) => fs!.readFile(path, "utf8"),
      list: (path) => fs!.readdir(path),
      realpath: (path) => fs!.realpath(path),
    };
    for (const kind of KINDS) {
      this.items.set(kind, new Map());
      this.warnings.set(kind, new Set());
    }
  }

  add(kind: AgentExtensionKind, item: AgentExtensionItem): AgentExtensionItem {
    const previous = this.items.get(kind)!.get(item.id);
    const inherited = this.parentPluginId && kind !== "plugin";
    const next = {
      ...previous,
      ...item,
      kind,
      ...(kind === "plugin" &&
      previous?.target &&
      item.target &&
      item.enabled === undefined &&
      (previous.target.scope.kind === "project" || item.target.scope.kind === "user")
        ? { target: previous.target }
        : {}),
      ...(inherited ? { parentPluginId: this.parentPluginId, readOnly: true } : {}),
      ...(inherited && item.target && this.items.get("plugin")?.get(this.parentPluginId!)?.target
        ? {
            target: {
              ...item.target,
              scope: this.items.get("plugin")!.get(this.parentPluginId!)!.target!.scope,
            },
          }
        : {}),
      capabilities: inherited
        ? { edit: false, delete: false, toggle: false }
        : (item.capabilities ??
          previous?.capabilities ?? { edit: kind !== "plugin", delete: true, toggle: true }),
      enabled: item.enabled ?? previous?.enabled,
    };
    this.items.get(kind)!.set(item.id, next);
    return next;
  }

  pluginRule(pattern: string, enabled: boolean): void {
    for (const [id, item] of this.items.get("plugin")!) {
      if (pattern === "*" || (pattern.endsWith(".*") && id.startsWith(pattern.slice(0, -1))))
        this.items.get("plugin")!.set(id, { ...item, enabled });
    }
  }

  async skillConfiguration(value: unknown): Promise<void> {
    if (!Array.isArray(value)) return;
    for (const entry of value) {
      const config = object(entry);
      if (typeof config.path !== "string" || typeof config.enabled !== "boolean") continue;
      let canonical: string;
      try {
        canonical = await this.fs.realpath(config.path);
      } catch {
        continue;
      }
      for (const [id, item] of this.items.get("skill")!) {
        if (item.location === canonical || this.path.dirname(item.location || "") === canonical)
          this.items.get("skill")!.set(id, { ...item, enabled: config.enabled });
      }
    }
  }

  async plugin(
    root: string,
    id: string,
    manifest: Record<string, unknown>,
    enabled?: boolean
  ): Promise<void> {
    const plugin = this.add("plugin", { id, name: id, source: "plugin", location: root, enabled });
    const previousPlugin = this.parentPluginId;
    this.parentPluginId = id;
    const pluginName = typeof manifest.name === "string" ? manifest.name : id.split("@")[0];
    const paths = (value: unknown, fallback: string): string[] =>
      (Array.isArray(value) ? value : [value ?? fallback])
        .filter((path): path is string => typeof path === "string")
        .map((path) => this.path.resolve(root, path))
        .filter(
          (path) =>
            path === this.path.resolve(root) ||
            path.startsWith(`${this.path.resolve(root)}${this.path.sep}`)
        );
    for (const folder of new Set([
      this.path.join(root, "skills"),
      ...paths(manifest.skills, "./skills"),
    ]))
      await this.markdown(folder, "plugin", "skill", false, "", plugin.enabled, `${pluginName}:`);
    for (const folder of paths(manifest.commands, "./commands"))
      await this.markdown(
        folder,
        "plugin",
        "command",
        false,
        `${id.split("@")[0]}:`,
        plugin.enabled,
        `${pluginName}:`
      );
    for (const [name, value] of Object.entries(object(manifest.commands))) {
      const command = object(value);
      const source = typeof command.source === "string" ? paths(command.source, "")[0] : undefined;
      if (
        source ? (await this.text(source, "command")) === null : typeof command.content !== "string"
      )
        continue;
      this.add("command", {
        id: `${id.split("@")[0]}:${name}`,
        name: `${id.split("@")[0]}:${name}`,
        runtimeName: `${pluginName}:${name}`,
        source: "plugin",
        enabled: plugin.enabled,
        description: typeof command.description === "string" ? command.description : undefined,
        location: source,
        target: {
          path: source ?? this.path.join(root, ".claude-plugin", "plugin.json"),
          format: source ? "markdown" : "json",
          ...(source ? {} : { keyPath: ["commands", name] }),
          scope: { kind: "user" },
        },
      });
    }
    for (const folder of paths(manifest.agents, "./agents"))
      await this.markdown(
        folder,
        "plugin",
        "subagent",
        false,
        "",
        plugin.enabled,
        `${pluginName}:`
      );
    for (const [field, fallback, kind] of [
      ["mcpServers", "./.mcp.json", "mcp"],
      ["hooks", "./hooks/hooks.json", "hook"],
    ] as const) {
      const declared = manifest[field];
      const entries = [
        fallback,
        ...(Array.isArray(declared) ? declared : declared === undefined ? [] : [declared]),
      ];
      for (const [index, entry] of entries.entries()) {
        const file = typeof entry === "string" ? paths(entry, fallback)[0] : undefined;
        if (typeof entry === "string" && !file) continue;
        if (file && !file.endsWith(".json")) {
          this.warn(kind, "Some plugin components require an agent check to be listed.");
          continue;
        }
        const config = file ? await this.config(file) : object(entry);
        const nested = config[field] !== undefined;
        const keyPrefix: (string | number)[] = file
          ? []
          : [field, ...(Array.isArray(declared) ? [index - 1] : [])];
        if (nested) keyPrefix.push(field);
        const location = file ?? this.path.join(root, ".claude-plugin", "plugin.json");
        if (kind === "mcp")
          this.named(
            "mcp",
            nested ? config[field] : config,
            "plugin",
            plugin.enabled,
            `${id}:`,
            `plugin:${pluginName}:`,
            location,
            keyPrefix
          );
        else
          this.hooks(
            nested ? config[field] : config,
            "plugin",
            location,
            plugin.enabled,
            keyPrefix
          );
      }
    }
    this.parentPluginId = previousPlugin;
  }

  warn(kind: AgentExtensionKind, message: string): void {
    this.warnings.get(kind)!.add(message);
  }

  async text(path: string, kind: AgentExtensionKind): Promise<string | null> {
    try {
      return await this.fs.read(path);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "EISDIR"
      )
        this.warn(kind, "Some local files could not be read.");
      return null;
    }
  }

  async list(path: string, kind: AgentExtensionKind): Promise<string[]> {
    try {
      return (await this.fs.list(path)).sort();
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== "ENOENT" &&
        (error as NodeJS.ErrnoException).code !== "ENOTDIR"
      )
        this.warn(kind, "Some local files could not be read.");
      return [];
    }
  }

  parse(content: string, format: "json" | "toml"): JsonObject {
    try {
      if (format === "toml") return object(parseToml(content));
      const errors: ParseError[] = [];
      const value: unknown = parseJsonc(content, errors, { allowTrailingComma: true });
      if (errors.length || !value || typeof value !== "object" || Array.isArray(value))
        throw new Error("invalid configuration");
      return object(value);
    } catch {
      for (const kind of KINDS) this.warn(kind, "Some configuration files could not be read.");
      return {};
    }
  }

  async config(path: string, format: "json" | "toml" = "json"): Promise<JsonObject> {
    const content = await this.text(path, "plugin");
    return content === null ? {} : this.parse(content, format);
  }

  named(
    kind: "mcp" | "plugin" | "command",
    value: unknown,
    source: ExtensionSource,
    enabled?: boolean,
    prefix = "",
    runtimePrefix = "",
    targetPath?: string,
    keyPrefix: readonly (string | number)[] = []
  ): void {
    for (const [name, config] of Object.entries(object(value))) {
      const data = object(config);
      this.add(kind, {
        id: `${prefix}${name}`,
        name: `${prefix}${name}`,
        ...(runtimePrefix ? { runtimeName: `${runtimePrefix}${name}` } : {}),
        source,
        ...(targetPath
          ? {
              target: {
                path: targetPath,
                format: "json" as const,
                keyPath: [...keyPrefix, name],
                scope:
                  source === "project" && this.input.cwd
                    ? { kind: "project" as const, cwd: this.input.cwd }
                    : { kind: "user" as const },
              },
            }
          : {}),
        enabled:
          enabled === false
            ? false
            : typeof config === "boolean"
              ? config
              : typeof data.enabled === "boolean"
                ? data.enabled
                : undefined,
        description: typeof data.description === "string" ? data.description : undefined,
      });
    }
  }

  hooks(
    value: unknown,
    source: ExtensionSource,
    location: string,
    enabled?: boolean,
    keyPrefix: readonly (string | number)[] = ["hooks"]
  ): void {
    for (const [event, groups] of Object.entries(object(value))) {
      if (!Array.isArray(groups)) continue;
      groups.forEach((group, index) => {
        const data = object(group);
        if (!Array.isArray(data.hooks)) return;
        data.hooks.forEach((_hook: unknown, hookIndex: number) => {
          this.add("hook", {
            id: `${location}:${JSON.stringify(keyPrefix)}:${event}:${index}:${hookIndex}`,
            name: event,
            source,
            location,
            target: {
              path: location,
              format: "json",
              keyPath: [...keyPrefix, event, index, "hooks", hookIndex],
              scope:
                source === "project" && this.input.cwd
                  ? { kind: "project", cwd: this.input.cwd }
                  : { kind: "user" },
            },
            enabled: enabled === false ? false : undefined,
          });
        });
      });
    }
  }

  async markdown(
    root: string,
    source: ExtensionSource,
    kind: "skill" | "command" | "subagent",
    byFileId = false,
    prefix = "",
    enabled?: boolean,
    runtimePrefix = ""
  ): Promise<void> {
    const visited = new Set<string>();
    const visit = async (folder: string, relative: string, depth: number): Promise<void> => {
      if (depth > 6) {
        this.warn(kind, "Some folders exceed the discovery depth limit.");
        return;
      }
      let canonical: string;
      try {
        canonical = await this.fs.realpath(folder);
      } catch {
        return;
      }
      if (visited.has(canonical)) return;
      visited.add(canonical);
      const names = await this.list(folder, kind);
      if (kind === "skill" && (names.includes("SKILL.md") || names.includes("SKILL.md.disabled"))) {
        await read(
          this.path.join(folder, names.includes("SKILL.md") ? "SKILL.md" : "SKILL.md.disabled"),
          this.path.basename(folder)
        );
        return;
      }
      for (const name of names) {
        if (name.startsWith(".") || name === "node_modules") continue;
        const path = this.path.join(folder, name);
        const rel = relative ? `${relative}/${name}` : name;
        if (
          (name.endsWith(".md") || name.endsWith(".md.disabled")) &&
          (kind === "command" || kind === "subagent" || (byFileId && !relative))
        )
          await read(path, rel.replace(/\.md(?:\.disabled)?$/, ""));
        else if (!name.endsWith(".md")) await visit(path, rel, depth + 1);
      }
    };
    const read = async (location: string, fileId: string): Promise<void> => {
      const content = await this.text(location, kind);
      if (content === null) return;
      let metadata: JsonObject = {};
      const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
      try {
        if (match) metadata = object(parseYaml(match[1]));
      } catch {
        this.warn(kind, "Some extension descriptions could not be read.");
        return;
      }
      if (
        kind === "skill" &&
        (!match || typeof metadata.name !== "string" || typeof metadata.description !== "string")
      ) {
        this.warn(kind, "Some extension descriptions could not be read.");
        return;
      }
      let canonical: string;
      try {
        canonical = await this.fs.realpath(location);
      } catch {
        this.warn(kind, "Some local files could not be read.");
        return;
      }
      const name =
        kind === "command"
          ? `${prefix}${fileId}`
          : typeof metadata.name === "string"
            ? metadata.name
            : fileId;
      this.add(kind, {
        id: kind === "command" ? name : byFileId ? fileId : canonical,
        name,
        ...(runtimePrefix
          ? {
              runtimeName: `${runtimePrefix}${kind === "command" ? fileId : name}`,
            }
          : {}),
        description: typeof metadata.description === "string" ? metadata.description : undefined,
        source,
        location: canonical,
        ...(!this.parentPluginId && this.path.resolve(canonical) !== this.path.resolve(location)
          ? { readOnly: true, capabilities: { edit: false, delete: false, toggle: false } }
          : {}),
        enabled: canonical.endsWith(".disabled") ? false : enabled,
        target: {
          path: canonical,
          format: "markdown",
          disabled: canonical.endsWith(".disabled"),
          scope:
            source === "project" && this.input.cwd
              ? { kind: "project", cwd: this.input.cwd }
              : { kind: "user" },
        },
      });
    };
    if (kind !== "skill" && /\.md(?:\.disabled)?$/.test(root))
      await read(root, this.path.basename(root).replace(/\.md(?:\.disabled)?$/, ""));
    else await visit(root, "", 0);
  }

  result(unavailable: readonly AgentExtensionKind[] = []): readonly AgentExtensionGroup[] {
    for (const [id, item] of this.items.get("skill")!) {
      if (this.input.disabledSkills?.includes(id) || this.input.disabledSkills?.includes(item.name))
        this.items.get("skill")!.set(id, { ...item, enabled: false });
    }
    return KINDS.map((kind) => ({
      kind,
      status: unavailable.includes(kind) ? "unavailable" : "partial",
      items: [...this.items.get(kind)!.values()],
      warnings: [...this.warnings.get(kind)!],
    }));
  }
}
