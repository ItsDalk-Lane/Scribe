import { SubagentsSettings } from "@/agentMode/subagents/ui/SubagentsSettings";
import { backendDisplayOrder } from "@/agentMode/backends/registry";
import type {
  AgentExtensionGroup,
  AgentExtensionItem,
  AgentExtensionKind,
  AgentExtensionRuntimeSnapshot,
} from "@/agentMode/session/extensionInventory";
import type {
  AgentExtensionDetails,
  AgentExtensionManager,
  AgentExtensionScope,
} from "@/agentMode/session/extensionManagement";
import { mergeExtensionRuntime } from "@/agentMode/session/mergeExtensionRuntime";
import {
  extensionCheckCacheIdentity,
  extensionCheckCacheKey,
  readCachedExtensionCheck,
  readCachedExtensionView,
  storeCachedExtensionCheck,
  storeCachedExtensionView,
} from "@/agentMode/session/extensionCheckCache";
import { resolveScopeCwd } from "@/agentMode/session/sessionScope";
import { SkillsSettings } from "@/agentMode/skills/ui/SkillsSettings";
import { AgentExtensionsPanel, EXTENSION_LABELS } from "@/agentMode/ui/AgentExtensionsPanel";
import { ExtensionEditor } from "@/agentMode/ui/ExtensionEditor";
import { ExtensionDetailsView, ExtensionModal } from "@/agentMode/ui/ExtensionDialogs";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { AgentConfigurationHeader } from "@/components/ui/AgentConfigurationHeader";
import { Button } from "@/components/ui/button";
import { usePlugin } from "@/contexts/PluginContext";
import { t } from "@/lib/i18n";
import { logError } from "@/logger";
import { useProjects } from "@/projects/state";
import { useSettingsValue } from "@/settings/model";
import { getVaultBase } from "@/utils/vaultPath";
import { normalizeAbsPath } from "@/utils/pathUtils";
import { RefreshCw } from "lucide-react";
import { Notice, type App } from "obsidian";
import React from "react";

export interface AgentExtensionsSettingsProps {
  kind?: AgentExtensionKind;
}
export const EXTENSION_KINDS: readonly AgentExtensionKind[] = Object.freeze([
  "plugin",
  "skill",
  "command",
  "hook",
  "mcp",
  "subagent",
]);

interface InventoryState {
  context?: string;
  groups: readonly AgentExtensionGroup[] | null;
  loading: boolean;
  error?: boolean;
  runtimeState: "not_started" | "checked" | "partial" | "error";
}

function savedInventoryState(
  app: App | null | undefined,
  identity: string,
  context: string
): InventoryState | null {
  const view = readCachedExtensionView(app, identity);
  return view
    ? { context, groups: view.groups, loading: false, runtimeState: view.runtimeState }
    : null;
}

function mergeScopeInventories(
  inventories: readonly (readonly AgentExtensionGroup[])[]
): AgentExtensionGroup[] {
  const base = inventories[0] ?? [];
  return base.map((group) => {
    const items = new Map<string, AgentExtensionItem>();
    const warnings = new Set<string>();
    for (const inventory of inventories) {
      const entry = inventory.find((candidate) => candidate.kind === group.kind);
      if (!entry) continue;
      for (const warning of entry.warnings) warnings.add(warning);
      for (const item of entry.items) {
        const target = item.target?.scope;
        const key = target
          ? `${target.kind}:${target.kind === "project" ? normalizeAbsPath(target.cwd) : ""}:${item.id}`
          : `${item.source}:${item.id}`;
        if (!items.has(key)) items.set(key, item);
      }
    }
    return { ...group, warnings: [...warnings], items: [...items.values()] };
  });
}

export function AgentExtensionsSettings(props: AgentExtensionsSettingsProps) {
  if (props.kind === "subagent") return <SubagentsSettings />;
  if (!props.kind || props.kind === "skill") return <SkillsSettings />;
  return <RuntimeExtensionsSettings {...props} />;
}

