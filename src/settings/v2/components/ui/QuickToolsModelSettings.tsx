import { QuickCommandModelSetting } from "./QuickCommandModelSetting";
import { SettingSection } from "@/components/ui/setting-section";
import React from "react";

interface ModelOption {
  label: string;
  value: string;
}

export interface QuickToolsModelSettingsProps {
  defaultModelId: string | undefined;
  options: ModelOption[];
  onDefaultModelChange: (modelId: string) => void;
  children: React.ReactNode;
}

export const QuickToolsModelSettings: React.FC<QuickToolsModelSettingsProps> = ({
  defaultModelId,
  options,
  onDefaultModelChange,
  children,
}) => (
  <SettingSection>
    <QuickCommandModelSetting
      value={defaultModelId}
      options={options}
      onChange={onDefaultModelChange}
    />
    <div className="tw-py-4">{children}</div>
  </SettingSection>
);
