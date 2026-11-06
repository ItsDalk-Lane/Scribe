import { cn } from "@/lib/utils";
import React from "react";

export interface SkillRowLayoutProps {
  name: string;
  description: string;
  iconUrl?: string | null;
  meta?: string;
  annotations?: React.ReactNode;
  controls: React.ReactNode;
  actions: React.ReactNode;
  menuOpen?: boolean;
  onOpen?: () => void;
}

export function SkillRowLayout({
  name,
  description,
  iconUrl,
  meta,
  annotations,
  controls,
  actions,
  menuOpen,
  onOpen,
}: SkillRowLayoutProps) {
  return (
    <div
      data-menu-open={menuOpen ? "true" : undefined}
      onClick={(event) => {
        if (!event.currentTarget.contains(event.target as Node)) return;
        if (
          !(event.target as Element).closest("button, [role=switch], [role=menuitem], [role=menu]")
        )
          onOpen?.();
      }}
      className={cn(
        "tw-group/settings tw-flex tw-flex-wrap tw-items-center tw-gap-x-4 tw-gap-y-2",
        "tw-rounded-md tw-border tw-border-solid tw-border-border tw-bg-transparent",
        "tw-p-3",
        "tw-transition-colors hover:tw-border-border-hover hover:tw-bg-modifier-hover",
        "data-[menu-open=true]:tw-bg-modifier-hover data-[menu-open=true]:tw-border-normal/100"
      )}
    >
      <div className="tw-min-w-0 tw-max-w-full tw-flex-1 tw-basis-48 tw-@container/skill-title">
        <button
          type="button"
          disabled={!onOpen}
          onClick={onOpen}
          className="!tw-block !tw-h-auto tw-w-full !tw-border-0 !tw-bg-transparent !tw-p-0 tw-text-left !tw-shadow-none focus-visible:tw-outline-none focus-visible:tw-ring-1 focus-visible:tw-ring-ring"
        >
          <div className="tw-group/settings tw-flex tw-items-center tw-gap-2">
            {iconUrl && (
              <img
                src={iconUrl}
                alt=""
                aria-hidden="true"
                className="tw-size-4 tw-shrink-0 tw-rounded-sm"
              />
            )}
            <span
              title={name}
              className="tw-min-w-0 tw-truncate tw-text-ui-small tw-font-medium tw-text-normal"
            >
              {name}
            </span>
            {annotations}
          </div>
          {description.length > 0 && (
            <div
              title={description}
              className="tw-mt-1 tw-max-w-[540px] tw-truncate tw-text-ui-smaller tw-leading-relaxed tw-text-muted"
            >
              {description}
            </div>
          )}
          {meta && <div className="tw-mt-0.5 tw-text-ui-smaller tw-text-faint">{meta}</div>}
        </button>
      </div>
      {controls}
      {actions}
    </div>
  );
}
