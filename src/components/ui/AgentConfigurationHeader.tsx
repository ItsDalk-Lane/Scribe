import { SearchBar } from "@/components/ui/SearchBar";
import { cn } from "@/lib/utils";

import React from "react";

export interface AgentConfigurationHeaderProps {
  agents: readonly { id: string; label: string; icon?: React.ReactNode }[];
  selectedAgent: string;
  onSelectAgent?: (id: string) => void;
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
      {(onQueryChange || label || actions) && (
        <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-3">
          {label && (
            <span className="tw-text-ui-small tw-font-medium">
              {label}{" "}
              {count !== undefined && <span className="tw-ml-1 tw-text-muted">{count}</span>}
            </span>
          )}
          {onQueryChange && (
            <div className="tw-w-full tw-min-w-0 sm:tw-w-64">
              <SearchBar
                value={query ?? ""}
                onChange={onQueryChange}
                placeholder={searchPlaceholder}
              />
            </div>
          )}
          {actions && (
            <div className="tw-group/extension-actions tw-ml-auto tw-flex tw-flex-wrap tw-items-center tw-justify-end tw-gap-2">
              {actions}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
