import { t } from "@/lib/i18n";
import React from "react";

interface ExtensionAvailabilityDotProps {
  state: {
    enabled: boolean;
    connecting?: boolean;
    informational?: boolean;
    reason?: string;
  };
}

export function ExtensionAvailabilityDot({ state }: ExtensionAvailabilityDotProps) {
  if (state.enabled && !state.informational) return null;
  const reason = t(state.reason ?? "Unavailable in this scope");
  return (
    <span
      role="img"
      aria-label={reason}
      title={reason}
      className={
        state.informational
          ? "tw-inline-block tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-faint"
          : state.connecting
            ? "tw-inline-block tw-size-2 tw-shrink-0 tw-animate-pulse tw-rounded-full tw-bg-warning"
            : "tw-inline-block tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-error"
      }
    />
  );
}
