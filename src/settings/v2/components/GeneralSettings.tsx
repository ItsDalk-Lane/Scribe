import { ResetSettingsConfirmModal } from "@/components/modals/ResetSettingsConfirmModal";
import { usePlugin } from "@/contexts/PluginContext";
import { resetSettings } from "@/settings/model";
import { AdvancedSettings } from "@/settings/v2/components/AdvancedSettings";
import { BasicSettings } from "@/settings/v2/components/BasicSettings";
import { AboutSettings } from "@/settings/v2/components/ui/AboutSettings";
import {
  GeneralSettingsTabs,
  type GeneralSettingsSection,
} from "@/settings/v2/components/ui/GeneralSettingsTabs";
import React, { useState } from "react";

export const GeneralSettings: React.FC = () => {
  const plugin = usePlugin();
  const [resetKey, setResetKey] = useState(0);
  const [section, setSection] = useState<GeneralSettingsSection>("general");

  return (
    <GeneralSettingsTabs key={resetKey} section={section} onSectionChange={setSection}>
      {section === "about" ? (
        <AboutSettings
          version={plugin.manifest.version}
          onReset={() => {
            const modal = new ResetSettingsConfirmModal(plugin.app, () => {
              resetSettings();
              setSection("general");
              setResetKey((value) => value + 1);
            });
            modal.open();
          }}
        />
      ) : section === "others" || section === "debug" ? (
        <AdvancedSettings section={section} />
      ) : (
        <BasicSettings section={section} />
      )}
    </GeneralSettingsTabs>
  );
};
