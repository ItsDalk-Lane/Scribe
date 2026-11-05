import { SettingSection } from "@/components/ui/setting-section";
import { t } from "@/lib/i18n";
import React from "react";
import { AgentNotificationSoundSettings } from "@/settings/v2/components/ui/AgentNotificationSoundSettings";
import { setSettings, useSettingsValue } from "@/settings/model";
import { playNotificationSound } from "@/utils/notificationSound";
import {
  NOTIFICATION_SOUND_OPTIONS,
  isNotificationSoundId,
} from "@/utils/notificationSoundCatalog";

export function AgentNotificationSettings() {
  const settings = useSettingsValue();
  return (
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
  );
}
