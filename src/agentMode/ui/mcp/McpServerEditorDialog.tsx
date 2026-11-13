import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ConfirmModal } from "@/components/modals/ConfirmModal";
import { ReactModal } from "@/components/modals/ReactModal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { Input } from "@/components/ui/input";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { Textarea } from "@/components/ui/textarea";
import { Loader2 } from "lucide-react";
import { useApp } from "@/context";
import { logError } from "@/logger";
import { Notice } from "obsidian";
import React, { useMemo, useState } from "react";
import { v4 as uuidv4 } from "uuid";

import {
  formatArgLines,
  formatSecretAwareKeyValueLines,
  isValidMcpUrl,
  parseArgLines,
  parseKeyValueLines,
} from "@/agentMode/mcp/configSchema";
import {
  isAdvertisedMcpWebSearch,
  mcpDirectToolFingerprint,
} from "@/agentMode/mcp/mcpDirectPolicy";
import { deleteUnusedMcpSecretEntries, persistMcpSecretEntries } from "@/agentMode/mcp/secretRefs";
import type {
  McpServerConfig,
  McpServerStatus,
  McpServerType,
  McpToolInfo,
} from "@/agentMode/mcp/types";
import { SecretStore } from "@/services/secretStore";
import { getSettings, useSettingsValue } from "@/settings/model";
import { McpToolsSection, type McpDirectToolState } from "./McpToolsSection";
import { isDeferredMcpLoadingActive } from "./mcpToolLoadingUi";
import { useMcpServerRuntime, writeMcpServers } from "./mcpUiState";

export interface McpServerDraft {
  name: string;
  type: McpServerType;
  description: string;
  command: string;
  url: string;
  argsText: string;
  envText: string;
  headersText: string;
  timeoutText: string;
  longRunning: boolean;
  isActive: boolean;
  disabledTools: string[];
  autoApprovedTools: string[];
  directToolChanges: Record<string, string | null>;
}

const EMPTY_DIRECT_TOOL_CHANGES: McpServerDraft["directToolChanges"] = Object.freeze({});

export function draftFromServer(server: McpServerConfig): McpServerDraft {
  return {
    name: server.name,
    type: server.type,
    description: server.description ?? "",
    command: server.command ?? "",
    url: server.url ?? "",
    argsText: formatArgLines(server.args),
    envText: formatSecretAwareKeyValueLines(server.env, server.secretRefs, "env"),
    headersText: formatSecretAwareKeyValueLines(server.headers, server.secretRefs, "headers"),
    timeoutText: server.timeoutSeconds !== undefined ? String(server.timeoutSeconds) : "",
    longRunning: server.longRunning === true,
    isActive: server.isActive,
    disabledTools: [...(server.disabledTools ?? [])],
    autoApprovedTools: [...(server.autoApprovedTools ?? [])],
    directToolChanges: EMPTY_DIRECT_TOOL_CHANGES,
  };
}

export const EMPTY_MCP_SERVER_DRAFT: McpServerDraft = Object.freeze({
  name: "",
  type: "stdio",
  description: "",
  command: "",
  url: "",
  argsText: "",
  envText: "",
  headersText: "",
  timeoutText: "",
  longRunning: false,
  isActive: false,
  disabledTools: [],
  autoApprovedTools: [],
  directToolChanges: EMPTY_DIRECT_TOOL_CHANGES,
});

export function validateMcpServerDraft(
  draft: McpServerDraft
): Partial<Record<keyof McpServerDraft, string>> {
  const errors: Partial<Record<keyof McpServerDraft, string>> = {};
  if (!draft.name.trim()) errors.name = t("This field is required");
  if (draft.type === "stdio") {
    if (!draft.command.trim())
      errors.command = t("A command is required for standard input / output servers.");
  } else {
    if (!draft.url.trim()) errors.url = t("A URL is required for remote servers.");
    else if (!isValidMcpUrl(draft.url.trim())) errors.url = t("Enter an http:// or https:// URL.");
  }
  if (draft.timeoutText.trim()) {
    const timeout = Number(draft.timeoutText);
    if (!Number.isSafeInteger(timeout) || timeout < 1)
      errors.timeoutText = t("Enter a whole number of seconds greater than 0.");
  }
  return errors;
}

