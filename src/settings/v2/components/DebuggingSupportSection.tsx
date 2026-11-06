import { t } from "@/lib/i18n";
import { SettingItem } from "@/components/ui/setting-item";
import { SettingSection } from "@/components/ui/setting-section";
import React from "react";

export interface DebuggingSupportSectionProps {
  debug: boolean;
  onDebugChange: (checked: boolean) => void;
}

export const DebuggingSupportSection: React.FC<DebuggingSupportSectionProps> = ({
  debug,
  onDebugChange,
}) => (
  <SettingSection>
    <SettingItem
      type="switch"
      title={t("Debug mode")}
      description={t(
        "Logs Scribe chat activity to the developer console (View → Toggle Developer Tools)."
      )}
      checked={debug}
      onCheckedChange={onDebugChange}
    />
  </SettingSection>
);
