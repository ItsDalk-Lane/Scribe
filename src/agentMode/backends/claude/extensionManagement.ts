import { applyEdits, modify, parse as parseJsonc, type ParseError } from "jsonc-parser";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { discoverClaudeExtensions } from "./discoverExtensions";
import {
  object,
  type ExtensionDiscoveryInput,
  type ExtensionFs,
} from "@/agentMode/backends/shared/extensionInventory";
import type {
  AgentExtensionGroup,
  AgentExtensionItem,
  AgentExtensionKind,
} from "@/agentMode/session/extensionInventory";
import type {
  AgentExtensionCapabilities,
  AgentExtensionDetails,
  AgentExtensionDraft,
  AgentExtensionImport,
  AgentExtensionManager,
  AgentExtensionScope,
  AgentExtensionTarget,
  AgentMarketplace,
  AgentPluginAction,
} from "@/agentMode/session/extensionManagement";
import { requireNodeModule } from "@/utils/desktopRuntime";
import { testMcpConnection } from "@/agentMode/sdk/testMcpConnection";
import { HOOK_EVENTS } from "@anthropic-ai/claude-agent-sdk";

export interface ClaudeExtensionFs extends ExtensionFs {
  write(path: string, content: string): Promise<void>;
  mkdir(path: string): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
  removeTree(path: string): Promise<void>;
}

export interface ClaudeExtensionManagerInput extends ExtensionDiscoveryInput {
  binaryPath?: string | null;
  io?: ClaudeExtensionFs;
  run?: (
    file: string,
    args: readonly string[],
    cwd: string | undefined,
    env: Readonly<Record<string, string | undefined>>
  ) => Promise<string>;
}

const FILE_QUEUES = new Map<string, Promise<unknown>>();
const MODEL_HOOK_EVENTS = new Set([
  "PermissionDenied",
  "PostToolBatch",
  "PostToolUse",
  "PostToolUseFailure",
  "PreToolUse",
  "Stop",
  "SubagentStop",
  "TaskCompleted",
  "TaskCreated",
  "TeammateIdle",
  "UserPromptExpansion",
  "UserPromptSubmit",
]);
const NO_HOOK_EVENTS: readonly string[] = Object.freeze([]);

export class ClaudeExtensionManager implements AgentExtensionManager {
  private readonly path = requireNodeModule<typeof import("node:path")>("path");
  private readonly io: ClaudeExtensionFs;
  private readonly configDir: string;
  private readonly env: Readonly<Record<string, string | undefined>>;
  private readonly knownScopes = new Map<string, AgentExtensionScope>();
  private readonly inventories = new Map<string, Promise<readonly AgentExtensionGroup[]>>();
  private readonly pluginChildren = new Map<string, readonly AgentExtensionItem[]>();

  constructor(private readonly input: ClaudeExtensionManagerInput) {
    const fs = input.io
      ? null
      : requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    this.io = input.io ?? {
      read: (path) => fs!.readFile(path, "utf8"),
      list: (path) => fs!.readdir(path),
      realpath: (path) => fs!.realpath(path),
      write: (path, content) => fs!.writeFile(path, content, { encoding: "utf8", mode: 0o600 }),
      mkdir: async (path) => {
        await fs!.mkdir(path, { recursive: true });
      },
      rename: (from, to) => fs!.rename(from, to),
      remove: async (path) => {
        await fs!.unlink(path);
      },
      removeTree: async (path) => {
        await fs!.rm(path, { recursive: true });
      },
    };
    this.configDir = input.env.CLAUDE_CONFIG_DIR
      ? this.path.resolve(input.cwd ?? input.home, input.env.CLAUDE_CONFIG_DIR)
      : this.path.join(input.home, ".claude");
    this.env = input.env.CLAUDE_CONFIG_DIR
      ? { ...input.env, CLAUDE_CONFIG_DIR: this.configDir }
      : input.env;
  }

