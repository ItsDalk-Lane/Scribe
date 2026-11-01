import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";
import { ChevronDown, Monitor } from "lucide-react";
import React from "react";

export interface AgentConfigurationHeaderProps {
  agents: readonly { id: string; label: string; icon?: React.ReactNode }[];
  selectedAgent: string;
  onSelectAgent?: (id: string) => void;
  source?: string;
  sources?: readonly { value: string; label: string }[];
  onSourceChange?: (value: string) => void;
  query?: string;
  onQueryChange?: (value: string) => void;
  searchPlaceholder?: string;
  count?: number;
  label?: string;
  actions?: React.ReactNode;
}

export function AgentConfigurationHeader({
  agents,
  selectedAgent,
  onSelectAgent,
  source,
  sources,
  onSourceChange,
  query,
  onQueryChange,
  searchPlaceholder,
  count,
  label,
  actions,
}: AgentConfigurationHeaderProps) {
  return (
    <div className="tw-group/settings tw-space-y-5">
      <div
        role="tablist"
        aria-label="Agent"
        className="tw-flex tw-flex-wrap tw-gap-0.5 tw-border-0 tw-border-b tw-border-solid tw-border-border"
      >
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            role="tab"
            aria-selected={agent.id === selectedAgent}
            onClick={() => onSelectAgent?.(agent.id)}
            className={cn(
              "tw-flex tw-items-center tw-gap-2 !tw-rounded-none !tw-border-0 !tw-border-b-[2px] !tw-border-solid !tw-bg-transparent !tw-px-3 !tw-py-2 tw-text-ui-small !tw-shadow-none tw-transition-colors hover:tw-text-normal focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-inset focus-visible:tw-ring-ring",
              agent.id === selectedAgent
                ? "!tw-border-interactive-accent tw-font-medium tw-text-normal"
                : "!tw-border-transparent tw-text-muted"
            )}
          >
            {agent.icon}
            {agent.label}
          </button>
        ))}
      </div>
      {(sources || onQueryChange || label || actions) && (
        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
          <div className="tw-flex tw-min-w-0 tw-max-w-full tw-flex-wrap tw-items-center tw-gap-4">
            {sources && (
              <div className="tw-relative tw-flex tw-min-w-0 tw-max-w-full tw-items-center">
                <Monitor
                  aria-hidden="true"
                  className="tw-pointer-events-none tw-absolute tw-left-3 tw-size-4 tw-text-muted"
                />
                <select
                  aria-label="配置来源"
                  value={source}
                  onChange={(event) => onSourceChange?.(event.target.value)}
                  className="!tw-h-8 tw-max-w-full !tw-appearance-none !tw-rounded-md !tw-border tw-border-solid tw-border-border !tw-bg-transparent !tw-py-1 !tw-pl-9 !tw-pr-8 !tw-text-ui-small tw-text-normal !tw-shadow-none focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring"
                >
                  {sources.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <ChevronDown
                  aria-hidden="true"
                  className="tw-pointer-events-none tw-absolute tw-right-3 tw-top-1/2 tw-size-4 tw--translate-y-1/2 tw-text-muted"
                />
              </div>
            )}
          </div>
          {onQueryChange && (
            <div className="tw-w-full sm:tw-w-64">
              <SearchBar
                value={query ?? ""}
                onChange={onQueryChange}
                placeholder={searchPlaceholder}
              />
            </div>
          )}
        </div>
      )}
      {(label || actions) && (
        <div className="tw-flex tw-flex-wrap tw-items-center tw-justify-between tw-gap-3">
          {label && (
            <span className="tw-text-ui-small tw-font-medium">
              {label}{" "}
              {count !== undefined && <span className="tw-ml-1 tw-text-muted">{count}</span>}
            </span>
          )}
          {actions && (
            <div className="tw-group/extension-actions tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
