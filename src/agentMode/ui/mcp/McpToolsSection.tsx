import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { SearchBar } from "@/components/ui/SearchBar";
import { Button } from "@/components/ui/button";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { ChevronDown } from "lucide-react";
import React, { useMemo, useState } from "react";

import type { McpToolInfo } from "@/agentMode/mcp/types";

export interface McpToolsSectionProps {
  tools: readonly McpToolInfo[];
  disabled?: boolean;
  disabledTools: readonly string[];
  autoApprovedTools: readonly string[];
  deferred?: boolean;
  onToggleTool: (name: string, enabled: boolean) => void;
  onToggleAutoApprove: (name: string, approved: boolean) => void;
}

export const McpToolsSection: React.FC<McpToolsSectionProps> = ({
  tools,
  disabled: controlsDisabled = false,
  disabledTools,
  autoApprovedTools,
  deferred = false,
  onToggleTool,
  onToggleAutoApprove,
}) => {
  const [query, setQuery] = useState("");
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set<string>());
  const disabled = useMemo(() => new Set(disabledTools), [disabledTools]);
  const approved = useMemo(() => new Set(autoApprovedTools), [autoApprovedTools]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tools;
    return tools.filter(
      (tool) =>
        tool.name.toLowerCase().includes(q) || (tool.description ?? "").toLowerCase().includes(q)
    );
  }, [tools, query]);

  const toggleExpanded = (name: string): void => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  if (tools.length === 0) {
    return (
      <div className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-px-4 tw-py-8 tw-text-center tw-text-sm tw-text-muted">
        {t("No tools available. Save and enable the server to load its tools.")}
      </div>
    );
  }

  return (
    <div className="tw-flex tw-flex-col tw-gap-3 tw-@container">
      <SearchBar value={query} onChange={setQuery} placeholder={t("Search tools…")} />
      {deferred && (
        <p className="tw-text-xs tw-text-muted">
          {t(
            "Deferred loading is active: these tools stay in the catalog until the agent selects one with tool_search."
          )}
        </p>
      )}
      <div className="tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-border-border">
        <div className="tw-hidden tw-grid-cols-[minmax(0,1fr)_3rem_6rem] tw-items-center tw-gap-2 tw-border-x-0 tw-border-b tw-border-t-0 tw-border-solid tw-border-border tw-bg-secondary tw-px-3 tw-py-2 tw-text-xs tw-font-semibold tw-text-muted @sm:tw-grid">
          <span>{t("Available tools")}</span>
          <span>{t("Enabled")}</span>
          <span className="tw-flex tw-items-center tw-gap-1">
            {t("Auto-approve")}
            <HelpTooltip
              content={t(
                "Auto-approved tools run without asking for confirmation before each call."
              )}
            />
          </span>
        </div>
        {filtered.length === 0 ? (
          <div className="tw-px-4 tw-py-6 tw-text-center tw-text-sm tw-text-muted">
            {t("No results.")}
          </div>
        ) : (
          filtered.map((tool) => {
            const isEnabled = !disabled.has(tool.name);
            const isApproved = approved.has(tool.name);
            const isExpanded = expanded.has(tool.name);
            return (
              <div
                key={tool.name}
                className="tw-border-x-0 tw-border-b tw-border-t-0 tw-border-solid tw-border-border last:tw-border-b-0"
              >
                <div className="tw-grid tw-grid-cols-2 tw-items-center tw-gap-2 tw-px-3 tw-py-2.5 @sm:tw-grid-cols-[minmax(0,1fr)_3rem_6rem]">
                  <Button
                    type="button"
                    variant="ghost2"
                    size="fit"
                    className="tw-col-span-2 tw-flex tw-h-auto tw-min-w-0 tw-flex-col tw-items-start tw-gap-1 tw-whitespace-normal tw-rounded-none tw-border-0 tw-bg-transparent tw-p-0 tw-text-left tw-shadow-none @sm:tw-col-span-1"
                    disabled={controlsDisabled}
                    onClick={() => toggleExpanded(tool.name)}
                    aria-expanded={isExpanded}
                  >
                    <span className="tw-flex tw-w-full tw-items-center tw-gap-1 tw-text-sm tw-font-medium tw-text-normal">
                      <ChevronDown
                        aria-hidden="true"
                        className={cn(
                          "tw-size-3.5 tw-shrink-0 tw-text-muted tw-transition-transform",
                          !isExpanded && "tw--rotate-90"
                        )}
                      />
                      <span className="tw-truncate">{tool.name}</span>
                      {isEnabled && (
                        <span
                          className={cn(
                            "tw-shrink-0 tw-rounded tw-px-1.5 tw-py-0.5 tw-text-smallest tw-font-semibold",
                            deferred
                              ? "tw-bg-secondary-alt tw-text-muted"
                              : "tw-bg-secondary tw-text-normal"
                          )}
                        >
                          {deferred ? t("Deferred") : t("Registered")}
                        </span>
                      )}
                    </span>
                    {tool.description && (
                      <span className="tw-break-words tw-text-xs tw-leading-relaxed tw-text-muted [overflow-wrap:anywhere]">
                        {tool.description}
                      </span>
                    )}
                  </Button>
                  <span className="tw-flex tw-min-w-0 tw-flex-col tw-items-start tw-gap-1">
                    <span className="tw-text-xs tw-text-muted @sm:tw-hidden">{t("Enabled")}</span>
                    <SettingSwitch
                      checked={isEnabled}
                      disabled={controlsDisabled}
                      onCheckedChange={(checked) => onToggleTool(tool.name, checked)}
                      aria-label={t("Enable {name}", { name: tool.name })}
                    />
                  </span>
                  <span className="tw-flex tw-min-w-0 tw-flex-col tw-items-start tw-gap-1">
                    <span className="tw-text-xs tw-text-muted @sm:tw-hidden">
                      {t("Auto-approve")}
                    </span>
                    <span className="tw-flex tw-items-center tw-gap-1">
                      <SettingSwitch
                        checked={isApproved}
                        disabled={!isEnabled || controlsDisabled}
                        onCheckedChange={(checked) => onToggleAutoApprove(tool.name, checked)}
                        aria-label={t("Auto-approve {name}", { name: tool.name })}
                      />
                      <HelpTooltip
                        content={
                          !isEnabled
                            ? t("Enable the tool before configuring auto-approval.")
                            : isApproved
                              ? t("This tool runs without asking for confirmation.")
                              : t("This tool asks for confirmation before it runs.")
                        }
                      />
                    </span>
                  </span>
                </div>
                {isExpanded && (
                  <div className="tw-flex tw-flex-col tw-gap-3 tw-border-x-0 tw-border-b-0 tw-border-t tw-border-solid tw-border-border tw-bg-secondary tw-px-4 tw-py-3">
                    <McpSchemaViewer schema={tool.inputSchema} />
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

const MAX_SCHEMA_DEPTH = 5;

export const McpSchemaViewer: React.FC<{ schema: Record<string, unknown> }> = ({ schema }) => {
  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <McpSchemaNode name={undefined} schema={schema} required={false} depth={0} />
    </div>
  );
};

interface McpSchemaNodeProps {
  name?: string;
  schema: Record<string, unknown>;
  required: boolean;
  depth: number;
}

const McpSchemaNode: React.FC<McpSchemaNodeProps> = ({ name, schema, required, depth }) => {
  const type = typeof schema.type === "string" ? schema.type : "any";
  const enumValues = Array.isArray(schema.enum)
    ? schema.enum.map((value) => String(value))
    : undefined;
  const properties =
    depth < MAX_SCHEMA_DEPTH &&
    type === "object" &&
    schema.properties &&
    typeof schema.properties === "object"
      ? (schema.properties as Record<string, unknown>)
      : undefined;
  const requiredProperties = Array.isArray(schema.required)
    ? schema.required.filter((item): item is string => typeof item === "string")
    : [];
  const arrayItems =
    depth < MAX_SCHEMA_DEPTH && type === "array" && schema.items && typeof schema.items === "object"
      ? (schema.items as Record<string, unknown>)
      : undefined;
  const itemSchema = schema as { description?: unknown };
  const description =
    typeof itemSchema.description === "string" ? itemSchema.description : undefined;

  return (
    <div className="tw-flex tw-flex-col tw-gap-1">
      <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1.5">
        {name !== undefined && (
          <span className="tw-font-mono tw-text-xs tw-text-normal">{name}</span>
        )}
        <span className="tw-rounded tw-bg-secondary-alt tw-px-1.5 tw-py-0.5 tw-font-mono tw-text-smallest tw-text-muted">
          {type}
        </span>
        {required && (
          <span className="tw-text-smallest tw-font-semibold tw-text-error">{t("Required")}</span>
        )}
        {description && <span className="tw-text-xs tw-text-muted">{description}</span>}
      </div>
      {enumValues && (
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-1">
          <span className="tw-text-smallest tw-text-muted">{t("Allowed values")}</span>
          {enumValues.map((value) => (
            <span
              key={value}
              className="tw-rounded tw-bg-secondary-alt tw-px-1.5 tw-py-0.5 tw-font-mono tw-text-smallest tw-text-normal"
            >
              {value}
            </span>
          ))}
        </div>
      )}
      {properties && (
        <div className="tw-flex tw-flex-col tw-gap-1 tw-border-l tw-border-solid tw-border-border tw-pl-3">
          {Object.entries(properties).map(([property, propertySchema]) => (
            <McpSchemaNode
              key={property}
              name={property}
              schema={
                propertySchema && typeof propertySchema === "object"
                  ? (propertySchema as Record<string, unknown>)
                  : {}
              }
              required={requiredProperties.includes(property)}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
      {arrayItems && (
        <div className="tw-flex tw-flex-col tw-gap-1 tw-border-l tw-border-solid tw-border-border tw-pl-3">
          <span className="tw-text-smallest tw-text-muted">{t("Items")}</span>
          <McpSchemaNode schema={arrayItems} required={false} depth={depth + 1} />
        </div>
      )}
    </div>
  );
};