  async list(
    kind: AgentExtensionKind,
    scope: AgentExtensionScope
  ): Promise<readonly AgentExtensionItem[]> {
    this.validateScope(scope);
    const listingKey = scope.kind === "project" ? `project:${scope.cwd}` : "user";
    let listing = this.inventories.get(listingKey);
    if (!listing) {
      listing = this.readPluginList(scope)
        .catch(() => undefined)
        .then((installedPlugins) =>
          discoverClaudeExtensions(
            {
              ...this.input,
              env: this.env,
              fs: this.io,
              cwd: scope.kind === "project" ? scope.cwd : null,
            },
            installedPlugins
          )
        )
        .finally(() => this.inventories.delete(listingKey));
      this.inventories.set(listingKey, listing);
    }
    const groups = await listing;
    const unavailablePlugins = new Set(
      groups
        .find((group) => group.kind === "plugin")
        ?.items.filter((item) => item.canDisable === false)
        .map((item) => item.id)
    );
    const seen = new Set<string>();
    // Each scope's list holds only entries whose write target lives in that scope; entries from
    // other scopes are invisible here instead of appearing as read-only inherited rows.
    // https://github.com/ItsDalk-Lane/Scribe/issues/6
    return (groups.find((group) => group.kind === kind)?.items ?? []).flatMap((item) => {
      const targetScope = item.target?.scope;
      if (
        !targetScope ||
        (scope.kind === "user" && targetScope.kind !== "user") ||
        (scope.kind === "project" &&
          (targetScope.kind !== "project" ||
            this.path.resolve(targetScope.cwd) !== this.path.resolve(scope.cwd))) ||
        (item.parentPluginId && unavailablePlugins.has(item.parentPluginId))
      )
        return [];
      const key = `${item.parentPluginId ?? ""}:${item.target!.path}:${JSON.stringify(item.target!.keyPath ?? [])}:${item.name}`;
      if (seen.has(key)) return [];
      seen.add(key);
      if (kind === "plugin") {
        this.pluginChildren.set(
          `${item.target!.path}:${item.id}`,
          groups.flatMap((group) => group.items.filter((child) => child.parentPluginId === item.id))
        );
      }
      return [item];
    });
  }

  async details(item: AgentExtensionItem): Promise<AgentExtensionDetails> {
    const target = this.target(item);
    const text = await this.read(target.path);
    const implicitPlugin =
      item.kind === "plugin" &&
      target.format === "json" &&
      target.keyPath?.[0] === "enabledPlugins";
    const children =
      item.kind === "plugin" ? this.pluginChildren.get(`${target.path}:${item.id}`) : undefined;
    if (text === null && implicitPlugin)
      return { item, revision: this.revision(null), config: {}, children };
    if (text === null) throw new Error("配置文件已不存在，请刷新列表。");
    if (target.format === "markdown")
      return {
        item,
        revision: this.revision(text),
        content: text,
        config: this.markdownMetadata(text),
      };
    const document = this.parse(text);
    const value = this.at(document, target.keyPath ?? []);
    if (value === undefined && !implicitPlugin) throw new Error("配置项目已变化，请刷新列表。");
    const config = {
      ...(target.disabled && (item.kind === "hook" || item.kind === "mcp")
        ? object(object(value).config)
        : typeof value === "boolean"
          ? { enabled: value }
          : object(value)),
    };
    if (item.kind === "hook" && !target.disabled) {
      config.event = String(target.keyPath![1]);
      const group = object(this.at(document, target.keyPath!.slice(0, -2)));
      if (typeof group.matcher === "string") config.matcher = group.matcher;
    }
    if (item.kind === "hook" && target.disabled) {
      const stored = object(value),
        original = object(stored.item) as unknown as AgentExtensionItem;
      config.event = original.target?.keyPath?.[1];
      const group = object(stored.group);
      if (typeof group.matcher === "string") config.matcher = group.matcher;
    }
    return {
      item,
      revision: this.revision(text),
      config,
      ...(children ? { children } : {}),
      ...(item.kind === "hook" ? { hookEvents: this.hookEvents(config.type) } : {}),
    };
  }

