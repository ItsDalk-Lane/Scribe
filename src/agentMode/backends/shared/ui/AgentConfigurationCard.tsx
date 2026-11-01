import { InstallBadge } from "@/agentMode/backends/shared/installStatus";
import type { AgentBackendHeaderProps } from "@/agentMode/backends/shared/ui/AgentBackendHeader";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { SettingSwitch } from "@/components/ui/setting-switch";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";
import React from "react";

export interface AgentConfigurationCardProps extends AgentBackendHeaderProps {
  enabled: boolean;
  pendingDisable?: boolean;
  changing?: boolean;
  onEnabledChange: (enabled: boolean) => void;
}

export function AgentConfigurationCard({
  displayName,
  Icon,
  installState,
  authStatus,
  managedInstall,
  resolvedPath,
  onConfigure,
  enabled,
  pendingDisable = false,
  changing = false,
  onEnabledChange,
}: AgentConfigurationCardProps) {
  const [open, setOpen] = React.useState(false);
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="tw-group/settings tw-overflow-hidden tw-rounded-lg tw-border tw-border-solid tw-border-border tw-bg-transparent"
    >
      <div className="tw-flex tw-items-center tw-gap-3 tw-p-4">
        <Icon className="tw-size-7 tw-shrink-0" />
        <div className="tw-min-w-0 tw-flex-1 tw-space-y-1">
          <div className="tw-flex tw-flex-wrap tw-items-center tw-gap-2">
            <span className="tw-text-ui-small tw-font-medium">{displayName}</span>
            {installState.kind === "ready" && installState.version && (
              <span className="tw-text-ui-smaller tw-text-muted">v{installState.version}</span>
            )}
            {installState.kind === "incompatible" && (
              <span className="tw-text-ui-smaller tw-text-muted">
                v{installState.currentVersion}
              </span>
            )}
            <InstallBadge state={installState} authStatus={authStatus} />
          </div>
          <p className="tw-m-0 tw-text-ui-smaller tw-leading-normal tw-text-muted">
            {t(
              pendingDisable
                ? "Finishing current tasks before disabling."
                : enabled
                  ? "Automatically detected"
                  : "Disabled; configuration kept"
            )}
          </p>
        </div>
        <CollapsibleTrigger asChild>
          <Button variant="ghost" size="icon" aria-label={t("Installation and sign-in settings")}>
            <ChevronRight
              aria-hidden="true"
              className={cn("tw-size-4 tw-transition-transform", open && "tw-rotate-90")}
            />
          </Button>
        </CollapsibleTrigger>
        <SettingSwitch
          aria-label={t("Enable {name}", { name: displayName })}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          disabled={changing}
        />
      </div>
      <CollapsibleContent className="tw-space-y-3 tw-border-0 tw-border-t tw-border-solid tw-border-border tw-p-4">
        {resolvedPath && (
          <div className="tw-break-all tw-text-ui-smaller tw-leading-normal tw-text-muted">
            {resolvedPath}
          </div>
        )}
        {(installState.kind === "error" || installState.kind === "incompatible") && (
          <p role="alert" className="tw-text-ui-small tw-text-error">
            {installState.message}
          </p>
        )}
        {managedInstall.kind === "error" && (
          <p role="alert" className="tw-text-ui-small tw-text-error">
            {managedInstall.message}
          </p>
        )}
        <div className="tw-flex tw-items-center tw-justify-between tw-gap-4">
          <span className="tw-text-ui-small">{t("Installation and sign-in")}</span>
          <Button variant="secondary" onClick={onConfigure}>
            {t("Configure")}
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}
