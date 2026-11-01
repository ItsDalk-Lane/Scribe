import { TabContent, TabItem } from "@/components/ui/setting-tabs";
import { t } from "@/lib/i18n";
import React from "react";

export const GENERAL_SETTINGS_SECTIONS = [
  { id: "general", label: "General" },
  { id: "instructions", label: "Custom instructions" },
  { id: "saving", label: "Saving chats" },
  { id: "others", label: "Others" },
  { id: "debug", label: "Debugging & support" },
  { id: "about", label: "About" },
] as const;

export type GeneralSettingsSection = (typeof GENERAL_SETTINGS_SECTIONS)[number]["id"];

interface GeneralSettingsTabsProps {
  section: GeneralSettingsSection;
  onSectionChange: (section: GeneralSettingsSection) => void;
  children: React.ReactNode;
}

export const GeneralSettingsTabs: React.FC<GeneralSettingsTabsProps> = ({
  section,
  onSectionChange,
  children,
}) => (
  <div>
    <div
      role="tablist"
      aria-label={t("General settings")}
      className="tw-flex tw-flex-wrap tw-gap-0.5 tw-border-0 tw-border-b tw-border-solid tw-border-border"
    >
      {GENERAL_SETTINGS_SECTIONS.map((item) => (
        <TabItem
          key={item.id}
          tab={{ id: `general-${item.id}`, label: t(item.label), icon: null }}
          isSelected={section === item.id}
          onClick={() => onSectionChange(item.id)}
          variant="inline"
        />
      ))}
    </div>
    <TabContent id={`general-${section}`} isSelected variant="inline">
      {children}
    </TabContent>
  </div>
);