  async save(draft: AgentExtensionDraft): Promise<void> {
    this.validateScope(draft.scope);
    if (draft.name !== draft.original?.item.name) this.validateName(draft.name);
    if (draft.kind === "plugin") throw new Error("请通过插件安装或启用操作管理插件。");
    const target = draft.original ? this.writable(draft.original, "edit") : this.newTarget(draft);
    if (JSON.stringify(target.scope) !== JSON.stringify(draft.scope))
      throw new Error("编辑不能改变配置来源。");
    if (target.format === "markdown") {
      const content = this.markdownContent(draft);
      const renamed =
        draft.original && draft.name !== draft.original.item.name
          ? this.newTarget(draft).path + (target.disabled ? ".disabled" : "")
          : undefined;
      if (renamed && (await this.read(renamed)) !== null) throw new Error("同名项目已经存在。");
      if (renamed) await this.assertSafePath(renamed, draft.scope);
      if (renamed && draft.kind === "skill")
        await this.assertMissingDirectory(this.path.dirname(renamed));
      await this.change(target.path, draft.original?.revision, async (old) => {
        if (!draft.original && old !== null) throw new Error("同名项目已经存在。");
        return content;
      });
      if (renamed) {
        try {
          await this.assertRevision(target.path, this.revision(content));
          if (draft.kind === "skill") {
            await this.io.mkdir(this.path.dirname(this.path.dirname(renamed)));
            await this.io.rename(this.path.dirname(target.path), this.path.dirname(renamed));
          } else {
            await this.io.mkdir(this.path.dirname(renamed));
            await this.io.rename(target.path, renamed);
          }
        } catch (error) {
          if (draft.original?.content !== undefined)
            await this.change(
              target.path,
              this.revision(content),
              async () => draft.original!.content!
            );
          throw error;
        }
      }
      return;
    }
    const config = { ...draft.original?.config, ...draft.config };
    this.validateConfig(draft.kind, config);
    await this.change(target.path, draft.original?.revision, async (old) => {
      let content = old ?? "{}";
      let path = [...target.keyPath!];
      const current = this.at(this.parse(content), path);
      if (!draft.original && draft.kind !== "hook" && current !== undefined)
        throw new Error("同名项目已经存在。");
      if (target.disabled && (draft.kind === "hook" || draft.kind === "mcp")) {
        const savedConfig = { ...config };
        if (draft.kind === "hook") {
          delete savedConfig.event;
          delete savedConfig.matcher;
          if (typeof config.event === "string")
            content = this.patch(content, [...path, "item", "target", "keyPath", 1], config.event);
          if (typeof config.matcher === "string")
            content = this.patch(
              content,
              [...path, "group", "matcher"],
              config.matcher || undefined
            );
        }
        content = this.patch(content, [...path, "config"], savedConfig);
        if (draft.kind === "mcp" && draft.original && draft.name !== draft.original.item.name) {
          content = this.patch(content, [...path, "item", "name"], draft.name);
          content = this.patch(content, [...path, "item", "id"], draft.name);
          const savedItem = object(
            this.at(this.parse(content), [...path, "item"])
          ) as unknown as AgentExtensionItem;
          const oldPath = savedItem.target?.keyPath;
          if (!oldPath?.length) throw new Error("停用配置不完整。");
          content = this.patch(
            content,
            [...path, "item", "target", "keyPath"],
            [...oldPath.slice(0, -1), draft.name]
          );
        }
      } else if (draft.kind === "hook") {
        const event =
          typeof config.event === "string"
            ? config.event
            : draft.original
              ? String(path[1])
              : draft.name;
        const hook = { ...config };
        if (!this.hookEvents(config.type).includes(event))
          throw new Error("请选择有效的钩子触发事件。");
        delete hook.event;
        delete hook.matcher;
        if (!draft.original) {
          const groupsPath = ["hooks", event],
            groups = this.at(this.parse(content), groupsPath);
          if (groups !== undefined && !Array.isArray(groups))
            throw new Error("钩子配置格式不正确。");
          content = this.patch(content, groupsPath, [
            ...(Array.isArray(groups) ? groups : []),
            {
              ...(typeof config.matcher === "string" && config.matcher
                ? { matcher: config.matcher }
                : {}),
              hooks: [hook],
            },
          ]);
        } else {
          const oldGroup = { ...object(this.at(this.parse(content), path.slice(0, -2))) };
          if (
            event !== path[1] ||
            (typeof config.matcher === "string" && config.matcher !== (oldGroup.matcher ?? ""))
          ) {
            delete oldGroup.hooks;
            content = this.patch(content, path, undefined);
            const newGroups = this.at(this.parse(content), ["hooks", event]);
            content = this.patch(
              content,
              ["hooks", event],
              [
                ...(Array.isArray(newGroups) ? newGroups : []),
                {
                  ...oldGroup,
                  ...(typeof config.matcher === "string"
                    ? { matcher: config.matcher || undefined }
                    : {}),
                  hooks: [hook],
                },
              ]
            );
            return content;
          }
          content = this.patch(content, path, hook);
          if (typeof config.matcher === "string")
            content = this.patch(
              content,
              [...path.slice(0, -2), "matcher"],
              config.matcher || undefined
            );
        }
      } else {
        if (draft.original && draft.name !== draft.original.item.name) {
          const renamed = [...path.slice(0, -1), draft.name];
          if (this.at(this.parse(content), renamed) !== undefined)
            throw new Error("同名项目已经存在。");
          content = this.patch(content, path, undefined);
          path = renamed;
        }
        content = this.patch(content, path, config);
      }
      return content;
    });
  }

  async toggle(details: AgentExtensionDetails, enabled: boolean): Promise<void> {
    if (enabled ? details.item.canEnable === false : details.item.canDisable === false)
      throw new Error(details.item.unavailableReason ?? "此插件不能在当前范围切换。");
    const target = this.writable(details, "toggle");
    if (target.format === "markdown") {
      if (Boolean(target.disabled) === !enabled) return;
      const next = enabled ? target.path.replace(/\.disabled$/, "") : `${target.path}.disabled`;
      await this.lock(target.path, async () => {
        await this.assertRevision(target.path, details.revision);
        await this.assertSafePath(next, target.scope);
        if ((await this.read(next)) !== null) throw new Error("目标文件已经存在，请刷新列表。");
        await this.io.rename(target.path, next);
      });
      return;
    }
    if (details.item.kind === "plugin") {
      await this.change(target.path, details.revision, async (old) => {
        const path = target.keyPath!;
        return this.patch(
          old ?? "{}",
          path[0] === "localPlugins" ? [...path, "enabled"] : path,
          enabled
        );
      });
      return;
    }
    if (details.item.kind !== "hook" && details.item.kind !== "mcp")
      throw new Error("此项目不支持独立启用开关。");
    await this.toggleStructured(details, enabled);
  }

