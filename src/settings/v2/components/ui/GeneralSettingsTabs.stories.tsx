import { t } from "@/lib/i18n";
import type { Meta, StoryObj } from "@/lib/story";
import {
  GENERAL_SETTINGS_SECTIONS,
  GeneralSettingsTabs,
  type GeneralSettingsSection,
} from "@/settings/v2/components/ui/GeneralSettingsTabs";
import React, { useState } from "react";

const Preview = ({ initial }: { initial: GeneralSettingsSection }) => {
  const [section, setSection] = useState(initial);
  return (
    <GeneralSettingsTabs section={section} onSectionChange={setSection}>
      <div className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-4 tw-text-sm">
        {t(GENERAL_SETTINGS_SECTIONS.find((item) => item.id === section)!.label)}
      </div>
    </GeneralSettingsTabs>
  );
};

const meta = {
  title: "Settings/General settings tabs",
  component: GeneralSettingsTabs,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof GeneralSettingsTabs>>;
export default meta;

export const General: StoryObj<React.ComponentProps<typeof GeneralSettingsTabs>> = {
  render: () => <Preview initial="general" />,
};
export const Instructions: StoryObj<React.ComponentProps<typeof GeneralSettingsTabs>> = {
  render: () => <Preview initial="instructions" />,
};
export const Saving: StoryObj<React.ComponentProps<typeof GeneralSettingsTabs>> = {
  render: () => <Preview initial="saving" />,
};
export const Others: StoryObj<React.ComponentProps<typeof GeneralSettingsTabs>> = {
  render: () => <Preview initial="others" />,
};
export const Support: StoryObj<React.ComponentProps<typeof GeneralSettingsTabs>> = {
  render: () => <Preview initial="debug" />,
};

export const About: StoryObj<React.ComponentProps<typeof GeneralSettingsTabs>> = {
  render: () => <Preview initial="about" />,
};
