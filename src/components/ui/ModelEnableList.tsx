import { t } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { FreeModelWarningIcon } from "@/components/ui/FreeModelWarningIcon";
import { DestinationIcon } from "@/components/ui/DestinationIcon";
import { ModelCapabilityIcons, hasCapabilityIcons } from "@/components/ui/model-display";
import { SearchBar } from "@/components/ui/SearchBar";
import { SettingSwitch } from "@/components/ui/setting-switch";
import type { ModelCapability } from "@/constants";
import { cn } from "@/lib/utils";
import type { Destination } from "@/types/destination";
import { ChevronRight } from "lucide-react";
import React from "react";

export interface ModelEnableRow {
  id: string;
  label: string;
  description?: string;
  wireId?: string;
  enabled: boolean;
  capabilities?: ModelCapability[];
  isFree?: boolean;
}

export interface ModelEnableGroup {
  key: string;
  label: string;
  badge?: string;
  destination?: Destination;
  rows: ModelEnableRow[];
}

interface ModelEnableListProps {
  groups: ModelEnableGroup[];
  onToggle: (id: string, enabled: boolean) => void;
  query: string;
  onQueryChange: (next: string) => void;
  searchPlaceholder?: string;
  emptyState?: React.ReactNode;
  defaultOpenGroupKey?: string;
}

interface EnabledCountBadgeProps {
  rows: ModelEnableRow[];
}

const EnabledCountBadge: React.FC<EnabledCountBadgeProps> = ({ rows }) => {
  const count = rows.filter((row) => row.enabled).length;
  if (count === 0) return null;
  return (
    <Badge
      variant="accent"
      title={t("{count} selected", { count })}
      className="tw-shrink-0 tw-px-1.5 tw-py-0 tw-font-normal"
    >
      {count}
    </Badge>
  );
};

export const ModelEnableList: React.FC<ModelEnableListProps> = ({
  groups,
  onToggle,
  query,
  onQueryChange,
  searchPlaceholder,
  emptyState,
  defaultOpenGroupKey,
}) => {
  const searching = query.trim().length > 0;

  const [userOpen, setUserOpen] = React.useState<Record<string, boolean>>({});
  const isOpen = (key: string) => {
    if (searching) return true;
    if (key in userOpen) return userOpen[key];
    return defaultOpenGroupKey === undefined || key === defaultOpenGroupKey;
  };
  const handleOpenChange = (key: string, open: boolean) =>
    setUserOpen((prev) => ({ ...prev, [key]: open }));

  const renderRows = (rows: ModelEnableRow[]): React.ReactNode => (
    <div className="tw-space-y-1">
      {rows.map((row) => {
        return (
          <div
            key={row.id}
            className="tw-flex tw-items-center tw-justify-between tw-gap-2 tw-rounded tw-px-2 tw-py-1 hover:tw-bg-modifier-hover"
          >
            <div className="tw-min-w-0">
              <div className="tw-flex tw-min-w-0 tw-items-center tw-gap-1">
                <span className="tw-truncate">{row.label}</span>
                {row.isFree && <FreeModelWarningIcon />}
                {hasCapabilityIcons(row.capabilities) && (
                  <span className="tw-flex tw-shrink-0 tw-items-center tw-gap-0.5">
                    <ModelCapabilityIcons capabilities={row.capabilities} iconSize={14} />
                  </span>
                )}
              </div>
              {row.description && (
                <div className="tw-truncate tw-text-xs tw-text-muted">{row.description}</div>
              )}
            </div>
            <SettingSwitch
              checked={row.enabled}
              onCheckedChange={(next) => onToggle(row.id, next)}
            />
          </div>
        );
      })}
    </div>
  );

  const hasRows = groups.some((g) => g.rows.length > 0);

  return (
    <div className="tw-flex tw-flex-col tw-gap-2">
      <SearchBar
        value={query}
        onChange={onQueryChange}
        placeholder={searchPlaceholder ?? t("Search models…")}
      />

      <div className="tw-max-h-80 tw-overflow-y-auto tw-pr-1">
        {!hasRows ? (
          <div className="tw-py-6 tw-text-center tw-text-sm tw-text-muted">
            {emptyState ??
              (searching
                ? t("No models match “{value0}”.", { value0: query.trim() })
                : t("No models."))}
          </div>
        ) : (
          <div className="tw-space-y-2">
            {groups
              .filter((g) => g.rows.length > 0)
              .map((group) => (
                <Collapsible
                  key={group.key}
                  open={isOpen(group.key)}
                  onOpenChange={(open) => handleOpenChange(group.key, open)}
                >
                  <CollapsibleTrigger asChild>
                    <div className="tw-flex tw-w-full tw-cursor-pointer tw-items-center tw-gap-1 tw-rounded tw-px-2 tw-py-1.5 tw-text-left tw-text-ui-medium tw-font-bold hover:tw-bg-modifier-hover">
                      <ChevronRight
                        className={cn(
                          "tw-size-3 tw-shrink-0 tw-text-muted tw-transition-transform",
                          isOpen(group.key) && "tw-rotate-90"
                        )}
                      />
                      <span className="tw-truncate">{group.label}</span>
                      <EnabledCountBadge rows={group.rows} />
                      {group.badge && (
                        <Badge variant="secondary" className="tw-shrink-0 tw-font-normal">
                          {group.badge}
                        </Badge>
                      )}
                      {group.destination && <DestinationIcon destination={group.destination} />}
                    </div>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="tw-pl-4">{renderRows(group.rows)}</div>
                  </CollapsibleContent>
                </Collapsible>
              ))}
          </div>
        )}
      </div>
    </div>
  );
};