  async delete(details: AgentExtensionDetails): Promise<void> {
    const target = this.writable(details, "delete");
    if (details.item.kind === "plugin" && target.keyPath?.[0] === "localPlugins") {
      await this.change(target.path, details.revision, async (old) => {
        const reference = object(this.at(this.parse(old!), target.keyPath!));
        if (typeof reference.path !== "string") throw new Error("未找到本地插件引用。");
        const pluginPath = this.path.resolve(reference.path);
        if ((await this.read(this.path.join(pluginPath, ".claude-plugin", "plugin.json"))) === null)
          throw new Error("本地插件目录不存在或不是插件目录，未删除任何文件。");
        await this.io.removeTree(pluginPath);
        return this.patch(old!, target.keyPath!, undefined);
      });
      return;
    }
    if (details.item.kind === "plugin" && target.keyPath?.[0] !== "localPlugins") {
      await this.assertRevision(target.path, details.revision);
      await this.pluginAction({
        action: "uninstall",
        scope: target.scope,
        plugin: details.item.id,
        installationScope: details.item.installationScope,
      });
      return;
    }
    if (target.format === "markdown") {
      await this.lock(target.path, async () => {
        await this.assertRevision(target.path, details.revision);
        const trash = this.path.join(
          this.scopeDir(target.scope),
          ".scribe",
          "trash",
          `${requireNodeModule<typeof import("node:crypto")>("crypto").randomUUID()}-${this.path.basename(details.item.kind === "skill" ? this.path.dirname(target.path) : target.path)}`
        );
        await this.assertSafePath(trash, target.scope);
        await this.io.mkdir(this.path.dirname(trash));
        await this.io.rename(
          details.item.kind === "skill" ? this.path.dirname(target.path) : target.path,
          trash
        );
      });
      return;
    }
    await this.change(target.path, details.revision, async (old) =>
      this.patch(old!, target.keyPath!, undefined)
    );
  }

  async import(input: AgentExtensionImport): Promise<void> {
    if (input.kind === "plugin") throw new Error("请从插件市场或本地目录添加插件。");
    const parsed = this.parse(input.content);
    const entries = input.kind === "mcp" ? object(parsed.mcpServers ?? parsed) : parsed;
    const drafts = Object.entries(entries).map(
      ([name, value]): AgentExtensionDraft => ({
        kind: input.kind,
        scope: input.scope,
        name,
        ...(typeof value === "string" ? { content: value } : { config: object(value) }),
      })
    );
    if (!drafts.length) throw new Error("导入内容没有可用项目。");
    for (const draft of drafts) {
      this.validateName(draft.name);
      this.validateScope(draft.scope);
      if (draft.kind === "mcp" || draft.kind === "hook")
        this.validateConfig(draft.kind, draft.config ?? {});
      const target = this.newTarget(draft);
      const text = await this.read(target.path);
      if (
        text !== null &&
        (target.format === "markdown" || this.at(this.parse(text), target.keyPath!) !== undefined)
      )
        throw new Error(`同名项目已存在：${draft.name}`);
    }
    let completed = 0;
    for (const draft of drafts) {
      try {
        await this.save(draft);
        completed += 1;
      } catch {
        throw new Error(`已导入 ${completed} 项，后续项目未能保存。请刷新列表后检查剩余配置。`);
      }
    }
  }

  async pluginAction(input: AgentPluginAction): Promise<void> {
    this.validateScope(input.scope);
    if (
      input.installationScope &&
      (input.installationScope === "user") !== (input.scope.kind === "user")
    )
      throw new Error("此插件安装在其他配置范围，请切换到对应来源后管理。");
    if (!input.plugin || input.plugin.startsWith("-"))
      throw new Error("请填写有效的插件名称或目录。");
    if (input.plugin.startsWith("local:")) {
      const state = await this.read(this.statePath(input.scope));
      const reference = object(
        object(state ? this.parse(state).localPlugins : undefined)[input.plugin]
      );
      if (typeof reference.path !== "string") throw new Error("未找到本地插件引用。");
      await this.pluginAction({ ...input, plugin: reference.path, local: true });
      return;
    }
    if (input.local) {
      const pluginPath = this.path.resolve(input.plugin);
      const manifestPath = this.path.join(pluginPath, ".claude-plugin", "plugin.json");
      const manifestText = await this.read(manifestPath);
      if (manifestText === null) throw new Error("此目录没有 Claude 插件清单。");
      const manifest = this.parse(manifestText);
      const name =
        typeof manifest.name === "string" ? manifest.name : this.path.basename(pluginPath);
      this.validateName(name);
      await this.change(this.statePath(input.scope), undefined, async (old) => {
        const reference = object(
          object(old ? this.parse(old).localPlugins : undefined)[`local:${name}`]
        );
        return this.patch(
          old ?? "{}",
          ["localPlugins", `local:${name}`],
          input.action === "uninstall"
            ? undefined
            : { ...reference, path: pluginPath, enabled: reference.enabled !== false }
        );
      });
      return;
    }
    const args = [
      "plugin",
      input.action,
      input.plugin,
      "--scope",
      input.installationScope ?? (input.scope.kind === "user" ? "user" : "project"),
    ];
    if (input.marketplace && input.action === "install") {
      if (input.marketplace.startsWith("-")) throw new Error("插件市场来源无效。");
      args.push("--marketplace", input.marketplace);
    }
    if (input.action === "uninstall") args.push("--keep-data");
    await this.run(args, input.scope.kind === "project" ? input.scope.cwd : undefined);
  }