export function draftChanged(draft: McpServerDraft, server: McpServerConfig | null): boolean {
  if (!server) return true;
  const original = draftFromServer(server);
  return (
    draftConnectionChanged(draft, original) ||
    draft.timeoutText !== original.timeoutText ||
    draft.longRunning !== original.longRunning ||
    !arraysEqual(draft.disabledTools, original.disabledTools) ||
    !arraysEqual(draft.autoApprovedTools, original.autoApprovedTools) ||
    Object.keys(draft.directToolChanges).length > 0
  );
}

function draftConnectionChanged(draft: McpServerDraft, original: McpServerDraft): boolean {
  return (
    draft.name !== original.name ||
    draft.type !== original.type ||
    draft.description !== original.description ||
    draft.command !== original.command ||
    draft.url !== original.url ||
    draft.argsText !== original.argsText ||
    draft.envText !== original.envText ||
    draft.headersText !== original.headersText
  );
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

const MCP_MODAL_CLASS = "scribe-mcp-server-editor-modal";

export interface McpServerEditorModalOptions {
  serverId?: string;
  onSaved?: () => void;
}

export class McpServerEditorModal extends ReactModal {
  constructor(
    app: ConstructorParameters<typeof ReactModal>[0],
    private readonly options: McpServerEditorModalOptions
  ) {
    super(app, undefined, MCP_MODAL_CLASS);
  }

  onOpen(): void {
    this.modalEl.addClasses(["tw-flex", "tw-max-h-[85vh]", "tw-w-[720px]", "tw-flex-col"]);
    this.contentEl.addClasses([
      "tw-flex",
      "tw-min-h-0",
      "tw-flex-1",
      "tw-flex-col",
      "tw-overflow-hidden",
    ]);
    super.onOpen();
  }

  protected renderContent(close: () => void): React.ReactElement {
    return (
      <McpServerEditorBridge
        serverId={this.options.serverId}
        onSaved={this.options.onSaved}
        onClose={close}
      />
    );
  }
}

const McpServerEditorBridge: React.FC<{
  serverId?: string;
  onSaved?: () => void;
  onClose: () => void;
}> = ({ serverId, onSaved, onClose }) => {
  const app = useApp();
  const settings = useSettingsValue();
  const server = settings.mcp.servers.find((entry) => entry.id === serverId) ?? null;
  const { state, tools } = useMcpServerRuntime(serverId ?? null);
  const webSearch = settings.agentMode?.webSearch?.mcp;
  const [saving, setSaving] = useState(false);

  const handleToggleActive = (checked: boolean): void => {
    if (!server) return;
    void writeMcpServers(app, (servers) =>
      servers.map((entry) =>
        entry.id === server.id
          ? { ...entry, isActive: checked, updatedAt: new Date().toISOString() }
          : entry
      )
    ).catch((error) => {
      logError("[MCP] failed to toggle server", error);
      new Notice(t("Failed to save the MCP server configuration."));
    });
  };

  const handleSave = async (draft: McpServerDraft): Promise<void> => {
    setSaving(true);
    try {
      const resolvedId = server?.id ?? uuidv4();
      const store = SecretStore.getInstance(app);
      const env = draft.type === "stdio" ? parseKeyValueLines(draft.envText) : {};
      const headers = draft.type === "stdio" ? {} : parseKeyValueLines(draft.headersText);
      const split = await persistMcpSecretEntries(
        store,
        resolvedId,
        { env, headers },
        server?.secretRefs ?? []
      );
      const now = new Date().toISOString();
      const timeout = draft.timeoutText.trim() ? Number(draft.timeoutText) : undefined;
      const command = draft.type === "stdio" ? draft.command.trim() : undefined;
      const args = draft.type === "stdio" ? parseArgLines(draft.argsText) : [];
      const url = draft.type === "stdio" ? undefined : draft.url.trim();
      const next: McpServerConfig = {
        id: resolvedId,
        name: draft.name.trim(),
        type: draft.type,
        description: draft.description.trim() || undefined,
        ...(command ? { command } : {}),
        ...(args.length > 0 ? { args } : {}),
        ...(split.env && Object.keys(split.env).length > 0 ? { env: split.env } : {}),
        ...(url ? { url } : {}),
        ...(split.headers && Object.keys(split.headers).length > 0
          ? { headers: split.headers }
          : {}),
        ...(timeout !== undefined ? { timeoutSeconds: timeout } : {}),
        longRunning: draft.longRunning,
        isActive: server ? server.isActive : draft.isActive,
        ...(draft.disabledTools.length > 0 ? { disabledTools: draft.disabledTools } : {}),
        ...(draft.autoApprovedTools.length > 0
          ? { autoApprovedTools: draft.autoApprovedTools }
          : {}),
        ...(split.secretRefs ? { secretRefs: split.secretRefs } : {}),
        createdAt: server?.createdAt ?? now,
        updatedAt: now,
      };
      await writeMcpServers(app, (servers) =>
        server
          ? servers.map((entry) => {
              if (entry.id !== resolvedId) return entry;
              if (draftConnectionChanged(draft, draftFromServer(entry))) return next;
              const approvals = new Map(Object.entries(entry.directToolApprovals ?? {}));
              for (const [name, fingerprint] of Object.entries(draft.directToolChanges)) {
                if (fingerprint === null) approvals.delete(name);
                else approvals.set(name, fingerprint);
              }
              const reserved = getSettings().agentMode?.webSearch?.mcp;
              if (reserved?.serverId === resolvedId) approvals.delete(reserved.toolName);
              for (const tool of tools) {
                if (isAdvertisedMcpWebSearch(next, tool)) approvals.delete(tool.name);
              }
              return approvals.size
                ? { ...next, directToolApprovals: Object.fromEntries(approvals) }
                : next;
            })
          : [...servers, next]
      );
      onSaved?.();
      onClose();
      await deleteUnusedMcpSecretEntries(
        store,
        server?.secretRefs ?? [],
        next.secretRefs ?? []
      ).catch((error) => {
        logError("[MCP] failed to clean up unused credentials", error);
        new Notice(t("The server was saved, but its unused credentials could not be deleted."));
      });
    } catch (error) {
      logError("[MCP] failed to save server", error);
      new Notice(t("Failed to save the MCP server configuration."));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = (): void => {
    if (!server) return;
    new ConfirmModal(
      app,
      async () => {
        try {
          const store = SecretStore.getInstance(app);
          await writeMcpServers(app, (servers) =>
            servers.filter((entry) => entry.id !== server.id)
          );
          onClose();
          await deleteUnusedMcpSecretEntries(store, server.secretRefs ?? [], []).catch((error) => {
            logError("[MCP] failed to clean up removed server credentials", error);
            new Notice(
              t("The server was removed, but its saved credentials could not be deleted.")
            );
          });
        } catch (error) {
          logError("[MCP] failed to delete server", error);
          new Notice(t("Failed to delete the MCP server."));
        }
      },
      t('Remove MCP server "{name}"? Its saved credentials are removed as well.', {
        name: server.name,
      }),
      t("Remove MCP server"),
      t("Remove"),
      t("Cancel")
    ).open();
  };

  return (
    <McpServerEditorContent
      mode={server ? "edit" : "create"}
      server={server}
      runtime={{
        status: state.status,
        lastError: state.lastError,
        version: state.version,
        tools,
      }}
      saving={saving}
      liveActive={server?.isActive}
      deferred={isDeferredMcpLoadingActive(app)}
      webSearchToolName={webSearch?.serverId === server?.id ? webSearch?.toolName : undefined}
      onToggleActive={server ? handleToggleActive : undefined}
      onSave={handleSave}
      onDelete={server ? handleDelete : undefined}
      onCancel={onClose}
    />
  );
};

export interface McpServerEditorRuntime {
  status: McpServerStatus;
  lastError?: string;
  version?: string;
  tools: readonly McpToolInfo[];
}

export interface McpServerEditorContentProps {
  mode: "create" | "edit";
  server: McpServerConfig | null;
  runtime: McpServerEditorRuntime;
  saving?: boolean;
  deferred?: boolean;
  initialTab?: "general" | "tools";
  webSearchToolName?: string;
  liveActive?: boolean;
  onToggleActive?: (checked: boolean) => void;
  onSave: (draft: McpServerDraft) => Promise<void> | void;
  onDelete?: () => void;
  onCancel: () => void;
}

export const McpServerEditorContent: React.FC<McpServerEditorContentProps> = ({
  mode,
  server,
  runtime,
  saving = false,
  deferred = false,
  initialTab = "general",
  webSearchToolName,
  liveActive,
  onToggleActive,
  onSave,
  onDelete,
  onCancel,
}) => {
  const [draft, setDraft] = useState<McpServerDraft>(() =>
    server ? draftFromServer(server) : { ...EMPTY_MCP_SERVER_DRAFT }
  );
  const [tab, setTab] = useState<"general" | "tools">(initialTab);
  const errors = useMemo(() => validateMcpServerDraft(draft), [draft]);
  const dirty = useMemo(() => draftChanged(draft, server), [draft, server]);
  const canSave = Object.keys(errors).length === 0 && dirty && !saving;
  const patch = (partial: Partial<McpServerDraft>): void =>
    setDraft((current) => ({ ...current, ...partial }));
  const directToolStates = new Map<string, McpDirectToolState>();
  if (tab === "tools" && server) {
    const connectionChanged =
      runtime.status !== "connected" || draftConnectionChanged(draft, draftFromServer(server));
    for (const tool of runtime.tools) {
      if (tool.name === webSearchToolName || isAdvertisedMcpWebSearch(server, tool)) {
        directToolStates.set(tool.name, "web-search");
      } else if (connectionChanged) {
        directToolStates.set(tool.name, "connection-changed");
      } else {
        const approval = Object.hasOwn(draft.directToolChanges, tool.name)
          ? draft.directToolChanges[tool.name]
          : server.directToolApprovals?.[tool.name];
        if (approval === mcpDirectToolFingerprint(server, tool))
          directToolStates.set(tool.name, "approved");
      }
    }
  }

  const toggleDirectTool = (name: string, approved: boolean): void => {
    const tool = runtime.tools.find((entry) => entry.name === name);
    const state = directToolStates.get(name);
    if (!server || !tool || state === "web-search" || state === "connection-changed") return;
    const fingerprint = approved ? mcpDirectToolFingerprint(server, tool) : null;
    setDraft((current) => {
      const directToolChanges = { ...current.directToolChanges, [name]: fingerprint };
      if (fingerprint === (server.directToolApprovals?.[name] ?? null))
        delete directToolChanges[name];
      return { ...current, directToolChanges };
    });
  };

  return (
    <div className="tw-group/settings tw-flex tw-min-h-0 tw-min-w-0 tw-flex-1 tw-flex-col tw-gap-4">
      <div className="tw-flex tw-shrink-0 tw-flex-wrap tw-items-center tw-justify-between tw-gap-3 tw-px-2 tw-pb-3">
        <div className="tw-flex tw-min-w-0 tw-flex-col tw-gap-1">
          <div className="tw-flex tw-min-w-0 tw-flex-wrap tw-items-center tw-gap-2">
            <span className="tw-truncate tw-text-base tw-font-semibold tw-text-normal">
              {draft.name.trim() || (mode === "create" ? t("New MCP server") : server?.name)}
            </span>
            <McpServerStatusBadge status={runtime.status} lastError={runtime.lastError} />
          </div>
          <span className="tw-text-ui-smaller tw-text-muted">
            {runtime.status === "connected" && runtime.version
              ? runtime.version
              : t("Version unknown")}
          </span>
        </div>
        <div className="tw-flex tw-shrink-0 tw-items-center tw-gap-2">
          <span className="tw-text-sm tw-text-muted">{t("Enabled")}</span>
          <SettingSwitch
            disabled={saving}
            checked={liveActive ?? draft.isActive}
            onCheckedChange={(checked) =>
              onToggleActive ? onToggleActive(checked) : patch({ isActive: checked })
            }
            aria-label={t("Enable this server")}
          />
        </div>
      </div>

      <div className="tw-shrink-0 tw-px-2">
        <SegmentedControl<"general" | "tools">
          disabled={saving}
          options={[
            { label: t("General"), value: "general" },
            { label: `${t("Tools")} (${runtime.tools.length})`, value: "tools" },
          ]}
          value={tab}
          onChange={setTab}
          aria-label={t("Server settings sections")}
        />
      </div>

      <div className="tw-min-h-0 tw-min-w-0 tw-flex-1 tw-overflow-y-auto tw-px-2 tw-py-1">
        {tab === "general" ? (
          <div className="tw-flex tw-flex-col tw-gap-4">
            <FormField label={t("Name")} required error={!!errors.name} errorMessage={errors.name}>
              <Input
                disabled={saving}
                aria-label={t("Name")}
                value={draft.name}
                onChange={(event) => patch({ name: event.target.value })}
                placeholder={t("Name")}
              />
            </FormField>
            <FormField label={t("Type")}>
              <SegmentedControl<McpServerType>
                disabled={saving}
                options={[
                  { label: t("Standard input / output (stdio)"), value: "stdio" },
                  { label: t("Server-sent events (sse)"), value: "sse" },
                  { label: t("Streamable HTTP (streamableHttp)"), value: "streamableHttp" },
                ]}
                value={draft.type}
                onChange={(type) => patch({ type })}
                aria-label={t("Type")}
                className="tw-max-w-full tw-flex-wrap"
              />
            </FormField>
            <FormField label={t("Description")}>
              <Textarea
                disabled={saving}
                aria-label={t("Description")}
                value={draft.description}
                onChange={(event) => patch({ description: event.target.value })}
                placeholder={t("Description")}
                rows={2}
              />
            </FormField>
            {draft.type === "stdio" ? (
              <>
                <FormField
                  label={t("Command")}
                  required
                  error={!!errors.command}
                  errorMessage={errors.command}
                >
                  <Input
                    disabled={saving}
                    aria-label={t("Command")}
                    value={draft.command}
                    onChange={(event) => patch({ command: event.target.value })}
                    placeholder="uvx or npx"
                  />
                </FormField>
                <FormField label={t("Arguments")} description={t("One argument per line")}>
                  <Textarea
                    disabled={saving}
                    aria-label={t("Arguments")}
                    value={draft.argsText}
                    onChange={(event) => patch({ argsText: event.target.value })}
                    placeholder={"arg1\narg2"}
                    rows={3}
                  />
                </FormField>
                <FormField
                  label={t("Environment variables")}
                  description={t("Format: KEY=value, one per line")}
                >
                  <Textarea
                    disabled={saving}
                    aria-label={t("Environment variables")}
                    value={draft.envText}
                    onChange={(event) => patch({ envText: event.target.value })}
                    placeholder={"KEY1=value1\nKEY2=value2"}
                    rows={3}
                  />
                </FormField>
              </>
            ) : (
              <>
                <FormField label={t("URL")} required error={!!errors.url} errorMessage={errors.url}>
                  <Input
                    disabled={saving}
                    aria-label={t("URL")}
                    value={draft.url}
                    onChange={(event) => patch({ url: event.target.value })}
                    placeholder={
                      draft.type === "sse"
                        ? "http://localhost:3000/sse"
                        : "http://localhost:3000/mcp"
                    }
                  />
                </FormField>
                <FormField label={t("Headers")} description={t("Format: KEY=value, one per line")}>
                  <Textarea
                    disabled={saving}
                    aria-label={t("Headers")}
                    value={draft.headersText}
                    onChange={(event) => patch({ headersText: event.target.value })}
                    placeholder={"Content-Type=application/json\nAuthorization=Bearer token"}
                    rows={3}
                  />
                </FormField>
              </>
            )}
            {(server?.secretRefs?.length ?? 0) > 0 && (
              <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
                <span className="tw-text-xs tw-text-muted">
                  {t("Saved credentials — leave blank to keep them:")}
                </span>
                {(server?.secretRefs ?? []).map((ref) => (
                  <Badge key={ref.secretId} variant="outline" className="tw-font-mono">
                    {ref.key}
                  </Badge>
                ))}
              </div>
            )}
            <FormField
              label={t("Timeout")}
              description={t(
                "Request timeout for this server, in seconds. The default is 60 seconds."
              )}
              error={!!errors.timeoutText}
              errorMessage={errors.timeoutText}
            >
              <Input
                disabled={saving}
                type="number"
                min={1}
                step={1}
                aria-label={t("Timeout")}
                value={draft.timeoutText}
                onChange={(event) => patch({ timeoutText: event.target.value })}
                placeholder="60"
                className="tw-w-32"
              />
            </FormField>
            <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
              <div className="tw-flex tw-items-center tw-gap-1.5">
                <span className="tw-text-sm tw-text-normal">{t("Long-running mode")}</span>
                <HelpTooltip
                  content={t(
                    "When enabled, progress notifications reset the timeout for long tasks, up to a 10-minute total limit."
                  )}
                />
              </div>
              <SettingSwitch
                disabled={saving}
                checked={draft.longRunning}
                onCheckedChange={(checked) => patch({ longRunning: checked })}
                aria-label={t("Long-running mode")}
              />
            </div>
          </div>
        ) : (
          <McpToolsSection
            tools={runtime.tools}
            disabled={saving}
            disabledTools={draft.disabledTools}
            autoApprovedTools={draft.autoApprovedTools}
            directToolStates={directToolStates}
            onToggleDirect={toggleDirectTool}
            deferred={deferred}
            onToggleTool={(name, enabled) =>
              patch({
                disabledTools: enabled
                  ? draft.disabledTools.filter((entry) => entry !== name)
                  : [...new Set([...draft.disabledTools, name])],
              })
            }
            onToggleAutoApprove={(name, approved) =>
              patch({
                autoApprovedTools: approved
                  ? [...new Set([...draft.autoApprovedTools, name])]
                  : draft.autoApprovedTools.filter((entry) => entry !== name),
              })
            }
          />
        )}
      </div>

      <div className="tw-flex tw-shrink-0 tw-flex-col-reverse tw-gap-2 tw-px-2 tw-pt-3 sm:tw-flex-row sm:tw-items-center sm:tw-justify-between">
        <div>
          {onDelete && (
            <Button variant="ghost" className="tw-text-error" onClick={onDelete} disabled={saving}>
              {t("Delete")}
            </Button>
          )}
        </div>
        <div className="tw-flex tw-gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={saving}>
            {t("Cancel")}
          </Button>
          <Button onClick={() => void onSave(draft)} disabled={!canSave}>
            {saving ? <Loader2 className="tw-size-4 tw-animate-spin" /> : null}
            {t("Save")}
          </Button>
        </div>
      </div>
    </div>
  );
};

export const McpServerStatusBadge: React.FC<{
  status: McpServerStatus;
  lastError?: string;
}> = ({ status, lastError }) => {
  const labels: Record<McpServerStatus, string> = {
    connected: t("Connected"),
    connecting: t("Connecting"),
    error: t("Error"),
    disabled: t("Disabled"),
  };
  const dotColors: Record<McpServerStatus, string> = {
    connected: "tw-bg-success",
    connecting: "tw-bg-warning",
    error: "tw-bg-modifier-error",
    disabled: "tw-bg-[--background-modifier-border-hover]",
  };
  const badge = (
    <Badge variant="outline" className="tw-gap-1.5">
      <span aria-hidden="true" className={cn("tw-size-2 tw-rounded-full", dotColors[status])} />
      {labels[status]}
    </Badge>
  );
  return status === "error" && lastError ? (
    <HelpTooltip content={lastError}>{badge}</HelpTooltip>
  ) : (
    badge
  );
};
