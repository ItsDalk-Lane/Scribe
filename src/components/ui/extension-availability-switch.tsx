import { SettingSwitch } from "@/components/ui/setting-switch";
import { t } from "@/lib/i18n";
import { CircleHelp, Loader2 } from "lucide-react";
import React from "react";

interface ExtensionAvailabilitySwitchProps {
  state: {
    checked: boolean;
    disabled: boolean;
    phase?: "checking" | "unknown" | "pending";
    reason?: string;
  };
  label: string;
  busy?: boolean;
  onToggle?: (next: boolean) => void;
}

export function ExtensionAvailabilitySwitch({
  state,
  label,
  busy = false,
  onToggle,
}: ExtensionAvailabilitySwitchProps) {
  const phase = busy ? "pending" : state.phase;
  const reason = t(
    busy
      ? "Waiting for configuration changes to take effect."
      : (state.reason ?? (state.checked ? "Available in this scope" : "Unavailable in this scope"))
  );
  return (
    <span className="tw-inline-flex tw-items-center tw-gap-2" title={reason}>
      {phase &&
        (phase === "unknown" ? (
          <CircleHelp aria-label={reason} className="tw-size-4 tw-text-muted" />
        ) : (
          <Loader2 aria-label={reason} className="tw-size-4 tw-animate-spin tw-text-muted" />
        ))}
      <SettingSwitch
        aria-label={label}
        aria-description={reason}
        checked={state.checked}
        disabled={busy || state.disabled || !onToggle}
        onCheckedChange={onToggle}
      />
    </span>
  );
}