  async marketplaces(): Promise<readonly AgentMarketplace[]> {
    const registryText = await this.read(
      this.path.join(this.configDir, "plugins", "known_marketplaces.json")
    );
    if (registryText === null) return [];
    const registry = this.parse(registryText),
      result: AgentMarketplace[] = [];
    for (const [name, value] of Object.entries(registry)) {
      const entry = object(value);
      const source = object(entry.source);
      const directory =
        typeof entry.installLocation === "string" ? entry.installLocation : undefined;
      const manifestText = directory
        ? await this.read(this.path.join(directory, ".claude-plugin", "marketplace.json"))
        : null;
      const manifest = manifestText ? this.parse(manifestText) : {};
      const plugins = Array.isArray(manifest.plugins)
        ? manifest.plugins.flatMap((value) => {
            const spec = object(value);
            return typeof spec.name === "string"
              ? [
                  {
                    id: `${spec.name}@${name}`,
                    name: spec.name,
                    ...(typeof spec.description === "string"
                      ? { description: spec.description }
                      : {}),
                  },
                ]
              : [];
          })
        : [];
      result.push({
        name,
        source:
          typeof source.repo === "string"
            ? source.repo
            : typeof source.url === "string"
              ? source.url
              : (directory ?? name),
        plugins,
      });
    }
    return result;
  }

  async testConnection(draft: AgentExtensionDraft) {
    if (draft.kind !== "mcp") throw new Error("只能检查 MCP 连接。");
    this.validateScope(draft.scope);
    this.validateName(draft.name);
    this.validateConfig("mcp", draft.config ?? {});
    if (!this.input.binaryPath) throw new Error("未找到可用的 Claude Code。");
    return testMcpConnection({
      binaryPath: this.input.binaryPath,
      cwd: draft.scope.kind === "project" ? draft.scope.cwd : (this.input.cwd ?? undefined),
      env: this.env,
      name: draft.name,
      config: draft.config!,
    });
  }

  async localPlugins(
    cwd: string | null = this.input.cwd
  ): Promise<readonly { type: "local"; path: string }[]> {
    const scopes: AgentExtensionScope[] = [
      { kind: "user" },
      ...(cwd ? [{ kind: "project" as const, cwd }] : []),
    ];
    const entries = new Map<string, { path: string; enabled: boolean }>();
    for (const scope of scopes) {
      const text = await this.read(this.statePath(scope));
      for (const [id, value] of Object.entries(
        object(text ? this.parse(text).localPlugins : undefined)
      )) {
        const entry = object(value);
        if (typeof entry.path === "string")
          entries.set(id, { path: entry.path, enabled: entry.enabled !== false });
      }
    }
    return [
      ...new Set(
        [...entries.values()]
          .filter((entry) => entry.enabled)
          .map((entry) => this.path.resolve(entry.path))
      ),
    ].map((path) => ({ type: "local", path }));
  }

  private async toggleStructured(details: AgentExtensionDetails, enabled: boolean): Promise<void> {
    const target = details.item.target!,
      statePath = this.statePath(target.scope);
    if (Boolean(target.disabled) === !enabled) return;
    const stateText = await this.read(statePath),
      state = stateText ?? "{}";
    if (enabled) {
      if (this.revision(state) !== details.revision)
        throw new Error("配置已被其他程序修改，请刷新后重试。");
      const stored = object(this.at(this.parse(state), target.keyPath!));
      const original = object(stored.item) as unknown as AgentExtensionItem;
      if (!original.target || !stored.config) throw new Error("停用配置不完整。");
      const destination = original.target,
        activeText = await this.read(destination.path),
        active = activeText ?? "{}";
      let next: string;
      if (details.item.kind === "hook") {
        const event = String(destination.keyPath![1]),
          path = ["hooks", event],
          groups = this.at(this.parse(active), path);
        if (groups !== undefined && !Array.isArray(groups))
          throw new Error("钩子配置已变化，请刷新。");
        const list = Array.isArray(groups) ? [...groups] : [];
        list.push({ ...object(stored.group), hooks: [stored.config] });
        next = this.patch(active, path, list);
      } else {
        if (this.at(this.parse(active), destination.keyPath!) !== undefined)
          throw new Error("同名 MCP 服务器已经存在，未覆盖现有配置。");
        next = this.patch(active, destination.keyPath!, stored.config);
      }
      await this.commitPair(
        destination.path,
        activeText,
        next,
        statePath,
        stateText,
        this.patch(state, target.keyPath!, undefined)
      );
    } else {
      const activeText = await this.read(target.path);
      if (activeText === null || this.revision(activeText) !== details.revision)
        throw new Error("配置已被其他程序修改，请刷新后重试。");
      const group =
        details.item.kind === "hook"
          ? { ...object(this.at(this.parse(activeText), target.keyPath!.slice(0, -2))) }
          : undefined;
      if (group) delete group.hooks;
      const config = { ...details.config };
      if (details.item.kind === "hook") {
        delete config.event;
        delete config.matcher;
      }
      const saved = { item: details.item, config, ...(group ? { group } : {}) };
      const key = [
        details.item.kind === "hook" ? "disabledHooks" : "disabledMcp",
        requireNodeModule<typeof import("node:crypto")>("crypto").randomUUID(),
      ];
      await this.commitPair(
        statePath,
        stateText,
        this.patch(state, key, saved),
        target.path,
        activeText,
        this.patch(activeText, target.keyPath!, undefined)
      );
    }
  }

