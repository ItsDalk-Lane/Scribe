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
import { resolveScopeCwd } from "@/agentMode/session/sessionScope";
import { useManagedSkills } from "@/agentMode/skills/SkillManager";
import { BUILTIN_SKILLS } from "@/builtinSkills/builtinSkills";
import { SkillsSettings } from "@/agentMode/skills/ui/SkillsSettings";
import { AgentExtensionsPanel, EXTENSION_LABELS } from "@/agentMode/ui/AgentExtensionsPanel";
import { ExtensionEditor } from "@/agentMode/ui/ExtensionEditor";
import {
  ExtensionDetailsView,
  ExtensionImportForm,
  ExtensionModal,
  PluginInstallForm,
} from "@/agentMode/ui/ExtensionDialogs";
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
import { Plus, RefreshCw, Download } from "lucide-react";
import { Notice } from "obsidian";
import React from "react";

export interface AgentExtensionsSettingsProps {
  kind?: AgentExtensionKind;
}
interface InventoryState {
  groups: readonly AgentExtensionGroup[] | null;
  loading: boolean;
  error?: boolean;
  runtimeState: "not_started" | "checked" | "partial" | "error";
}

export function AgentExtensionsSettings({ kind = "plugin" }: AgentExtensionsSettingsProps) {
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const projects = useProjects();
  const managedSkills = useManagedSkills();
  const descriptors = backendDisplayOrder();
  const [selectedAgent, setSelectedAgent] = React.useState(descriptors[0].id);
  const descriptor = descriptors.find((item) => item.id === selectedAgent) ?? descriptors[0];
  const [source, setSource] = React.useState("user");
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [state, setState] = React.useState<InventoryState>({
    groups: null,
    loading: true,
    runtimeState: "not_started",
  });
  const vaultBase = getVaultBase(plugin.app);
  const sources = [
    { value: "user", label: t("Local · User") },
    { value: "vault", label: t("Current vault") },
    ...projects.map((project) => ({
      value: project.id,
      label: `${t("Project")} · ${project.name}`,
    })),
  ];
  const selection = sources.some((item) => item.value === source) ? source : "user";
  const cwd = React.useMemo(
    () =>
      vaultBase
        ? selection === "user" || selection === "vault"
          ? vaultBase
          : resolveScopeCwd(vaultBase, selection)
        : null,
    [vaultBase, selection]
  );
  const scope = React.useMemo<AgentExtensionScope>(
    () => (selection === "user" ? { kind: "user" } : { kind: "project", cwd: cwd ?? "" }),
    [selection, cwd]
  );
  const management = React.useMemo(
    () => descriptor.createExtensionManager?.({ settings, cwd }) ?? null,
    [descriptor, settings, cwd]
  );
  const requestId = React.useRef(0);
  const controller = React.useRef<AbortController | null>(null);
  const sessionManager = plugin.agentSessionManager;
  const enabled = sessionManager?.isBackendEnabled(descriptor.id) ?? true;
  const load = React.useCallback(
    async (check: boolean) => {
      const id = ++requestId.current;
      controller.current?.abort();
      const abort = new AbortController();
      controller.current = abort;
      setState((current) => ({ ...current, loading: true, error: false }));
      try {
        if (!management || !cwd || !descriptor.readExtensions)
          throw new Error("Configuration is unavailable");
        const session = sessionManager
          ?.getSessions()
          .find((item) => item.backendId === descriptor.id && item.cwd === cwd);
        const readRuntime = async (): Promise<AgentExtensionRuntimeSnapshot | null> => {
          if (!enabled) return null;
          if (check && descriptor.checkExtensions)
            return descriptor.checkExtensions({ plugin, cwd, signal: abort.signal });
          return session ? session.getExtensionRuntime() : null;
        };
        const [items, discovered, report] = await Promise.all([
          management.list(kind, scope),
          descriptor.readExtensions({ settings, cwd }),
          readRuntime().then(
            (runtime) => ({ runtime, failed: false }),
            () => ({ runtime: null, failed: true })
          ),
        ]);
        const merged = mergeExtensionRuntime(discovered, report.runtime).find(
          (group) => group.kind === kind
        );
        const identity = (item: AgentExtensionItem) =>
          JSON.stringify([item.id, item.target?.path, item.target?.keyPath, item.target?.scope]);
        const observed = new Map(merged?.items.map((item) => [identity(item), item]));
        const local = items.map((item) => {
          const runtime = observed.get(identity(item));
          return {
            ...item,
            availability:
              item.enabled === false
                ? ("disabled" as const)
                : (runtime?.availability ?? item.availability),
            toolCount: runtime?.toolCount ?? item.toolCount,
          };
        });
        const managedNames = new Set([
          ...managedSkills.map((item) => item.name),
          ...BUILTIN_SKILLS.map((item) => item.name),
        ]);
        const runtimeOnly =
          selection === "vault"
            ? (merged?.items.filter(
                (item) =>
                  item.source === "runtime" && !(kind === "skill" && managedNames.has(item.name))
              ) ?? [])
            : [];
        const managedFiles = new Set(managedSkills.map((item) => normalizeAbsPath(item.filePath)));
        const filtered =
          kind === "skill" && selection === "vault"
            ? local.filter(
                (item) =>
                  item.source === "plugin" ||
                  item.parentPluginId ||
                  !managedFiles.has(normalizeAbsPath(item.target?.path ?? item.location ?? ""))
              )
            : local;
        if (id === requestId.current && !abort.signal.aborted)
          setState({
            groups: [
              {
                kind,
                status: "partial",
                warnings: merged?.warnings ?? [],
                items: [...filtered, ...runtimeOnly],
              },
            ],
            loading: false,
            runtimeState: report.failed ? "error" : report.runtime ? "checked" : "not_started",
          });
      } catch (error) {
        if (id === requestId.current && !abort.signal.aborted) {
          logError("Could not read extension configuration", error);
          setState({ groups: null, loading: false, error: true, runtimeState: "error" });
        }
      }
    },
    [
      management,
      cwd,
      descriptor,
      sessionManager,
      kind,
      scope,
      settings,
      selection,
      enabled,
      plugin,
      managedSkills,
    ]
  );
  React.useEffect(() => {
    void load(false);
    return () => {
      controller.current?.abort();
    };
  }, [load]);
  const mutate = async (action: (manager: AgentExtensionManager) => Promise<void>) => {
    if (!management) throw new Error(t("Configuration is unavailable."));
    setBusy(true);
    try {
      await action(management);
      sessionManager?.noteExtensionsChanged(descriptor.id);
      try {
        await plugin.skills?.refresh();
      } catch (error) {
        logError("Configuration saved but skill refresh failed", error);
        new Notice(t("Configuration saved; refresh the skill list to see its latest state."));
      }
      await load(false);
    } catch (error) {
      await load(false);
      throw error;
    } finally {
      setBusy(false);
    }
  };
  const showError = (error: unknown) => {
    logError("Extension configuration action failed", error);
    new Notice(error instanceof Error ? error.message : t("Could not save configuration."));
  };
  const remove = (item: AgentExtensionItem, close?: () => void) => {
    new ConfirmModal(
      plugin.app,
      async () => {
        try {
          await mutate(async (manager) => manager.delete(await manager.details(item)));
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
  const openEditor = (original?: AgentExtensionDetails) => {
    if (kind === "plugin") return;
    new ExtensionModal(
      plugin.app,
      t(original ? "Edit {name}" : "New {name}", {
        name: original?.item.name ?? t(EXTENSION_LABELS[kind]),
      }),
      (close) => (
        <ExtensionEditor
          kind={kind}
          scope={scope}
          original={original}
          onClose={close}
          onSave={(draft) => mutate((manager) => manager.save(draft))}
          onTest={
            kind === "mcp"
              ? async (draft) => {
                  if (!management) throw new Error(t("Configuration is unavailable."));
                  const result = await management.testConnection(draft);
                  return (
                    result.message ??
                    t(
                      result.status === "connected"
                        ? "Connected"
                        : result.status === "needs-auth"
                          ? "Sign-in required"
                          : result.status === "pending"
                            ? "Connection not completed in this check"
                            : "Connection failed"
                    )
                  );
                }
              : undefined
          }
        />
      )
    ).open();
  };
  const openItem = async (item: AgentExtensionItem) => {
    try {
      const details =
        item.target && management ? await management.details(item) : { item, revision: "" };
      if (item.capabilities?.edit && kind !== "plugin") {
        openEditor(details);
        return;
      }
      new ExtensionModal(plugin.app, item.name, (close) => (
        <ExtensionDetailsView
          details={details}
          onClose={close}
          onUpdate={
            kind === "plugin" && !item.readOnly && item.capabilities?.update !== false
              ? () =>
                  mutate((manager) =>
                    manager.pluginAction({
                      action: "update",
                      scope,
                      plugin: item.id,
                      local: item.id.startsWith("local:"),
                      installationScope: item.installationScope,
                    })
                  )
              : undefined
          }
          onDelete={item.capabilities?.delete ? () => remove(item, close) : undefined}
        />
      )).open();
    } catch (error) {
      showError(error);
    }
  };
  const installPlugin = async () => {
    try {
      if (!management) throw new Error(t("Configuration is unavailable."));
      const marketplaces = await management.marketplaces();
      new ExtensionModal(plugin.app, t("Add plugin"), (close) => (
        <PluginInstallForm
          scope={scope}
          marketplaces={marketplaces}
          onClose={close}
          onInstall={(action) => mutate((manager) => manager.pluginAction(action))}
        />
      )).open();
    } catch (error) {
      showError(error);
    }
  };
  const importConfiguration = () =>
    new ExtensionModal(plugin.app, t("Import"), (close) => (
      <ExtensionImportForm
        kind={kind}
        scope={scope}
        onClose={close}
        onImport={(input) => mutate((manager) => manager.import(input))}
      />
    )).open();
  const q = query.trim().toLowerCase();
  const groups =
    state.groups?.map((group) => ({
      ...group,
      items: group.items.filter((item) =>
        `${item.name} ${item.description ?? ""} ${item.parentPluginId ?? ""}`
          .toLowerCase()
          .includes(q)
      ),
    })) ?? null;
  const inactive = enabled ? {} : { inert: "" };
  const ownsSkills = kind === "skill" && selection === "vault";
  const hideEmpty =
    ownsSkills &&
    !state.loading &&
    !state.error &&
    state.runtimeState !== "error" &&
    groups?.every((group) => group.items.length === 0 && group.warnings.length === 0);
  const content = hideEmpty ? null : (
    <div {...inactive} aria-disabled={!enabled} className={enabled ? undefined : "tw-opacity-50"}>
      <AgentExtensionsPanel
        agentName={descriptor.displayName}
        groups={groups}
        loading={state.loading}
        error={state.error}
        runtimeState={state.runtimeState}
        onRefresh={() => void load(false)}
        busy={busy}
        onOpen={(item) => void openItem(item)}
        onToggle={(item, next) => {
          void mutate(async (manager) => manager.toggle(await manager.details(item), next)).catch(
            showError
          );
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
          label: item.id === "claude" ? "Claude Code" : item.displayName,
        }))}
        selectedAgent={descriptor.id}
        onSelectAgent={(id) => setSelectedAgent(id)}
        source={selection}
        sources={sources}
        onSourceChange={setSource}
        query={query}
        onQueryChange={setQuery}
        searchPlaceholder={t("Search {name}…", { name: t(EXTENSION_LABELS[kind]) })}
        label={t("Installed")}
        count={
          (state.groups?.reduce(
            (sum, group) =>
              sum +
              group.items.filter(
                (item) => !item.parentPluginId && !item.builtin && item.source !== "runtime"
              ).length,
            0
          ) ?? 0) + (ownsSkills ? managedSkills.filter((item) => !item.builtin).length : 0)
        }
        actions={
          <>
            <Button
              size="icon"
              variant="secondary"
              aria-label={t("Refresh and check")}
              disabled={busy || state.loading || !enabled}
              onClick={() => void load(true)}
            >
              <RefreshCw className="tw-size-4" />
            </Button>
            {kind === "plugin" && (
              <Button
                variant="secondary"
                disabled={busy || !enabled}
                onClick={() => void installPlugin()}
              >
                {t("Browse plugin marketplace")}
              </Button>
            )}
            {kind === "mcp" && (
              <Button variant="secondary" disabled={busy || !enabled} onClick={importConfiguration}>
                <Download className="tw-size-4" />
                {t("Import")}
              </Button>
            )}
            {!ownsSkills && (
              <Button
                disabled={busy || !enabled}
                onClick={() => (kind === "plugin" ? void installPlugin() : openEditor())}
              >
                <Plus className="tw-size-4" />
                {t(
                  kind === "plugin"
                    ? "Add plugin"
                    : kind === "command"
                      ? "New agent command"
                      : "New"
                )}
              </Button>
            )}
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
      {ownsSkills ? (
        <div {...inactive} aria-disabled={!enabled}>
          <SkillsSettings embedded query={query}>
            {content}
          </SkillsSettings>
        </div>
      ) : (
        content
      )}
      <details className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
        <summary>{t("About checking and configuration changes")}</summary>
        <div className="tw-space-y-2 tw-pt-2">
          <p>
            {t(
              "Checks what Claude loaded and connected without sending a chat message or testing each tool."
            )}
          </p>
          <p>
            {t(
              "Starting Claude loads your configuration, connects extension services, and may run configured startup hooks."
            )}
          </p>
          <p>{t("Loaded or connected does not guarantee that each execution succeeds.")}</p>
          <p>
            {t(
              "Configuration changes take effect at the next agent start; current tasks keep running."
            )}
          </p>
        </div>
      </details>
    </section>
  );
}
