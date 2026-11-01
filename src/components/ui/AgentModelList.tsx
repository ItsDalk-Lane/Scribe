import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ModelEnableRow } from "@/components/ui/ModelEnableList";
import { SearchBar } from "@/components/ui/SearchBar";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ChevronDown } from "lucide-react";
import React from "react";

export interface AgentModelListProps {
  rows: readonly ModelEnableRow[];
  onToggle: (id: string, enabled: boolean) => void;
  agentName: string;
  defaultOpen?: boolean;
}

export function AgentModelList({
  rows,
  onToggle,
  agentName,
  defaultOpen = false,
}: AgentModelListProps) {
  const [open, setOpen] = React.useState(defaultOpen);
  const [query, setQuery] = React.useState("");
  const enabled = rows.filter((row) => row.enabled);
  const defaultId = enabled[0]?.id;
  const q = query.trim().toLowerCase();
  const visible = rows.filter((row) =>
    `${row.label}\n${row.wireId ?? ""}\n${row.description ?? ""}`.toLowerCase().includes(q)
  );
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="tw-group/settings tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-transparent"
    >
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="tw-flex !tw-h-auto tw-w-full tw-items-center tw-justify-between tw-gap-4 !tw-whitespace-normal !tw-border-0 !tw-bg-transparent !tw-p-4 tw-text-left tw-text-normal !tw-shadow-none hover:!tw-bg-modifier-hover focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-inset focus-visible:tw-ring-ring"
        >
          <span className="tw-space-y-1">
            <span className="tw-block tw-text-ui-small tw-font-medium">{t("Visible models")}</span>
            <span className="tw-block tw-text-ui-smaller tw-leading-normal tw-text-muted">
              {t("{enabled} enabled / {total} models", {
                enabled: enabled.length,
                total: rows.length,
              })}
            </span>
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              "tw-size-4 tw-shrink-0 tw-text-muted tw-transition-transform",
              !open && "tw--rotate-90"
            )}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent className="tw-space-y-3 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-p-4">
        <p className="tw-m-0 tw-text-ui-smaller tw-leading-normal tw-text-muted">
          {t(
            "Models are reported by this agent. The first enabled model is the default; reasoning uses the agent default."
          )}
        </p>
        <SearchBar
          value={query}
          onChange={setQuery}
          placeholder={t("Search {displayName} models…", { displayName: agentName })}
        />
        <div className="tw-max-h-80 tw-space-y-1 tw-overflow-y-auto">
          {visible.map((row) => (
            <div
              key={row.id}
              className="tw-flex tw-items-center tw-justify-between tw-gap-4 tw-rounded-md tw-p-3 hover:tw-bg-modifier-hover"
            >
              <div className="tw-min-w-0 tw-flex-1 tw-space-y-1">
                <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
                  <span className="tw-break-words tw-text-ui-small tw-font-medium">
                    {row.label}
                  </span>
                  {row.id === defaultId && <Badge variant="accent">{t("Default")}</Badge>}
                </div>
                {row.wireId && (
                  <div className="tw-break-all tw-text-ui-smaller tw-leading-normal tw-text-muted">
                    {row.wireId}
                  </div>
                )}
                {row.description && (
                  <div className="tw-break-words tw-text-ui-smaller tw-leading-normal tw-text-muted">
                    {row.description}
                  </div>
                )}
              </div>
              <SettingSwitch
                aria-label={t("Show model {name}", {
                  name: `${row.label} (${row.wireId ?? row.id})`,
                })}
                checked={row.enabled}
                onCheckedChange={(next) => onToggle(row.id, next)}
              />
            </div>
          ))}
          {visible.length === 0 && (
            <p role="status" className="tw-py-4 tw-text-center tw-text-ui-small tw-text-muted">
              {t(
                q
                  ? "No matching models."
                  : "No models reported yet. Install and sign in to the agent to discover its models."
              )}
            </p>
          )}
        </div>
        {rows.length > 0 && enabled.length === 0 && (
          <p role="status" className="tw-text-ui-smaller tw-leading-normal tw-text-muted">
            {t("Enable at least one model to start a new chat.")}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