  private async commitPair(
    firstPath: string,
    firstOld: string | null,
    firstNext: string,
    secondPath: string,
    secondOld: string | null,
    secondNext: string
  ): Promise<void> {
    await this.change(
      firstPath,
      firstOld === null ? undefined : this.revision(firstOld),
      async (current) => {
        if (current !== firstOld) throw new Error("配置已变化，请刷新后重试。");
        return firstNext;
      }
    );
    try {
      await this.change(
        secondPath,
        secondOld === null ? undefined : this.revision(secondOld),
        async (current) => {
          if (current !== secondOld) throw new Error("配置已变化，请刷新后重试。");
          return secondNext;
        }
      );
    } catch (error) {
      await this.change(firstPath, this.revision(firstNext), async () => firstOld ?? "{}");
      throw error;
    }
  }

  private newTarget(draft: AgentExtensionDraft): AgentExtensionTarget {
    const root = this.scopeDir(draft.scope);
    if (draft.kind === "mcp")
      return {
        path:
          draft.scope.kind === "user"
            ? this.path.join(
                this.input.env.CLAUDE_CONFIG_DIR ? this.configDir : this.input.home,
                ".claude.json"
              )
            : this.path.join(draft.scope.cwd, ".mcp.json"),
        format: "json",
        keyPath: ["mcpServers", draft.name],
        scope: draft.scope,
      };
    if (draft.kind === "hook")
      return {
        path: this.settingsPath(draft.scope),
        format: "json",
        keyPath: ["hooks", draft.name, 0, "hooks", 0],
        scope: draft.scope,
      };
    const folder =
      draft.kind === "skill" ? "skills" : draft.kind === "subagent" ? "agents" : "commands";
    return {
      path:
        draft.kind === "skill"
          ? this.path.join(root, folder, draft.name, "SKILL.md")
          : this.path.join(root, folder, `${draft.name}.md`),
      format: "markdown",
      scope: draft.scope,
    };
  }

  private target(item: AgentExtensionItem): AgentExtensionTarget {
    if (!item.target) throw new Error("此项目没有可读取的本地配置。");
    this.validateScope(item.target.scope);
    return item.target;
  }

  private writable(
    details: AgentExtensionDetails,
    operation: keyof AgentExtensionCapabilities
  ): AgentExtensionTarget {
    if (
      details.item.builtin ||
      details.item.readOnly ||
      details.item.parentPluginId ||
      details.item.source === "runtime" ||
      !details.item.capabilities?.[operation]
    )
      throw new Error("内置或插件提供的项目不能单独修改。");
    return this.target(details.item);
  }

