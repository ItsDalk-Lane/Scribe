import { t } from "@/lib/i18n";
import { ReactModal } from "@/components/modals/ReactModal";
import { Button } from "@/components/ui/button";
import { FormField } from "@/components/ui/form-field";
import { Textarea } from "@/components/ui/textarea";
import { Notice } from "obsidian";
import { useApp } from "@/context";
import { SecretStore } from "@/services/secretStore";
import { persistMcpSecretEntries } from "@/agentMode/mcp/secretRefs";
import React, { useMemo, useState } from "react";

import { parseMcpServersImportJson, type McpServerImportIssue } from "@/agentMode/mcp/configSchema";
import type { McpServerConfig } from "@/agentMode/mcp/types";
import { getSettings, useSettingsValue } from "@/settings/model";
import { writeMcpServers } from "./mcpUiState";

const MCP_IMPORT_MODAL_CLASS = "scribe-mcp-json-import-modal";

export interface McpJsonImportModalOptions {
  onImported?: (count: number) => void;
}

export class McpJsonImportModal extends ReactModal {
  constructor(
    app: ConstructorParameters<typeof ReactModal>[0],
    private readonly options: McpJsonImportModalOptions
  ) {
    super(app, t("Import from JSON"), MCP_IMPORT_MODAL_CLASS);
  }

  onOpen(): void {
    this.modalEl.addClasses(["tw-flex", "tw-max-h-[85vh]", "tw-w-[640px]", "tw-flex-col"]);
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
    return <McpJsonImportBridge onClose={close} onImported={this.options.onImported} />;
  }
}

const ISSUE_LABELS: Record<McpServerImportIssue["reason"], string> = {
  "duplicate-name": "Server already exists: {name}",
  "missing-endpoint": "{name} is missing a command or URL.",
  "invalid-url": "{name} has an invalid URL.",
};

const McpJsonImportBridge: React.FC<{
  onClose: () => void;
  onImported?: (count: number) => void;
}> = ({ onClose, onImported }) => {
  const app = useApp();
  const settings = useSettingsValue();
  const existingNames = useMemo(
    () => new Set(settings.mcp.servers.map((server) => server.name)),
    [settings.mcp.servers]
  );

  const handleImport = async (servers: readonly McpServerConfig[]): Promise<void> => {
    const store = SecretStore.getInstance(app);
    const names = new Set(getSettings().mcp.servers.map((server) => server.name));
    const prepared: McpServerConfig[] = [];
    for (const server of servers) {
      if (names.has(server.name)) continue;
      const split = await persistMcpSecretEntries(store, server.id, server);
      prepared.push({
        ...server,
        env: split.env,
        headers: split.headers,
        secretRefs: split.secretRefs,
      });
    }
    let importedCount = 0;
    await writeMcpServers(app, (current) => {
      const currentNames = new Set(current.map((server) => server.name));
      const additions = prepared.filter((server) => !currentNames.has(server.name));
      importedCount = additions.length;
      return [...current, ...additions];
    });
    new Notice(
      t("Imported {count} MCP servers. They are disabled until you enable them.", {
        count: importedCount,
      })
    );
    onImported?.(importedCount);
  };

  return (
    <McpJsonImportContent existingNames={existingNames} onImport={handleImport} onClose={onClose} />
  );
};

export interface McpJsonImportContentProps {
  existingNames: ReadonlySet<string>;
  onImport: (servers: readonly McpServerConfig[]) => Promise<void>;
  onClose: () => void;
  initialText?: string;
}

export const McpJsonImportContent: React.FC<McpJsonImportContentProps> = ({
  existingNames,
  onImport,
  onClose,
  initialText = "",
}) => {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string>();

  const parsed = useMemo<{
    servers?: McpServerConfig[];
    issues?: McpServerImportIssue[];
    error?: string;
  }>(() => {
    if (!text.trim()) return {};
    try {
      return parseMcpServersImportJson(text);
    } catch (error) {
      return { error: t(error instanceof Error ? error.message : String(error)) };
    }
  }, [text]);

  const importable = (parsed.servers ?? []).filter((server) => !existingNames.has(server.name));
  const conflicts = (parsed.servers ?? []).filter((server) => existingNames.has(server.name));
  const issueLines = [
    ...conflicts.map((server) => `${t("Server already exists: {name}", { name: server.name })}`),
    ...(parsed.issues ?? []).map((issue) =>
      t(ISSUE_LABELS[issue.reason], { name: issue.serverName })
    ),
  ];
  const canImport = importable.length > 0;

  const handleImport = async (): Promise<void> => {
    setSaving(true);
    setSaveError(undefined);
    try {
      await onImport(importable);
      onClose();
    } catch {
      setSaveError(t("Failed to save the MCP server configuration."));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="tw-flex tw-min-h-0 tw-flex-1 tw-flex-col tw-gap-4">
      <p className="tw-m-0 tw-text-ui-smaller tw-leading-relaxed tw-text-muted">
        {t(
          "Paste an {mcpServers} JSON config, such as the one from Claude Desktop or Cherry Studio.",
          { mcpServers: '"mcpServers"' }
        )}
      </p>
      <FormField error={!!(parsed.error || saveError)} errorMessage={parsed.error ?? saveError}>
        <Textarea
          value={text}
          disabled={saving}
          aria-label={t("MCP servers JSON")}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            '{\n  "mcpServers": {\n    "files": { "command": "npx", "args": ["-y", "mcp-server-files"] }\n  }\n}'
          }
          rows={12}
          className="tw-min-h-0 tw-flex-1 tw-font-mono tw-text-sm"
        />
      </FormField>
      {issueLines.length > 0 && (
        <div className="tw-flex tw-flex-col tw-gap-1">
          {issueLines.map((line) => (
            <span key={line} className="tw-text-xs tw-text-error">
              {line}
            </span>
          ))}
        </div>
      )}
      {canImport && (
        <span className="tw-text-xs tw-text-muted">
          {t("{count} servers are ready to import.", { count: importable.length })}
        </span>
      )}
      <div className="tw-flex tw-shrink-0 tw-justify-end tw-gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          {t("Cancel")}
        </Button>
        <Button onClick={() => void handleImport()} disabled={!canImport || saving}>
          {t("Import")}
        </Button>
      </div>
    </div>
  );
};
