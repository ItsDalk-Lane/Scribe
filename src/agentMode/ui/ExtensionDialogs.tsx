import type {
  AgentExtensionDetails,
  AgentExtensionImport,
  AgentExtensionScope,
  AgentMarketplace,
  AgentPluginAction,
} from "@/agentMode/session/extensionManagement";
import type { AgentExtensionKind } from "@/agentMode/session/extensionInventory";
import { ExtensionField, ExtensionSelect } from "@/agentMode/ui/ExtensionEditor";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/lib/i18n";
import type { App } from "obsidian";
import React from "react";

export class ExtensionModal extends ReactModal {
  constructor(
    app: App,
    title: string,
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
            "The plugin stays in this directory. Removing it here does not delete its source files."
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

export interface ExtensionDetailsViewProps {
  details: AgentExtensionDetails;
  onClose: () => void;
  onUpdate?: () => Promise<void>;
  onDelete?: () => void;
}

export function ExtensionDetailsView({
  details,
  onClose,
  onUpdate,
  onDelete,
}: ExtensionDetailsViewProps) {
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState("");
  const { item, config } = details;
  const readOnly = Boolean(item.builtin || item.readOnly || item.parentPluginId);
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
  return (
    <div className="tw-group/settings tw-space-y-4 tw-text-normal">
      <p className="tw-text-ui-small">{item.description}</p>
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
      {item.location && (
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
