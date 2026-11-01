import { Button } from "@/components/ui/button";
import { SettingSection } from "@/components/ui/setting-section";
import { t } from "@/lib/i18n";
import React from "react";

interface AboutSettingsProps {
  version: string;
  onReset: () => void;
}

export function AboutSettings({ version, onReset }: AboutSettingsProps) {
  return (
    <SettingSection>
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-4 tw-py-4">
        <span className="tw-text-sm tw-font-medium">{t("Plugin version")}</span>
        <span className="tw-text-sm tw-text-muted">{version}</span>
      </div>
      <div className="tw-flex tw-items-center tw-justify-between tw-gap-4 tw-py-4">
        <span className="tw-text-sm tw-font-medium">{t("Reset settings")}</span>
        <Button variant="secondary" onClick={onReset}>
          {t("Reset settings")}
        </Button>
      </div>
    </SettingSection>
  );
}
