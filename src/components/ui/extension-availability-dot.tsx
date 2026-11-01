import { t } from "@/lib/i18n";
import React from "react";

interface ExtensionAvailabilityDotProps {
  state: {
    enabled: boolean;
    reason?: string;
  };
}

export function ExtensionAvailabilityDot({ state }: ExtensionAvailabilityDotProps) {
  if (state.enabled) return null;
  const reason = t(state.reason ?? "Unavailable in this scope");
  return (
    <span
      role="img"
      aria-label={reason}
      title={reason}
      className="tw-inline-block tw-size-2 tw-shrink-0 tw-rounded-full tw-bg-error"
    />
  );
}
