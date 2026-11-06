import { DebuggingSupportSection } from "@/settings/v2/components/DebuggingSupportSection";
import { updateSetting, useSettingsValue } from "@/settings/model";
import React from "react";

export const AdvancedSettings: React.FC = () => {
  const settings = useSettingsValue();
  return (
    <DebuggingSupportSection
      debug={settings.debug}
      onDebugChange={(checked) => updateSetting("debug", checked)}
    />
  );
};
