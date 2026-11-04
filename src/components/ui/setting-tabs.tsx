import React from "react";
import { cn } from "@/lib/utils";

export interface TabItem {
  icon: React.ReactNode;
  label: string;
  id: string;
  warningLabel?: string;
}

export type TabVariant = "page" | "inline";

interface TabItemProps {
  tab: TabItem;
  isSelected: boolean;
  onClick: () => void;
  variant?: TabVariant;
}

export const TabItem: React.FC<TabItemProps> = ({ tab, isSelected, onClick }) => {
  return (
    <div
      role="tab"
      id={`tab-${tab.id}`}
      aria-controls={`tabpanel-${tab.id}`}
      aria-selected={isSelected}
      aria-label={tab.warningLabel ? `${tab.label}: ${tab.warningLabel}` : tab.label}
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick();
        }
      }}
      className={cn(
        "tw-relative tw-flex tw-h-9 tw-cursor-pointer tw-items-center tw-gap-1.5 tw-whitespace-nowrap tw-border-0 tw-border-b-[2px] tw-border-solid tw-bg-transparent tw-px-3 tw-py-2 tw-text-sm tw-font-medium tw-transition-colors",
        "focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring",
        isSelected
          ? "tw-border-interactive-accent tw-text-normal"
          : "tw-border-transparent tw-text-muted hover:tw-text-normal"
      )}
    >
      {tab.icon && (
        <div
          className={cn(
            "tw-flex tw-items-center tw-justify-center",
            "tw-size-4",
            "tw-transition-transform tw-duration-200 tw-ease-in-out",
            isSelected
              ? "tw-max-w-[16px] tw-translate-x-0 tw-opacity-100"
              : "tw-max-w-0 tw--translate-x-4 tw-opacity-0"
          )}
        >
          {tab.icon}
        </div>
      )}
      <span
        className={cn(
          "tw-text-sm",
          "tw-font-medium",
          "tw-transition-all tw-duration-200 tw-ease-in-out",
          "tw-overflow-hidden tw-whitespace-nowrap",
          "tw-max-w-[100px] tw-translate-x-0 tw-opacity-100"
        )}
      >
        {tab.label}
      </span>

      {tab.warningLabel && (
        <span
          aria-hidden="true"
          title={tab.warningLabel}
          className="tw-pointer-events-none tw-absolute tw-right-1 tw-top-1 tw-size-1.5 tw-rounded-full tw-bg-warning"
        />
      )}
    </div>
  );
};

interface TabContentProps {
  id: string;
  children: React.ReactNode;
  isSelected: boolean;
  variant?: TabVariant;
}

export const TabContent: React.FC<TabContentProps> = ({
  id,
  children,
  isSelected,
  variant = "page",
}) => {
  if (!isSelected) return null;

  return (
    <div
      role="tabpanel"
      id={`tabpanel-${id}`}
      aria-labelledby={`tab-${id}`}
      className={cn(
        variant === "page" ? "tw-mt-2 tw-px-4 tw-pb-4 tw-pt-2" : "tw-mt-3",
        "tw-transition-all tw-duration-200 tw-ease-in-out",
        isSelected ? "tw-translate-y-0 tw-opacity-100" : "tw-translate-y-2 tw-opacity-0"
      )}
    >
      {children}
    </div>
  );
};
