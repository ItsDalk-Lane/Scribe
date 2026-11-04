import type {
  AgentExtensionDetails,
  AgentExtensionImport,
  AgentExtensionScope,
  AgentMarketplace,
  AgentPluginAction,
} from "@/agentMode/session/extensionManagement";
import type { AgentExtensionKind } from "@/agentMode/session/extensionInventory";
import { ExtensionField, ExtensionSelect } from "@/agentMode/ui/ExtensionEditor";
import { EXTENSION_LABELS } from "@/agentMode/ui/AgentExtensionsPanel";
import { getExtensionDotState } from "@/agentMode/session/extensionAvailability";
import { ExtensionAvailabilityDot } from "@/components/ui/extension-availability-dot";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import { logError } from "@/logger";
import { Copy } from "lucide-react";
import type { App } from "obsidian";
import { Notice } from "obsidian";
import React from "react";

export class ExtensionModal extends ReactModal {
  constructor(
    app: App,
    title: string | undefined,
    private readonly renderBody: (close: () => void) => React.ReactElement
  ) {
    super(app, title);
  }
  protected renderContent(close: () => void): React.ReactElement {
    return this.renderBody(close);
  }
}

export interface PluginInstallFormProps {
  scope: AgentExtensionScope;
  marketplaces: readonly AgentMarketplace[];
  onInstall: (action: AgentPluginAction) => Promise<void>;
  onClose: () => void;
}

export function PluginInstallForm({
  scope,
  marketplaces,
  onInstall,
  onClose,
}: PluginInstallFormProps) {
  const [source, setSource] = React.useState("marketplace");
  const [plugin, setPlugin] = React.useState("");
  const [marketplace, setMarketplace] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const install = async () => {
    setBusy(true);
    setError("");
    try {
      await onInstall({
        action: "install",
        scope,
        plugin: plugin.trim(),
        local: source === "local",
        ...(marketplace.trim() ? { marketplace: marketplace.trim() } : {}),
      });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Could not install plugin."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="tw-group/settings tw-space-y-4 tw-text-normal"
      onSubmit={(event) => {
        event.preventDefault();
        void install();
      }}
    >
      <ExtensionField label={t("Add from")}>
        <ExtensionSelect
          value={source}
          onChange={setSource}
          options={[
            { value: "marketplace", label: t("Plugin marketplace") },
            { value: "local", label: t("Local directory") },
          ]}
        />
      </ExtensionField>
      {source === "marketplace" && (
        <>
          {marketplaces.length > 0 && (
            <>
              <Input
                aria-label={t("Search plugins")}
                placeholder={t("Search plugins")}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
              <div className="tw-max-h-64 tw-space-y-3 tw-overflow-y-auto">
                {marketplaces.map((market) => (
                  <section key={market.name}>
                    <h3 className="tw-text-ui-small tw-text-muted">{market.name}</h3>
                    {market.plugins
                      .filter((item) =>
                        `${item.name} ${item.description ?? ""}`
                          .toLowerCase()
                          .includes(query.toLowerCase())
                      )
                      .map((item) => (
                        <button
                          type="button"
                          key={item.id}
                          onClick={() => {
                            setPlugin(item.id);
                            setMarketplace("");
                          }}
                          className="tw-flex !tw-h-auto tw-w-full tw-flex-col tw-items-start tw-gap-1 !tw-whitespace-normal !tw-border-0 !tw-bg-transparent !tw-p-2 tw-text-left tw-text-normal !tw-shadow-none hover:!tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
                        >
                          <span className="tw-text-ui-small tw-font-medium">{item.name}</span>
                          {item.description && (
                            <span className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
                              {item.description}
                            </span>
                          )}
                        </button>
                      ))}
                  </section>
                ))}
              </div>
            </>
          )}
          <ExtensionField label={t("Marketplace address (optional)")}>
            <Input
              value={marketplace}
              onChange={(event) => setMarketplace(event.target.value)}
              placeholder={t("URL, repository or configured marketplace")}
            />
          </ExtensionField>
        </>
      )}
      <ExtensionField label={t(source === "local" ? "Plugin directory" : "Plugin name")}>
        <Input
          required
          value={plugin}
          onChange={(event) => setPlugin(event.target.value)}
          placeholder={source === "local" ? "" : "plugin@marketplace"}
        />
      </ExtensionField>
      {source === "local" && (
        <p className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
          {t(
            "The plugin runs from this directory. Deleting it later from the extension list also deletes this directory."
          )}
        </p>
      )}
      {error && (
        <p role="alert" className="tw-text-ui-small tw-text-error">
          {error}
        </p>
      )}
      <div className="tw-group/extension-actions tw-flex tw-justify-end tw-gap-2 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {t(busy ? "Installing…" : "Add plugin")}
        </Button>
      </div>
    </form>
  );
}

export interface ExtensionImportFormProps {
  kind: AgentExtensionKind;
  scope: AgentExtensionScope;
  onImport: (input: AgentExtensionImport) => Promise<void>;
  onClose: () => void;
}

export function ExtensionImportForm({ kind, scope, onImport, onClose }: ExtensionImportFormProps) {
  const [content, setContent] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      await onImport({ kind, scope, content });
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Could not import configuration."));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form
      className="tw-group/settings tw-space-y-4 tw-text-normal"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ExtensionField label={t("Choose configuration file")}>
        <input
          type="file"
          accept=".json,.jsonc"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file)
              void file
                .text()
                .then(setContent)
                .catch(() => setError(t("Could not read configuration file.")));
          }}
        />
      </ExtensionField>
      <ExtensionField label={t("Configuration content")}>
        <Textarea
          required
          rows={10}
          value={content}
          onChange={(event) => setContent(event.target.value)}
        />
      </ExtensionField>
      {error && (
        <p role="alert" className="tw-text-ui-small tw-text-error">
          {error}
        </p>
      )}
      <div className="tw-group/extension-actions tw-flex tw-justify-end tw-gap-2 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-pt-4">
        <Button type="button" variant="secondary" onClick={onClose}>
          {t("Cancel")}
        </Button>
        <Button type="submit" disabled={busy}>
          {t(busy ? "Importing…" : "Import")}
        </Button>
      </div>
    </form>
  );
}

