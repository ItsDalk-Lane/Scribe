import { SCRIBE_AGENT_ICON_PATH, SCRIBE_AGENT_ICON_TRANSFORM } from "@/constants";
import { cn } from "@/lib/utils";
import React from "react";

interface ScribeBrandIconProps {
  className?: string;
}

export const ScribeBrandIcon: React.FC<ScribeBrandIconProps> = ({ className }) => (
  <svg
    viewBox="0 0 100 100"
    xmlns="http://www.w3.org/2000/svg"
    aria-hidden="true"
    className={cn("tw-shrink-0", className)}
  >
    <g transform={SCRIBE_AGENT_ICON_TRANSFORM}>
      <path fill="currentColor" d={SCRIBE_AGENT_ICON_PATH} />
    </g>
  </svg>
);
