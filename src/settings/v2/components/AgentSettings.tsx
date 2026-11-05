import { t } from "@/lib/i18n";
import {
  AgentConfigurationCard,
  backendDisplayOrder,
  useBackendInstallState,
  useBackendAuthState,
  useManagedInstallActionState,
  type BackendDescriptor,
} from "@/agentMode";
import { AgentConfigurationHeader } from "@/components/ui/AgentConfigurationHeader";
import { SettingSection } from "@/components/ui/setting-section";
import { usePlugin } from "@/contexts/PluginContext";
import { logError } from "@/logger";
import { setSettings, useSettingsValue } from "@/settings/model";
import { ConfiguredModelEnableList } from "@/settings/v2/components/ConfiguredModelEnableList";
import { AgentNotificationSoundSettings } from "@/settings/v2/components/ui/AgentNotificationSoundSettings";
import { playNotificationSound } from "@/utils/notificationSound";
import {
  NOTIFICATION_SOUND_OPTIONS,
  isNotificationSoundId,
} from "@/utils/notificationSoundCatalog";
import { Notice } from "obsidian";
import React from "react";

export const AgentSettings: React.FC = () => {
  const descriptors = backendDisplayOrder();
  const [selected, setSelected] = React.useState(() => descriptors[0].id);
  const descriptor = descriptors.find((item) => item.id === selected) ?? descriptors[0];
  return (
    <section className="tw-space-y-5">
      <AgentConfigurationHeader
        agents={descriptors.map((item) => ({
          id: item.id,
          label: item.displayName,
        }))}
        selectedAgent={descriptor.id}
        onSelectAgent={(id) => setSelected(id)}
      />
      <BackendPanel descriptor={descriptor} />
    </section>
  );
};

interface BackendPanelProps {
  descriptor: BackendDescriptor;
}

function BackendPanel({ descriptor }: BackendPanelProps) {
  const plugin = usePlugin();
  const settings = useSettingsValue();
  const manager = plugin.agentSessionManager;
  const Panel = descriptor.SettingsPanel;
  const installState = useBackendInstallState(descriptor, plugin);
  const managedInstall = useManagedInstallActionState(descriptor, plugin);
  const auth = useBackendAuthState(descriptor);
  const [changing, setChanging] = React.useState(false);
  const subscribe = React.useCallback(
    (listener: () => void) => manager?.subscribe(listener) ?? (() => {}),
    [manager]
  );
  const getState = React.useCallback(
    () =>
      `${manager?.isBackendEnabled(descriptor.id) ?? true}:${manager?.isBackendDisablePending(descriptor.id) ?? false}`,
    [manager, descriptor.id]
  );
  const state = React.useSyncExternalStore(subscribe, getState, getState);
  const enabled = state.split(":")[0] === "true";
  const pendingDisable = state.split(":")[1] === "true";
  React.useEffect(() => {
    if (
      !enabled ||
      !manager ||
      installState.kind !== "ready" ||
      manager.getCachedModelCatalog(descriptor.id)
    )
      return;
    void manager
      .preloadModels(descriptor.id)
      .catch((error) => logError("Could not load agent models", error));
  }, [manager, descriptor.id, installState.kind, enabled]);
  const changeEnabled = (next: boolean) => {
    if (!manager) return;
    setChanging(true);
    void manager
      .setBackendEnabled(descriptor.id, next)
      .catch((error) => {
        logError("Could not change agent enablement", error);
        new Notice(t("Could not change agent enablement."));
      })
      .finally(() => setChanging(false));
  };
  const inactive = enabled ? {} : { inert: "" };
  return (
    <div className="tw-space-y-5">
      <AgentConfigurationCard
        displayName={descriptor.displayName}
        Icon={descriptor.Icon}
        installState={installState}
        managedInstall={managedInstall}
        authStatus={descriptor.auth ? auth.status : undefined}
        resolvedPath={descriptor.getResolvedBinaryPath?.(settings) ?? null}
        onConfigure={() => descriptor.openInstallUI(plugin)}
        enabled={enabled}
        pendingDisable={pendingDisable}
        changing={changing}
        onEnabledChange={changeEnabled}
      />
      <div
        {...inactive}
        aria-disabled={!enabled}
        className={enabled ? "tw-space-y-5" : "tw-space-y-5 tw-opacity-50"}
      >
        {(installState.kind === "ready" || descriptor.usesConfiguredModels) && (
          <ConfiguredModelEnableList descriptor={descriptor} />
        )}
        {Panel && (
          <SettingSection>
            <Panel plugin={plugin} app={plugin.app} />
          </SettingSection>
        )}
        <SettingSection label={t("Notification")}>
          <AgentNotificationSoundSettings
            enabled={settings.agentMode.notificationSound}
            onEnabledChange={(notificationSound) =>
              setSettings((current) => ({ agentMode: { ...current.agentMode, notificationSound } }))
            }
            soundId={settings.agentMode.notificationSoundId}
            soundOptions={NOTIFICATION_SOUND_OPTIONS}
            onSoundChange={(value) => {
              if (!isNotificationSoundId(value)) return;
              setSettings((current) => ({
                agentMode: { ...current.agentMode, notificationSoundId: value },
              }));
              playNotificationSound(value);
            }}
          />
        </SettingSection>
      </div>
    </div>
  );
}