  private scopeDir(scope: AgentExtensionScope): string {
    return scope.kind === "user" ? this.configDir : this.path.join(scope.cwd, ".claude");
  }
  private settingsPath(scope: AgentExtensionScope): string {
    return this.path.join(this.scopeDir(scope), "settings.json");
  }
  private statePath(scope: AgentExtensionScope): string {
    return this.path.join(this.scopeDir(scope), ".scribe", "extensions.json");
  }
  private validateScope(scope: AgentExtensionScope): void {
    if (scope.kind === "project" && !this.path.isAbsolute(scope.cwd))
      throw new Error("项目位置必须是完整路径。");
    this.knownScopes.set(this.scopeDir(scope), scope);
  }
  private validateName(name: string): void {
    if (
      !name.trim() ||
      name === "." ||
      name === ".." ||
      /[/\\\0]/.test(name) ||
      name.startsWith("-")
    )
      throw new Error("名称不能为空，不能包含路径分隔符。");
  }
  private validateConfig(kind: AgentExtensionKind, config: Record<string, unknown>): void {
    if (kind === "mcp") {
      if (
        config.type !== undefined &&
        (typeof config.type !== "string" || !["stdio", "http", "sse"].includes(config.type))
      )
        throw new Error("不支持此 MCP 连接方式。");
      if (config.url !== undefined) {
        if (typeof config.url !== "string") throw new Error("MCP 服务地址无效。");
        let address: URL;
        try {
          address = new URL(config.url);
        } catch {
          throw new Error("MCP 服务地址无效。");
        }
        if (!["http:", "https:"].includes(address.protocol))
          throw new Error("MCP 服务地址必须使用 HTTP 或 HTTPS。");
      }
      if (
        config.args !== undefined &&
        (!Array.isArray(config.args) || config.args.some((value) => typeof value !== "string"))
      )
        throw new Error("MCP 参数必须是文本列表。");
    }
    if (
      kind === "mcp" &&
      !(typeof config.command === "string" && config.command.trim()) &&
      !(typeof config.url === "string" && /^https?:\/\//.test(config.url))
    )
      throw new Error("请填写启动命令或 HTTP 服务地址。");
    if (kind === "hook") {
      if (typeof config.event === "string" && !this.hookEvents(config.type).includes(config.event))
        throw new Error("此钩子类型不支持所选触发事件。");
      if (
        config.timeout !== undefined &&
        (typeof config.timeout !== "number" ||
          !Number.isFinite(config.timeout) ||
          config.timeout <= 0)
      )
        throw new Error("超时时间必须大于零。");
      switch (config.type) {
        case "command":
          if (typeof config.command !== "string" || !config.command.trim())
            throw new Error("请填写钩子执行命令。");
          break;
        case "prompt":
        case "agent":
          if (typeof config.prompt !== "string" || !config.prompt.trim())
            throw new Error("请填写钩子提示词。");
          break;
        case "http": {
          let address: URL;
          try {
            if (typeof config.url !== "string") throw new Error();
            address = new URL(config.url);
          } catch {
            throw new Error("钩子服务地址无效。");
          }
          if (!["http:", "https:"].includes(address.protocol))
            throw new Error("钩子服务地址必须使用 HTTP 或 HTTPS。");
          break;
        }
        default:
          throw new Error("不支持此钩子类型，未更改原配置。");
      }
    }
  }
  private hookEvents(type: unknown): readonly string[] {
    switch (type) {
      case "command":
        return HOOK_EVENTS;
      case "http":
        return HOOK_EVENTS.filter((event) => event !== "SessionStart" && event !== "Setup");
      case "prompt":
        return HOOK_EVENTS.filter(
          (event) => MODEL_HOOK_EVENTS.has(event) || event === "PermissionRequest"
        );
      case "agent":
        return HOOK_EVENTS.filter((event) => MODEL_HOOK_EVENTS.has(event));
      default:
        return NO_HOOK_EVENTS;
    }
  }
  private markdownMetadata(content: string): Record<string, unknown> {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    return match ? object(parseYaml(match[1])) : {};
  }
  private markdownContent(draft: AgentExtensionDraft): string {
    const content = draft.content ?? "",
      match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    const metadata: Record<string, unknown> = {
      ...this.markdownMetadata(content),
      ...draft.config,
      ...(draft.kind === "skill" || draft.kind === "subagent" ? { name: draft.name } : {}),
    };
    if (
      (draft.kind === "skill" || draft.kind === "subagent") &&
      typeof metadata.description !== "string"
    )
      throw new Error("请填写说明。");
    return Object.keys(metadata).length
      ? `---\n${stringifyYaml(metadata).trimEnd()}\n---\n${match ? content.slice(match[0].length) : content}`
      : content;
  }
  private parse(text: string): Record<string, unknown> {
    const errors: ParseError[] = [];
    const value: unknown = parseJsonc(text, errors, { allowTrailingComma: true });
    if (errors.length || !value || typeof value !== "object" || Array.isArray(value))
      throw new Error("配置文件格式不正确，未写入任何修改。");
    return value as Record<string, unknown>;
  }
  private at(value: unknown, path: readonly (string | number)[]): unknown {
    let current = value;
    for (const key of path) {
      if (current === null || typeof current !== "object") return undefined;
      current = (current as Record<string | number, unknown>)[key];
    }
    return current;
  }
  private patch(text: string, path: readonly (string | number)[], value: unknown): string {
    this.parse(text);
    return applyEdits(
      text,
      modify(text, [...path], value, { formattingOptions: { insertSpaces: true, tabSize: 2 } })
    );
  }
  private revision(text: string | null): string {
    if (text === null) return "missing";
    return requireNodeModule<typeof import("node:crypto")>("crypto")
      .createHash("sha256")
      .update(text)
      .digest("hex");
  }
  private async read(path: string): Promise<string | null> {
    try {
      return await this.io.read(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw new Error("无法读取配置文件。");
    }
  }
  private async assertRevision(path: string, revision: string): Promise<void> {
    const current = await this.read(path);
    if (this.revision(current) !== revision)
      throw new Error("配置已被其他程序修改，请刷新后重试。");
  }
  private async assertMissingDirectory(path: string): Promise<void> {
    try {
      await this.io.list(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
    throw new Error("同名技能目录已经存在。");
  }
  private async assertSafePath(path: string, scope: AgentExtensionScope): Promise<void> {
    const roots = [
      this.scopeDir(scope),
      ...(scope.kind === "user"
        ? [
            this.path.join(
              this.input.env.CLAUDE_CONFIG_DIR ? this.configDir : this.input.home,
              ".claude.json"
            ),
          ]
        : [
            this.path.join(scope.cwd, ".mcp.json"),
            this.path.join(
              this.input.env.CLAUDE_CONFIG_DIR ? this.configDir : this.input.home,
              ".claude.json"
            ),
          ]),
    ];
    const absolute = this.path.resolve(path);
    if (
      !roots.some(
        (root) =>
          absolute === this.path.resolve(root) ||
          absolute.startsWith(`${this.path.resolve(root)}${this.path.sep}`)
      )
    )
      throw new Error("拒绝修改当前配置范围以外的文件。");
    let existing = absolute;
    while (true) {
      try {
        const actual = await this.io.realpath(existing);
        if (this.path.resolve(actual) !== existing)
          throw new Error("配置路径经过链接，请直接管理原始来源。");
        return;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const parent = this.path.dirname(existing);
        if (parent === existing) throw new Error("配置目录不可访问。");
        existing = parent;
      }
    }
  }
  private async lock<T>(path: string, run: () => Promise<T>): Promise<T> {
    const previous = FILE_QUEUES.get(path) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(run);
    FILE_QUEUES.set(path, task);
    try {
      return await task;
    } finally {
      if (FILE_QUEUES.get(path) === task) FILE_QUEUES.delete(path);
    }
  }
  private async change(
    path: string,
    revision: string | undefined,
    update: (text: string | null) => Promise<string>
  ): Promise<void> {
    const scopes: AgentExtensionScope[] = [
      { kind: "user" },
      ...this.knownScopes.values(),
      ...(this.input.cwd ? [{ kind: "project" as const, cwd: this.input.cwd }] : []),
    ];
    const scope = scopes.find(
      (scope) =>
        path === this.settingsPath(scope) ||
        path.startsWith(`${this.scopeDir(scope)}${this.path.sep}`) ||
        (scope.kind === "project" && path === this.path.join(scope.cwd, ".mcp.json"))
    ) ?? { kind: "user" as const };
    await this.assertSafePath(path, scope);
    await this.lock(path, async () => {
      const old = await this.read(path);
      if (revision !== undefined && this.revision(old) !== revision)
        throw new Error("配置已被其他程序修改，请刷新后重试。");
      const next = await update(old);
      await this.io.mkdir(this.path.dirname(path));
      const temp = `${path}.scribe-${requireNodeModule<typeof import("node:crypto")>("crypto").randomUUID()}.tmp`;
      try {
        await this.io.write(temp, next);
        if ((await this.read(path)) !== old)
          throw new Error("配置已被其他程序修改，请刷新后重试。");
        await this.io.rename(temp, path);
      } finally {
        await this.io.remove(temp).catch(() => undefined);
      }
    });
  }
  private async readPluginList(scope: AgentExtensionScope): Promise<readonly unknown[]> {
    const fs = requireNodeModule<typeof import("node:fs/promises")>("fs/promises");
    const directory =
      scope.kind === "user"
        ? await fs.mkdtemp(
            this.path.join(
              requireNodeModule<typeof import("node:os")>("os").tmpdir(),
              "scribe-plugin-list-"
            )
          )
        : undefined;
    try {
      const records: unknown = JSON.parse(
        await this.run(
          [
            "--setting-sources",
            scope.kind === "user" ? "user" : "user,project,local",
            "plugin",
            "list",
            "--json",
          ],
          scope.kind === "project" ? scope.cwd : directory
        )
      );
      if (
        !Array.isArray(records) ||
        records.some((value) => {
          const record = object(value);
          return (
            typeof record.id !== "string" ||
            typeof record.installPath !== "string" ||
            typeof record.enabled !== "boolean" ||
            !["user", "project", "local"].includes(String(record.scope))
          );
        })
      )
        throw new Error("Claude Code 插件列表格式无效。");
      return records as unknown[];
    } finally {
      if (directory) await fs.rmdir(directory);
    }
  }

  private async run(args: readonly string[], cwd?: string): Promise<string> {
    if (!this.input.binaryPath) throw new Error("未找到可用的 Claude Code。");
    if (this.input.run) return this.input.run(this.input.binaryPath, args, cwd, this.env);
    const child = requireNodeModule<typeof import("node:child_process")>("child_process");
    return new Promise((resolve, reject) =>
      child.execFile(
        this.input.binaryPath!,
        [...args],
        {
          cwd,
          env: { ...process.env, ...this.env },
          timeout: 120000,
          maxBuffer: 2 * 1024 * 1024,
        },
        (error, stdout) =>
          error
            ? reject(new Error("Claude Code 插件操作失败，请检查插件来源与网络连接。"))
            : resolve(stdout)
      )
    );
  }
}
