import { t } from "@/lib/i18n";
import { HelpTooltip } from "@/components/ui/help-tooltip";
import { cn } from "@/lib/utils";
import type { Destination } from "@/types/destination";
import { Cloud, Monitor } from "lucide-react";
import React from "react";

const ICONS = { cloud: Cloud, local: Monitor } as const;

interface DestinationIconProps {
  destination: Destination;
  className?: string;
}

// Settings name where each provider sends requests, so nothing new shows in the chat.
// https://github.com/logancyang/obsidian-copilot/issues/2889
export function DestinationIcon({ destination, className }: DestinationIconProps) {
  const Icon = ICONS[destination.kind];
  return (
    <span
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      className={cn("tw-flex tw-shrink-0 tw-items-center tw-text-muted", className)}
    >
      <HelpTooltip
        content={destination.label}
        side="top"
        delayDuration={0}
        contentClassName="tw-whitespace-pre-line"
      >
        <Icon className="tw-size-3.5" />
      </HelpTooltip>
      <span className="tw-sr-only">
        {t("Sends requests to: {destination}", { destination: destination.label })}
      </span>
    </span>
  );
}
