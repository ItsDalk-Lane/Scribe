import { t } from "@/lib/i18n";
import type { Meta, StoryObj } from "@/lib/story";
import {
  QUICK_ACTIONS_SECTIONS,
  QuickActionsTabs,
  type QuickActionsSection,
} from "@/settings/v2/components/ui/QuickActionsTabs";
import React, { useState } from "react";

const Preview = ({ initial }: { initial: QuickActionsSection }) => {
  const [section, setSection] = useState(initial);
  return (
    <QuickActionsTabs section={section} onSectionChange={setSection}>
      <div className="tw-rounded-lg tw-border tw-border-solid tw-border-border tw-p-4 tw-text-sm">
        {t(QUICK_ACTIONS_SECTIONS.find((item) => item.id === section)!.label)}
      </div>
    </QuickActionsTabs>
  );
};

const meta = {
  title: "Settings/Quick actions tabs",
  component: QuickActionsTabs,
  parameters: { gallery: { host: "settings-tab", layout: "padded" } },
} satisfies Meta<React.ComponentProps<typeof QuickActionsTabs>>;
export default meta;

export const ModelsAndProviders: StoryObj<React.ComponentProps<typeof QuickActionsTabs>> = {
  render: () => <Preview initial="models" />,
};
export const Tools: StoryObj<React.ComponentProps<typeof QuickActionsTabs>> = {
  render: () => <Preview initial="tools" />,
};
export const Commands: StoryObj<React.ComponentProps<typeof QuickActionsTabs>> = {
  render: () => <Preview initial="commands" />,
};
