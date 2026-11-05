import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { usePlugin } from "@/contexts/PluginContext";
import { resetSettings } from "@/settings/model";
import { AdvancedSettings } from "@/settings/v2/components/AdvancedSettings";
import { AgentNotificationSettings } from "@/settings/v2/components/AgentNotificationSettings";
import { AboutSettings } from "@/settings/v2/components/ui/AboutSettings";
import React from "react";

export const AboutSettingsPanel: React.FC = () => {
  const plugin = usePlugin();

  return (
    <div className="tw-space-y-4">
      <AboutSettings
        version={plugin.manifest.version}
        onReset={() => new ResetSettingsConfirmModal(plugin.app, resetSettings).open()}
      />
      <AgentNotificationSettings />
      <AdvancedSettings />
    </div>
  );
};
