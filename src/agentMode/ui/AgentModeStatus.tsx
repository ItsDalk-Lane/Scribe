import { t } from "@/lib/i18n";
import { AgentStatusCard } from "@/agentMode/ui/AgentStatusCard";
import { useBackendAuthState } from "@/agentMode/session/useBackendAuthState";
import {
  useBackendInstallState,
  useManagedInstallActionState,
  useSessionBackendDescriptor,
} from "@/agentMode/ui/useBackendDescriptor";
import { AgentSessionManager } from "@/agentMode/session/AgentSessionManager";
import { logError } from "@/logger";
import type CopilotPlugin from "@/main";
import { Notice } from "obsidian";
import React from "react";

interface Props {
  manager?: AgentSessionManager;
  plugin: CopilotPlugin;
  onInstallClick: () => void;
}

export const AgentModeStatus: React.FC<Props> = ({ manager, plugin, onInstallClick }) => {
  const descriptor = useSessionBackendDescriptor(manager);
  const installState = useBackendInstallState(descriptor, plugin);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const auth = useBackendAuthState(descriptor);

  const [, setTick] = React.useState(0);
  React.useEffect(() => {
    if (!manager) return;
    return manager.subscribe(() => setTick((v) => v + 1));
  }, [manager]);

  const heldConfigChange = manager?.hasHeldConfigChange(descriptor.id) ?? false;
  // A reload waits for a running turn to finish, so read the queued restart
  // rather than the click: the action then reports progress for exactly as
  // long as the restart is actually outstanding.
  // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
  const reloading = manager?.isBackendRestartPending(descriptor.id) ?? false;

  const handleReload = React.useCallback(() => {
    manager?.applyHeldConfigChange(descriptor.id).catch((e) => {
      logError("[AgentMode] reload after config change failed", e);
    });
  }, [manager, descriptor.id]);

  const handleUpgrade = React.useCallback(() => {
    const action = descriptor.managedInstall;
    if (!action || managedInstall.kind === "running") return;
    new Notice(t("Updating {p0}…", { p0: descriptor.displayName }));
    action
      .run(plugin)
      .then(() => new Notice(t("{p0} updated.", { p0: descriptor.displayName })))
      .catch((e) => {
        logError("[AgentMode] upgrade failed", e);
        new Notice(
          t("Failed to update {p0}. Check the Scribe log for details.", {
            p0: descriptor.displayName,
          })
        );
      });
  }, [descriptor, plugin, managedInstall.kind]);

  if (installState.kind === "absent") {
    // 配置驱动型后端没有"未安装"一说，缺的是模型；文案与选择面板保持一致。
    // https://github.com/ItsDalk-Lane/Scribe/issues/21
    const usesConfiguredModels = descriptor.usesConfiguredModels ?? false;
    return (
      <AgentStatusCard
        message={
          usesConfiguredModels
            ? t("No chat model is enabled for {p0} yet. Add a provider and enable a model first.", {
                p0: descriptor.displayName,
              })
            : t("{p0} not installed", { p0: descriptor.displayName })
        }
        action={{
          label: usesConfiguredModels
            ? t("Configure")
            : t("Install {p0}", { p0: descriptor.displayName }),
          onClick: onInstallClick,
        }}
      />
    );
  }

  if (installState.kind === "checking") {
    return (
      <AgentStatusCard message={t("Checking {p0} version…", { p0: descriptor.displayName })} />
    );
  }

  if (installState.kind === "incompatible") {
    const canUpgrade = descriptor.managedInstall !== undefined;
    const upgrading = managedInstall.kind === "running";
    const failed = managedInstall.kind === "error";
    return (
      <AgentStatusCard
        tone={failed ? "error" : "warning"}
        // State supplies the summary; never infer a cause by parsing the backend's full error.
        // https://github.com/Brevilabs/obsidian-copilot-private/issues/410
        summary={
          upgrading
            ? t("Updating {p0}…", { p0: descriptor.displayName })
            : failed
              ? t("{p0} update failed", { p0: descriptor.displayName })
              : t("{p0} update required", { p0: descriptor.displayName })
        }
        message={
          upgrading ? managedInstall.label : failed ? managedInstall.message : installState.message
        }
        action={{
          label: canUpgrade
            ? upgrading
              ? t("Updating…")
              : failed
                ? t("Retry")
                : t("Update")
            : t("Configure {p0}", { p0: descriptor.displayName }),
          disabled: canUpgrade && upgrading,
          onClick: canUpgrade ? handleUpgrade : () => descriptor.openInstallUI(plugin),
        }}
      />
    );
  }

  if (installState.kind === "error") {
    return (
      <AgentStatusCard
        tone="error"
        summary={t("{p0} setup error", { p0: descriptor.displayName })}
        message={installState.message}
        action={{
          label: t("Configure {p0}", { p0: descriptor.displayName }),
          onClick: () => descriptor.openInstallUI(plugin),
        }}
      />
    );
  }

  if (descriptor.auth && auth.status && !auth.status.signedIn) {
    return (
      <AgentStatusCard
        message={
          auth.signingIn
            ? t("Signing in to {p0}…", { p0: descriptor.displayName })
            : t("{p0} not signed in", { p0: descriptor.displayName })
        }
        action={
          auth.signingIn
            ? auth.url
              ? { label: t("Open sign-in page"), href: auth.url }
              : undefined
            : { label: t("Sign in"), onClick: auth.signIn }
        }
      />
    );
  }

  if (!manager) {
    return null;
  }

  const bootError = manager.getLastError();
  if (!bootError) {
    // Settings the running agent was spawned with have changed since. Applying
    // them restarts the backend and replaces this conversation, so the manager
    // holds the restart and the choice of when to take it belongs here. A boot
    // error keeps its recovery action, which also applies any held config.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
    if (!heldConfigChange) return null;
    return (
      <AgentStatusCard
        layout="row"
        message={t("{p0} settings changed", { p0: descriptor.displayName })}
        action={{
          label: reloading ? t("Reloading…") : t("Reload"),
          disabled: reloading,
          onClick: handleReload,
        }}
      />
    );
  }

  const handleRetry = (): void => {
    // A failed session may remain active after startup rejects. Apply corrected
    // settings before retrying so that session cannot mask the new config.
    // https://github.com/Brevilabs/obsidian-copilot-private/issues/475
    const retry = heldConfigChange
      ? manager.applyHeldConfigChange(descriptor.id)
      : manager.getOrCreateActiveSession();
    retry.catch((e) => {
      logError("[AgentMode] retry failed", e);
    });
  };

  return (
    <AgentStatusCard
      tone="error"
      summary={t("{p0} ran into a problem", { p0: descriptor.displayName })}
      message={bootError}
      action={{ label: t("Retry"), onClick: handleRetry }}
    />
  );
};