const PLUGIN_COMPONENT_KINDS: readonly AgentExtensionKind[] = Object.freeze([
  "skill",
  "command",
  "hook",
  "mcp",
  "subagent",
]);
const INSTALLATION_SCOPE_LABELS = {
  user: "Local · User",
  project: "Project",
  local: "Project · Local",
};

export interface ExtensionDetailsViewProps {
  details: AgentExtensionDetails;
  scopeLabel?: string;
  onClose: () => void;
  onUpdate?: () => Promise<void>;
  onDelete?: () => void;
}

export function ExtensionDetailsView({
  details,
  scopeLabel,
  onClose,
  onUpdate,
  onDelete,
}: ExtensionDetailsViewProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const { item, config } = details;
  const readOnly = Boolean(item.builtin || item.readOnly || item.parentPluginId);
  const dot = getExtensionDotState(item);
  const update = async () => {
    setBusy(true);
    try {
      await onUpdate?.();
      onClose();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : t("Could not update plugin."));
    } finally {
      setBusy(false);
    }
  };
  const copyName = async () => {
    try {
      await navigator.clipboard.writeText(item.name);
      new Notice(t("Copied to clipboard"));
    } catch (failure) {
      logError("Could not copy the extension name", failure);
      new Notice(t("Failed to copy to clipboard"));
    }
  };
  return (
    <div className="tw-group/settings tw-space-y-4 tw-text-normal">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-2 tw-gap-y-1">
        <span className="tw-min-w-0 tw-break-words tw-text-ui-medium tw-font-medium">
          {item.name}
        </span>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("Copy name")}
          title={t("Copy name")}
          onClick={() => void copyName()}
        >
          <Copy className="tw-size-4" />
        </Button>
      </div>
      {scopeLabel && (
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
          <span className="tw-text-ui-small">{t("Scope")}</span>
          <span className="tw-min-w-0 tw-truncate tw-text-ui-small tw-text-muted">
            {scopeLabel}
          </span>
        </div>
      )}
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-3">
        <span className="tw-text-ui-small">{t("Availability in this scope")}</span>
        <span className="tw-inline-flex tw-min-w-0 tw-items-center tw-gap-2">
          <ExtensionAvailabilityDot state={dot} />
          <span className="tw-truncate tw-text-ui-small tw-text-muted">
            {dot.enabled
              ? t("Available in this scope")
              : t(dot.reason ?? "Unavailable in this scope")}
          </span>
        </span>
      </div>
      <p className="tw-text-ui-small">{item.description}</p>
      {item.unavailableReason && (
        <p className="tw-text-ui-small tw-text-muted">{t(item.unavailableReason)}</p>
      )}
      {item.kind === "plugin" && (
        <dl className="tw-space-y-2 tw-text-ui-small">
          <div className="tw-flex tw-flex-wrap tw-gap-x-3 tw-gap-y-1">
            <dt className="tw-text-muted">{t("Version")}</dt>
            <dd className="tw-m-0 tw-break-all">{item.version ?? t("Not provided")}</dd>
          </div>
          <div className="tw-space-y-1">
            <dt className="tw-text-muted">{t("Installation address")}</dt>
            <dd className="tw-m-0 tw-break-all">{item.location ?? t("Not provided")}</dd>
          </div>
        </dl>
      )}
      {item.installations && item.installations.length > 0 && (
        <section className="tw-space-y-2" aria-label={t("Installations")}>
          <h3 className="tw-m-0 tw-text-ui-small tw-font-medium">{t("Installations")}</h3>
          <div className="tw-divide-y tw-divide-border tw-rounded-lg tw-border tw-border-solid tw-border-border">
            {item.installations.map((installation) => (
              <div
                key={JSON.stringify([
                  installation.scope,
                  installation.projectPath,
                  installation.path,
                  installation.version,
                ])}
                className="tw-space-y-1 tw-p-3 tw-text-ui-smaller"
              >
                <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-x-3 tw-gap-y-1">
                  <span>{t(INSTALLATION_SCOPE_LABELS[installation.scope])}</span>
                  {installation.version && (
                    <span className="tw-break-all tw-text-muted">{installation.version}</span>
                  )}
                </div>
                {installation.projectPath && (
                  <p className="tw-m-0 tw-break-all tw-text-muted">{installation.projectPath}</p>
                )}
                <p className="tw-m-0 tw-break-all tw-text-muted">{installation.path}</p>
                {installation.available === false && (
                  <p className="tw-m-0 tw-text-error">{t("Installation files are missing.")}</p>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
      {item.kind === "plugin" && (
        <section className="tw-space-y-4" aria-label={t("Plugin components")}>
          {details.children === undefined ? (
            <p className="tw-text-ui-small tw-text-muted">
              {t("Plugin components could not be confirmed.")}
            </p>
          ) : details.children.length === 0 ? (
            <p className="tw-text-ui-small tw-text-muted">
              {t("This plugin has no listed components.")}
            </p>
          ) : (
            PLUGIN_COMPONENT_KINDS.map((kind) => {
              const children = details.children?.filter((child) => child.kind === kind);
              if (!children?.length) return null;
              return (
                <section key={kind} className="tw-space-y-2">
                  <h3 className="tw-m-0 tw-text-ui-small tw-font-medium">
                    {t(EXTENSION_LABELS[kind])}
                  </h3>
                  <div className="tw-divide-y tw-divide-border tw-rounded-lg tw-border tw-border-solid tw-border-border">
                    {children.map((child) => (
                      <div
                        key={child.id}
                        className="tw-flex tw-min-w-0 tw-items-center tw-justify-between tw-gap-3 tw-p-3"
                      >
                        <div className="tw-min-w-0 tw-space-y-1">
                          <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-2">
                            <span className="tw-break-words tw-text-ui-small">{child.name}</span>
                            <ExtensionAvailabilityDot state={getExtensionDotState(child)} />
                          </div>
                          {child.description && (
                            <p className="tw-m-0 tw-break-words tw-text-ui-smaller tw-text-muted">
                              {child.description}
                            </p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              );
            })
          )}
        </section>
      )}
      {item.parentPluginId && (
        <p className="tw-text-ui-small tw-text-muted">
          {t("Plugin")}: {item.parentPluginId}
        </p>
      )}
      {readOnly && (
        <p className="tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-transparent tw-p-3 tw-text-ui-small tw-text-muted">
          {t("This entry is managed by its source and cannot be edited or deleted independently.")}
        </p>
      )}
      {item.toolCount !== undefined && (
        <p className="tw-text-ui-small">{t("{count} tools", { count: item.toolCount })}</p>
      )}
      {typeof config?.url === "string" && (
        <p className="tw-break-all tw-text-ui-small tw-text-muted">{config.url}</p>
      )}
      {typeof config?.command === "string" && (
        <ExtensionField label={t("Command")}>
          <Textarea readOnly rows={3} value={config.command} />
        </ExtensionField>
      )}
      {details.content && (
        <ExtensionField label={t("Content")}>
          <Textarea readOnly rows={8} value={details.content} />
        </ExtensionField>
      )}
      {item.location && item.kind !== "plugin" && (
        <p className="tw-break-all tw-text-ui-smaller tw-leading-normal tw-text-muted">
          {item.location}
        </p>
      )}
      {error && (
        <p role="alert" className="tw-text-ui-small tw-text-error">
          {error}
        </p>
      )}
      <div className="tw-group/extension-actions tw-flex tw-flex-wrap tw-justify-end tw-gap-2 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-pt-4">
        {onUpdate && !readOnly && (
          <Button variant="secondary" onClick={() => void update()} disabled={busy}>
            {t("Update plugin")}
          </Button>
        )}
        {onDelete && !readOnly && (
          <Button variant="destructive" onClick={onDelete} disabled={busy}>
            {t("Uninstall")}
          </Button>
        )}
        <Button variant="secondary" onClick={onClose}>
          {t("Close")}
        </Button>
      </div>
    </div>
  );
}