function RuntimeExtensionsSettings({ kind = "skill" }: AgentExtensionsSettingsProps) {
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const projects = useProjects();
  const descriptors = backendDisplayOrder();
  const [selectedAgent, setSelectedAgent] = React.useState(descriptors[0].id);
  const descriptor = descriptors.find((item) => item.id === selectedAgent) ?? descriptors[0];
  // 旧视图可能误认同名项目，读取当前身份且不重写可能含未知数据的旧缓存。https://github.com/ItsDalk-Lane/Scribe/issues/6
  const usePersistentCache = descriptor.id !== "native" || kind !== "skill";
  const [query, setQuery] = React.useState("");
  const [operation, setOperation] = React.useState<{
    context: string;
    controller: AbortController;
  } | null>(null);
  const vaultBase = getVaultBase(plugin.app);
  const scopeEntries = React.useMemo<
    { scope: AgentExtensionScope; cwd: string; label: string }[]
  >(() => {
    if (!vaultBase) return [];
    return [
      {
        scope: { kind: "project" as const, cwd: vaultBase },
        cwd: vaultBase,
        label: t("Current vault"),
      },
      ...projects.flatMap((project) => {
        try {
          const projectCwd = resolveScopeCwd(vaultBase, project.id);
          return [
            {
              scope: { kind: "project" as const, cwd: projectCwd },
              cwd: projectCwd,
              label: `${t("Project")} · ${project.name}`,
            },
          ];
        } catch {
          return [];
        }
      }),
    ];
  }, [vaultBase, projects]);
  const scanScopes = React.useMemo<AgentExtensionScope[]>(
    () => [{ kind: "user" }, ...scopeEntries.map((entry) => entry.scope)],
    [scopeEntries]
  );
  const primary = scopeEntries[0];
  const scope = React.useMemo<AgentExtensionScope>(
    () => primary?.scope ?? { kind: "user" },
    [primary]
  );
  const cwd = primary?.cwd ?? null;
  const scopeLabelFor = (target: AgentExtensionScope): string => {
    if (target.kind === "user") return t("Local · User");
    const normalized = normalizeAbsPath(target.cwd);
    return (
      scopeEntries.find((entry) => normalizeAbsPath(entry.cwd) === normalized)?.label ??
      `${t("Project")} · ${target.cwd}`
    );
  };
  const management = React.useMemo(
    () => descriptor.createExtensionManager?.({ settings, cwd }) ?? null,
    [descriptor, settings, cwd]
  );
  const requestId = React.useRef(0);
  const mutationController = React.useRef<AbortController | null>(null);
  const context = JSON.stringify([descriptor.id, scanScopes, kind]);
  const cacheIdentity = React.useMemo(
    () =>
      // 项目清单改变后，旧页面可能把其他项目的状态显示给当前用户。https://github.com/ItsDalk-Lane/Scribe/issues/6
      JSON.stringify([
        extensionCheckCacheIdentity({
          backendId: descriptor.id,
          scopeKind: scope.kind,
          cwd: scope.kind === "user" ? null : cwd,
          vaultBase,
        }),
        scanScopes,
      ]),
    [descriptor.id, scope.kind, cwd, vaultBase, scanScopes]
  );
  const [state, setState] = React.useState<InventoryState>(
    () =>
      (usePersistentCache ? savedInventoryState(plugin.app, cacheIdentity, context) : null) ?? {
        context,
        groups: null,
        loading: true,
        runtimeState: "not_started",
      }
  );
  const busy = operation?.context === context;
  const controller = React.useRef<AbortController | null>(null);
  const sessionManager = plugin.agentSessionManager;
  const enabled = sessionManager?.isBackendEnabled(descriptor.id) ?? true;
  const pending = React.useSyncExternalStore(
    React.useCallback(
      (listener: () => void) => sessionManager?.subscribe?.(listener) ?? (() => {}),
      [sessionManager]
    ),
    () => sessionManager?.isExtensionChangePending?.(descriptor.id, scope) ?? false
  );
  const load = React.useCallback(
    async (force = false) => {
      const id = ++requestId.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      const savedView = usePersistentCache
        ? readCachedExtensionView(plugin.app, cacheIdentity)
        : null;
      setState((current) => {
        if (current.context === context)
          return { ...current, loading: current.groups === null, error: false };
        const groups = savedView?.groups ?? null;
        return {
          context,
          groups,
          loading: groups === null,
          error: false,
          runtimeState:
            groups === null ? "not_started" : (savedView?.runtimeState ?? "not_started"),
        };
      });
      try {
        if (!management || !cwd) throw new Error("Configuration is unavailable");
        const [inventories, discovered] = await Promise.all([
          Promise.all(
            scanScopes.map((scanScope) =>
              Promise.all(
                EXTENSION_KINDS.map(
                  async (entryKind): Promise<AgentExtensionGroup> => ({
                    kind: entryKind,
                    status: "partial",
                    warnings: [],
                    items: await management.list(entryKind, scanScope),
                  })
                )
              )
            )
          ),
          descriptor.readExtensions?.({ settings, cwd: scope.kind === "user" ? null : cwd }) ??
            Promise.resolve([]),
        ]);
        const inventory = mergeScopeInventories(inventories);
        const inventoryWithWarnings = inventory.map((group) => ({
          ...group,
          warnings:
            discovered.find((entry) => entry.kind === group.kind)?.warnings ?? group.warnings,
        }));
        const key = extensionCheckCacheKey(
          {
            backendId: descriptor.id,
            scopeKind: scope.kind,
            cwd: scope.kind === "user" ? null : cwd,
          },
          inventory
        );
        const cached =
          usePersistentCache && enabled && !force
            ? readCachedExtensionCheck(plugin.app, key)
            : null;
        const mergeOptions = { appendRuntimeEntries: true, runtimeScope: scope };
        let runtime: AgentExtensionRuntimeSnapshot | null = cached;
        let failed = false;
        if (!cached && enabled && descriptor.checkExtensions) {
          setState((current) =>
            current.context === context ? { ...current, loading: true } : current
          );
          const applyUpdate = (snapshot: AgentExtensionRuntimeSnapshot) => {
            if (usePersistentCache) storeCachedExtensionCheck(plugin.app, key, snapshot);
            const mergedSnapshot = mergeExtensionRuntime(
              inventoryWithWarnings,
              snapshot,
              mergeOptions
            );
            const runtimeState = snapshot.checkErrors?.length ? "partial" : "checked";
            if (usePersistentCache)
              storeCachedExtensionView(plugin.app, cacheIdentity, {
                groups: mergedSnapshot,
                runtimeState,
              });
            if (id !== requestId.current || abort.signal.aborted) return;
            setState((current) =>
              current.context === context
                ? { ...current, groups: mergedSnapshot, loading: false, runtimeState }
                : current
            );
          };
          try {
            runtime = await descriptor.checkExtensions({
              plugin,
              cwd,
              scope,
              signal: abort.signal,
              onUpdate: applyUpdate,
            });
            if (runtime && usePersistentCache) storeCachedExtensionCheck(plugin.app, key, runtime);
          } catch {
            failed = true;
            runtime = null;
          }
        }
        const merged = mergeExtensionRuntime(inventoryWithWarnings, runtime, mergeOptions);
        const runtimeState = failed
          ? "error"
          : runtime?.checkErrors?.length
            ? "partial"
            : runtime
              ? "checked"
              : "not_started";
        if (id === requestId.current && !abort.signal.aborted) {
          setState({ context, groups: merged, loading: false, runtimeState });
          if (usePersistentCache)
            storeCachedExtensionView(plugin.app, cacheIdentity, { groups: merged, runtimeState });
        }
      } catch (error) {
        if (id === requestId.current && !abort.signal.aborted) {
          logError("Could not read extension configuration", error);
          setState({ context, groups: null, loading: false, error: true, runtimeState: "error" });
          abort.abort();
        }
      }
    },
    [
      management,
      cwd,
      descriptor,
      scope,
      scanScopes,
      settings,
      enabled,
      plugin,
      context,
      cacheIdentity,
      usePersistentCache,
    ]
  );
  const loadRef = React.useRef(load);
  loadRef.current = load;
  React.useEffect(() => {
    void loadRef.current();
    return () => {
      controller.current?.abort();
      mutationController.current?.abort();
    };
  }, [context, enabled]);
  const mutate = async (
    action: (manager: AgentExtensionManager) => Promise<void>,
    actionScope: AgentExtensionScope = scope
  ) => {
    if (!management) throw new Error(t("Configuration is unavailable."));
    const mutation = new AbortController();
    setOperation({ context, controller: mutation });
    mutationController.current = mutation;
    try {
      await action(management);
      if (sessionManager?.applyExtensionChanges)
        await sessionManager.applyExtensionChanges(descriptor.id, actionScope, mutation.signal);
      else sessionManager?.noteExtensionsChanged(descriptor.id);
      try {
        await plugin.skills?.refresh();
      } catch (error) {
        logError("Configuration saved but skill refresh failed", error);
        new Notice(t("Configuration saved; refresh the skill list to see its latest state."));
      }
      if (!mutation.signal.aborted) await loadRef.current();
    } catch (error) {
      if (!mutation.signal.aborted) await loadRef.current();
      throw error;
    } finally {
      setOperation((current) => (current?.controller === mutation ? null : current));
    }
  };
  const showError = (error: unknown) => {
    if (error instanceof Error && error.name === "AbortError") return;
    logError("Extension configuration action failed", error);
    new Notice(error instanceof Error ? error.message : t("Could not save configuration."));
  };
  const remove = (item: AgentExtensionItem, close?: () => void) => {
    new ConfirmModal(
      plugin.app,
      async () => {
        try {
          await mutate(
            async (manager) => manager.delete(await manager.details(item)),
            item.target?.scope ?? scope
          );
          close?.();
        } catch (error) {
          showError(error);
        }
      },
      t("Remove {name} from this configuration?", { name: item.name }),
      t("Delete {name}", { name: item.name }),
      t("Delete")
    ).open();
  };
  const openEditor = (
    original?: AgentExtensionDetails,
    editorScope: AgentExtensionScope = scope
  ) => {
    if (kind !== "command") return;
    new ExtensionModal(
      plugin.app,
      t(original ? "Edit {name}" : "New {name}", {
        name: original?.item.name ?? t(EXTENSION_LABELS[kind]),
      }),
      (close) => (
        <ExtensionEditor
          kind={kind}
          scope={editorScope}
          original={original}
          onClose={close}
          onSave={(draft) => mutate((manager) => manager.save(draft), draft.scope)}
        />
      )
    ).open();
  };
  const openItem = async (item: AgentExtensionItem) => {
    try {
      const originalDetails =
        item.target && management ? await management.details(item) : { item, revision: "" };
      const details = { ...originalDetails, item };
      if (item.capabilities?.edit && kind === "command") {
        openEditor(details, item.target?.scope ?? scope);
        return;
      }
      new ExtensionModal(plugin.app, undefined, (close) => (
        <ExtensionDetailsView
          details={details}
          scopeLabel={scopeLabelFor(item.target?.scope ?? scope)}
          onClose={close}
          onDelete={item.capabilities?.delete ? () => remove(item, close) : undefined}
        />
      )).open();
    } catch (error) {
      showError(error);
    }
  };
  const q = query.trim().toLowerCase();
  const currentState: InventoryState =
    state.context === context
      ? state
      : ((usePersistentCache ? savedInventoryState(plugin.app, cacheIdentity, context) : null) ?? {
          context,
          groups: null,
          loading: true,
          runtimeState: "not_started" as const,
        });
  const groups =
    currentState.groups
      ?.filter((group) => group.kind === kind)
      .map((group) => ({
        ...group,
        items: group.items.filter((item) =>
          `${item.name} ${item.description ?? ""} ${item.parentPluginId ?? ""}`
            .toLowerCase()
            .includes(q)
        ),
      })) ?? null;
  const inactive = enabled ? {} : { inert: "" };
  const content = (
    <div {...inactive} aria-disabled={!enabled} className={enabled ? undefined : "tw-opacity-50"}>
      <AgentExtensionsPanel
        agentName={descriptor.displayName}
        groups={groups}
        loading={currentState.loading}
        error={currentState.error}
        runtimeState={currentState.runtimeState}
        forceExpanded={query.trim() !== ""}
        onRefresh={() => void loadRef.current()}
        busy={busy || pending}
        onOpen={(item) => void openItem(item)}
        onToggle={(item, next) => {
          void mutate(
            async (manager) => manager.toggle(await manager.details(item), next),
            item.target?.scope ?? scope
          ).catch(showError);
        }}
        onDelete={(item) => remove(item)}
      />
    </div>
  );
  return (
    <section className="tw-space-y-5">
      <AgentConfigurationHeader
        agents={descriptors.map((item) => ({
          id: item.id,
          label: item.displayName,
        }))}
        selectedAgent={descriptor.id}
        onSelectAgent={(id) => setSelectedAgent(id)}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder={t("Search {name}…", { name: t(EXTENSION_LABELS[kind]) })}
        actions={
          <>
            <Button
              size="icon"
              variant="secondary"
              aria-label={t("Refresh and check")}
              disabled={busy || pending || currentState.loading || !enabled}
              onClick={() => void loadRef.current(true)}
            >
              <RefreshCw className="tw-size-4" />
            </Button>
          </>
        }
      />
      {!enabled && (
        <p role="status" className="tw-text-ui-small tw-text-muted">
          {t(
            "This agent is disabled. Configuration is kept; enable it on the Agent page to use it."
          )}
        </p>
      )}
      {content}
      <details className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
        <summary>{t("About checking and configuration changes")}</summary>
        <div className="tw-space-y-2 tw-pt-2">
          <p>
            {t(
              "Checks the registered Scribe skills, commands, and subagents without sending a chat message."
            )}
          </p>
          <p>
            {t(
              "Scribe uses its own registered tools and extensions. External agent plugins, hooks, and MCP services are not loaded."
            )}
          </p>
          <p>{t("Loaded or connected does not guarantee that each execution succeeds.")}</p>
          <p>
            {t(
              "Availability is checked automatically. Changes reach existing chats after their current tasks finish."
            )}
          </p>
        </div>
      </details>
    </section>
  );
}
