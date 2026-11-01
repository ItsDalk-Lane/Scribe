import { t } from "@/lib/i18n";
import { SettingItem } from "@/components/ui/setting-item";
import React from "react";

export interface QuickCommandModelSettingProps {
  value: string | undefined;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
}

export function QuickCommandModelSetting({
  value,
  options,
  onChange,
}: QuickCommandModelSettingProps) {
  return (
    <SettingItem
      type="select"
      title={t("Default quick command model")}
      description={t("Used by Quick Ask, Quick Command, and saved commands set to Default model.")}
      value={value ?? ""}
      onChange={onChange}
      options={options}
      placeholder={t("Select model")}
    />
  );
}
