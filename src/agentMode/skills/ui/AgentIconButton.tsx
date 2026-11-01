import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import React from "react";

interface AgentIconButtonProps {
  Icon: React.ComponentType<{ className?: string }>;
  agentId: string;
  agentName?: string;
  enabled: boolean;
  disabled?: boolean;
  onClick?: () => void;
  title?: string;
  size?: "sm" | "md";
}

export const AgentIconButton: React.FC<AgentIconButtonProps> = ({
  Icon,
  agentId,
  agentName,
  enabled,
  disabled = false,
  onClick,
  title,
  size = "md",
}) => {
  const label = agentName ?? agentId;
  return (
    <div
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-disabled={disabled}
      onClick={disabled ? undefined : onClick}
      onKeyDown={(e) => {
        if (disabled) return;
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onClick?.();
        }
      }}
      aria-pressed={enabled}
      aria-label={title ?? `${enabled ? t("Disable") : t("Enable")} ${label}`}
      className={cn(
        "tw-flex tw-items-center tw-justify-center tw-transition-colors focus-visible:tw-outline-none focus-visible:tw-ring-2 focus-visible:tw-ring-ring",
        disabled ? "tw-cursor-not-allowed tw-opacity-40" : "hover:tw-bg-modifier-hover",
        size === "md" ? "tw-size-7 tw-rounded-md" : "tw-size-5 tw-rounded-sm",
        enabled
          ? "tw-border tw-border-solid tw-border-interactive-accent tw-bg-transparent tw-text-accent"
          : "tw-border tw-border-dashed tw-border-border tw-bg-transparent tw-text-muted hover:tw-border-border-hover"
      )}
    >
      <Icon className="tw-size-4" />
    </div>
  );
};
